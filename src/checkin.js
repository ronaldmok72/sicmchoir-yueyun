// 团员扫了现场的 QR 来到这里：第一次扫 = 签到，隔 10 分钟以上再扫 = 签退
// 积分：签到 + 签退 = 1 分（迟到、早退各扣 0.2）；只签到没签退 = 0.5 分
// 要先用电话登录（才知道是谁）；签到 / 签退会直接改点名页那一次的记录
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { tokenOk, hm, markFor, scanScore, lateOf, earlyOf, fmtPts } from "./checkin-common.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ampm = t => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}.${pad(m)}${h < 12 ? 'am' : 'pm'}`; };
const gate = window.sicStaff;
const q = new URLSearchParams(location.search);
const evId = q.get('e'), key = q.get('k');
const MIN_GAP = 10 * 60000;   // 签到后 10 分钟内再扫，不算签退（免得扫两次）
let okAt = 0;
const OUT_HINT = '<b class="text-indigo-700">回家前记得再扫一次签退</b>，不然这次只算 0.5 分。';

const show = (icon, title, sub = '', tone = 'slate') => {
  $('box').innerHTML = `<div class="text-5xl">${icon}</div>
    <div class="text-xl font-semibold text-${tone}-700">${title}</div>
    ${sub ? `<div class="text-sm text-slate-500 leading-relaxed">${sub}</div>` : ''}`;
};

async function run() {
  if (!evId) return show('🤔', '这个链接不完整', '请扫现场的 QR。');
  const ref = doc(db, 'attendance', evId);
  const snap = await getDoc(ref);
  const e = snap.exists() ? snap.data() : null;
  if (!e?.qr) return show('🤔', '找不到这次的签到', '请扫现场的 QR。');
  $('ev').textContent = `${Number(e.date.slice(8))}/${Number(e.date.slice(5, 7))} ${e.title || ''}`;
  if (e.date !== iso(new Date())) return show('📅', '这个 QR 不是今天的', '请扫今天现场的 QR。');
  // 打开这页时 QR 是对的 → 先去登录也没关系，10 分钟内回来都算
  if (await tokenOk(e.qr, key)) okAt ||= Date.now();
  if (!okAt || Date.now() - okAt > MIN_GAP) return show('⌛', 'QR 过期了', '现场的 QR 每 30 秒会换。<br>请再扫一次屏幕上的 QR。', 'amber');

  let who = gate?.me();
  // 很久以前登录的手机没记打乱过的电话 → 领不到通行证，当作没登录，请他用电话再登录一次
  if (who && !who.ph) { gate.logout(); who = null; }
  if (!who) {
    show('📱', '先用电话登录', '登录一次，以后用这部手机扫就会直接签到。<br><span class="text-xs text-slate-400">iPhone 用相机扫会开 Safari，跟桌面上的 App 是分开的，所以 Safari 也要登录一次。<br>不想再登录：打开 App，按下面的「📷 扫码签到」。</span><br><button id="go" class="mt-3 w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3">用电话号码登录</button>');
    $('go').addEventListener('click', () => window.sicLogin?.open());
    return;
  }

  const now = new Date();
  const t = e.times?.[who.id] || {};
  const timeLine = x => `到 <b>${hm(x.in)}</b>${x.out ? `　·　走 <b>${hm(x.out)}</b>` : ''}`;
  let next, kind;
  if (!t.in) { next = { in: now.toISOString() }; kind = 'in'; }
  else if (now - new Date(t.in) < MIN_GAP) {
    return show('✅', `${esc(who.name)}，你已经签到了`, `${timeLine(t)}<br>${OUT_HINT}`, 'emerald');
  } else { next = { ...t, out: now.toISOString() }; kind = 'out'; }

  const mark = markFor(next, e.start, e.end);
  const pts = scanScore(next, e.start, e.end);
  const late = lateOf(next, e.start), early = earlyOf(next, e.end);
  try {
    await gate.withAuth(() => updateDoc(ref, {
      [`times.${who.id}`]: next,
      [`marks.${who.id}`]: mark,
      [`pts.${who.id}`]: pts,
      [`names.${who.id}`]: who.name,
      updatedAt: now.toISOString(),
    }));
  } catch (err) {
    if (err.code !== 'permission-denied') throw err;
    // 重领通行证也不行：多数是电话换过了／名单上的人被合并了 → 请他重新登录
    console.error(err);
    gate.logout();
    show('📱', '要重新登录一次', '这部手机记的登录过期了。<br>用电话号码再登录一次，就会马上签到。<br><button id="go" class="mt-3 w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3">用电话号码登录</button>', 'amber');
    $('go').addEventListener('click', () => window.sicLogin?.open());
    return;
  }

  if (kind === 'in') {
    show(late ? '⏰' : '✅', `${esc(who.name)}，签到好了`,
      `${timeLine(next)}${late ? `<br><span class="text-amber-700">${ampm(e.start)} 后才到，算迟到（扣 0.2 分）</span>` : ''}<br>${OUT_HINT}`, late ? 'amber' : 'emerald');
  } else {
    show(late || early ? '⏰' : '👋', `${esc(who.name)}，签退好了`,
      `${timeLine(next)}<br>这次 <b>${fmtPts(pts)}</b> 分${late ? '（迟到扣 0.2）' : ''}${early ? `<br><span class="text-amber-700">${ampm(e.end)} 前走，算早退（扣 0.2 分）</span>` : ''}<br>辛苦了，路上小心 🙏`, late || early ? 'amber' : 'emerald');
  }
}

// 在这页登录好了 → 关掉登录框，马上签到
document.addEventListener('sic-login', () => { window.sicLogin?.close(); start(); });
function start() {
  run().catch(err => { console.error(err); show('📶', '没签到成功', '检查一下网络，再扫一次现场的 QR。<br><span class="text-xs text-slate-400">' + esc(err.code || err.message) + '</span>', 'red'); });
}
start();
