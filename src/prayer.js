// 练习前祈祷文：这个主日的进堂咏 + 集祷经（弥撒经书，每年同一个主日都一样）+ 圣女则济利亚祷文（每次都念）
// 进堂咏、集祷经存 Firestore prayers/{礼仪 key}（OT29、ADV1、EASTER…）：输入一次，明年同一个主日自己出来
// 星期四、星期六练的是接下来那个主日的歌，所以显示接下来的主日（今天是主日就是今天）
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, getDoc } from "./firebase.js";
import { litDay } from "./liturgy.js";
import { CECILIA, SEED, bookName, loadPrayer } from "./prayer-common.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gate = window.sicStaff;

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = s => new Date(s + 'T12:00');
const add = (s, n) => { const d = at(s); d.setDate(d.getDate() + n); return iso(d); };
const dm = s => `${+s.slice(8)}/${+s.slice(5, 7)}`;
// ?d=2026-10-18 看某一个主日；不然 = 接下来的主日
const want = (new URLSearchParams(location.search).get('d') || '').match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
let sunday = (() => { const t = want || iso(new Date()); return add(t, (7 - at(t).getDay()) % 7); })();
let lit = null, data = null;
window.sicNavDate = () => sunday;

async function load() {
  lit = litDay(sunday);
  const name = bookName(lit.key, lit.name);
  $('sun-name').textContent = name;
  // 这一周的练习：主日前的星期四、星期六
  $('sun-sub').textContent = `${dm(sunday)} 主日 · ${dm(add(sunday, -3))} & ${dm(add(sunday, -1))} 练习前念`;
  $('status').classList.remove('hidden');
  $('status').textContent = '读取中…';
  $('text').classList.add('hidden');
  data = await loadPrayer(lit.key);
  $('status').classList.add('hidden');
  render();
}

function render() {
  const has = !!(data && (data.entrance || data.collect || data.imageUrl));
  const verse = data?.verse?.[lit.cycle] || '';
  $('sec-verse').classList.toggle('hidden', !verse);
  $('verse').textContent = verse;
  $('verse-cycle').textContent = `（${lit.cycle}年）`;
  $('missing').classList.toggle('hidden', has);
  $('sec-entrance').classList.toggle('hidden', !data?.entrance);
  $('sec-collect').classList.toggle('hidden', !data?.collect);
  $('entrance-ref').textContent = data?.ref ? `（${data.ref}）` : '';
  $('entrance').textContent = data?.entrance || '';
  $('collect').textContent = data?.collect || '';
  $('photo').classList.toggle('hidden', !data?.imageUrl);
  if (data?.imageUrl) $('photo').src = data.imageUrl;
  $('cecilia').textContent = CECILIA;
  $('btn-edit').classList.toggle('hidden', !has);
  $('text').classList.remove('hidden');
  $('msg').textContent = has ? '' : '先输入这个主日的经文，或者只复制圣女则济利亚祷文';
}

$('prev').addEventListener('click', () => { sunday = add(sunday, -7); load(); });
$('next').addEventListener('click', () => { sunday = add(sunday, 7); load(); });

// ───────── 复制给 WhatsApp（照群里平常发的样子）─────────
$('btn-copy').addEventListener('click', async () => {
  const y = sunday.slice(2, 4);
  const lines = [`*${dm(add(sunday, -3))}/${y} & ${dm(add(sunday, -1))}/${y} ~练习前的祈祷文*`, `${bookName(lit.key, lit.name)}`];
  if (data?.entrance) lines.push('', `*进堂咏*${data.ref ? `（${data.ref}）` : ''}`, data.entrance);
  if (data?.collect) lines.push('', '*集祷经*', '请大家祈祷：', data.collect);
  lines.push('', '*圣女则济利亚祷文*', CECILIA);
  const text = lines.join('\n');
  try { await navigator.clipboard.writeText(text); $('msg').textContent = '✅ 已复制，可以贴到 WhatsApp'; }
  catch { prompt('复制下面这段：', text); }
});

// ───────── 输入／改（用电话登录过的团员、或有后台的都可以）─────────
async function canEdit() {
  if (gate?.me() || gate?.isStaff()) return true;
  if (confirm('要先用电话登录，才可以输入。现在登录？')) window.sicLogin?.open();
  return false;
}
const f = $('f');
async function openEditor() {
  if (!(await canEdit())) return;
  $('ed-title').textContent = `${bookName(lit.key, lit.name)}（${dm(sunday)}）`;
  f.ref.value = data?.ref || '';
  f.entrance.value = data?.entrance || '';
  f.collect.value = data?.collect || '';
  f.verse.value = data?.verse?.[lit.cycle] || '';
  $('ed-verse-label').textContent = `阿肋路亚经文（${lit.cycle}年；福音前欢呼中间唱的那一句）`;
  f.photo.value = '';
  $('ed-ai').value = '';
  $('ed-ai-msg').classList.add('hidden');
  $('ed-photo').textContent = data?.imageUrl ? '已经有照片了；再选一张会换掉。' : '';
  $('ed-err').textContent = '';
  $('editor').classList.remove('hidden');
}
$('btn-add').addEventListener('click', openEditor);
$('btn-edit').addEventListener('click', openEditor);
$('ed-close').addEventListener('click', () => $('editor').classList.add('hidden'));
$('editor').addEventListener('click', e => { if (e.target === $('editor')) $('editor').classList.add('hidden'); });
document.addEventListener('sic-login', () => window.sicLogin?.close());

