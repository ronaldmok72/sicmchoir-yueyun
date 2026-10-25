// 团员扫了现场的 QR 来到这里：自己按「刚到」（签到）还是「要走了」（签退）
// （以前第一次扫 = 签到、再扫 = 签退；忘了签到的人走的时候一扫就变成签到，早退看不出来）
// 积分：签到 + 签退 = 1 分（迟到、早退各扣 0.2）；只签到没签退 = 0.5 分；只签退没签到 = 0.5 分（早退再扣 0.2）
// 要先用电话登录（才知道是谁）；签到 / 签退会直接改点名页那一次的记录
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, getDoc } from "./firebase.js";
import { tokenOk, hm, markFor, scanScore, lateOf, earlyOf, fmtPts } from "./checkin-common.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ampm = t => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}.${pad(m)}${h < 12 ? 'am' : 'pm'}`; };
const gate = window.sicStaff;
const q = new URLSearchParams(location.search);
const evId = q.get('e'), key = q.get('k');
const MIN_GAP = 10 * 60000;   // QR 扫了 10 分钟内要按好；签到后 10 分钟内按「要走了」会再问一次
let okAt = 0;
const OUT_HINT = '<span class="block mt-2 rounded-xl bg-indigo-50 text-indigo-800 px-3 py-2">💡 温馨提醒：回家前记得再扫一次，按「<b>要走了</b>」签退哦～<br>没签退的话，这次只算 0.5 分（少掉 0.5 分，好可惜的）</span>';
const BTN = 'w-full rounded-2xl py-4 text-lg font-semibold transition-colors';

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

  const t = e.times?.[who.id] || {};
  choose(e, ref, who, t);
}

const timeLine = x => [x.in && `到 <b>${hm(x.in)}</b>`, x.out && `走 <b>${hm(x.out)}</b>`].filter(Boolean).join('　·　');

// 让他自己选：刚到，还是要走了（还没签到 → 「刚到」比较大；签到过了 → 「要走了」比较大）
function choose(e, ref, who, t) {
  const guess = t.in ? 'out' : 'in';
  const btn = (k, label) => `<button data-k="${k}" class="${BTN} ${k === guess
    ? (k === 'in' ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white')
    : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300'}">${label}</button>`;
  show('😊', `${esc(who.name)}，你好！`,
    `你是刚到，还是要回家了？${t.in || t.out ? `<br><span class="text-xs text-slate-400">今天：${timeLine(t)}</span>` : ''}
    <span class="block mt-4 space-y-3">${btn('in', '🙋 刚到（签到）')}${btn('out', '🏠 要走了（签退）')}</span>`);
  $('box').querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => pick(b.dataset.k, e, ref, who, t).catch(fail)));
}

async function pick(kind, e, ref, who, t, sure) {
  if (Date.now() - okAt > MIN_GAP) return show('⌛', 'QR 过期了', '隔太久才按了～<br>请再扫一次屏幕上的 QR。', 'amber');
  const now = new Date();
  if (kind === 'in') {
    if (t.in) return show('😊', `${esc(who.name)}，你已经签到了`, `${timeLine(t)}${t.out ? '<br>今天也签退了，辛苦了 🙏' : OUT_HINT}`, 'emerald');
    if (t.out) return show('😊', `${esc(who.name)}，你今天已经签退了`, `${timeLine(t)}<br>辛苦了，路上小心 🙏`, 'emerald');
  } else {
    if (t.out) return show('👋', `${esc(who.name)}，你已经签退了`, `${timeLine(t)}<br>辛苦了，路上小心，平安到家 🙏`, 'emerald');
    // 才刚签到就按要走：多数是按错，再问一次
    if (t.in && now - new Date(t.in) < MIN_GAP && !sure) {
      show('🤔', '这么快就要走了吗？', `你 <b>${hm(t.in)}</b> 才签到哦。<br>如果是按错了，按「我还没要走」就好。
        <span class="block mt-4 space-y-3"><button data-sure class="${BTN} bg-indigo-600 hover:bg-indigo-500 text-white">是的，我要走了</button>
        <button data-back class="${BTN} bg-white hover:bg-slate-50 text-slate-700 border border-slate-300">我还没要走</button></span>`, 'amber');
      $('box').querySelector('[data-sure]').addEventListener('click', () => pick(kind, e, ref, who, t, true).catch(fail));
      $('box').querySelector('[data-back]').addEventListener('click', () => show('😊', `好的，${esc(who.name)}`, `${timeLine(t)}${OUT_HINT}`, 'emerald'));
      return;
    }
  }
  show('⏳', kind === 'in' ? '签到中…' : '签退中…');

  const next = { ...t, [kind]: now.toISOString() };
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

  const lateLine = late ? `<br><span class="text-amber-700">今天 ${ampm(e.start)} 后才到，算迟到（扣 0.2 分）。没关系，下次早一点点就好 💪</span>` : '';
  const earlyLine = early ? `<br><span class="text-amber-700">${ampm(e.end)} 前先走，算早退（扣 0.2 分）。有事先走没关系，下次能留到最后就更好啦 😊</span>` : '';
  if (kind === 'in') {
    show(late ? '⏰' : '✅', `${esc(who.name)}，欢迎你来 😊`,
      `${timeLine(next)}<br>今天也一起好好唱 🎶${lateLine}${OUT_HINT}`, late ? 'amber' : 'emerald');
  } else if (!next.in) {
    show('👋', `${esc(who.name)}，辛苦了！`,
      `${timeLine(next)}<br>今天好像忘了签到哦，所以这次算 <b>${fmtPts(pts)}</b> 分。${earlyLine}
      <span class="block mt-2 rounded-xl bg-indigo-50 text-indigo-800 px-3 py-2">💡 下次到了先扫一次，按「<b>刚到</b>」签到，就可以拿满分啦～</span>
      <br>路上小心，平安到家 🙏`, 'amber');
  } else {
    show(late || early ? '⏰' : '👋', `${esc(who.name)}，辛苦了！`,
      `${timeLine(next)}<br>这次 <b>${fmtPts(pts)}</b> 分${late ? '（迟到扣 0.2）' : ''}${earlyLine}<br>谢谢你今天的付出，路上小心，平安到家 🙏`, late || early ? 'amber' : 'emerald');
  }
}

// 在这页登录好了 → 关掉登录框，马上签到
document.addEventListener('sic-login', () => { window.sicLogin?.close(); start(); });
function fail(err) {
  console.error(err);
  show('📶', '没签到成功', '检查一下网络，再扫一次现场的 QR。<br><span class="text-xs text-slate-400">' + esc(err.code || err.message) + '</span>', 'red');
}
function start() { run().catch(fail); }
start();
