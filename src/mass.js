// 弥撒排歌：每个位置选歌 → 保存时自动生成乐谱排单（setlists），乐谱 App 不用改
import { collection, getDocs, doc, getDoc, setDoc, deleteDoc, updateDoc, deleteField } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { LIBRARY_DATA, loadLibrary } from "./library.js";
import { clean, waTitle, ORDINARY, massSetOf } from "./mass-common.js";
import { autofill, sourcesFor, litDay, suggestFor, warmHistory, PROPER } from "./autofill.js";
import { WEDDING_ROLES, WEDDING_TIMES, timeText, findMember, roleZh } from "./weddings-common.js";

const $ = id => document.getElementById(id);
const MASSES = 'masses';
const SETLISTS = 'setlists';

// 一台主日弥撒的位置（照现在排单的顺序）。code = 歌本编号的字母，hint = 歌名关键字，用来推荐和导入
const SLOT_TEMPLATE = [
  { key: 'pre',         label: '弥撒前祷文',          hint: ['祷文'] },
  { key: 'entrance',    label: '进堂咏',              code: 'C' },
  { key: 'kyrie',       label: '垂怜曲',              hint: ['垂怜'] },
  { key: 'gloria',      label: '光荣颂',              hint: ['光荣颂'] },
  { key: 'psalm',       label: '答唱咏',              hint: ['圣咏'] },
  { key: 'alleluia',    label: '福音前欢呼',          hint: ['阿肋路亚', '福音前'] },
  { key: 'offertory',   label: '奉献咏',              code: 'D' },
  { key: 'sanctus',     label: '圣圣圣',              hint: ['圣圣圣'] },
  { key: 'mystery',     label: '信德的奥迹',          hint: ['信德的奥迹', '欢呼词'] },
  { key: 'pater',       label: '天主经',              hint: ['天主经'] },
  { key: 'doxology',    label: '天下万国',            hint: ['天下万国'] },
  { key: 'agnus',       label: '羔羊颂',              hint: ['羔羊'] },
  { key: 'communion',   label: '领主咏',              code: 'E' },
  { key: 'thanks',      label: '谢主咏',              code: 'E' },
  { key: 'welcome',     label: '欢迎曲',              hint: ['欢迎'] },
  { key: 'recessional', label: '礼成咏' },
  { key: 'post',        label: '弥撒后祷文',          hint: ['祷文'] },
];
const TPL = Object.fromEntries(SLOT_TEMPLATE.map(s => [s.key, s]));

// 💒 婚礼也在这里排：kind = rite 婚配礼仪（其中一方不是教友，没有感恩经）／wedding 婚姻弥撒（全套）；主日、平日弥撒没有 kind
// 婚礼一天可以几台，id = 日期_时间（2026-10-17_0930），多了 time、roles [{role,name}]、singers [团员名字]
const KIND_TITLE = { rite: '婚配礼仪~ ', wedding: '婚姻弥撒~ ' };
const RITE_KEYS = ['pre', 'entrance', 'psalm', 'alleluia', 'pater', 'communion', 'thanks', 'recessional', 'post'];
const templateOf = kind => kind === 'rite' ? SLOT_TEMPLATE.filter(s => RITE_KEYS.includes(s.key)) : kind ? SLOT_TEMPLATE.filter(s => s.key !== 'welcome') : SLOT_TEMPLATE;
const isWed = m => !!m?.kind;
const regular = () => masses.filter(m => !m.kind);   // 自动排歌、推荐只看主日／平日弥撒
const idOf = m => m.kind ? `${m.date}_${String(m.time || '0000').replace(':', '')}` : m.date;
// 婚礼 WA 文字的简写（照平常发的：进：…／答：…；阿肋路亚、天主经只写歌名）
const SHORT = { entrance: '进', psalm: '答', offertory: '奉', communion: '领', thanks: '谢', recessional: '礼', alleluia: '', pater: '' };
let MEMBERS = [];
// 两个位置常常印在同一张谱（例如「垂怜曲 A1 & 光荣颂 A8」）：后面那个位置写「跟上面同一张谱」
const PAIR = { gloria: 'kyrie', mystery: 'sanctus' };
const hasHint = (t, key) => TPL[key].hint.some(h => String(t || '').includes(h));

// 以前存的弥撒「垂怜曲 & 光荣颂」「圣圣圣 & 信德的奥迹」是一个位置 → 拆成两个
function normalizeSlots(slots) {
  const out = [];
  (slots || []).forEach(s => {
    const sl = { ...s, label: TPL[s.key]?.label || s.label, songs: [...s.songs] };
    out.push(sl);
    const second = Object.keys(PAIR).find(k => PAIR[k] === s.key);
    if (!second || (slots || []).some(x => x.key === second)) return;
    // 只有后半段的谱（例如「光明弥撒 之 光荣颂 1」）搬过去
    const move = sl.songs.filter(x => hasHint(x.title, second) && !hasHint(x.title, s.key));
    sl.songs = sl.songs.filter(x => !move.includes(x));
    out.push({ key: second, label: TPL[second].label, songs: move });
  });
  return out;
}
// 礼仪固定、每台都一样的部分：复制文字时不列出来
const QUIET = new Set(['pre', 'post', 'pater', 'doxology']);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const codeOf = t => (String(t || '').match(/\s([A-Z])\d+/) || [])[1];  // "日升之处 C24" → "C"
// 曲库＋排过的弥撒里出现过、但曲库已经没有的歌（例如「弥撒前后祷文」）
let EXTRA = [];
const allSongs = () => LIBRARY_DATA.concat(EXTRA);
const songById = id => LIBRARY_DATA.find(s => s.id === id);

let masses = [];      // 所有已排的弥撒
let M = null;         // 正在编辑的这一场
let dirty = false;

// ───────── 日期、名称 ─────────
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function nextSunday(after = new Date()) {
  const d = new Date(after);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  return isoDate(d);
}
const setlistNameOf = m => {
  const [, mm, dd] = (m.date || '').split('-');
  return `${mm || ''}${dd || ''} ${m.kind ? timeText(m.time) + ' ' : ''}${m.title || ''}`.replace(/\s+/g, ' ').trim();
};

function emptyMass(date) {
  return { id: date, date, title: '', slots: SLOT_TEMPLATE.map(s => ({ key: s.key, label: s.label, songs: [] })), setlistName: null, isNew: true };
}