// 经书上「请大家祈祷：」贴进来的话拿掉（页面上会自己加）
const clean = s => s.trim().replace(/^请大家祈祷[:：]\s*/, '').replace(/\s*\n\s*/g, '');
f.addEventListener('submit', async e => {
  e.preventDefault();
  const file = f.photo.files[0];
  const next = { ref: f.ref.value.trim().replace(/^[（(]|[)）]$/g, ''), entrance: clean(f.entrance.value), collect: clean(f.collect.value) };
  const verse = clean(f.verse.value);
  next.verse = { ...(data?.verse || {}), [lit.cycle]: verse };
  if (!verse) delete next.verse[lit.cycle];
  if (!next.entrance && !next.collect && !verse && !file && !data?.imageUrl) { $('ed-err').textContent = '至少打一段，或放一张照片'; return; }
  const b = $('ed-save');
  b.disabled = true; b.textContent = file ? '上传照片中…' : '保存中…';
  try {
    if (file) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('upload_preset', 'ml_default');
      const r = await (await fetch('https://api.cloudinary.com/v1_1/dsfhilcgz/image/upload', { method: 'POST', body: fd })).json();
      if (!r.secure_url) throw new Error('照片上传失败');
      next.imageUrl = r.secure_url;
    }
    const who = gate?.me()?.name || '后台';
    const full = { ...(data || {}), ...next, key: lit.key, name: bookName(lit.key, lit.name), updatedBy: who, updatedAt: new Date().toISOString() };
    await setDoc(doc(db, 'prayers', lit.key), full);
    data = full;
    $('editor').classList.add('hidden');
    render();
    $('msg').textContent = '✅ 存好了，明年同一个主日会自己出来';
  } catch (err) { console.error(err); $('ed-err').textContent = '没存到：' + (err.code || err.message); }
  b.disabled = false; b.textContent = '保存';
});

// ───────── 拍经书 → AI 读出字（填进表格，人看过再保存）─────────
// 手机照片很大：先缩到 1600px 宽的 JPEG 再送
function shrink(file) {
  return new Promise((ok, bad) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      ok(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = () => bad(new Error('这张照片打不开'));
    img.src = URL.createObjectURL(file);
  });
}
$('ed-ai').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const msg = $('ed-ai-msg');
  const say = (t, cls) => { msg.textContent = t; msg.className = `text-xs ${cls}`; };
  say('📷 读字中…（大概 10–30 秒）', 'text-indigo-600');
  try {
    await gate?.ensureAuth?.();
    const r = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await gate?.idToken?.()) },
      body: JSON.stringify({ stage: 'book', image: { data: await shrink(file), mime: 'image/jpeg' }, cycle: lit.cycle }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error('要先用电话登录（右上角菜单）');
    if (!r.ok) throw new Error(j.error || r.status);
    const b = j.book || {};
    const got = [];
    if (b.ref) { f.ref.value = b.ref; }
    if (b.entrance) { f.entrance.value = b.entrance; got.push('进堂咏'); }
    if (b.collect) { f.collect.value = b.collect; got.push('集祷经'); }
    if (b.verse) { f.verse.value = b.verse; got.push('阿肋路亚经文'); }
    say(got.length ? `✅ 读到：${got.join('、')}。请对一下经书有没有错字（看不清的字会写「□」），再按保存。` : '读不到字，请拍清楚一点再试，或直接打字。', got.length ? 'text-emerald-700' : 'text-amber-700');
  } catch (err) { console.error(err); say('没读到：' + (err.message || err), 'text-red-500'); }
});

// ───────── 接下来 8 个主日：哪些已经输入 ─────────
$('btn-ahead').addEventListener('click', async () => {
  const box = $('ahead'), b = $('btn-ahead');
  b.disabled = true; b.textContent = '读取中…';
  const first = add(iso(new Date()), (7 - new Date().getDay()) % 7);
  const suns = Array.from({ length: 8 }, (_, i) => add(first, i * 7));
  const rows = await Promise.all(suns.map(async d => {
    const l = litDay(d);
    let p = null;
    try { const s = await getDoc(doc(db, 'prayers', l.key)); p = s.exists() ? s.data() : SEED[l.key] || null; } catch { p = SEED[l.key] || null; }
    const okText = !!(p && (p.entrance || p.collect || p.imageUrl)), okVerse = !!p?.verse?.[l.cycle];
    return `<a href="prayer.html?d=${d}" class="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50">
      <span class="w-12 shrink-0 text-stone-500">${dm(d)}</span>
      <span class="flex-1 min-w-0 truncate">${esc(bookName(l.key, l.name))} <span class="text-xs text-stone-400">${l.cycle}年</span></span>
      <span class="text-xs whitespace-nowrap">${okText ? '✅' : '⚠️'} 祈祷文　${okVerse ? '✅' : '⚠️'} 阿肋路亚</span></a>`;
  }));
  box.innerHTML = rows.join('') + '<div class="px-4 py-2 text-xs text-stone-400">⚠️ 的按进去输入（可以拍经书）。输入过的以后每年（阿肋路亚：三年后）自己出来。</div>';
  box.classList.remove('hidden');
  b.disabled = false; b.textContent = '📋 接下来 8 个主日：哪些还没输入？';
});

load();
