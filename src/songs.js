// 歌单目录：曲库每一首歌都在这里，团员随时翻来看谱、学歌
// 歌就是排单后台的曲库（library.js + 云端 custom_songs），后台上传新歌、改名、换图，这里打开就是最新的
// 每首歌旁边写接下来哪一台要唱、以前唱过几次（从 masses 排歌记录算）
// songs.html#song_123 = 直接打开那一首（公告、WhatsApp 可以贴这个连结）
// 录音：song_audio/{歌id} = { items: [{ url, label, at }] }，只放 Google Drive／YouTube 连结（另外放，排单后台换谱时不会被盖掉）
//   后台（排单后台／弥撒排歌／指挥）的人在看谱页按「🎧＋」贴连结
import { collection, getDocs, doc, setDoc, arrayUnion, arrayRemove, updateDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase.js";
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
  const [, ma, no, au] = await Promise.all([loadLibrary(db), getDocs(collection(db, 'masses')), loadNotices(db).catch(() => ({ active: [] })), getDocs(collection(db, 'song_audio')).catch(() => ({ docs: [] }))]);
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
  openFromHash();
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
function renderAudio() {
  const list = open ? audio[open.id] || [] : [];
  const staff = canAudio();
  $('v-audio-add').classList.toggle('hidden', !staff);
  const box = $('v-audio');
  box.classList.toggle('hidden', !list.length);
  box.innerHTML = `<div class="flex flex-wrap gap-2">${list.map((x, i) => `
    <span class="inline-flex items-center rounded-lg bg-white/10">
      <a href="${esc(x.url)}" target="_blank" rel="noopener" class="px-3 py-2 text-sm hover:bg-white/10 rounded-lg">🎧 ${esc(x.label || '听录音')}</a>
      ${staff ? `<button data-audio-del="${i}" class="px-2 py-2 text-slate-400 hover:text-red-400" title="拿掉">✕</button>` : ''}
    </span>`).join('')}</div>`;
}
$('v-audio').addEventListener('click', async e => {
  const d = e.target.closest('[data-audio-del]');
  if (!d || !open) return;
  const x = (audio[open.id] || [])[+d.dataset.audioDel];
  if (!x || !confirm(`拿掉「${x.label || '录音'}」这个连结？\n（Google Drive 里的录音不会被删）`)) return;
  try {
    await updateDoc(doc(db, 'song_audio', open.id), { items: arrayRemove(x) });
    audio[open.id] = audio[open.id].filter(y => y !== x);
    renderAudio(); render();
  } catch (err) { console.error(err); alert('没拿掉：' + (err.code || err.message)); }
});
$('v-audio-add').addEventListener('click', async () => {
  if (!open) return;
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
});

// ───────── 看谱 ─────────
let zoom = false;
function show(id, push = true) {
  const s = songs.find(x => x.id === id);
  if (!s) return;
  open = s;
  $('v-title').textContent = s.name;
  $('v-sub').textContent = clean(s.title);
  $('v-img').src = s.imageUrl;
  $('v-img').alt = s.name;
  $('v-body').scrollTo(0, 0);
  setZoom(false);
  const info = [
    s.practice.length ? `📢 要练：${s.practice.join('、')}` : '',
    s.next.length ? `接下来：${s.next.slice(0, 3).map(x => `${md(x.date)} ${x.label}`).join('、')}${s.next.length > 3 ? ` 等 ${s.next.length} 台` : ''}` : '',
    s.past.length ? `唱过 ${s.past.length} 次，上次 ${md(s.past.at(-1))}` : '',
  ].filter(Boolean).join('　·　');
  $('v-info').textContent = info || '还没有在弥撒排过';
  const i = shown.findIndex(x => x.id === id);
  $('v-prev').disabled = i <= 0;
  $('v-next').disabled = i < 0 || i >= shown.length - 1;
  ['v-prev', 'v-next'].forEach(b => $(b).classList.toggle('opacity-30', $(b).disabled));
  renderAudio();
  $('viewer').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  if (push) history.replaceState(null, '', '#' + id);
}
function close() {
  open = null;
  $('viewer').classList.add('hidden');
  document.body.style.overflow = '';
  history.replaceState(null, '', location.pathname + location.search);
}
function step(d) {
  const i = shown.findIndex(x => x.id === open?.id);
  if (i >= 0 && shown[i + d]) show(shown[i + d].id);
}
function setZoom(on) {
  zoom = on;
  $('v-img').className = `block mx-auto ${on ? 'max-w-none w-[200%]' : 'w-full max-w-3xl'}`;
  $('v-zoom').textContent = on ? '🔍 缩小' : '🔍 放大';
}
function openFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (id && songs.some(s => s.id === id)) show(id, false);
}

$('v-close').addEventListener('click', close);
$('v-prev').addEventListener('click', () => step(-1));
$('v-next').addEventListener('click', () => step(1));
$('v-zoom').addEventListener('click', () => setZoom(!zoom));
$('v-share').addEventListener('click', async () => {
  if (!open) return;
  const text = `🎼 ${open.name}\n${location.origin}${location.pathname}#${open.id}`;
  try { await navigator.clipboard.writeText(text); toast('连结复制好了，可以贴去 WhatsApp'); }
  catch { prompt('复制这个连结：', text); }
});
document.addEventListener('keydown', e => {
  if (!open) return;
  if (e.key === 'Escape') close();
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