function setDirty(v = true) {
  dirty = v;
  $('status').textContent = v ? '● 还没保存' : (M?.savedAt ? `已保存 ${new Date(M.savedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '');
  $('status').className = `text-xs flex-1 min-w-0 truncate ${v ? 'text-amber-600' : 'text-slate-500'}`;
}
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

// ───────── 画面 ─────────
function renderHeader() {
  $('mass-kind').value = M.kind || '';
  $('mass-time').value = M.time || '';
  document.querySelectorAll('.wed-only').forEach(el => el.classList.toggle('hidden', !isWed(M)));
  $('btn-bulk').classList.toggle('hidden', isWed(M));
  renderWed();
  $('mass-date').value = M.date;
  $('mass-title').value = M.title;
  // 以前写在职务表的备注（例如「原本 Frank，当天不舒服，Francis 补上」）：搬来这里一起改，保存后职务表那份就收掉
  const dn = !isWed(M) && DUTY[M.date]?.note;
  if (dn && !(M.note || '').includes(dn)) M.note = [M.note, dn].filter(Boolean).join('；');
  $('mass-note').value = M.note || '';
  const missing = M.slots.reduce((n, s) => n + s.songs.filter(x => x.missing).length, 0);
  $('draft-banner').classList.toggle('hidden', !!M.setlistName || M.isNew);
  $('draft-banner').textContent = `草稿：还没出现在乐谱 App。检查好按「保存并更新乐谱」才会生成排单。${missing ? `另外有 ${missing} 首曲库还没有谱（⚠ 标出来的）。` : ''}`;
  $('setlist-name-preview').textContent = setlistNameOf(M) || '—';
  const sel = $('mass-select');
  const opts = masses.map(m => `<option value="${esc(m.id)}">${m.kind ? '💒 ' : ''}${esc(m.date)}${m.kind ? ' ' + esc(timeText(m.time)) : ''}　${esc(m.title || '')}${m.setlistName ? '' : '　（草稿）'}</option>`);
  if (M.isNew) opts.unshift(`<option value="__new">（新的一场，还没保存）</option>`);
  sel.innerHTML = opts.join('') || '<option>还没有</option>';
  sel.value = M.isNew ? '__new' : M.id;

  // 新的一场／草稿：显示照哪一份旧歌单排的，可以换；另外两个起手方法
  const tools = $('start-tools');
  tools.innerHTML = '';
  if ((M.isNew || !M.setlistName) && !isWed(M)) renderAutoBox(tools);
  if (M.isNew) {
    const pool = isWed(M) ? masses.filter(isWed) : regular();
    const prev = pool.find(m => m.date < M.date) || pool[0];
    if (prev) addTool(tools, `照上一${isWed(M) ? '台婚礼' : '场'}（${prev.date} ${prev.title || ''}）复制歌，再换`, () => copyFrom(prev));
    addTool(tools, '从现有的乐谱排单导入', importFromSetlist);
  }
}

const SEASON_NAME = { OT: '常年期', ADV: '将临期', LENT: '四旬期', EAS: '复活期', XMAS: '圣诞期', TRIDUUM: '圣周三日' };
function renderAutoBox(tools) {
  if (!M.date) return;
  const { day, sources } = sourcesFor(M.date, M.title, regular(), LIBRARY_DATA);
  const box = document.createElement('div');
  box.className = 'w-full text-xs space-y-1.5 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2';
  const cur = sources.find(s => s.id === M.autoFrom);
  const head = `${esc(day.name)} · <b>${day.cycle}年</b>`;
  box.innerHTML = `
    <div class="text-slate-600">${head}${cur ? `　✅ 已照「${esc(cur.label)}」排好，检查一下再保存` : sources.length ? '' : '　以前的歌单里没有这个主日，请自己选歌'}</div>
    ${sources.length ? `<label class="flex flex-wrap items-center gap-2 text-slate-500">${cur ? '换成别年的：' : '照以前的歌单排：'}
      <select id="auto-src" class="flex-1 min-w-[12rem] border border-slate-300 rounded-md px-2 py-1 bg-white text-slate-700">
        ${cur ? '' : '<option value="">— 选一份 —</option>'}
        ${sources.map(s => `<option value="${esc(s.id)}" ${s.id === M.autoFrom ? 'selected' : ''}>${s.cycle === day.cycle ? '★ ' : ''}${esc(s.label)}</option>`).join('')}
      </select></label>
      <div class="text-slate-400">★ = 同一个${day.cycle}年，最适合照着排</div>` : ''}
    ${M.autoFrom !== undefined && M.ordinaryHint ? `<div class="text-amber-700">${esc(M.ordinaryHint)}</div>` : ''}`;
  tools.appendChild(box);
  box.querySelector('#auto-src')?.addEventListener('change', e => {
    if (!e.target.value) return;
    const filled = M.slots.some(s => s.songs.length);
    if (filled && !confirm('换掉现在排好的歌？（固定部分如垂怜曲不会动）')) { e.target.value = M.autoFrom || ''; return; }
    applyAuto(e.target.value, { keepOrdinary: filled });
  });
}

// 照以前同一个主日的歌单自动排：换歌部分照来源，固定部分（垂怜曲、圣圣圣…）照同季最近一场
function applyAuto(sourceId, { keepOrdinary = false } = {}) {
  if (!M.title || M.autoTitle) { M.title = litDay(M.date).name; M.autoTitle = true; }
  const a = autofill(M.date, M.title, regular(), LIBRARY_DATA, SLOT_TEMPLATE, sourceId);
  if (keepOrdinary) {
    // 只换会换歌的位置，其他的（包括自己加的位置）不动
    M.slots = M.slots.map(s => { const n = a.slots.find(x => x.key === s.key); return n && a.source && ['entrance', 'psalm', 'offertory', 'communion', 'thanks', 'recessional'].includes(s.key) ? n : s; });
  } else {
    M.slots = a.slots;
  }
  M.autoFrom = a.source?.id || null;
  if (a.source) M.note = a.note;
  M.ordinaryHint = a.ordinary ? '' : `⚠ ${SEASON_NAME[a.day.season] || '这个礼仪季'}还没排过：垂怜曲、圣圣圣这些固定部分请选一次，之后同季的会自动带上`;
  M.manual = false;
  setDirty(M.slots.some(s => s.songs.length));
  renderSlots();
  renderHeader();
}
function addTool(box, label, fn) {
  const b = document.createElement('button');
  b.className = 'px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 text-sm hover:bg-indigo-100';
  b.textContent = label;
  b.addEventListener('click', fn);
  box.appendChild(b);
}

// 这个位置空着，但上一个配对位置的谱已经包含它 → 回传那个位置的名称
function sharedWith(si) {
  const slot = M.slots[si];
  const first = PAIR[slot.key] && M.slots.find(s => s.key === PAIR[slot.key]);
  return first && first.songs.some(x => hasHint(x.title, slot.key)) ? first.label : null;
}
function renderSlots() {
  const box = $('slots');
  box.innerHTML = '';
  M.slots.forEach((slot, si) => {
    const el = document.createElement('div');
    el.className = 'bg-white rounded-xl border border-slate-200 px-3 py-2.5';
    const songs = slot.songs.map((s, k) => `
      <div class="flex items-center gap-1.5 py-1 group">
        ${s.missing
          ? `<span class="flex-1 min-w-0 truncate text-sm text-amber-600" title="曲库里还没有这首的谱：先到排单后台上传，再回来按 ＋ 选歌换掉它">⚠ 还没有谱：${esc(s.title)}</span>`
          : `<span class="flex-1 min-w-0"><a href="${esc(s.imageUrl)}" target="_blank" rel="noopener" class="block truncate text-sm text-slate-800 hover:text-indigo-600" title="看乐谱">${esc(clean(s.title))}</a>${s.note ? `<span class="block text-xs text-indigo-600">✎ ${esc(s.note)}</span>` : ''}</span>`}
        ${s.missing ? '' : `<button data-act="note" data-si="${si}" data-k="${k}" class="px-1.5 ${s.note ? 'text-indigo-500' : 'text-slate-300'} hover:text-indigo-600" title="这一台唱哪几段／特别歌词">✎</button>`}
        ${slot.songs.length > 1 ? `<button data-act="up" data-si="${si}" data-k="${k}" class="px-1.5 text-slate-300 hover:text-slate-600 ${k === 0 ? 'invisible' : ''}" title="上移">↑</button>` : ''}
        <button data-act="rm" data-si="${si}" data-k="${k}" class="px-1.5 text-slate-300 hover:text-red-500" title="拿掉">✕</button>
      </div>`).join('');
    el.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="text-xs font-semibold text-slate-500 w-28 shrink-0">${esc(slot.label)}</div>
        <div class="flex-1 min-w-0">${songs || (sharedWith(si) ? `<span class="text-sm text-slate-400">✓ 跟上面「${esc(sharedWith(si))}」同一张谱</span>` : '<span class="text-sm text-slate-300">—</span>')}</div>
        <button data-act="add" data-si="${si}" class="shrink-0 px-2.5 py-1 rounded-md bg-slate-100 hover:bg-indigo-100 hover:text-indigo-700 text-xs">＋ 选歌</button>
        ${TPL[slot.key] ? '' : `<button data-act="del-slot" data-si="${si}" class="shrink-0 px-1 text-xs text-slate-300 hover:text-red-500" title="删掉这个位置">删</button>`}
      </div>`;
    box.appendChild(el);
  });
}

