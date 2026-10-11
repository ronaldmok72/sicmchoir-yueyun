// 弥撒排歌：每个位置选歌 → 保存时自动生成乐谱排单（setlists），乐谱 App 不用改
import { collection, getDocs, doc, getDoc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { LIBRARY_DATA, loadLibrary } from "./library.js";

const $ = id => document.getElementById(id);
const MASSES = 'masses';
const SETLISTS = 'setlists';

// 一台主日弥撒的位置（照现在排单的顺序）。code = 歌本编号的字母，hint = 歌名关键字，用来推荐和导入
const SLOT_TEMPLATE = [
  { key: 'pre',         label: '弥撒前祷文',          hint: ['祷文'] },
  { key: 'entrance',    label: '进堂咏',              code: 'C' },
  { key: 'kyrie',       label: '垂怜曲 & 光荣颂',     hint: ['垂怜', '光荣颂'] },
  { key: 'psalm',       label: '答唱咏',              hint: ['圣咏'] },
  { key: 'alleluia',    label: '福音前欢呼',          hint: ['阿肋路亚', '福音前'] },
  { key: 'offertory',   label: '奉献咏',              code: 'D' },
  { key: 'sanctus',     label: '圣圣圣 & 信德的奥迹', hint: ['圣圣圣', '欢呼词', '信德的奥迹'] },
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
// 礼仪固定、每台都一样的部分：复制文字时不列出来
const QUIET = new Set(['pre', 'post', 'pater', 'doxology']);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = t => String(t || '').replace(/^[a-z]\s+/, '');           // 去掉排序用的开头字母 "r 日升之处" → "日升之处"
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
  return `${mm || ''}${dd || ''} ${m.title || ''}`.trim();
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
  $('mass-date').value = M.date;
  $('mass-title').value = M.title;
  $('setlist-name-preview').textContent = setlistNameOf(M) || '—';
  const sel = $('mass-select');
  const opts = masses.map(m => `<option value="${esc(m.id)}">${esc(m.date)}　${esc(m.title || '')}</option>`);
  if (M.isNew) opts.unshift(`<option value="__new">（新的一场，还没保存）</option>`);
  sel.innerHTML = opts.join('') || '<option>还没有</option>';
  sel.value = M.isNew ? '__new' : M.id;

  // 新的一场：给两个起手方法
  const tools = $('start-tools');
  tools.innerHTML = '';
  const empty = M.slots.every(s => !s.songs.length);
  if (M.isNew && empty) {
    const prev = masses.find(m => m.date < M.date) || masses[0];
    if (prev) addTool(tools, `照上一场（${prev.date} ${prev.title || ''}）复制，再换歌`, () => copyFrom(prev));
    addTool(tools, '从现有的乐谱排单导入', importFromSetlist);
  }
}
function addTool(box, label, fn) {
  const b = document.createElement('button');
  b.className = 'px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 text-sm hover:bg-indigo-100';
  b.textContent = label;
  b.addEventListener('click', fn);
  box.appendChild(b);
}

function renderSlots() {
  const box = $('slots');
  box.innerHTML = '';
  M.slots.forEach((slot, si) => {
    const el = document.createElement('div');
    el.className = 'bg-white rounded-xl border border-slate-200 px-3 py-2.5';
    const songs = slot.songs.map((s, k) => `
      <div class="flex items-center gap-1.5 py-1 group">
        <a href="${esc(s.imageUrl)}" target="_blank" rel="noopener" class="flex-1 min-w-0 truncate text-sm text-slate-800 hover:text-indigo-600" title="看乐谱">${esc(clean(s.title))}</a>
        ${slot.songs.length > 1 ? `<button data-act="up" data-si="${si}" data-k="${k}" class="px-1.5 text-slate-300 hover:text-slate-600 ${k === 0 ? 'invisible' : ''}" title="上移">↑</button>` : ''}
        <button data-act="rm" data-si="${si}" data-k="${k}" class="px-1.5 text-slate-300 hover:text-red-500" title="拿掉">✕</button>
      </div>`).join('');
    el.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="text-xs font-semibold text-slate-500 w-28 shrink-0">${esc(slot.label)}</div>
        <div class="flex-1 min-w-0">${songs || '<span class="text-sm text-slate-300">—</span>'}</div>
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
  if (b.dataset.act === 'up' && k > 0) [slot.songs[k - 1], slot.songs[k]] = [slot.songs[k], slot.songs[k - 1]];
  if (b.dataset.act === 'del-slot') {
    if (slot.songs.length && !confirm(`删掉「${slot.label}」这个位置和里面的歌？`)) return;
    M.slots.splice(si, 1);
  }
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
  setDirty();
  renderSlots();
});

['mass-date', 'mass-title'].forEach(id => $(id).addEventListener('input', () => {
  M.date = $('mass-date').value;
  M.title = $('mass-title').value.trim();
  $('setlist-name-preview').textContent = setlistNameOf(M) || '—';
  setDirty();
}));

// ───────── 选歌 ─────────
let pickSlot = null;
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
  masses.forEach(m => (m.slots || []).filter(s => s.key === slotKey).forEach(s => s.songs.forEach(x => { c[x.id] = (c[x.id] || 0) + 1; })));
  return c;
}
function renderPicker() {
  if (pickSlot === null) return;
  const slot = M.slots[pickSlot];
  const tpl = TPL[slot.key] || {};
  const q = $('picker-search').value.trim().toLowerCase();
  const onlyFit = $('picker-suggest').checked && !q;
  const used = usedCount(slot.key);
  let list = allSongs().filter(s => (!q || s.title.toLowerCase().includes(q)) && (!onlyFit || fits(s, tpl)));
  list.sort((a, b) => (used[b.id] || 0) - (used[a.id] || 0) || clean(a.title).localeCompare(clean(b.title), 'zh'));
  const total = list.length;
  list = list.slice(0, 120);
  $('picker-list').innerHTML = list.map(s => `
    <button data-id="${esc(s.id)}" class="w-full text-left flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-indigo-50">
      <span class="flex-1 min-w-0 truncate text-sm">${esc(clean(s.title))}</span>
      ${used[s.id] ? `<span class="text-[10px] text-slate-400 shrink-0">唱过 ${used[s.id]} 次</span>` : ''}
    </button>`).join('')
    + (total > list.length ? `<div class="text-xs text-slate-400 text-center py-2">还有 ${total - list.length} 首，打字缩小范围</div>` : '')
    + (!total ? '<div class="text-sm text-slate-400 text-center py-8">找不到。试试别的字，或把「只看适合这个位置的」关掉。</div>' : '');
}
$('picker-list').addEventListener('click', e => {
  const b = e.target.closest('button[data-id]');
  if (!b || pickSlot === null) return;
  const s = allSongs().find(x => x.id === b.dataset.id);
  if (!s) return;
  M.slots[pickSlot].songs.push({ id: s.id, title: s.title, imageUrl: s.imageUrl });
  setDirty();
  renderSlots();
  renderHeader();
  closePicker();
});

// ───────── 起手：复制上一场／从排单导入 ─────────
function copyFrom(prev) {
  const keep = { date: M.date, title: M.title };
  M.slots = prev.slots.map(s => ({ key: s.key, label: s.label, songs: s.songs.map(x => ({ ...x })) }));
  Object.assign(M, keep);
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
  setDirty();
  renderSlots();
  renderHeader();
}

// 把一份排单的歌，按歌名关键字／编号字母／前后位置，分到每个位置
function assignToSlots(items) {
  const slots = SLOT_TEMPLATE.map(s => ({ key: s.key, label: s.label, songs: [] }));
  const S = Object.fromEntries(slots.map(s => [s.key, s]));
  const order = SLOT_TEMPLATE.map(s => s.key);
  const hintOrder = ['psalm', 'kyrie', 'alleluia', 'sanctus', 'pater', 'doxology', 'agnus', 'welcome'];
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
  const items = [];
  M.slots.forEach(s => s.songs.forEach(x => {
    const lib = songById(x.id) || x;   // 用曲库最新的歌名和图片
    items.push({ id: x.id, order: items.length + 1, title: lib.title, imageUrl: lib.imageUrl });
  }));
  if (!items.length) return alert('还没有选任何歌。');

  const newId = M.date;
  if (M.isNew && masses.some(m => m.id === newId) && !confirm(`${newId} 已经排过一场，要覆盖吗？`)) return;
  const name = setlistNameOf(M);
  const btn = $('btn-save');
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    const oldId = M.isNew ? null : M.id;
    const oldSetlist = M.setlistName;
    const now = new Date().toISOString();
    const data = {
      date: M.date, title: M.title, setlistName: name,
      slots: M.slots.map(s => ({ key: s.key, label: s.label, songs: s.songs.map(x => ({ id: x.id, title: (songById(x.id) || x).title, imageUrl: (songById(x.id) || x).imageUrl })) })),
      createdAt: M.createdAt || now, savedAt: now,
    };
    await setDoc(doc(db, MASSES, newId), data);

    // 乐谱排单：同名就更新歌单（保留原本建立时间和直播翻页），没有就新建
    const ref = doc(db, SETLISTS, name);
    const existing = await getDoc(ref);
    await setDoc(ref, { name, items, ...(existing.exists() ? {} : { createdAt: now }) }, { merge: true });

    // 改了日期或名称：把这一场以前生成的旧排单／旧记录收掉，免得乐谱里出现两份
    if (oldSetlist && oldSetlist !== name) await deleteDoc(doc(db, SETLISTS, oldSetlist));
    if (oldId && oldId !== newId) await deleteDoc(doc(db, MASSES, oldId));

    Object.assign(M, data, { id: newId, isNew: false });
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
  const [, mm, dd] = (M.date || '').split('-');
  const lines = [`*${Number(dd) || ''}/${Number(mm) || ''} ${M.title || ''}*`];
  M.slots.filter(s => !QUIET.has(s.key) && s.songs.length).forEach(s => {
    lines.push(`${s.label}：${s.songs.map(x => clean(x.title)).filter((t, i, a) => a.indexOf(t) === i).join(' / ')}`);
  });
  const text = lines.join('\n');
  try { await navigator.clipboard.writeText(text); $('status').textContent = '✅ 已复制，可以贴到 WhatsApp'; }
  catch { prompt('复制下面这段：', text); }
});

// ───────── 读取 ─────────
async function loadMasses() {
  const snap = await getDocs(collection(db, MASSES));
  masses = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.date.localeCompare(a.date));
  const seen = new Set(LIBRARY_DATA.map(x => x.id));
  EXTRA = [];
  masses.forEach(m => m.slots.forEach(sl => sl.songs.forEach(x => {
    if (!seen.has(x.id)) { seen.add(x.id); EXTRA.push({ id: x.id, title: x.title, imageUrl: x.imageUrl }); }
  })));
}
function openMass(m) {
  M = { ...m, slots: m.slots.map(s => ({ ...s, songs: s.songs.map(x => ({ ...x })) })), isNew: false };
  setDirty(false);
  renderHeader();
  renderSlots();
}
function newMass() {
  const latest = masses[0]?.date;
  const base = latest && latest >= isoDate(new Date()) ? new Date(latest + 'T12:00') : new Date();
  M = emptyMass(nextSunday(base));
  setDirty(false);
  renderHeader();
  renderSlots();
}
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
  const upcoming = [...masses].reverse().find(m => m.date >= today);
  if (upcoming) openMass(upcoming); else newMass();
})();
