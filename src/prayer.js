// 练习前祈祷文：这个主日的进堂咏 + 集祷经（弥撒经书，每年同一个主日都一样）+ 圣女则济利亚祷文（每次都念）
// 进堂咏、集祷经存 Firestore prayers/{礼仪 key}（OT29、ADV1、EASTER…）：输入一次，明年同一个主日自己出来
// 星期四、星期六练的是接下来那个主日的歌，所以显示接下来的主日（今天是主日就是今天）
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { litDay } from "./liturgy.js";
import { CECILIA, bookName, loadPrayer } from "./prayer-common.js";

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
  f.photo.value = '';
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
  if (!next.entrance && !next.collect && !file && !data?.imageUrl) { $('ed-err').textContent = '至少打一段，或放一张照片'; return; }
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

load();