$('slots').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const si = Number(b.dataset.si), k = Number(b.dataset.k);
  const slot = M.slots[si];
  if (b.dataset.act === 'add') return openPicker(si);
  if (b.dataset.act === 'rm') slot.songs.splice(k, 1);
  if (b.dataset.act === 'note') {
    const x = slot.songs[k];
    const v = prompt('这首歌这一台唱哪几段／特别歌词？（例如：唱 1、3 段；圣诞节歌词）\n空白 = 不用注明', x.note || '');
    if (v === null) return;
    if (v.trim()) x.note = v.trim(); else delete x.note;
  }
  if (b.dataset.act === 'up' && k > 0) [slot.songs[k - 1], slot.songs[k]] = [slot.songs[k], slot.songs[k - 1]];
  if (b.dataset.act === 'del-slot') {
    if (slot.songs.length && !confirm(`删掉「${slot.label}」这个位置和里面的歌？`)) return;
    M.slots.splice(si, 1);
  }
  M.manual = true;
  setDirty();
  renderSlots();
  renderHeader();
});

$('btn-add-slot').addEventListener('click', () => {
  const name = prompt('新位置叫什么？（例如：圣母歌、洗脚礼、特别献唱）');
  if (!name || !name.trim()) return;
  const after = prompt('放在哪一个位置后面？输入那个位置的名称（不填就放在礼成咏前面）', '领主咏') || '';
  let idx = M.slots.findIndex(s => s.label === after.trim());
  if (idx === -1) idx = M.slots.findIndex(s => s.key === 'recessional') - 1;
  M.slots.splice(idx + 1, 0, { key: `custom_${Date.now()}`, label: name.trim(), songs: [] });
  M.manual = true;
  setDirty();
  renderSlots();
});

['mass-date', 'mass-title', 'mass-note'].forEach(id => $(id).addEventListener('input', () => {
  M.date = $('mass-date').value;
  if (M.title !== $('mass-title').value.trim()) M.autoTitle = false;
  M.title = $('mass-title').value.trim();
  M.note = $('mass-note').value.trim();
  $('setlist-name-preview').textContent = setlistNameOf(M) || '—';
  setDirty();
}));
// 新的一场还没动过歌：改日期／改礼仪名称 → 重新自动排
['mass-date', 'mass-title'].forEach(id => $(id).addEventListener('change', () => {
  if (!M.isNew || M.manual || !M.date || isWed(M)) return renderHeader();
  if (id === 'mass-title' && !M.title) M.autoTitle = true;
  applyAuto();
}));

