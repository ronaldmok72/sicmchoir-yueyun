// 婚礼弥撒排歌：选日期、时间（9.30am / 11.30am / 1.30pm）、唱的歌、谁做什么、来唱的团员
// 保存 = special_masses/{日期_时间} + 乐谱排单（setlists），「这台弥撒」那天会多一张 💒 卡
import { collection, getDocs, doc, getDoc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { LIBRARY_DATA, loadLibrary } from "./library.js";
import { clean, waTitle } from "./mass-common.js";
import { SPECIAL, WEDDING_SLOTS, WEDDING_ROLES, WEDDING_TIMES, idOf, timeText, setlistNameOf, loadSpecials } from "./weddings-common.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').toLowerCase().replace(/[\s_\-（）()，,。.、:：'’]+/g, '');
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = iso(new Date());
const week = date => '日一二三四五六'[new Date(date + 'T12:00').getDay()];
const dmy = date => date ? `${Number(date.slice(8))}/${Number(date.slice(5, 7))}/${date.slice(0, 4)}` : '';
const songById = id => LIBRARY_DATA.find(s => s?.id === id);

let all = [];        // 全部婚礼弥撒（新的排前面）
let W = null;        // 正在改的这一台
let dirty = false;
let pickSlot = -1;   // 选歌框是给第几个位置的

// 下一个星期六（新的一台默认那天）
function nextSat() {
  const d = new Date(TODAY + 'T12:00');
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return iso(d);
}
const blank = () => ({
  date: nextSat(), time: '09:30', kind: 'wedding', title: '婚配礼仪~ ', note: '',
  slots: WEDDING_SLOTS.map(s => ({ ...s, songs: [] })),
  roles: WEDDING_ROLES.map(role => ({ role, name: '' })),
  singers: [], isNew: true,
});

async function load(keepId) {
  const [, by, mb] = await Promise.all([loadLibrary(db), loadSpecials(db), getDocs(collection(db, 'members'))]);
  all = Object.values(by).flat().sort((a, b) => b.id.localeCompare(a.id));
  const names = mb.docs.map(d => d.data()).filter(m => m.active !== false).map(m => m.fullName || m.name).sort((a, b) => a.localeCompare(b));
  $('names').innerHTML = names.map(n => `<option value="${esc(n)}">`).join('');
  const want = keepId || new URLSearchParams(location.search).get('id');
  const pick = all.find(w => w.id === want) || all.filter(w => w.date >= TODAY).at(-1);
  edit(pick ? structuredClone(pick) : blank());
}

function edit(w) {
  W = w;
  dirty = false;
  renderAll();
}
function setDirty() { dirty = true; $('status').textContent = '有改动还没保存'; $('setlist-name').textContent = setlistNameOf(W); }

function renderAll() {
  const opts = all.map(w => `<option value="${esc(w.id)}" ${w.id === W.id && !W.isNew ? 'selected' : ''}>${esc(w.date)}（${week(w.date)}）${esc(timeText(w.time))}　${esc(w.title)}</option>`);
  if (W.isNew) opts.unshift('<option value="__new" selected>（新的一台，还没保存）</option>');
  if (!opts.length) opts.push('<option>还没有</option>');
  $('sel').innerHTML = opts.join('');
  $('f-date').value = W.date || '';
  $('f-time').value = W.time || '';
  $('f-title').value = W.title || '';
  $('f-note').value = W.note || '';
  $('setlist-name').textContent = setlistNameOf(W);
  $('btn-del').classList.toggle('hidden', !!W.isNew);
  $('status').textContent = W.isNew ? '新的一台' : (W.savedAt ? `上次保存 ${new Date(W.savedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : '');
  renderTimes(); renderSlots(); renderRoles(); renderSingers();
}

function renderTimes() {
  $('time-quick').innerHTML = WEDDING_TIMES.map(t => `<button data-time="${t}" class="px-2.5 py-1 rounded-lg text-xs ${W.time === t ? 'bg-indigo-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}">${timeText(t)}</button>`).join('');
}
$('time-quick').addEventListener('click', e => {
  const b = e.target.closest('[data-time]'); if (!b) return;
  W.time = $('f-time').value = b.dataset.time;
  renderTimes(); setDirty();
});
[['f-date', 'date'], ['f-time', 'time'], ['f-title', 'title'], ['f-note', 'note']].forEach(([id, k]) => $(id).addEventListener('input', () => {
  W[k] = $(id).value; if (k === 'time') renderTimes(); setDirty();
}));

// ───────── 歌 ─────────
function renderSlots() {
  $('slots').innerHTML = W.slots.map((s, i) => `
    <div class="flex gap-3 py-2">
      <div class="w-20 shrink-0 text-slate-500 pt-1.5">${esc(s.label)}</div>
      <div class="flex-1 min-w-0 space-y-1">
        ${s.songs.map((x, j) => `<div class="flex items-center gap-2 rounded-lg bg-indigo-50 px-2.5 py-1.5">
          <a href="${esc(x.imageUrl)}" target="_blank" rel="noopener" class="flex-1 min-w-0 truncate hover:text-indigo-600" title="${esc(x.title)}">${esc(waTitle(x.title))}</a>
          <button data-rm="${i}-${j}" class="text-slate-400 hover:text-red-500 px-1" aria-label="拿掉">✕</button>
        </div>`).join('')}
        <button data-pick="${i}" class="text-indigo-600 hover:underline py-1">${s.songs.length ? '＋ 再加一首' : '＋ 选歌'}</button>
      </div>
      ${WEDDING_SLOTS.some(t => t.key === s.key) ? '' : `<button data-rmslot="${i}" class="shrink-0 text-xs text-slate-400 hover:text-red-500 self-start pt-1.5">拿掉位置</button>`}
    </div>`).join('');
}
$('slots').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.pick) return openPicker(+b.dataset.pick);
  if (b.dataset.rm) { const [i, j] = b.dataset.rm.split('-').map(Number); W.slots[i].songs.splice(j, 1); }
  if (b.dataset.rmslot && confirm(`拿掉「${W.slots[+b.dataset.rmslot].label}」这个位置？`)) W.slots.splice(+b.dataset.rmslot, 1);
  renderSlots(); setDirty();
});
$('btn-add-slot').addEventListener('click', () => {
  const label = prompt('位置名称（例如：圣母歌、点烛、献花）'); if (!label?.trim()) return;
  // 放在礼成咏前面
  const at = W.slots.findIndex(s => s.key === 'recessional');
  W.slots.splice(at < 0 ? W.slots.length : at, 0, { key: 'extra_' + Date.now(), label: label.trim(), short: label.trim(), songs: [] });
  renderSlots(); setDirty();
});

function openPicker(i) {
  pickSlot = i;
  $('picker-title').textContent = `选「${W.slots[i].label}」`;
  $('picker-q').value = '';
  renderPicker();
  $('picker').classList.remove('hidden');
  $('picker-q').focus();
}
function renderPicker() {
  const q = norm($('picker-q').value);
  const hits = LIBRARY_DATA.filter(s => s?.id && s.imageUrl && (!q || norm(s.title).includes(q))).slice(0, q ? 60 : 0);
  $('picker-list').innerHTML = !q ? '<div class="px-3 py-6 text-center text-slate-400">打歌名找，例如：爱的真谛、圣咏128</div>'
    : hits.length ? hits.map(s => `<button data-add="${esc(s.id)}" class="w-full text-left px-3 py-2 rounded-lg hover:bg-indigo-50"><div class="truncate">${esc(waTitle(s.title))}</div><div class="text-[11px] text-slate-400 truncate">${esc(clean(s.title))}</div></button>`).join('')
    : '<div class="px-3 py-6 text-center text-slate-400">曲库里找不到（先到排单后台上传谱）</div>';
}
$('picker-q').addEventListener('input', renderPicker);
$('picker-list').addEventListener('click', e => {
  const b = e.target.closest('[data-add]'); if (!b) return;
  const s = songById(b.dataset.add);
  W.slots[pickSlot].songs.push({ id: s.id, title: s.title, imageUrl: s.imageUrl });
  closePicker(); renderSlots(); setDirty();
});
const closePicker = () => $('picker').classList.add('hidden');
$('picker-close').addEventListener('click', closePicker);
$('picker').addEventListener('click', e => { if (e.target === $('picker')) closePicker(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePicker(); });

// ───────── 职务 ─────────
function renderRoles() {
  $('roles').innerHTML = W.roles.map((r, i) => `
    <div class="flex items-center gap-2">
      <input data-role="${i}" value="${esc(r.role)}" class="w-24 shrink-0 border border-slate-200 rounded-lg px-2 py-1.5 text-slate-500">
      <input data-name="${i}" value="${esc(r.name)}" list="names" placeholder="谁？" class="flex-1 min-w-0 border border-slate-300 rounded-lg px-3 py-1.5">
      <button data-rmrole="${i}" class="text-slate-300 hover:text-red-500 px-1" aria-label="拿掉">✕</button>
    </div>`).join('');
}
$('roles').addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.role) W.roles[+t.dataset.role].role = t.value;
  if (t.dataset.name) W.roles[+t.dataset.name].name = t.value;
  setDirty();
});
$('roles').addEventListener('click', e => {
  const b = e.target.closest('[data-rmrole]'); if (!b) return;
  W.roles.splice(+b.dataset.rmrole, 1); renderRoles(); setDirty();
});
$('btn-add-role').addEventListener('click', () => { W.roles.push({ role: '', name: '' }); renderRoles(); $('roles').querySelector('input[data-role]:last-of-type')?.focus(); setDirty(); });

// ───────── 来唱的团员 ─────────
function renderSingers() {
  $('singer-n').textContent = W.singers.length ? `（${W.singers.length} 位）` : '';
  $('singers').innerHTML = W.singers.length ? W.singers.map((n, i) => `<span class="inline-flex items-center gap-1 rounded-lg bg-slate-100 pl-2.5 pr-1 py-1">${esc(n)}<button data-rmsinger="${i}" class="text-slate-400 hover:text-red-500 px-1" aria-label="拿掉">✕</button></span>`).join('')
    : '<span class="text-xs text-slate-400">还没加</span>';
}
$('singer-form').addEventListener('submit', e => {
  e.preventDefault();
  // 一次贴好几个也可以（用逗号、顿号或换行分开）
  const add = $('singer-q').value.split(/[,，、\n]+/).map(s => s.trim()).filter(Boolean)
    .filter(n => !W.singers.some(x => x.toLowerCase() === n.toLowerCase()));
  if (!add.length) return;
  W.singers.push(...add);
  $('singer-q').value = '';
  renderSingers(); setDirty();
});
$('singers').addEventListener('click', e => {
  const b = e.target.closest('[data-rmsinger]'); if (!b) return;
  W.singers.splice(+b.dataset.rmsinger, 1); renderSingers(); setDirty();
});

// ───────── 复制 WA 文字（跟平常发的格式一样）─────────
function waText() {
  const lines = [W.title.trim(), `${dmy(W.date)}（${week(W.date)}）${timeText(W.time)}`, ''];
  W.slots.filter(s => s.songs.length).forEach(s => lines.push(`${s.short ? s.short + '：' : ''}${s.songs.map(x => waTitle(x.title)).join(' / ')}`));
  const roles = W.roles.filter(r => r.role.trim() && r.name.trim());
  if (roles.length) lines.push('', ...roles.map(r => `${r.role.trim()}：${r.name.trim()}`));
  if (W.singers.length) lines.push('', '歌咏团：', ...W.singers);
  if (W.note?.trim()) lines.push('', '📌 ' + W.note.trim());
  return lines.join('\n');
}
$('btn-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(waText()); $('status').textContent = '✅ 复制好了，可以贴去 WhatsApp'; }
  catch { prompt('复制这段：', waText()); }
});

// ───────── 保存 ─────────
$('btn-save').addEventListener('click', async () => {
  if (!W.date || !W.time) return alert('日期和时间要填');
  if (!W.title.trim() || W.title.trim() === '婚配礼仪~') return alert('名称要填（新人的名字）');
  const items = [];
  W.slots.forEach(s => s.songs.forEach(x => {
    if (items.some(i => i.id === x.id)) return;
    const lib = songById(x.id) || x;
    items.push({ id: x.id, order: items.length + 1, title: lib.title, imageUrl: lib.imageUrl });
  }));
  if (!items.length) return alert('还没有选任何歌。');
  const newId = idOf(W.date, W.time);
  if (newId !== W.id && all.some(w => w.id === newId) && !confirm(`${W.date} ${timeText(W.time)} 已经有一台了，要覆盖吗？`)) return;
  const name = setlistNameOf(W);
  const btn = $('btn-save');
  btn.disabled = true; btn.textContent = '保存中…';
  try {
    const now = new Date().toISOString();
    const data = {
      date: W.date, time: W.time, kind: 'wedding', title: W.title.trim(), note: (W.note || '').trim(), setlistName: name,
      slots: W.slots.map(s => ({ key: s.key, label: s.label, short: s.short || '', songs: s.songs.map(x => { const lib = songById(x.id) || x; return { id: x.id, title: lib.title, imageUrl: lib.imageUrl }; }) })),
      roles: W.roles.filter(r => r.role.trim()).map(r => ({ role: r.role.trim(), name: r.name.trim() })),
      singers: W.singers,
      createdAt: W.createdAt || now, savedAt: now,
    };
    await setDoc(doc(db, SPECIAL, newId), data);
    const ref = doc(db, 'setlists', name);
    const existing = await getDoc(ref);
    await setDoc(ref, { name, items, date: W.date, ...(existing.exists() ? {} : { createdAt: now }) }, { merge: true });
    // 改了日期／时间／名称：把旧的收掉
    if (W.setlistName && W.setlistName !== name) await deleteDoc(doc(db, 'setlists', W.setlistName));
    if (!W.isNew && W.id !== newId) await deleteDoc(doc(db, SPECIAL, W.id));
    history.replaceState(null, '', `?id=${newId}`);
    await load(newId);
    $('status').textContent = `✅ 已保存，乐谱排单「${name}」（${items.length} 页）`;
  } catch (err) {
    console.error(err);
    alert('保存失败：' + (err.code || err.message));
  } finally {
    btn.disabled = false; btn.textContent = '保存并更新乐谱';
  }
});

$('btn-del').addEventListener('click', async () => {
  if (W.isNew || !confirm(`删掉「${W.title}」（${W.date} ${timeText(W.time)}）？乐谱排单也会一起删掉。`)) return;
  try {
    await deleteDoc(doc(db, SPECIAL, W.id));
    if (W.setlistName) await deleteDoc(doc(db, 'setlists', W.setlistName));
    history.replaceState(null, '', location.pathname);
    await load();
    $('status').textContent = '删掉了';
  } catch (err) { alert('没删到：' + (err.code || err.message)); }
});

$('sel').addEventListener('change', () => {
  if (dirty && !confirm('这一台有改动还没保存，要放弃吗？')) { renderAll(); return; }
  const w = all.find(x => x.id === $('sel').value);
  if (w) { history.replaceState(null, '', `?id=${w.id}`); edit(structuredClone(w)); }
});
$('btn-new').addEventListener('click', () => {
  if (dirty && !confirm('这一台有改动还没保存，要放弃吗？')) return;
  history.replaceState(null, '', location.pathname);
  edit(blank());
  $('f-title').focus();
});
window.addEventListener('beforeunload', e => { if (dirty) e.preventDefault(); });

load().catch(err => { console.error(err); $('status').textContent = '读取失败：' + (err.code || err.message); });
document.querySelector('[data-day-link]')?.addEventListener('click', e => { if (W?.date) e.currentTarget.href = `day.html?d=${W.date}`; });
