// 公告页：团员看公告、点要练的歌直接看谱；有「公告」权限的可以发、改、删
// 还在显示的公告也会出现在「这台弥撒」最下面，要练的歌在「歌单目录」有「📢 要练的」可以挑出来
import { collection, addDoc, doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { LIBRARY_DATA, loadLibrary } from "./library.js";
import { clean, waTitle } from "./mass-common.js";
import { loadNotices, noticeHtml, TODAY } from "./notices-common.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').toLowerCase().replace(/[\s_\-（）()，,。.、:：'’]+/g, '');
const gate = window.sicStaff;
const canEdit = () => !!gate?.can('notice');
const addDays = (date, n) => { const d = new Date(date + 'T12:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

let notices = { active: [], past: [] };
let titles = {};
let editing = null;      // 正在改的公告 id；null = 新的
let picked = [];         // 表格里选好的歌 [{id, title}]

async function load() {
  const [, n] = await Promise.all([loadLibrary(db), loadNotices(db), gate?.refresh()]);   // refresh：最高权限马上拿到新加的「公告」区
  notices = n;
  titles = Object.fromEntries(LIBRARY_DATA.map(s => [s.id, s.title]));
  $('loading').classList.add('hidden');
  render();
}

function render() {
  const ed = canEdit();
  $('btn-new').classList.toggle('hidden', !ed || !$('form').classList.contains('hidden'));
  $('btn-staff').classList.toggle('hidden', ed);
  const card = n => `<article class="bg-white rounded-2xl border border-slate-200 p-4">${noticeHtml(n, {
    titles, edit: ed ? `<button data-edit="${esc(n.id)}" class="shrink-0 text-xs text-indigo-600 hover:underline">改</button>` : '',
  })}</article>`;
  $('list').innerHTML = notices.active.length ? notices.active.map(card).join('')
    : '<div class="text-sm text-slate-400 text-center py-8">现在没有公告</div>';
  $('past-box').classList.toggle('hidden', !notices.past.length);
  $('past-n').textContent = notices.past.length;
  $('past').innerHTML = notices.past.map(card).join('');
}

// ───────── 发 / 改 ─────────
function openForm(n) {
  editing = n?.id || null;
  $('f-head').textContent = n ? '改公告' : '发公告';
  $('f-title').value = n?.title || '';
  $('f-body').value = n?.body || '';
  $('f-event').value = n?.event || '';
  $('f-until').value = n?.until || '';
  picked = (n?.songs || []).map(s => ({ id: s.id, title: titles[s.id] || s.title }));
  $('f-q').value = '';
  $('f-del').classList.toggle('hidden', !n);
  renderPicked(); renderHits();
  $('form').classList.remove('hidden');
  $('btn-new').classList.add('hidden');
  $('form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!n) $('f-title').focus();
}
function closeForm() {
  $('form').classList.add('hidden');
  editing = null;
  render();
}

function renderPicked() {
  $('f-songs').innerHTML = picked.length ? picked.map((s, i) => `
    <div class="flex items-center gap-2 rounded-lg bg-indigo-50 px-2.5 py-1.5">
      <span class="text-indigo-400 text-xs w-4">${i + 1}</span>
      <span class="flex-1 min-w-0 truncate">${esc(waTitle(s.title))}</span>
      <button data-up="${i}" class="text-slate-400 hover:text-indigo-600 px-1 ${i ? '' : 'invisible'}" aria-label="往上">↑</button>
      <button data-rm="${i}" class="text-slate-400 hover:text-red-500 px-1" aria-label="拿掉">✕</button>
    </div>`).join('') : '<div class="text-xs text-slate-400">还没选（可以不选）</div>';
}
function renderHits() {
  const q = norm($('f-q').value);
  const box = $('f-hits');
  if (!q) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const have = new Set(picked.map(s => s.id));
  const hits = LIBRARY_DATA.filter(s => s?.id && s.imageUrl && !have.has(s.id) && norm(s.title).includes(q)).slice(0, 30);
  box.classList.remove('hidden');
  box.innerHTML = hits.length ? hits.map(s => `<button data-add="${esc(s.id)}" class="w-full text-left px-3 py-2 hover:bg-indigo-50"><div class="truncate">${esc(waTitle(s.title))}</div><div class="text-[11px] text-slate-400 truncate">${esc(clean(s.title))}</div></button>`).join('')
    : '<div class="px-3 py-2 text-slate-400">曲库里找不到</div>';
}

$('f-q').addEventListener('input', renderHits);
$('f-hits').addEventListener('click', e => {
  const b = e.target.closest('[data-add]'); if (!b) return;
  const s = LIBRARY_DATA.find(x => x.id === b.dataset.add);
  if (s) picked.push({ id: s.id, title: s.title });
  $('f-q').value = '';
  renderPicked(); renderHits();
  $('f-q').focus();
});
$('f-songs').addEventListener('click', e => {
  const up = e.target.closest('[data-up]'), rm = e.target.closest('[data-rm]');
  if (up) { const i = +up.dataset.up; [picked[i - 1], picked[i]] = [picked[i], picked[i - 1]]; }
  if (rm) picked.splice(+rm.dataset.rm, 1);
  renderPicked(); renderHits();
});
// 填了活动日期、还没填「显示到」→ 先帮他填活动那天
$('f-event').addEventListener('change', () => { if ($('f-event').value && !$('f-until').value) $('f-until').value = $('f-event').value; });

$('f-save').addEventListener('click', async () => {
  const title = $('f-title').value.trim();
  if (!title) { alert('标题要写'); $('f-title').focus(); return; }
  const event = $('f-event').value;
  const until = $('f-until').value || (event && event >= TODAY ? event : addDays(TODAY, 30));
  const data = { title, body: $('f-body').value.trim(), event, until, songs: picked.map(s => ({ id: s.id, title: s.title })), updatedAt: Date.now() };
  const btn = $('f-save');
  btn.disabled = true; btn.textContent = '保存中…';
  try {
    if (editing) await setDoc(doc(db, 'announcements', editing), data, { merge: true });
    else await addDoc(collection(db, 'announcements'), { ...data, createdAt: Date.now() });
    notices = await loadNotices(db);
    toast(until < TODAY ? '保存好了（显示日期已过，放在以前的公告）' : '保存好了，团员现在看得到');
    closeForm();
  } catch (err) {
    console.error(err);
    alert('❌ 没存到，检查一下网络再按一次。\n' + (err.code || err.message));
  } finally {
    btn.disabled = false; btn.textContent = '保存';
  }
});
$('f-cancel').addEventListener('click', closeForm);
$('f-del').addEventListener('click', async () => {
  if (!editing || !confirm('确定删掉这个公告？删了就没有了。\n（只是不想显示的话，把「显示到」改成昨天就好）')) return;
  try {
    await deleteDoc(doc(db, 'announcements', editing));
    notices = await loadNotices(db);
    toast('删掉了');
    closeForm();
  } catch (err) { alert('❌ 没删到：' + (err.code || err.message)); }
});

$('btn-new').addEventListener('click', () => openForm(null));
document.addEventListener('click', e => {
  const b = e.target.closest('[data-edit]'); if (!b) return;
  openForm(notices.active.concat(notices.past).find(n => n.id === b.dataset.edit));
});
$('btn-staff').addEventListener('click', async () => {
  if (await gate?.unlock('notice', '发公告要「公告」权限的密码')) render();
});

function toast(t) {
  const el = $('status');
  el.textContent = t; el.style.opacity = 1;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.style.opacity = 0; }, 2500);
}

load().catch(err => { console.error(err); $('loading').textContent = '读取失败：' + (err.code || err.message); });