// ───────── 选歌 ─────────
let pickSlot = null;
let pickSug = null;   // 这次选歌的推荐（拿以前这个主日的备注用）
function openPicker(si) {
  pickSlot = si;
  const slot = M.slots[si];
  const tpl = TPL[slot.key] || {};
  $('picker-title').textContent = `选「${slot.label}」`;
  $('picker-search').value = '';
  $('picker-suggest').checked = !!(tpl.code || tpl.hint);
  $('picker-suggest').parentElement.classList.toggle('hidden', !(tpl.code || tpl.hint));
  $('picker').classList.remove('hidden');
  renderPicker();
  setTimeout(() => $('picker-search').focus(), 50);
}
function closePicker() { $('picker').classList.add('hidden'); pickSlot = null; }
$('picker-close').addEventListener('click', closePicker);
$('picker').addEventListener('click', e => { if (e.target === $('picker')) closePicker(); });
$('picker-search').addEventListener('input', renderPicker);
$('picker-suggest').addEventListener('change', renderPicker);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePicker(); });

function fits(song, tpl) {
  if (tpl.code && codeOf(song.title) === tpl.code) return true;
  if (tpl.hint && tpl.hint.some(h => song.title.includes(h))) return true;
  return false;
}
// 这首歌以前在这个位置唱过几次（从已存的弥撒算）
function usedCount(slotKey) {
  const c = {};
  masses.forEach(m => (m.slots || []).filter(s => s.key === slotKey).forEach(s => s.songs.forEach(x => { if (x.id) c[x.id] = (c[x.id] || 0) + 1; })));
  return c;
}
function renderPicker() {
  if (pickSlot === null) return;
  const slot = M.slots[pickSlot];
  const tpl = TPL[slot.key] || {};
  const q = $('picker-search').value.trim().toLowerCase();
  const onlyFit = $('picker-suggest').checked && !q;
  const used = usedCount(slot.key);
  // 推荐：以前这个主日唱过的、这个季节常唱的；前后几个礼拜已经排了的会提醒
  const sug = pickSug = M.date && !isWed(M) ? suggestFor(M.date, M.title, slot.key, regular().filter(m => m.id !== M.id), LIBRARY_DATA) : null;
  const recent = sug && PROPER.includes(slot.key) && slot.key !== 'psalm' ? sug.recent : {};
  const inSlot = new Set(slot.songs.map(x => x.id));
  const when = d => d === 0 ? '' : d < 0 ? `${Math.round(-d / 7) || 1} 周前刚唱过` : `${Math.round(d / 7) || 1} 周后已经排了`;
  const row = (s, right) => `
    <button data-id="${esc(s.id)}" class="w-full text-left flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-indigo-50 ${inSlot.has(s.id) ? 'opacity-40' : ''}">
      <span class="flex-1 min-w-0">
        <span class="block truncate text-sm">${esc(clean(s.title))}</span>
        ${recent[s.id] !== undefined ? `<span class="block text-[11px] text-amber-600">⚠ ${when(recent[s.id])}</span>` : ''}
      </span>
      ${right ? `<span class="text-[10px] text-slate-400 shrink-0 text-right">${right}</span>` : ''}
    </button>`;
  const head = t => `<div class="px-3 pt-2 pb-1 text-xs font-semibold text-slate-500">${t}</div>`;
  let top = '';
  if (sug && !q) {
    const ok = e => songById(e.song.id);
    const sd = sug.sameDay.filter(ok), se = sug.season.filter(ok);
    if (sd.length) top += head(`⭐ 以前「${esc(sug.day.name)}」唱过`) + sd.map(e => row(songById(e.song.id), `${e.sameCycle ? '★ ' : ''}${e.tags.slice(0, 3).join(' · ')}`)).join('');
    if (se.length) top += head(`这个季节常唱`) + se.map(e => row(songById(e.song.id), `唱过 ${e.n} 次`)).join('');
    if (top) top += head('全部');
  }
  let list = allSongs().filter(s => (!q || s.title.toLowerCase().includes(q)) && (!onlyFit || fits(s, tpl)));
  list.sort((a, b) => (used[b.id] || 0) - (used[a.id] || 0) || clean(a.title).localeCompare(clean(b.title), 'zh'));
  const total = list.length;
  list = list.slice(0, 120);
  $('picker-list').innerHTML = top + list.map(s => row(s, used[s.id] ? `唱过 ${used[s.id]} 次` : '')).join('')
    + (total > list.length ? `<div class="text-xs text-slate-400 text-center py-2">还有 ${total - list.length} 首，打字缩小范围</div>` : '')
    + (!total ? '<div class="text-sm text-slate-400 text-center py-8">找不到。试试别的字，或把「只看适合这个位置的」关掉。</div>' : '');
}
$('picker-list').addEventListener('click', e => {
  const b = e.target.closest('button[data-id]');
  if (!b || pickSlot === null) return;
  const s = allSongs().find(x => x.id === b.dataset.id);
  if (!s) return;
  // 以前这个主日唱这首时有注明唱哪几段，就照抄过来
  const note = pickSug?.sameDay.find(e => e.song.id === s.id)?.song.note;
  M.slots[pickSlot].songs.push({ id: s.id, title: s.title, imageUrl: s.imageUrl, ...(note ? { note } : {}) });
  M.manual = true;
  setDirty();
  renderSlots();
  renderHeader();
  closePicker();
});

// ───────── 起手：复制上一场／从排单导入 ─────────
function copyFrom(prev) {
  const keep = { date: M.date, title: M.title };
  M.slots = prev.slots.map(s => ({ key: s.key, label: s.label, songs: s.songs.map(x => ({ ...x })) }));
  Object.assign(M, keep, { manual: true, autoFrom: undefined });
  setDirty();
  renderSlots();
  renderHeader();
}

async function importFromSetlist() {
  const snap = await getDocs(collection(db, SETLISTS));
  const lists = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (!lists.length) return alert('乐谱里还没有排单。');
  const menu = lists.map((l, i) => `${i + 1}. ${l.name}`).join('\n');
  const pick = prompt(`要导入哪一份？输入号码：\n\n${menu}`, '1');
  const l = lists[Number(pick) - 1];
  if (!l) return;
  M.slots = assignToSlots(l.items || []);
  // 排单名称像 "1018 常年29主日" → 礼仪名拿来用
  if (!M.title) M.title = (l.name || '').replace(/^\d{3,4}\s*/, '');
  M.importedFrom = l.id;
  M.manual = true;
  M.autoFrom = undefined;
  setDirty();
  renderSlots();
  renderHeader();
}

