// 歌单目录：曲库每一首歌都在这里，团员随时翻来看谱、学歌
// 歌就是排单后台的曲库（library.js + 云端 custom_songs），后台上传新歌、改名、换图，这里打开就是最新的
// 每首歌旁边写接下来哪一台要唱、以前唱过几次（从 masses 排歌记录算）
// songs.html#song_123 = 直接打开那一首（公告、WhatsApp 可以贴这个连结）
// 录音：song_audio/{歌id} = { items: [{ url, label, at }] }，只放 Google Drive／YouTube 连结（另外放，排单后台换谱时不会被盖掉）
//   后台（排单后台／弥撒排歌／指挥）的人在看谱页按「🎧＋」贴连结
import { collection, doc, setDoc, arrayUnion, arrayRemove, updateDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, getDocs, history as recent } from "./firebase.js";
import { LIBRARY_DATA, loadLibrary } from "./library.js";
import { clean, waTitle } from "./mass-common.js";
import { loadNotices } from "./notices-common.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = iso(new Date());
const md = date => `${Number(date.slice(8))}/${Number(date.slice(5, 7))}`;
const norm = s => String(s || '').toLowerCase().replace(/[\s_\-（）()，,。.、:：'’]+/g, '');

let songs = [];          // [{id, title, imageUrl, name, letter, next:[{date,label}], past:[date]}]
let filter = new URLSearchParams(location.search).get('f') || 'all';   // songs.html?f=practice = 先看公告要练的
let shown = [];          // 现在列出来的（看谱时上一首/下一首照这个顺序）
let open = null;
let audio = {};          // 歌 id → 录音连结 [{url, label, at}]
const canAudio = () => ['admin', 'mass', 'conduct'].some(a => window.sicStaff?.can(a));

async function load() {
  const [, ma, no, au] = await Promise.all([loadLibrary(db), recent('masses'), loadNotices(db).catch(() => ({ active: [] })), getDocs(collection(db, 'song_audio')).catch(() => ({ docs: [] }))]);
  audio = Object.fromEntries(au.docs.map(d => [d.id, d.data().items || []]));
  const practice = {};   // 歌 id → 哪几个公告要练
  no.active.forEach(n => (n.songs || []).forEach(x => (practice[x.id] ||= []).push(n.title)));
  const use = {};        // 歌 id → 哪几台用到
  ma.docs.forEach(d => {
    const m = d.data(), date = m.date || d.id;
    (m.slots || []).forEach(sl => (sl.songs || []).forEach(x => {
      if (!x.id || x.missing) return;
      (use[x.id] ||= []).push({ date, label: sl.label || '' });
    }));
  });
  songs = LIBRARY_DATA.filter(s => s?.id && s.imageUrl).map(s => {
    const u = (use[s.id] || []).sort((a, b) => a.date.localeCompare(b.date));
    const m = String(s.title || '').match(/^([a-z])\s+/i);
    return {
      ...s,
      name: waTitle(s.title) || clean(s.title),
      letter: m ? m[1].toUpperCase() : /圣咏|答唱咏|继抒咏/.test(s.title) ? '咏' : '#',
      key: norm(s.title),
      next: u.filter(x => x.date >= TODAY),
      past: [...new Set(u.filter(x => x.date < TODAY).map(x => x.date))],
      practice: practice[s.id] || [],
    };
  }).sort((a, b) => a.letter === b.letter ? clean(a.title).localeCompare(clean(b.title), 'zh') : ORDER(a.letter) - ORDER(b.letter));
  $('loading').classList.add('hidden');
  render();
  openFromHash(true);
}

// 开头没有字母的：圣咏/答唱咏放一组，排在 A–Z 后面，其他的放最后
const ORDER = l => l === '咏' ? 100 : l === '#' ? 101 : l.charCodeAt(0);
const GROUP = { '咏': '圣咏 · 答唱咏', '#': '其他' };

const FILTERS = [
  ['all', '全部', () => true],
  ['practice', '📢 公告要练的', s => s.practice.length],
  ['next', '📅 接下来要唱', s => s.next.length],
  ['sung', '🔁 唱过的', s => s.past.length],
  ['audio', '🎧 有录音', s => (audio[s.id] || []).length],
];

function render() {
  const q = norm($('q').value);
  if (!FILTERS.some(x => x[0] === filter)) filter = 'all';
  const f = FILTERS.find(x => x[0] === filter)[2];
  shown = songs.filter(s => f(s) && (!q || s.key.includes(q)));
  if (filter === 'next') shown.sort((a, b) => a.next[0].date.localeCompare(b.next[0].date));
  if (filter === 'sung') shown.sort((a, b) => b.past.length - a.past.length || b.past.at(-1).localeCompare(a.past.at(-1)));

  $('filters').innerHTML = FILTERS.filter(([k, , fn]) => (k !== 'practice' && k !== 'audio') || songs.some(fn)).map(([k, label, fn]) => `
    <button data-f="${k}" class="shrink-0 px-3 py-1.5 rounded-full border ${k === filter ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300'}">${label} <span class="${k === filter ? 'text-indigo-100' : 'text-slate-400'}">${songs.filter(fn).length}</span></button>`).join('');

  const groups = filter === 'all' ? [...new Set(shown.map(s => s.letter))] : [];
  $('letters').innerHTML = groups.length > 1 ? groups.map(l => `<a href="#L-${l}" data-letter="${l}" class="shrink-0 min-w-[1.75rem] px-1.5 h-7 rounded-md bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:border-indigo-300" title="${GROUP[l] || l}">${l === '#' ? '其他' : l}</a>`).join('') : '';
  $('letters').classList.toggle('hidden', groups.length <= 1);

  $('empty').classList.toggle('hidden', shown.length > 0);
  const row = s => {
    const tag = s.practice.length
      ? `<span class="text-amber-600">📢 ${esc(s.practice.join('、'))}</span>`
      : s.next.length
      ? `<span class="text-indigo-600">📅 ${md(s.next[0].date)} ${esc(s.next[0].label)}</span>`
      : s.past.length ? `<span class="text-slate-400">唱过 ${s.past.length} 次 · 上次 ${md(s.past.at(-1))}</span>` : '';
    const extra = clean(s.title) !== s.name ? clean(s.title).replace(s.name, '').replace(/^[\s\-_]+/, '') : '';
    return `<button data-id="${esc(s.id)}" class="w-full text-left flex items-center gap-3 px-3.5 py-2.5 hover:bg-indigo-50/60">
      <div class="flex-1 min-w-0">
        <div class="text-sm truncate">${esc(s.name)}${(audio[s.id] || []).length ? ' <span title="有录音">🎧</span>' : ''}</div>
        ${extra || tag ? `<div class="text-[11px] truncate">${tag}${tag && extra ? '<span class="text-slate-300"> · </span>' : ''}<span class="text-slate-400">${esc(extra)}</span></div>` : ''}
      </div>
      <span class="shrink-0 text-slate-300">›</span>
    </button>`;
  };
  const box = list => `<div class="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">${list.map(row).join('')}</div>`;
  $('list').innerHTML = filter === 'all' && !q
    ? groups.map(l => `<section id="L-${l}" class="scroll-mt-32"><div class="text-xs font-semibold text-slate-400 px-1 mb-1">${GROUP[l] || l}</div>${box(shown.filter(s => s.letter === l))}</section>`).join('')
    : shown.length ? box(shown) : '';
}

$('q').addEventListener('input', render);
$('filters').addEventListener('click', e => {
  const b = e.target.closest('[data-f]'); if (!b) return;
  filter = b.dataset.f; render();
});
$('letters').addEventListener('click', e => {
  const a = e.target.closest('[data-letter]'); if (!a) return;
  e.preventDefault();
  document.getElementById('L-' + a.dataset.letter)?.scrollIntoView({ behavior: 'smooth' });
});
$('list').addEventListener('click', e => {
  const b = e.target.closest('[data-id]'); if (b) show(b.dataset.id);
});

// ───────── 录音 ─────────
// 只放连结（Google Drive、YouTube…），按了跳过去听；录音档本身不上传，不占 Cloudinary 的位置
// 看谱时在右下角：有录音才出现「🎧 听录音」，按了弹出连结；后台的人没录音时看到「🎧 加录音」
function renderAudio() {
  const list = open ? audio[open.id] || [] : [];
  const staff = canAudio();
  const btn = $('v-audio-btn');
  btn.textContent = list.length ? `🎧 听录音${list.length > 1 ? ` (${list.length})` : ''}` : '🎧 加录音';
  btn.classList.toggle('hidden', !list.length && !staff);
  btn.classList.toggle('flex', !!(list.length || staff));
  $('v-audio').innerHTML = list.map((x, i) => `
    <div class="flex items-center rounded-xl hover:bg-white/10">
      <a href="${esc(x.url)}" target="_blank" rel="noopener" class="flex-1 min-w-0 px-3 py-2.5 text-sm truncate">🎧 ${esc(x.label || '听录音')} <span class="text-zinc-500">↗</span></a>
      ${staff ? `<button data-audio-del="${i}" class="px-3 py-2.5 text-zinc-500 hover:text-red-400" title="拿掉">✕</button>` : ''}
    </div>`).join('') + (staff ? `<button data-audio-add class="w-full px-3 py-2.5 rounded-xl text-sm text-indigo-300 hover:bg-white/10 text-left">＋ 加录音连结</button>` : '');
}
const audioPanel = on => $('v-audio').classList.toggle('hidden', !on);
$('v-audio-btn').addEventListener('click', () => {
  if (!(audio[open?.id] || []).length) return addAudio();   // 还没有录音：直接加
  audioPanel($('v-audio').classList.contains('hidden'));
});
$('v-audio').addEventListener('click', async e => {
  if (e.target.closest('[data-audio-add]')) return addAudio();
  const d = e.target.closest('[data-audio-del]');
  if (!d || !open) return;
  const x = (audio[open.id] || [])[+d.dataset.audioDel];
  if (!x || !confirm(`拿掉「${x.label || '录音'}」这个连结？\n（Google Drive 里的录音不会被删）`)) return;
  try {
    await updateDoc(doc(db, 'song_audio', open.id), { items: arrayRemove(x) });
    audio[open.id] = audio[open.id].filter(y => y !== x);
    renderAudio(); render();
    if (!audio[open.id].length) audioPanel(false);
  } catch (err) { console.error(err); alert('没拿掉：' + (err.code || err.message)); }
});
async function addAudio() {
  if (!open || !canAudio()) return;
  const url = (prompt('贴录音的连结（Google Drive 记得开「知道连结的人都可以看」）') || '').trim();
  if (!url) return;
  if (!/^https:\/\/\S+$/.test(url)) return alert('连结要 https:// 开头');
  const label = (prompt('这是什么录音？（例如：全团、女高音、10/17 练歌）', '全团') || '').trim();
  if (!label) return;
  const item = { url, label, at: new Date().toISOString() };
  try {
    await setDoc(doc(db, 'song_audio', open.id), { items: arrayUnion(item), title: open.title }, { merge: true });
    (audio[open.id] ||= []).push(item);
    renderAudio(); render();
    toast('录音连结加好了 🎧');
  } catch (err) { console.error(err); alert('没加到：' + (err.code || err.message)); }
}

// ───────── 看谱 ─────────
// 操作跟「乐谱」一样：整页放进画面；两指放大缩小（0.6～5 倍）、放大了一指拖着看；
// 没放大时左右滑换歌；点一下谱：顶栏、右下按钮收起，左右箭头和「第几首」出现，再点一下换回来
// 电脑：滚轮放大缩小、放大了用滑鼠拖、← → 换歌；⛶ 全屏只留谱
let zoom = 1, tx = 0, ty = 0;
let full = false, hud = false;
// 从别页点进来的（例如公告「要练的歌」、主页）：✕ 变成「‹ 返回」，按了回去原来那一页
let cameIn = false;
const fromPage = (() => { try { const u = new URL(document.referrer); return u.origin === location.origin && u.pathname !== location.pathname ? u : null; } catch { return null; } })();
function show(id, push = true) {
  const s = songs.find(x => x.id === id);
  if (!s) return;
  open = s;
  $('v-title').textContent = s.name;
  $('v-sub').textContent = clean(s.title) !== s.name ? clean(s.title) : '';
  $('v-img').src = s.imageUrl;
  $('v-img').alt = s.name;
  zoom = 1; tx = 0; ty = 0; paint();
  const i = shown.findIndex(x => x.id === id);
  $('v-num').textContent = i >= 0 ? `${i + 1} / ${shown.length}` : '';
  $('v-info').textContent = [
    s.practice.length ? `📢 要练：${s.practice.join('、')}` : '',
    s.next.length ? `📅 接下来：${s.next.slice(0, 3).map(x => `${md(x.date)} ${x.label}`).join('、')}${s.next.length > 3 ? ` 等 ${s.next.length} 台` : ''}` : '',
    s.past.length ? `唱过 ${s.past.length} 次，上次 ${md(s.past.at(-1))}` : '',
  ].filter(Boolean).join('\n') || '还没有在弥撒排过';
  $('v-info').style.whiteSpace = 'pre-line';
  ['v-prev', 'v-next'].forEach((b, k) => $(b).disabled = k ? i < 0 || i >= shown.length - 1 : i <= 0);
  setHud(hud);
  audioPanel(false);
  renderAudio();
  $('viewer').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  flashToast();
  if (push) history.replaceState(null, '', '#' + id);
}
function close() {
  if (full) setFull(false);
  if (cameIn) return history.length > 1 ? history.back() : location.assign(fromPage.href);
  open = null;
  $('viewer').classList.add('hidden');
  document.body.style.overflow = '';
  history.replaceState(null, '', location.pathname + location.search);
  if (onlyIds.length) render();   // 回到全部的歌（上一首／下一首照目录的顺序）
}
function step(d) {
  const i = shown.findIndex(x => x.id === open?.id);
  if (i >= 0 && shown[i + d]) show(shown[i + d].id);
}

// 顶栏、右下按钮 ↔ 左右箭头、第几首（点一下谱就换）
const vis = (id, on, hideCls) => $(id).classList.toggle(hideCls, !on);
function setHud(on) {
  hud = on;
  ['v-prev', 'v-next'].forEach(b => { vis(b, on && !$(b).disabled, 'opacity-0'); vis(b, on && !$(b).disabled, 'pointer-events-none'); });
  vis('v-toast', on, 'opacity-0'); vis('v-toast', on, 'translate-y-4');
  const bars = !on && !full;
  ['v-head', 'v-dock'].forEach(b => { vis(b, bars, 'opacity-0'); vis(b, bars, 'pointer-events-none'); });
  if (!bars) audioPanel(false);
}
// 刚打开／换歌：「第几首、接下来要唱」闪一下
function flashToast() {
  if (hud) return;
  vis('v-toast', true, 'opacity-0'); vis('v-toast', true, 'translate-y-4');
  clearTimeout(flashToast.t);
  flashToast.t = setTimeout(() => { if (!hud) { vis('v-toast', false, 'opacity-0'); vis('v-toast', false, 'translate-y-4'); } }, 2500);
}

// 全屏：手机／电脑支持的话真的全屏；iPhone 不支持就把按钮都收起来，只留谱
function setFull(on) {
  full = on;
  const v = $('viewer');
  $('v-unlock').classList.toggle('hidden', !on);
  try {
    if (on && !document.fullscreenElement) (v.requestFullscreen || v.webkitRequestFullscreen)?.call(v)?.catch?.(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } catch { /* 不支持全屏就算了 */ }
  setHud(false);
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && full) setFull(false); });

// 放大缩小、拖着看（跟乐谱同一套算法）
function paint() {
  $('v-wrap').style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`;
  $('v-body').style.cursor = zoom > 1 ? 'grab' : '';
}
function bounds() {
  const r = $('v-body').getBoundingClientRect();
  const bx = zoom > 1 ? r.width * (zoom - 1) / 2 : 0, by = zoom > 1 ? r.height * (zoom - 1) / 2 : 0;   // 没放大就吸回正中间
  tx = Math.max(-bx, Math.min(bx, tx)); ty = Math.max(-by, Math.min(by, ty));
}
// z = 几倍；(cx, cy) = 手指／滑鼠在哪里，放大后那一点留在原地
function setZoom(z, cx, cy) {
  z = Math.min(5, Math.max(0.6, z));
  if (z === zoom) return;
  const r = $('v-body').getBoundingClientRect();
  const k = z / zoom;
  tx -= (cx - (r.left + r.width / 2)) * (k - 1);
  ty -= (cy - (r.top + r.height / 2)) * (k - 1);
  zoom = z; bounds(); paint();
}
const body = $('v-body');
const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
let pinch = null, drag = null, swipe = null, moved = false, start = null;
body.addEventListener('touchstart', e => {
  moved = false;
  start = [e.touches[0].clientX, e.touches[0].clientY];
  if (e.touches.length === 2) { pinch = dist(e.touches); drag = swipe = null; return; }
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  if (zoom > 1) drag = { x: t.clientX - tx, y: t.clientY - ty };
  else swipe = { x: t.clientX, y: t.clientY };
}, { passive: true });
body.addEventListener('touchmove', e => {
  e.preventDefault();
  if (e.touches.length > 1 || Math.hypot(e.touches[0].clientX - start[0], e.touches[0].clientY - start[1]) > 8) moved = true;   // 手指抖一下不算滑
  if (e.touches.length === 2 && pinch) {
    const d = dist(e.touches);
    setZoom(zoom * d / pinch, (e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
    pinch = d; swipe = null;
  } else if (e.touches.length === 1 && drag) {
    tx = e.touches[0].clientX - drag.x; ty = e.touches[0].clientY - drag.y; bounds(); paint();
  }
}, { passive: false });
body.addEventListener('touchend', e => {
  if (e.touches.length) return;
  const t = e.changedTouches[0];
  // 左右滑换歌：要明确滑过 80px，而且横的比直的多（跟乐谱一样）
  if (swipe && zoom <= 1) {
    const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
    if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
  }
  pinch = drag = swipe = null;
});
// 点一下（没有滑、没有捏）：按钮收起／出现
body.addEventListener('click', () => {
  if (moved) { moved = false; return; }
  if (!$('v-audio').classList.contains('hidden')) return audioPanel(false);
  setHud(!hud);
});
// 电脑：滚轮放大缩小、滑鼠拖
body.addEventListener('wheel', e => { e.preventDefault(); setZoom(zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY); }, { passive: false });
body.addEventListener('mousedown', e => {
  if (zoom <= 1) return;
  drag = { x: e.clientX - tx, y: e.clientY - ty, m: false };
  body.style.cursor = 'grabbing';
});
window.addEventListener('mousemove', e => {
  if (!drag || drag.m === undefined) return;
  drag.m = moved = true;
  tx = e.clientX - drag.x; ty = e.clientY - drag.y; bounds(); paint();
});
window.addEventListener('mouseup', () => { if (drag?.m !== undefined) { drag = null; paint(); } });
window.addEventListener('resize', () => { if (open) { bounds(); paint(); } });

// songs.html?ids=a,b,c#a：从主页／公告点进来，左右滑只在这几首里换
const onlyIds = (new URLSearchParams(location.search).get('ids') || '').split(',').filter(Boolean);
function openFromHash(first) {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id || !songs.some(s => s.id === id)) return;
  if (first === true && onlyIds.includes(id)) shown = onlyIds.map(x => songs.find(s => s.id === x)).filter(Boolean);
  if (first === true && fromPage) {
    cameIn = true;
    $('v-close').textContent = '‹ 返回';
    $('v-close').classList.add('text-sm');
  }
  show(id, false);
}

$('v-close').addEventListener('click', close);
$('v-prev').addEventListener('click', () => step(-1));
$('v-next').addEventListener('click', () => step(1));
$('v-full').addEventListener('click', () => setFull(true));
$('v-unlock').addEventListener('click', () => setFull(false));
$('v-share').addEventListener('click', async () => {
  if (!open) return;
  const text = `🎼 ${open.name}\n${location.origin}${location.pathname}#${open.id}`;
  try { await navigator.clipboard.writeText(text); toast('连结复制好了，可以贴去 WhatsApp'); }
  catch { prompt('复制这个连结：', text); }
});
document.addEventListener('keydown', e => {
  if (!open) return;
  if (e.key === 'Escape') { if (full) setFull(false); else close(); }
  if (e.key === 'ArrowLeft') step(-1);
  if (e.key === 'ArrowRight') step(1);
});
window.addEventListener('hashchange', openFromHash);

function toast(t) {
  const el = $('status');
  el.textContent = t; el.style.opacity = 1;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.style.opacity = 0; }, 2200);
}

load().catch(err => { console.error(err); $('loading').textContent = '读取失败：' + (err.code || err.message); });
