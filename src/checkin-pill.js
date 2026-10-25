// 打开 App 时：今天有开现场 QR 签到（点名页按了「开 QR」）→ 下面浮出「📷 扫码签到」
// 签到过了、还没签退 → 变成「📷 回家前扫码签退」；两个都扫了就不出现
// 只给登录了的团员看；回到 App（切回来）、每 5 分钟会再看一次
import { collection, query, where } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, getDocs } from "./firebase.js";

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const mins = t => { const [h, m] = (t || '23:59').split(':').map(Number); return h * 60 + m; };
const HIDE = 'sicPillHide';   // 按了 ✕ → 这次点名的这一步（签到/签退）不再出现

async function check() {
  const me = window.sicStaff?.me?.();
  if (!me || document.hidden) return;
  const now = new Date(), nowM = now.getHours() * 60 + now.getMinutes();
  const q = await getDocs(query(collection(db, 'attendance'), where('date', '==', iso(now))));
  // 开了 QR、还没结束太久（早退时间后 90 分钟内；没设就当天都算）
  const evs = q.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.qr && nowM <= mins(e.end) + 90);
  let step = null, ev = null;
  for (const e of evs) {
    const t = e.times?.[me.id] || {};
    if (!t.in && !t.out) { step = 'in'; ev = e; break; }
    if (t.in && !t.out && now - new Date(t.in) > 10 * 60000) { step = 'out'; ev = e; }
  }
  let hidden = '';
  try { hidden = sessionStorage.getItem(HIDE) || ''; } catch { /* 没关系 */ }
  const key = ev && `${ev.id}:${step}`;
  render(step && hidden !== key ? { step, key } : null);
}

function render(s) {
  let el = document.getElementById('checkin-pill');
  if (!s) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'checkin-pill';
    el.style.cssText = 'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 20px);transform:translateX(-50%);z-index:65;display:flex;align-items:center;gap:6px;';
    document.body.appendChild(el);
  }
  const out = s.step === 'out';
  el.innerHTML = `<a href="scan.html" style="display:inline-flex;align-items:center;gap:8px;padding:14px 22px;border-radius:999px;background:${out ? '#4f46e5' : '#059669'};color:#fff;font-weight:700;font-size:16px;text-decoration:none;box-shadow:0 10px 30px rgba(0,0,0,.45);white-space:nowrap;">📷 ${out ? '回家前扫码签退' : '扫码签到'}</a>
    <button aria-label="先不要" style="width:36px;height:36px;border-radius:999px;background:rgba(39,39,42,.9);color:#a1a1aa;border:1px solid rgba(255,255,255,.1);font-size:14px;">✕</button>`;
  el.querySelector('button').onclick = () => {
    try { sessionStorage.setItem(HIDE, s.key); } catch { /* 没关系 */ }
    el.remove();
  };
}

const safe = () => check().catch(err => console.warn('签到按钮', err));
safe();
document.addEventListener('sic-login', safe);
document.addEventListener('visibilitychange', () => { if (!document.hidden) safe(); });
setInterval(safe, 5 * 60000);