// 把一份排单的歌，按歌名关键字／编号字母／前后位置，分到每个位置
function assignToSlots(items) {
  const slots = SLOT_TEMPLATE.map(s => ({ key: s.key, label: s.label, songs: [] }));
  const S = Object.fromEntries(slots.map(s => [s.key, s]));
  const order = SLOT_TEMPLATE.map(s => s.key);
  const hintOrder = ['psalm', 'kyrie', 'gloria', 'alleluia', 'sanctus', 'mystery', 'pater', 'doxology', 'agnus', 'welcome'];
  let last = -1;
  const put = (key, it) => { S[key].songs.push({ id: it.id, title: it.title, imageUrl: it.imageUrl }); last = Math.max(last, order.indexOf(key)); };
  items.forEach(it => {
    const t = it.title || '';
    if (t.includes('祷文')) return put(last < order.indexOf('entrance') ? 'pre' : 'post', it);
    const h = hintOrder.find(k => TPL[k].hint.some(x => t.includes(x)));
    if (h) return put(h, it);
    const c = codeOf(t);
    if (c === 'C' && !S.entrance.songs.length) return put('entrance', it);
    if (c === 'D') return put('offertory', it);
    if (c === 'E') return put(S.communion.songs.length && last >= order.indexOf('communion') ? 'thanks' : 'communion', it);
    // 认不出来：放进"目前位置之后、第一个还空着的会换歌的位置"
    const propers = ['entrance', 'offertory', 'communion', 'thanks', 'recessional'];
    const next = propers.find(k => order.indexOf(k) > last && !S[k].songs.length)
      || propers.slice().reverse().find(k => order.indexOf(k) <= last) || 'recessional';
    put(next, it);
  });
  return slots;
}

// ───────── 保存：写 masses + 生成乐谱排单 ─────────
$('btn-save').addEventListener('click', save);
async function save() {
  M.date = $('mass-date').value;
  M.title = $('mass-title').value.trim();
  if (!M.date) return alert('请先填日期。');
  if (!M.title) return alert('请先填礼仪名称（例如：常年29主日）。');
  if (isWed(M) && !M.time) return alert('婚礼要填时间。');
  if (isWed(M) && Object.values(KIND_TITLE).includes(M.title + ' ')) return alert('名称要写新人的名字，例如：婚配礼仪~ Jason Tan & Yap Phui Khei');
  const items = [];
  let missing = 0;
  M.slots.forEach(s => s.songs.forEach(x => {
    if (x.missing) { missing++; return; }   // 还没有谱的，乐谱里先跳过
    if (items.some(i => i.id === x.id && PAIR[s.key])) return;   // 同一张谱放了两个位置：乐谱只出现一次
    const lib = songById(x.id) || x;   // 用曲库最新的歌名和图片
    items.push({ id: x.id, order: items.length + 1, title: lib.title, imageUrl: lib.imageUrl });
  }));
  if (!items.length) return alert('还没有选任何歌。');
  if (missing && !confirm(`有 ${missing} 首还没有谱（⚠），乐谱里会先跳过它们。继续保存？`)) return;

  const newId = idOf(M);
  if ((M.isNew || M.id !== newId) && masses.some(m => m.id === newId) && !confirm(`${M.date}${isWed(M) ? ' ' + timeText(M.time) : ''} 已经排过一场，要覆盖吗？`)) return;
  const name = setlistNameOf(M);
  const btn = $('btn-save');
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    const oldId = M.isNew ? null : M.id;
    const oldSetlist = M.setlistName;
    const now = new Date().toISOString();
    const data = {
      date: M.date, title: M.title, note: M.note || '', setlistName: name,
      slots: M.slots.map(s => ({ key: s.key, label: s.label, songs: s.songs.map(x => x.missing
        ? { id: null, title: x.title, imageUrl: '', missing: true }
        : { id: x.id, title: (songById(x.id) || x).title, imageUrl: (songById(x.id) || x).imageUrl, ...(x.note ? { note: x.note } : {}) }) })),
      ...(isWed(M) ? {
        kind: M.kind, time: M.time,
        roles: (M.roles || []).filter(r => r.role.trim()).map(r => ({ role: r.role.trim(), name: r.name.trim() })),
        singers: M.singers || [],
      } : {}),
      createdAt: M.createdAt || now, savedAt: now,
    };
    await setDoc(doc(db, MASSES, newId), data);
    if (!isWed(M) && DUTY[M.date]?.note) {   // 备注已经搬进这一场了
      await updateDoc(doc(db, 'duties', M.date), { note: deleteField() }).catch(console.error);
      delete DUTY[M.date].note;
    }

    // 乐谱排单：同名就更新歌单（保留原本建立时间和直播翻页），没有就新建
    const ref = doc(db, SETLISTS, name);
    const existing = await getDoc(ref);
    await setDoc(ref, { name, items, date: M.date, ...(existing.exists() ? {} : { createdAt: now }) }, { merge: true });

    // 改了日期或名称：把这一场以前生成的旧排单／旧记录收掉，免得乐谱里出现两份
    if (oldSetlist && oldSetlist !== name) await deleteDoc(doc(db, SETLISTS, oldSetlist));
    if (oldId && oldId !== newId) await deleteDoc(doc(db, MASSES, oldId));

    Object.assign(M, data, { id: newId, isNew: false });
    if (!isWed(M)) ['kind', 'time', 'roles', 'singers'].forEach(k => delete M[k]);
    history.replaceState(null, '', `?id=${encodeURIComponent(newId)}`);
    await loadMasses();
    setDirty(false);
    renderHeader();
    renderSlots();
    $('status').textContent = `✅ 已保存，乐谱排单「${name}」已更新（${items.length} 页）`;
  } catch (e) {
    console.error(e);
    alert('保存失败：' + (e.code || e.message));
  } finally {
    btn.disabled = false;
    btn.textContent = '保存并更新乐谱';
  }
}

