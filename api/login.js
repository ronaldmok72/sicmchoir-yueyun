// 领通行证：手机上输对的后台密码／电话登录，拿来这里换一张 Firebase 通行证（custom token）。
// 资料库锁起来之后，有通行证才能改资料；通行证里写着这个人开了哪几区（areas）、是哪个团员（member）。
// 服务器钥匙放在 Vercel 的环境变量 FIREBASE_SERVICE_ACCOUNT（整个 JSON），只有这里看得到，网页拿不到。
//
// POST { keys: ['打乱后的密码', ...], pins: [{ m: 团员id, h: pinHash }], member: { id, phoneHash } }
//   → { token, uid, areas, member }，全部对不上 → 401
// GET → { configured: true/false }（看钥匙放好了没有）
const crypto = require('crypto');

const PROJECT = 'sicmchoir-yueyun';
const API = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const ALL = ['conduct', 'mass', 'duties', 'seating', 'members', 'attendance', 'notice', 'admin', 'quiz', 'photos', 'access'];

const b64url = x => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
function jwt(sa, payload) {
  const head = b64url({ alg: 'RS256', typ: 'JWT' });
  const body = b64url(payload);
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(sa.private_key, 'base64url');
  return `${head}.${body}.${sig}`;
}

// 用服务器钥匙读资料库（不受锁影响）
let cached = null;
async function accessToken(sa) {
  if (cached && cached.exp > Date.now() + 60000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt(sa, { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${assertion}`,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('服务器钥匙不对：' + (j.error_description || j.error || r.status));
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}
const plain = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, 'arrayValue' in v ? (v.arrayValue.values || []).map(x => Object.values(x)[0]) : Object.values(v)[0]]));
async function getDoc(sa, path) {
  const r = await fetch(`${API}/${path}`, { headers: { Authorization: 'Bearer ' + await accessToken(sa) } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`读不到 ${path}：${r.status}`);
  return plain((await r.json()).fields);
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  let sa = null;
  try { sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || 'null'); } catch { /* 下面当没放 */ }
  if (req.method === 'GET') return res.status(200).end(JSON.stringify({ configured: !!sa?.private_key }));
  if (req.method !== 'POST') return res.status(405).end('{}');
  if (!sa?.private_key) return res.status(503).end(JSON.stringify({ error: '服务器钥匙还没放' }));

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const areas = new Set();

    // 1. 后台密码（密码管理页设的，config/access）
    const keys = (Array.isArray(body.keys) ? body.keys : []).filter(h => typeof h === 'string').slice(0, 10);
    if (keys.length) {
      const acc = await getDoc(sa, 'config/access');
      const list = acc ? JSON.parse(acc.json || '[]') : [];
      keys.forEach(h => { const k = list.find(k => k.hash === h); if (k) (k.master ? ALL : k.areas || []).forEach(a => areas.add(a)); });
    }

    // 2. 团员：电话（phoneHash）要跟名单上的一样
    let member = null;
    const m = body.member;
    if (m && typeof m.id === 'string' && typeof m.phoneHash === 'string' && m.id.length < 200) {
      const doc = await getDoc(sa, 'members/' + encodeURIComponent(m.id));
      if (doc && doc.phoneHash && doc.phoneHash === m.phoneHash) member = m.id;
    }

    // 3. 有开后台的团员：PIN（members/{id}.pinHash），开的区照名单上的 areas
    const pins = (Array.isArray(body.pins) ? body.pins : []).slice(0, 5);
    for (const p of pins) {
      if (typeof p?.m !== 'string' || typeof p?.h !== 'string') continue;
      const doc = await getDoc(sa, 'members/' + encodeURIComponent(p.m));
      if (doc && doc.pinHash && doc.pinHash === p.h) (doc.areas || []).forEach(a => areas.add(a));
    }

    if (!areas.size && !member) return res.status(401).end(JSON.stringify({ error: '密码／电话对不上' }));
    const uid = member ? 'm_' + member : 'staff_' + crypto.createHash('sha256').update([...areas].sort().join(',')).digest('hex').slice(0, 16);
    const now = Math.floor(Date.now() / 1000);
    const token = jwt(sa, {
      iss: sa.client_email, sub: sa.client_email,
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      iat: now, exp: now + 3600, uid,
      claims: { areas: [...areas].filter(a => ALL.includes(a)), member: member || '' },
    });
    return res.status(200).end(JSON.stringify({ token, uid, areas: [...areas], member }));
  } catch (e) {
    return res.status(500).end(JSON.stringify({ error: String(e.message || e) }));
  }
};
