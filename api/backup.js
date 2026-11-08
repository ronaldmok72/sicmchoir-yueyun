// 每晚自动备份：把资料库整份读出来，交给乐韵账号 Drive 里的小程序（tools/drive-bridge.gs）存好。
// Vercel 每天半夜 3 点左右叫一次（vercel.json 的 crons）。
// 走跟登录服务一样的路读资料库；密码表（secrets、config/access）不备份，打乱过的电话和 PIN 也拿掉。
// 这个网址谁都叫得到，所以 6 小时内备份过就不再读，免得被乱叫吃掉资料库额度。
const crypto = require('crypto');
const F = require('firebase/firestore');

const DRIVE_URL = '';   // 小程序的网址，src/gate.js 也有一份
const PROJECT = 'sicmchoir-yueyun';
const CONFIG = { apiKey: 'AIzaSyD77WKlfYpUS1MJKu5J_xdV3adMZc5-c8U', authDomain: `${PROJECT}.firebaseapp.com`, projectId: PROJECT };
const COLLS = ['announcements', 'attendance', 'changelog', 'config', 'custom_songs', 'duties', 'masses', 'meetings', 'members',
  'photos', 'prayers', 'quiz_results', 'rsvp', 'seatings', 'setlists', 'song_audio', 'song_renames'];
const SECRET = ['phoneHash', 'pinHash'];
const GAP = 6 * 3600e3;

const b64url = x => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
function jwt(sa, payload) {
  const head = b64url({ alg: 'RS256', typ: 'JWT' });
  const body = b64url(payload);
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(sa.private_key, 'base64url');
  return `${head}.${body}.${sig}`;
}
const val = v => v && typeof v.toDate === 'function' ? v.toDate().toISOString() : Array.isArray(v) ? v.map(val)
  : v && typeof v === 'object' ? plain(v) : v;
const plain = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, val(v)]));

let ready = null;
function store(sa) {
  return ready || (ready = (async () => {
    const { initializeApp } = require('firebase/app');
    const { getAuth, signInWithCustomToken } = require('firebase/auth');
    const app = initializeApp(CONFIG, 'backup');
    const auth = getAuth(app), now = Math.floor(Date.now() / 1000);
    await signInWithCustomToken(auth, jwt(sa, {
      iss: sa.client_email, sub: sa.client_email,
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      iat: now, exp: now + 3600, uid: 'svc_backup', claims: { svc: true, areas: ['access'], member: '' },
    }));
    return { db: F.getFirestore(app), auth };
  })().catch(e => { ready = null; throw e; }));
}
async function drive(action, token, body = {}) {
  const r = await fetch(DRIVE_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, action, token }) });
  if (!r.ok) throw new Error(`Drive 小程序回 ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}
async function readAll(db) {
  const data = {};
  await Promise.all(COLLS.map(async c => {
    const out = {};
    (await F.getDocs(F.collection(db, c))).forEach(d => {
      if (c === 'config' && d.id === 'access') return;
      const x = plain(d.data());
      if (c === 'members') SECRET.forEach(k => delete x[k]);
      out[d.id] = x;
    });
    data[c] = out;
  }));
  return data;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const send = (code, o) => res.status(code).end(JSON.stringify(o));
  if (!DRIVE_URL) return send(200, { skipped: 'Drive 还没接好' });
  let sa = null;
  try { sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || 'null'); } catch { /* 下面当没放 */ }
  if (!sa?.private_key) return send(503, { error: '服务器钥匙还没放' });
  try {
    const { db, auth } = await store(sa);
    const token = await auth.currentUser.getIdToken();
    const st = await drive('status', token);
    if (st.lastBackupAt && Date.now() - Date.parse(st.lastBackupAt) < GAP) return send(200, { skipped: '6 小时内备份过了', lastBackupAt: st.lastBackupAt });
    const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);   // 马来西亚的日期
    const r = await drive('backup', token, { day, data: await readAll(db) });
    return send(200, { ok: true, day, counts: r.counts });
  } catch (e) {
    console.error(e);
    return send(500, { error: String(e.message || e) });
  }
};