// ───────── 复制歌单文字（贴 WhatsApp）─────────
$('btn-copy').addEventListener('click', async () => {
  if (isWed(M)) {
    const text = waWedding();
    try { await navigator.clipboard.writeText(text); $('status').textContent = '✅ 已复制，可以贴到 WhatsApp'; }
    catch { prompt('复制下面这段：', text); }
    return;
  }
  const [, mm, dd] = (M.date || '').split('-');
  const lines = [`*${Number(dd) || ''}/${Number(mm) || ''} ${M.title || ''}*`];
  // 礼仪曲（垂怜曲、圣圣圣…）是一整套的：只写一行「弥撒曲：常年期」
  const sets = M.slots.filter(s => ORDINARY.includes(s.key)).flatMap(s => s.songs.map(x => massSetOf(x.title)));
  const named = [...new Set(sets.filter(Boolean))];
  if (named.length) lines.push(`弥撒曲：${named.join('、')}`);
  // 只列每台会换的歌（进堂、答唱、奉献、领主、谢主、礼成）和自己加的位置
  //（礼仪曲认不出是哪一套的，照旧写出来）
  const odd = s => ORDINARY.includes(s.key) && s.songs.some(x => !massSetOf(x.title));
  M.slots.filter(s => (PROPER.includes(s.key) || !TPL[s.key] || odd(s)) && s.songs.length).forEach(s => {
    lines.push(`${s.label}：${s.songs.map(x => waTitle(x.title) + (x.note ? `（${x.note}）` : '')).filter((t, i, a) => a.indexOf(t) === i).join(' / ')}`);
  });
  if (M.note) lines.push('', M.note);
  // 职务表有排这一场：带上谁指挥、谁答唱咏…
  {
    const d = DUTY[M.date] || {};
    const duty = [['conductor', '指挥'], ['cantor', '答唱咏'], ['piano', '钢琴'], ['organ', '风琴'], ['guitar', '吉他'], ['drums', '鼓手']]
      .filter(([k]) => d[k]).map(([k, l]) => `${l}：${d[k]}`);
    if (duty.length) lines.push('', ...duty);
  }
  const text = lines.join('\n');
  try { await navigator.clipboard.writeText(text); $('status').textContent = '✅ 已复制，可以贴到 WhatsApp'; }
  catch { prompt('复制下面这段：', text); }
});

// ───────── 读取 ─────────
// 职务表（复制歌单文字时带上谁指挥、谁答唱咏）
let DUTY = {};
async function loadMasses() {
  const duty = getDocs(collection(db, 'duties')).then(s => { DUTY = Object.fromEntries(s.docs.map(d => [d.id, d.data()])); }).catch(() => {});
  getDocs(collection(db, 'members')).then(s => {
    MEMBERS = s.docs.map(d => d.data()).filter(m => m.active !== false).sort((a, b) => a.name.localeCompare(b.name));
    $('names').innerHTML = MEMBERS.map(m => `<option value="${esc(m.name)}">${esc(m.fullName || '')}</option>`).join('');
  }).catch(() => {});
  const [snap] = await Promise.all([getDocs(collection(db, MASSES)), duty]);
  masses = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || ''));
  // 歌名以曲库为准：改过名的歌，旧弥撒里也显示新名字
  masses.forEach(m => { m.slots = normalizeSlots(m.slots); m.slots.forEach(sl => sl.songs.forEach(x => { const t = songById(x.id)?.title; if (t) x.title = t; })); });
  const seen = new Set(LIBRARY_DATA.map(x => x.id));
  EXTRA = [];
  masses.forEach(m => m.slots.forEach(sl => sl.songs.forEach(x => {
    if (x.id && !x.missing && !seen.has(x.id)) { seen.add(x.id); EXTRA.push({ id: x.id, title: x.title, imageUrl: x.imageUrl }); }
  })));
}
function openMass(m) {
  M = { ...m, slots: m.slots.map(s => ({ ...s, songs: s.songs.map(x => ({ ...x })) })), isNew: false,
    ...(m.kind ? { roles: (m.roles || []).map(r => ({ ...r })), singers: [...(m.singers || [])] } : {}) };
  setDirty(false);
  renderHeader();
  renderSlots();
}
function newMass() {
  const latest = regular()[0]?.date;
  const base = latest && latest >= isoDate(new Date()) ? new Date(latest + 'T12:00') : new Date();
  M = emptyMass(nextSunday(base));
  M.autoTitle = true;
  applyAuto();
}

// ───────── 一次排好后面几周（存成草稿，不会出现在乐谱 App）─────────
const serialize = slots => slots.map(s => ({ key: s.key, label: s.label, songs: s.songs.map(x => x.missing || !x.id
  ? { id: null, title: x.title, imageUrl: '', missing: true }
  : { id: x.id, title: x.title, imageUrl: x.imageUrl || '', ...(x.note ? { note: x.note } : {}) }) }));
$('btn-bulk').addEventListener('click', async () => {
  const last = regular()[0]?.date;
  const n = Number(prompt(`${last ? `已经排到 ${Number(last.slice(5, 7))}/${Number(last.slice(8))}（包括还没保存的草稿），从这之后` : ''}再往后自动排几个主日？`, '8'));
  if (!n || n < 1) return;
  const reg = regular();
  const start = new Date(Math.max(reg[0] ? new Date(reg[0].date + 'T12:00').getTime() : 0, Date.now()));
  // 后面 n 个主日，加上中间遇到的圣诞前夕／圣诞节
  const dates = [];
  let d = new Date(nextSunday(start) + 'T12:00');
  for (let i = 0; i < n; i++, d.setDate(d.getDate() + 7)) dates.push(isoDate(d));
  const end = dates[dates.length - 1];
  for (let y = start.getFullYear(); y <= Number(end.slice(0, 4)); y++) [`${y}-12-24`, `${y}-12-25`].forEach(x => { if (x > isoDate(start) && x <= end && !dates.includes(x)) dates.push(x); });
  dates.sort();
  const pool = [...reg];   // 新排的也算进去，后面几周的固定部分可以接着带
  const plan = [];
  for (const date of dates) {
    if (pool.some(m => m.date === date)) continue;
    const title = litDay(date).name;
    const a = autofill(date, title, pool, LIBRARY_DATA, SLOT_TEMPLATE);
    if (!a.source && new Date(date + 'T12:00').getDay() !== 0) continue;
    const m = { id: date, date, title, note: a.note, setlistName: null, importedFrom: a.source ? a.source.label : null, autoFrom: a.source?.id || null, slots: serialize(a.slots) };
    pool.push(m);
    plan.push({ m, a });
  }
  if (!plan.length) return alert('这几周都已经排过了。');
  const lines = plan.map(({ m, a }) => `${m.date.slice(5)} ${m.title}（${a.day.cycle}年）← ${a.source ? a.source.label : '找不到旧歌单，空的'}${a.ordinary ? '' : ' ⚠固定部分要自己选'}`);
  if (!confirm(`会新建这些草稿（不会出现在乐谱 App，检查好按保存才会）：\n\n${lines.join('\n')}\n\n确定？`)) return;
  $('status').textContent = '排歌中…';
  const now = new Date().toISOString();
  try {
    for (const { m } of plan) {
      const { id, ...data } = m;
      await setDoc(doc(db, MASSES, id), { ...data, createdAt: now, savedAt: now });
    }
  } catch (e) {
    console.error(e);
    return alert('排歌失败：' + (e.code || e.message));
  }
  await loadMasses();
  openMass(masses.find(x => x.id === plan[0].m.id));
  $('status').textContent = `✅ 排好 ${plan.length} 场草稿，在上面的选单里一场一场检查`;
});
$('mass-select').addEventListener('change', e => {
  if (e.target.value === '__new') return;
  if (dirty && !confirm('这一场还没保存，确定要换吗？')) { e.target.value = M.isNew ? '__new' : M.id; return; }
  const m = masses.find(x => x.id === e.target.value);
  if (m) openMass(m);
});
$('btn-new').addEventListener('click', () => {
  if (dirty && !confirm('这一场还没保存，确定要开新的吗？')) return;
  newMass();
});

