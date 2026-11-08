// 改动记录（文件名沿用 renames）：一个月一份，打开只读最近两个月，要看更早再按；改名那几笔可以复制旧名字或改回去
import { doc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, getDoc } from "./firebase.js";
import { renameSong } from "./rename.js";
import { customSongs } from "./song-cache.js";
import { monthKey } from "./changelog.js";
import { OLD_RENAMES } from "./renames-old.js";   // 2026-11-08 以前的改名，搬进来之后不用再读资料库

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const gate = window.sicStaff;
const FIRST = '2026-11';   // 第一本簿子
const MAX_MONTHS = 12;
const CATS = ['改名', '排单', '弥撒排歌', '座位表'];
const monthBack = (key, n) => { const [y, m] = key.split('-').map(Number); return monthKey(new Date(y, m - 1 - n, 1)); };

const book = {};     // { '2026-11': [一笔一笔] }
let months = [monthKey(), monthBack(monthKey(), 1)].filter(k => k >= FIRST);
let rows = [];
let nowTitle = {};   // 每首歌现在的名字
let cat = '';        // '' = 全部

async function readMonth(k) {
  const d = await gate.withAuth(() => getDoc(doc(db, 'changelog', k)));
  book[k] = d.exists() ? d.data().entries || [] : [];
}
function combine() {
  rows = [...Object.values(book).flat(), ...OLD_RENAMES].sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
async function load() {
  $('status').textContent = '读取中…';
  const [songs] = await Promise.all([customSongs(db).catch(() => []), ...months.map(readMonth)]);
  nowTitle = Object.fromEntries(songs.filter(x => x?.id).map(x => [x.id, x.title]));
  combine();
  render();
}

function renameCard(r, i) {
  const now = nowTitle[r.songId];
  const canUndo = gate.can('admin') || gate.can('conduct');
  return `<div><span class="text-slate-400">旧：</span><span class="line-through decoration-slate-300">${esc(r.oldTitle)}</span></div>
    <div><span class="text-slate-400">新：</span><span class="font-semibold">${esc(r.newTitle)}</span></div>
    ${now && now !== r.newTitle ? `<div class="text-xs text-amber-600">之后又改过，现在叫「${esc(now)}」</div>` : ''}
    <div class="flex flex-wrap gap-2 pt-1">
      <button data-copy="${i}" class="px-2.5 py-1 text-xs rounded-md bg-slate-100 hover:bg-slate-200">复制旧名字</button>
      ${now === r.oldTitle ? '<span class="px-2.5 py-1 text-xs text-emerald-600">✓ 现在就是旧名字</span>'
        : canUndo ? `<button data-undo="${i}" class="px-2.5 py-1 text-xs rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100">改回这个旧名字</button>` : ''}
    </div>`;
}
function render() {
  const q = $('q').value.trim().toLowerCase();
  const hit = r => !q || `${r.by} ${r.cat} ${r.item} ${r.text} ${r.oldTitle || ''} ${r.newTitle || ''}`.toLowerCase().includes(q);
  const found = rows.map((r, i) => [r, i]).filter(([r]) => hit(r));
  const all = [...new Set([...CATS, ...rows.map(r => r.cat)])];
  const chip = (k, label, n) => `<button data-cat="${esc(k)}" class="px-3 py-1.5 rounded-full border text-sm ${cat === k ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-700'}">${esc(label)}（${n}）</button>`;
  $('cats').innerHTML = chip('', '全部', found.length) + all.map(k => chip(k, k, found.filter(([r]) => r.cat === k).length)).join('');
  const list = found.filter(([r]) => !cat || r.cat === cat);
  $('list').innerHTML = list.map(([r, i]) => `<div class="bg-white rounded-2xl border border-slate-200 p-3.5 text-sm space-y-2">
      <div class="text-xs text-slate-400">${esc(when(r.at))} · <span class="text-slate-600 font-medium">${r.by ? `👤 ${esc(r.by)}` : '（以前的没记是谁）'}</span> · ${esc(r.cat)}${r.where ? ` · ${esc(r.where)}` : ''}${r.setlist ? ` · 排单 ${esc(r.setlist)}` : ''}</div>
      ${r.cat === '改名' && r.songId ? renameCard(r, i) : `<div><span class="font-semibold">${esc(r.item)}</span>${r.text ? `　<span class="text-slate-600">${esc(r.text)}</span>` : ''}</div>`}
    </div>`).join('');
  $('status').textContent = list.length ? `这里有 ${list.length} 笔` : '这里还没有记录。';
  $('more').classList.toggle('hidden', !(months.at(-1) > FIRST && months.length < MAX_MONTHS));
}

$('q').addEventListener('input', render);
$('cats').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]');
  if (b) { cat = b.dataset.cat; render(); }
});
$('more').addEventListener('click', async () => {
  const k = monthBack(months.at(-1), 1);
  $('more').disabled = true;
  try { await readMonth(k); months.push(k); combine(); render(); }
  catch (err) { console.error(err); $('status').textContent = '读取失败：' + (err.code || err.message); }
  $('more').disabled = false;
});
$('list').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const r = rows[+(b.dataset.copy ?? b.dataset.undo)]; if (!r) return;
  if (b.dataset.copy !== undefined) {
    try { await navigator.clipboard.writeText(r.oldTitle); b.textContent = '✓ 复制了'; }
    catch { prompt('复制这个：', r.oldTitle); }
    return;
  }
  const now = nowTitle[r.songId] || r.newTitle;
  if (!confirm(`把这首歌改回：\n\n「${r.oldTitle}」\n\n（现在叫「${now}」）`)) return;
  try {
    await renameSong(db, { id: r.songId, imageUrl: r.imageUrl, oldTitle: now, newTitle: r.oldTitle, where: '改动记录（改回）' });
    await load();
  } catch (err) { console.error(err); alert('改回失败：' + (err.code || err.message)); }
});

if (!gate?.isStaff()) location.replace('/');
else load().catch(err => { console.error(err); $('status').textContent = '读取失败：' + (err.code || err.message); });
