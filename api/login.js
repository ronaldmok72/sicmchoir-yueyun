// 登录服务：后台密码、PIN、电话都在这里对，手机只拿到「对／不对、开哪几区」，看不到打乱过的密码表。
// 对了就发一张 Firebase 通行证（custom token）；资料库锁起来之后，有通行证才能改资料。
// 服务器钥匙放在 Vercel 的环境变量 FIREBASE_SERVICE_ACCOUNT（整个 JSON），只有这里看得到，网页拿不到。
//
// POST { action, keys: ['打乱后的密码', ...], pins: [{ m: 团员id, h: pinHash }], member: { id, phoneHash }, ... }
//   action 'token'（默认）→ { token, uid, areas, member }，全部对不上 → 401
//   action 'check'    → { keys: [开的区 或 null], pins: [开的区 或 null], member: true/false }（不发通行证）
//   action 'find'     { phoneHash } → 名单上那一位（不含打乱过的电话／PIN，有 hasPin）；找不到 → 404
//   action 'register' { id（名单上的那一位，新团员不用）, info } → 注册好的那一位
//   action 'setPin'   { member, h } → 第一次设 PIN（要电话对得上、还没设过）→ { areas }
//   后台的事：keys / saveKeys / setPhone / clearPin / setMaster / mergeSecrets / migrate（要带证明，见下面）
//
// 打乱过的电话、PIN、密码表都藏在 secrets（资料库规则不给任何手机读写，只有这里的服务器钥匙碰得到）：
//   secrets/m_{团员id} = { phoneHash, pinHash, master（他的 PIN 也开最高权限）, pinFails, pinLockUntil }　secrets/access = { json: 密码表 }
//   PIN 连错 5 次 → 锁 15 分钟（PIN 只有 4 位数，不锁的话可以一个个试）
//   团员名单上只留 phoneTail（电话最后 4 码）、hasPin（设了 PIN）
//   还没搬（migrate）之前，members / config/access 上的旧资料照样认
// GET → { configured: true/false }（看钥匙放好了没有）
const crypto = require('crypto');

const PROJECT = 'sicmchoir-yueyun';
const API = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const ALL = ['conduct', 'mass', 'duties', 'seating', 'members', 'attendance', 'notice', 'admin', 'quiz', 'photos', 'access'];
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
// 还没在「密码管理」设过任何密码之前，旧密码 sic 暂时当最高权限（跟 App 一样）
const BOOT = sha('sicmchoir|sic');
const SECRET = ['phoneHash', 'pinHash'];

const b64url = x => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
// 团员票（ticket）：电话对得上一次之后发给那部手机，60 天有效，每次对得上就换新的
// 资料库读不到（额度用完、429）的时候，凭票照样发「团员」通行证（可以签到、按会来）；后台的区还是要资料库对得上才开
const TICKET_DAYS = 60;
const hmac = (sa, x) => crypto.createHmac('sha256', sa.private_key).update(x).digest('base64url');
function ticketFor(sa, id, ph) {
  const body = b64url({ id, ph, exp: Date.now() + TICKET_DAYS * 864e5 });
  return `${body}.${hmac(sa, body)}`;
}
function ticketOk(sa, t, m) {
  const [body, sig] = String(t || '').split('.');
  if (!body || !sig || sig.length !== 43) return false;
  const want = hmac(sa, body);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return false;
  try {
    const v = JSON.parse(Buffer.from(body, 'base64url').toString());
    return v.exp > Date.now() && v.id === m?.id && v.ph === m?.phoneHash;
  } catch { return false; }
}

function jwt(sa, payload) {
  const head = b64url({ alg: 'RS256', typ: 'JWT' });
  const body = b64url(payload);
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(sa.private_key, 'base64url');
  return `${head}.${body}.${sig}`;
}