(async function init() {
  $('status').textContent = '读取中…';
  try {
    await loadLibrary(db);
    await loadMasses();
  } catch (e) {
    console.error(e);
    $('status').textContent = '读取失败：' + (e.code || e.message);
    return;
  }
  // 默认打开：最近一场还没过的；没有就开新的
  const today = isoDate(new Date());
  const upcoming = [...regular()].reverse().find(m => m.date >= today);
  // 从「这台弥撒」总览点进来：?d=2026-10-18 直接打开那一天
  const qs = new URLSearchParams(location.search);
  const want = qs.get('d');
  const wanted = masses.find(m => m.id === qs.get('id')) || (want && (regular().find(m => m.date === want) || masses.find(m => m.date === want)));
  if (wanted) openMass(wanted);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(want || '')) { M = emptyMass(want); M.autoTitle = true; applyAuto(); }
  else if (upcoming) openMass(upcoming); else newMass();
  warmHistory(LIBRARY_DATA);
})();

// ───────── 💒 婚礼 ─────────
// 换种类：会换的歌照原本位置留着；新开的婚礼，固定部分（祷文、天主经、阿肋路亚、垂怜曲…）先照最近一台主日弥撒
function setKind(kind) {
  const wasWed = isWed(M);
  const fresh = M.isNew && !wasWed && kind;    // 新的一场从主日改成婚礼：主日自动排的歌不要
  if (fresh) M.date = nextSaturday();
  const old = fresh ? {} : Object.fromEntries(M.slots.map(s => [s.key, s]));
  const near = regular().find(m => m.date <= M.date) || regular().at(-1);
  const fixed = ['pre', 'post', 'pater', 'doxology', ...ORDINARY];
  const custom = fresh ? [] : M.slots.filter(s => !TPL[s.key]);
  M.slots = templateOf(kind).map(t => {
    if (old[t.key]) return old[t.key];
    const from = kind && fixed.includes(t.key) && near?.slots.find(s => s.key === t.key);
    return { key: t.key, label: t.label, songs: from ? from.songs.map(x => ({ ...x })) : [] };
  });
  const at = M.slots.findIndex(s => s.key === 'recessional');
  M.slots.splice(at < 0 ? M.slots.length : at, 0, ...custom);
  if (kind) {
    const prefix = Object.values(KIND_TITLE).find(t => M.title?.startsWith(t.trim()));
    M.title = !M.title || M.autoTitle || !wasWed ? KIND_TITLE[kind] : prefix ? KIND_TITLE[kind] + M.title.slice(prefix.trim().length).trim() : M.title;
    M.kind = kind;
    M.time ||= WEDDING_TIMES[0];
    M.roles ||= WEDDING_ROLES.map(role => ({ role, name: '' }));
    M.roles.forEach(r => { r.role = roleZh(r.role); });
    M.singers ||= [];
    M.autoTitle = false;
    M.manual = true;
  } else {
    if (M.isNew) return newMass();   // 新的一场改回主日：重新照下一个主日自动排
    ['kind', 'time', 'roles', 'singers'].forEach(k => delete M[k]);
  }
  setDirty();
  renderSlots();
  renderHeader();
  if (kind) { $('mass-title').focus(); $('mass-title').setSelectionRange(99, 99); }
}
function nextSaturday() {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return isoDate(d);
}
$('mass-kind').addEventListener('change', e => setKind(e.target.value));
$('mass-time').addEventListener('input', () => { M.time = $('mass-time').value; $('setlist-name-preview').textContent = setlistNameOf(M); renderWed(); setDirty(); });
$('time-quick').addEventListener('click', e => {
  const b = e.target.closest('[data-time]'); if (!b) return;
  M.time = $('mass-time').value = b.dataset.time;
  $('setlist-name-preview').textContent = setlistNameOf(M);
  renderWed(); setDirty();
});

