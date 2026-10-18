// 团员扫了现场的 QR 来到这里：第一次扫 = 签到（算整场到），隔 10 分钟以上再扫 = 签退（只有要早走的人才扫）
// 要先用电话登录（才知道是谁）；签到 / 签退会直接改点名页那一次的记录
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { tokenOk, hm, markFor } from "./checkin-common.js";

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
const OUT_HINT = '<span class="text-slate-400">待到最后的不用再扫。要早走的话，走之前再扫一次（签退）。</span>';

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

  const who = gate?.me();
  if (!who) {
    show('📱', '先用电话登录', '登录一次，以后这部手机扫了就直接签到。<br><button id="go" class="mt-3 w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3">用电话号码登录</button>');
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

  // 点名的人已经手动点过（请假、迟到…）就不盖掉；签退早走才改成早退
  const had = e.marks?.[who.id];
  const early = kind === 'out' && e.end && hm(next.out) < e.end;
  const mark = early ? 'T' : had || markFor(next, e.start, e.end);
  await updateDoc(ref, {
    [`times.${who.id}`]: next,
    [`marks.${who.id}`]: mark,
    [`names.${who.id}`]: who.name,
    updatedAt: now.toISOString(),
  });

  if (kind === 'in') {
    show('✅', `${esc(who.name)}，签到好了`, `${timeLine(next)}<br>这次算出席 🙏<br>${OUT_HINT}`, 'emerald');
  } else {
    show(early ? '⏰' : '👋', `${esc(who.name)}，签退好了`,
      `${timeLine(next)}${early ? `<br><span class="text-amber-700">${ampm(e.end)} 前走，这次算早退</span>` : '<br>辛苦了，路上小心 🙏'}`, early ? 'amber' : 'emerald');
  }
}

// 在这页登录好了 → 关掉登录框，马上签到
document.addEventListener('sic-login', () => { window.sicLogin?.close(); start(); });
function start() {
  run().catch(err => { console.error(err); show('📶', '没签到成功', '检查一下网络，再扫一次现场的 QR。<br><span class="text-xs text-slate-400">' + esc(err.code || err.message) + '</span>', 'red'); });
}
start();