// 用服务器钥匙读写资料库（不受锁影响）
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
// Firestore REST 的格式 ↔ 普通物件
const val = v => 'mapValue' in v ? plain(v.mapValue.fields) : 'arrayValue' in v ? (v.arrayValue.values || []).map(val)
  : 'integerValue' in v ? Number(v.integerValue) : 'nullValue' in v ? null : Object.values(v)[0];
const plain = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, val(v)]));
const fv = v => typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) };
const fields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fv(v)]));
async function call(sa, url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + await accessToken(sa), 'Content-Type': 'application/json' } });
  if (!r.ok && r.status !== 404) throw new Error(`资料库 ${r.status}`);
  return r.status === 404 ? null : r.json();
}
const getDoc = async (sa, path) => { const j = await call(sa, `${API}/${path}`); return j ? plain(j.fields) : null; };
const idOf = d => d.name.split('/').pop();
const secPath = id => 'secrets/m_' + encodeURIComponent(id);
// 名单上的一位，加上藏起来的电话／PIN；没有这个人 → null
// master 只认藏起来的那一份（名单上的谁都可能被有团员名单权限的人改到）；Ronald 本人一直都是
const OWNER = '2nS36onMz8Pn9F9ohTya';   // 团员名单上的 Ronald Mok
async function member(sa, id) {
  const [m, s] = await Promise.all([getDoc(sa, 'members/' + encodeURIComponent(id)), getDoc(sa, secPath(id))]);
  return m && { id, ...m, ...(s || {}), master: !!s?.master || id === OWNER };
}
const PIN_TRIES = 5, PIN_LOCK = 15 * 60000;
async function firstWith(sa, coll, h) {
  const j = await call(sa, `${API}:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery: {
    from: [{ collectionId: coll }], where: { fieldFilter: { field: { fieldPath: 'phoneHash' }, op: 'EQUAL', value: { stringValue: h } } }, limit: 1 } }) });
  const hit = (j || []).find(x => x.document);
  return hit ? decodeURIComponent(idOf(hit.document)) : null;
}
// 用打乱过的电话找团员（先找藏起来的，再找还没搬的旧资料）
async function byPhone(sa, h) {
  const s = await firstWith(sa, 'secrets', h);
  const id = s ? s.replace(/^m_/, '') : await firstWith(sa, 'members', h);
  return id ? member(sa, id) : null;
}
// 改几格（o），drop 里的那几格拿掉；只动这些，其他照旧
const patch = (sa, path, o, drop = []) => call(sa, `${API}/${path}?${[...Object.keys(o), ...drop].map(k => 'updateMask.fieldPaths=' + k).join('&')}`,
  { method: 'PATCH', body: JSON.stringify({ fields: fields(o) }) });
const send = (res, code, o) => res.status(code).end(JSON.stringify(o || {}));
const HEX = /^[0-9a-f]{64}$/;
// 密码表（secrets/access，还没搬的话 config/access）；还没设过 → null。给手机看的拿掉打乱过的密码
const accessList = async sa => {
  const a = await getDoc(sa, 'secrets/access') || await getDoc(sa, 'config/access');
  return a ? JSON.parse(a.json || '[]') : null;
};
const strip = list => list && list.map(({ hash, ...k }) => k);
// 给手机看的：拿掉打乱过的电话和 PIN
const pub = m => { const o = { ...m, hasPin: !!m.pinHash }; SECRET.forEach(k => delete o[k]); return o; };
const str = (x, n = 200) => typeof x === 'string' && x.length <= n ? x : '';

// 这次带来的密码／PIN／电话，逐个对：回传每一个开的区、是哪位团员、全部加起来开的区
async function verify(sa, body) {
  const keys = (Array.isArray(body.keys) ? body.keys : []).map(h => str(h, 100)).slice(0, 10);
  const pins = (Array.isArray(body.pins) ? body.pins : []).slice(0, 5).map(p => ({ m: str(p?.m), h: str(p?.h, 100) }));
  const out = { keys: [], pins: [], member: null, areas: new Set(), locked: false };

  // 1. 团员：电话（phoneHash）要跟名单上的一样
  const m = body.member;
  if (str(m?.id) && str(m?.phoneHash, 100)) {
    const doc = await member(sa, m.id);
    if (doc && doc.phoneHash && doc.phoneHash === m.phoneHash) { out.member = m.id; out.memberName = doc.name || ''; }
  }
  // 2. 后台密码（密码管理页设的）：一定要先用电话登录（上面对得上），才查得到是谁改的；没登录 → 全部不算
  if (keys.length && !out.member) out.keys = keys.map(() => null);
  else if (keys.length) {
    const list = await accessList(sa);
    out.keys = keys.map(h => {
      const k = list ? list.find(k => h && k.hash === h) : (h === BOOT ? { master: true } : null);
      return k ? (k.master ? ALL : (k.areas || []).filter(a => ALL.includes(a))) : null;
    });
  }
  // 3. 有开后台的团员：PIN，开的区照名单上的 areas；密码管理那边勾了「最高权限」的人（Ronald）全部都开
  for (const p of pins) {
    const doc = p.m && p.h ? await member(sa, p.m) : null;
    if (!doc || !doc.pinHash) { out.pins.push(null); continue; }
    if (Number(doc.pinLockUntil || 0) > Date.now()) { out.locked = true; out.pins.push(null); continue; }
    const ok = doc.pinHash === p.h, fails = Number(doc.pinFails || 0);   // 存进去的数字是字串
    if (!ok) {
      await patch(sa, secPath(p.m), fails + 1 >= PIN_TRIES ? { pinFails: 0, pinLockUntil: Date.now() + PIN_LOCK } : { pinFails: fails + 1 });
      if (fails + 1 >= PIN_TRIES) out.locked = true;
    } else if (fails) await patch(sa, secPath(p.m), { pinFails: 0 });
    const a = ok ? (doc.master ? ALL : (doc.areas || []).filter(a => ALL.includes(a) && a !== 'access')) : [];
    out.pins.push(a.length ? a : null);
  }
  [...out.keys, ...out.pins].forEach(a => (a || []).forEach(x => out.areas.add(x)));
  return out;
}

function token(sa, areas, member) {
  const uid = member ? 'm_' + member : 'staff_' + sha([...areas].sort().join(',')).slice(0, 16);
  const now = Math.floor(Date.now() / 1000);
  return { uid, token: jwt(sa, {
    iss: sa.client_email, sub: sa.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now, exp: now + 3600, uid,
    claims: { areas: [...areas], member: member || '' },
  }) };
}

const ACTIONS = {
  async token(sa, body, res) {
    let v;
    try { v = await verify(sa, body); } catch (e) {
      // 资料库读不到：带着有效团员票的，先发只有团员身份的通行证（不开后台）
      if (!ticketOk(sa, body.ticket, body.member)) throw e;
      const t = token(sa, new Set(), body.member.id);
      return res.status(200).end(JSON.stringify({ ...t, areas: [], member: body.member.id, ticket: body.ticket, degraded: true }));
    }
    // 保持登录：电话对得上 → 存一个 cookie 记住是谁（iPhone Safari 一阵子没开会清掉 localStorage，但服务器发的 cookie 会留着）
    // 电话对不上 → 把这个 cookie 也拿掉
    if (v.member) res.setHeader('Set-Cookie', `sicMe=${encodeURIComponent(JSON.stringify({ id: v.member, name: v.memberName, ph: body.member.phoneHash }))}; Path=/; Max-Age=34560000; Secure; SameSite=Lax`);
    else if (body.member) res.setHeader('Set-Cookie', 'sicMe=; Path=/; Max-Age=0; Secure; SameSite=Lax');
    if (!v.areas.size && !v.member) return res.status(401).end(JSON.stringify({ error: '密码／电话对不上' }));
    const t = token(sa, v.areas, v.member);
    return res.status(200).end(JSON.stringify({ ...t, areas: [...v.areas], member: v.member, ...(v.member ? { ticket: ticketFor(sa, v.member, body.member.phoneHash) } : {}) }));
  },
  async check(sa, body, res) {
    const v = await verify(sa, body);
    return res.status(200).end(JSON.stringify({ keys: v.keys, pins: v.pins, member: !!v.member, locked: v.locked, needLogin: !v.member && (body.keys || []).length > 0 }));
  },
  async find(sa, body, res) {
    const h = str(body.phoneHash, 100);
    const m = h && await byPhone(sa, h);
    if (!m) return res.status(404).end('{}');
    return res.status(200).end(JSON.stringify(pub(m)));
  },
  // 第一次用：自己注册（电话还没登记的人）。info：{ phoneHash, phoneTail, gender, voiceSelf, rename, name, fullName }
  async register(sa, body, res) {
    const i = body.info || {};
    const h = str(i.phoneHash, 100), tail = str(i.phoneTail, 4);
    if (!/^[0-9a-f]{64}$/.test(h) || !/^\d{4}$/.test(tail)) return res.status(400).end(JSON.stringify({ error: '电话不对' }));
    if (await byPhone(sa, h)) return res.status(409).end(JSON.stringify({ code: 'phone-taken' }));
    const now = new Date().toISOString();
    const f = { phoneTail: tail, voiceSelf: ['S', 'A', 'T', 'B'].includes(i.voiceSelf) ? i.voiceSelf : '', registeredAt: now, updatedAt: now };
    const gender = ['F', 'M'].includes(i.gender) ? i.gender : '';
    const id = str(body.id);
    if (id) {
      const cur = await member(sa, id);
      if (!cur) return res.status(404).end('{}');
      if (cur.phoneHash) return res.status(409).end(JSON.stringify({ code: 'name-taken', tail: cur.phoneTail || '' }));
      // 男女：名单没写、或者是猜的，才照他自己选的
      if (gender && (!cur.gender || cur.genderGuess)) { f.gender = gender; f.genderGuess = false; }
      // 他打了比较完整的名字（名单上 Hans，他打 Hans Chew）：先记在全名，团员名单会建议改成这个名字
      if (str(i.rename) && !cur.fullName) f.fullName = i.rename.trim();
      await patch(sa, secPath(id), { phoneHash: h });
      await patch(sa, 'members/' + encodeURIComponent(id), f);
      return res.status(200).end(JSON.stringify(pub({ id, ...cur, ...f })));
    }
    const name = str(i.name, 80).trim();
    if (!name) return res.status(400).end(JSON.stringify({ error: '名字不能空' }));
    Object.assign(f, { name, fullName: str(i.fullName, 120).trim(), gender, active: true, selfJoined: true, createdAt: now });
    const d = await call(sa, `${API}/members`, { method: 'POST', body: JSON.stringify({ fields: fields(f) }) });
    await patch(sa, secPath(idOf(d)), { phoneHash: h });
    return res.status(200).end(JSON.stringify(pub({ id: idOf(d), ...f })));
  },
  // 第一次设 PIN：电话要对得上，而且还没设过（忘了 PIN 要 Ronald 在密码管理清掉）
  async setPin(sa, body, res) {
    const v = await verify(sa, { member: body.member });
    const h = str(body.h, 100);
    if (!v.member || !/^[0-9a-f]{64}$/.test(h)) return res.status(401).end('{}');
    const cur = await member(sa, v.member);
    if (cur.pinHash) return res.status(409).end(JSON.stringify({ code: 'pin-set' }));
    await patch(sa, secPath(v.member), { pinHash: h });
    await patch(sa, 'members/' + encodeURIComponent(v.member), { hasPin: true });
    return res.status(200).end(JSON.stringify({ areas: cur.master ? ALL : (cur.areas || []).filter(a => ALL.includes(a) && a !== 'access') }));
  },

  // ── 下面这些要带这部手机的密码／PIN／电话（keys / pins / member）证明是谁 ──
  // 密码管理：拿密码表（不含打乱过的密码）；还没设过 → keys: null
  async keys(sa, body, res) {
    if (!(await verify(sa, body)).areas.has('access')) return send(res, 401);
    // 也回哪几位团员的 PIN 开了最高权限（这个藏在 secrets，网页自己看不到）
    const j = await call(sa, `${API}:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'secrets' }], where: { fieldFilter: { field: { fieldPath: 'master' }, op: 'EQUAL', value: { booleanValue: true } } } } }) });
    const masters = [...new Set([OWNER, ...(j || []).filter(x => x.document).map(x => decodeURIComponent(idOf(x.document)).replace(/^m_/, ''))])];
    return send(res, 200, { keys: strip(await accessList(sa)), masters });
  },
  // 团员的 PIN 也开最高权限（只有最高权限可以改）；on = false 拿掉
  async setMaster(sa, body, res) {
    if (!(await verify(sa, body)).areas.has('access') || !str(body.id)) return send(res, 401);
    if (!(await member(sa, body.id))) return send(res, 404);
    await patch(sa, secPath(body.id), body.on ? { master: true } : {}, body.on ? [] : ['master']);
    return send(res, 200);
  },
  // 密码管理：存整张密码表。list：[{ id, name, areas, master, hash（新的或换过的才带）}]，没带 hash 的照旧
  async saveKeys(sa, body, res) {
    if (!(await verify(sa, body)).areas.has('access')) return send(res, 401);
    if (!Array.isArray(body.list) || body.list.length > 50) return send(res, 400, { error: '密码表不对' });
    const old = new Map((await accessList(sa) || []).map(k => [k.id, k]));
    const next = body.list.map(k => ({
      id: str(k?.id, 40), name: str(k?.name, 80).trim(),
      hash: HEX.test(k?.hash || '') ? k.hash : old.get(k?.id)?.hash || '',
      ...(k?.master ? { master: true } : { areas: (Array.isArray(k?.areas) ? k.areas : []).filter(a => ALL.includes(a) && a !== 'access') }),
    }));
    if (next.some(k => !k.id || !k.hash) || !next.some(k => k.master)) return send(res, 400, { error: '密码表不对' });
    if (new Set(next.map(k => k.hash)).size !== next.length) return send(res, 409, { code: 'dup' });
    await patch(sa, 'secrets/access', { json: JSON.stringify(next), updatedAt: new Date().toISOString() });
    return send(res, 200, { keys: strip(next) });
  },
  // 换电话：团员自己（我的资料）或最高权限（密码管理）；phoneHash 空 = 拿掉（只有最高权限）
  async setPhone(sa, body, res) {
    const v = await verify(sa, body);
    const id = str(body.id), h = str(body.phoneHash, 100), tail = str(body.phoneTail, 4);
    const admin = v.areas.has('access');
    if (!id || !(admin || v.member === id)) return send(res, 401);
    const path = 'members/' + encodeURIComponent(id);
    if (!h) {
      if (!admin) return send(res, 401);
      await patch(sa, secPath(id), {}, ['phoneHash']);
      await patch(sa, path, {}, ['phoneHash', 'phoneTail']);
      return send(res, 200);
    }
    if (!HEX.test(h) || !/^\d{4}$/.test(tail)) return send(res, 400, { error: '电话不对' });
    const other = await byPhone(sa, h);
    if (other && other.id !== id) return send(res, 409, { code: 'phone-taken', name: other.name || '' });
    await patch(sa, secPath(id), { phoneHash: h });
    await patch(sa, path, { phoneTail: tail, updatedAt: new Date().toISOString() }, ['phoneHash']);
    return send(res, 200);
  },
  // 清掉 PIN（他忘了）：最高权限
  async clearPin(sa, body, res) {
    if (!(await verify(sa, body)).areas.has('access') || !str(body.id)) return send(res, 401);
    await patch(sa, secPath(body.id), {}, ['pinHash']);
    await patch(sa, 'members/' + encodeURIComponent(body.id), {}, ['pinHash', 'hasPin']);
    return send(res, 200);
  },
  // 合并同一个人的两笔：把要删掉那笔的电话、PIN 搬到留下的那笔（团员名单权限）。其他资料网页自己搬
  async mergeSecrets(sa, body, res) {
    if (!(await verify(sa, body)).areas.has('members')) return send(res, 401);
    const keep = str(body.keep), drop = str(body.drop);
    const [k, d] = keep && drop && keep !== drop ? await Promise.all([keep, drop].map(id => member(sa, id))) : [];
    if (!k || !d) return send(res, 404);
    const p = {};
    if (d.phoneHash && !k.phoneHash) p.phoneHash = d.phoneHash;
    if (d.pinHash && !k.pinHash) p.pinHash = d.pinHash;
    // 先从要删掉那笔拿掉（电话不能同时在两个人身上）
    await patch(sa, secPath(drop), {}, ['phoneHash', 'pinHash']);
    await patch(sa, 'members/' + encodeURIComponent(drop), {}, ['phoneHash', 'pinHash', 'hasPin']);
    if (Object.keys(p).length) await patch(sa, secPath(keep), p);
    if (p.pinHash) await patch(sa, 'members/' + encodeURIComponent(keep), { hasPin: true });
    return send(res, 200);
  },
  // 把还在团员名单／config/access 上的打乱过的电话、PIN、密码表搬去 secrets，原本的拿掉（最高权限；搬过了就没事做）
  async migrate(sa, body, res) {
    if (!(await verify(sa, body)).areas.has('access')) return send(res, 401);
    let moved = 0, token = '';
    do {
      const j = await call(sa, `${API}/members?pageSize=300${token ? '&pageToken=' + token : ''}`);
      for (const d of j?.documents || []) {
        const m = plain(d.fields), id = decodeURIComponent(idOf(d));
        if (!m.phoneHash && !m.pinHash) continue;
        const s = {};
        if (m.phoneHash) s.phoneHash = m.phoneHash;
        if (m.pinHash) s.pinHash = m.pinHash;
        await patch(sa, secPath(id), s);                       // 先存好藏起来的，再拿掉名单上的
        await patch(sa, 'members/' + encodeURIComponent(id), m.pinHash ? { hasPin: true } : {}, ['phoneHash', 'pinHash']);
        moved++;
      }
      token = j?.nextPageToken || '';
    } while (token);
    const old = await getDoc(sa, 'config/access');
    if (old) {
      if (!await getDoc(sa, 'secrets/access')) await patch(sa, 'secrets/access', { json: old.json || '[]', updatedAt: new Date().toISOString() });
      await call(sa, `${API}/config/access`, { method: 'DELETE' });
    }
    return send(res, 200, { moved, access: !!old });
  },
};

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');   // 本机测试（localhost）也要能用；没有 cookie，开放没关系
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  let sa = null;
  try { sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || 'null'); } catch { /* 下面当没放 */ }
  if (req.method === 'GET') return res.status(200).end(JSON.stringify({ configured: !!sa?.private_key }));
  if (req.method !== 'POST') return res.status(405).end('{}');
  if (!sa?.private_key) return res.status(503).end(JSON.stringify({ error: '服务器钥匙还没放' }));

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const name = body.action || 'token';
    const act = Object.hasOwn(ACTIONS, name) && ACTIONS[name];
    if (!act) return res.status(400).end(JSON.stringify({ error: '不认识的 action' }));
    return await act(sa, body, res);
  } catch (e) {
    return res.status(500).end(JSON.stringify({ error: String(e.message || e) }));
  }
};
