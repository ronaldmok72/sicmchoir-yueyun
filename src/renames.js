// 改名记录：song_renames 里每一次改歌名，最新的排最前面；可以复制旧名字或改回去
import { collection, doc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, getDocs, getDoc } from "./firebase.js";
import { renameSong } from "./rename.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };

let rows = [];
let nowTitle = {};   // 每首歌现在的名字

async function load() {
  $('status').textContent = '读取中…';
  const snap = await getDocs(collection(db, 'song_renames'));
  rows = snap.docs.map(d => ({ key: d.id, ...d.data() })).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const ids = [...new Set(rows.map(r => r.songId))];
  const cur = await Promise.all(ids.map(id => getDoc(doc(db, 'custom_songs', id)).catch(() => null)));
  nowTitle = Object.fromEntries(cur.filter(d => d?.exists()).map(d => [d.id, d.data().title]));
  render();
}

function render() {
  const q = $('q').value.trim().toLowerCase();
  const list = q ? rows.filter(r => `${r.oldTitle} ${r.newTitle}`.toLowerCase().includes(q)) : rows;
  $('status').textContent = rows.length ? `共 ${rows.length} 次改名` : '还没有人改过歌名。';
  $('list').innerHTML = list.map(r => {
    const now = nowTitle[r.songId];
    return `<div class="bg-white rounded-2xl border border-slate-200 p-3.5 text-sm space-y-2">
      <div class="text-xs text-slate-400">${esc(when(r.at))} · <span class="text-slate-600 font-medium">${r.by ? `👤 ${esc(r.by)}` : '（以前的没记是谁）'}</span> · ${esc(r.where || '')}${r.setlist ? ` · 排单 ${esc(r.setlist)}` : ''}</div>
      <div><span class="text-slate-400">旧：</span><span class="line-through decoration-slate-300">${esc(r.oldTitle)}</span></div>
      <div><span class="text-slate-400">新：</span><span class="font-semibold">${esc(r.newTitle)}</span></div>
      ${now && now !== r.newTitle ? `<div class="text-xs text-amber-600">之后又改过，现在叫「${esc(now)}」</div>` : ''}
      <div class="flex flex-wrap gap-2 pt-1">
        <button data-copy="${esc(r.key)}" class="px-2.5 py-1 text-xs rounded-md bg-slate-100 hover:bg-slate-200">复制旧名字</button>
        ${now === r.oldTitle ? '<span class="px-2.5 py-1 text-xs text-emerald-600">✓ 现在就是旧名字</span>'
          : `<button data-undo="${esc(r.key)}" class="px-2.5 py-1 text-xs rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100">改回这个旧名字</button>`}
      </div>
    </div>`;
  }).join('');
}

$('q').addEventListener('input', render);

$('list').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const r = rows.find(x => x.key === (b.dataset.copy || b.dataset.undo)); if (!r) return;
  if (b.dataset.copy) {
    try { await navigator.clipboard.writeText(r.oldTitle); b.textContent = '✓ 复制了'; }
    catch { prompt('复制这个：', r.oldTitle); }
    return;
  }
  const now = nowTitle[r.songId] || r.newTitle;
  if (!confirm(`把这首歌改回：\n\n「${r.oldTitle}」\n\n（现在叫「${now}」）`)) return;
  try {
    await renameSong(db, { id: r.songId, imageUrl: r.imageUrl, oldTitle: now, newTitle: r.oldTitle, where: '改名记录（改回）' });
    await load();
  } catch (err) { console.error(err); alert('改回失败：' + (err.code || err.message)); }
});

load().catch(err => { console.error(err); $('status').textContent = '读取失败：' + (err.code || err.message); });