function renderWed() {
  $('wed-box').classList.toggle('hidden', !isWed(M));
  if (!isWed(M)) return;
  $('time-quick').innerHTML = WEDDING_TIMES.map(t => `<button data-time="${t}" class="px-2.5 py-1 rounded-lg text-xs ${M.time === t ? 'bg-indigo-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}">${timeText(t)}</button>`).join('');
  $('roles').innerHTML = M.roles.map((r, i) => `
    <div class="flex items-center gap-2">
      <input data-role="${i}" value="${esc(r.role)}" class="w-24 shrink-0 border border-slate-200 rounded-lg px-2 py-1.5 text-slate-500">
      <input data-name="${i}" value="${esc(r.name)}" list="names" placeholder="谁？" class="flex-1 min-w-0 border border-slate-300 rounded-lg px-3 py-1.5">
      <button data-rmrole="${i}" class="text-slate-300 hover:text-red-500 px-1" aria-label="拿掉">✕</button>
    </div>`).join('');
  $('singer-n').textContent = M.singers.length ? `（${M.singers.length} 位）` : '';
  $('singers').innerHTML = M.singers.length ? M.singers.map((n, i) => `<span class="inline-flex items-center gap-1 rounded-lg bg-slate-100 pl-2.5 pr-1 py-1">${esc(n)}<button data-rmsinger="${i}" class="text-slate-400 hover:text-red-500 px-1" aria-label="拿掉">✕</button></span>`).join('')
    : '<span class="text-xs text-slate-400">还没加</span>';
  const saved = !M.isNew && M.id === idOf(M) && !dirty;
  $('wed-seat').classList.toggle('hidden', !!M.isNew);
  $('wed-seat').href = `seating.html?e=${encodeURIComponent(M.id || '')}`;
  $('wed-seat-hint').textContent = M.isNew ? '先保存，才可以排座位。' : saved ? '' : '有改动的话，先保存再去排座位。';
}
$('roles').addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.role) M.roles[+t.dataset.role].role = t.value;
  if (t.dataset.name) M.roles[+t.dataset.name].name = t.value;
  setDirty();
});
$('roles').addEventListener('click', e => {
  const b = e.target.closest('[data-rmrole]'); if (!b) return;
  M.roles.splice(+b.dataset.rmrole, 1); renderWed(); setDirty();
});
$('btn-add-role').addEventListener('click', () => { M.roles.push({ role: '', name: '' }); renderWed(); setDirty(); });
// 来唱的人存团员名单上的名字（座位表、披肩才对得上）；不是团员的照打的
$('singer-form').addEventListener('submit', e => {
  e.preventDefault();
  const add = $('singer-q').value.split(/[,，、\n]+/).map(s => s.trim()).filter(Boolean)
    .map(n => findMember(n, MEMBERS)?.name || n)
    .filter((n, i, a) => a.indexOf(n) === i && !M.singers.some(x => x.toLowerCase() === n.toLowerCase()));
  $('singer-q').value = '';
  if (!add.length) return;
  M.singers.push(...add);
  renderWed(); setDirty();
});
$('singers').addEventListener('click', e => {
  const b = e.target.closest('[data-rmsinger]'); if (!b) return;
  M.singers.splice(+b.dataset.rmsinger, 1); renderWed(); setDirty();
});

// 贴 WA 名单：有编号的行才算；「领经：Sebastian Yew」= 职务，「Ronald Mok」= 来唱的人
function parseWaList(text) {
  const roles = [], singers = [];
  text.split(/\n/).forEach(line => {
    const m = line.match(/^\s*\d+\s*[).、.]\s*(.+)$/);
    if (!m) return;
    const [role, ...rest] = m[1].split(/\s*[:：]\s*/);
    const name = rest.join(':').trim();
    if (rest.length && role.trim()) roles.push({ role: roleZh(role), name });
    else if (m[1].trim()) singers.push(m[1].trim());
  });
  return { roles, singers };
}
$('wa-apply').addEventListener('click', () => {
  const { roles, singers } = parseWaList($('wa-text').value);
  if (!roles.length && !singers.length) return alert('看不到名单。要有编号，例如「1)领经：Sebastian Yew」「9) Ronald Mok」。');
  const names = [...new Set(singers.map(n => findMember(n, MEMBERS)?.name || n))];
  const old = M.roles || [], oldS = M.singers || [];
  const lo = s => String(s || '').toLowerCase();
  const changes = [
    ...roles.filter(r => lo(old.find(o => o.role.trim() === r.role)?.name) !== lo(r.name)).map(r => `${r.role}：${old.find(o => o.role.trim() === r.role)?.name || '（空）'} → ${r.name || '（空）'}`),
    ...old.filter(o => o.role.trim() && !roles.some(r => r.role === o.role.trim())).map(o => `拿掉职务：${o.role}`),
    ...names.filter(n => !oldS.some(x => lo(x) === lo(n))).map(n => `＋ 来唱：${n}`),
    ...oldS.filter(x => !names.some(n => lo(n) === lo(x))).map(x => `− 不来唱：${x}`),
  ];
  if (!changes.length) return alert('跟现在的一样，不用改。');
  if (!confirm(`照 WA 名单更新：\n\n${changes.join('\n')}\n\n确定？（之后记得按保存）`)) return;
  if (roles.length) M.roles = roles;
  if (singers.length) M.singers = names;
  $('wa-text').value = '';
  $('wa-paste').open = false;
  renderWed(); setDirty();
});

// 婚礼的 WA 文字：照平常发的格式（标题、日期时间、进：…、职务、歌咏团名单）
const fullOf = n => { const m = MEMBERS.find(x => x.name === n); return String(m?.fullName || '').replace(/[\u3400-\u9fff]+/g, '').trim() || n; };
function waWedding() {
  const [y, mm, dd] = M.date.split('-');
  const lines = [`*${M.title}*`, `${+dd}/${+mm}/${y}（${'日一二三四五六'[new Date(M.date + 'T12:00').getDay()]}）${timeText(M.time)}`, ''];
  const ord = s => ORDINARY.includes(s.key) && s.key !== 'alleluia';
  const sets = [...new Set(M.slots.filter(ord).flatMap(s => s.songs.map(x => massSetOf(x.title))).filter(Boolean))];
  if (sets.length) lines.push(`弥撒曲：${sets.join('、')}`);
  M.slots.filter(s => s.songs.length && !['pre', 'post', 'doxology'].includes(s.key) && !(ord(s) && s.songs.every(x => massSetOf(x.title)))).forEach(s => {
    const k = s.key in SHORT ? SHORT[s.key] : s.label;
    lines.push(`${k ? k + '：' : ''}${s.songs.map(x => waTitle(x.title) + (x.note ? `（${x.note}）` : '')).filter((t, i, a) => a.indexOf(t) === i).join(' / ')}`);
  });
  if (M.note) lines.push('', M.note);
  const roles = (M.roles || []).filter(r => r.role.trim() && r.name.trim());
  if (roles.length) lines.push('', ...roles.map(r => `${r.role.trim()}：${r.name.trim()}`));
  if (M.singers?.length) lines.push('', '歌咏团：', ...M.singers.map(fullOf));
  return lines.join('\n');
}

// 「📅 总览」带着现在这一天过去
window.sicNavDate = () => M?.date;   // 菜单去别页时带着这个日期
