// 后台区的密码：不同的密码开不同的页面。密码在「🔑 密码管理」页自己设（Firestore config/access，只存打乱过的样子，看不到原本的密码）。
// 只是防团员误入，不是真正的保安。
// 普通 <script> 载入；页面加 data-require="mass" 这种，一打开就要有那一区的密码，不然送回乐谱首页。
(function () {
  // 每一区 = 一个（或几个）页面
  const AREAS = [
    { key: 'conduct', label: '乐谱指挥模式', sub: '翻页同步给团员、改歌名' },
    { key: 'mass', label: '弥撒排歌', sub: '按位置选歌、保存就更新乐谱' },
    { key: 'duties', label: '职务表', sub: '每场谁指挥、答唱咏、弹琴' },
    { key: 'seating', label: '座位表', sub: '谁坐哪里、拿哪件披肩' },
    { key: 'members', label: '团员名单', sub: '声部、披肩号码、会做的职务' },
    { key: 'attendance', label: '点名 / 出席率', sub: '每次点名、3 个月出席够不够' },
    { key: 'notice', label: '公告', sub: '发公告、写要练哪几首歌' },
    { key: 'admin', label: '排单后台', sub: '曲库、改图、排单历史' },
    { key: 'quiz', label: '测验结果', sub: '全团测验成绩' },
    { key: 'photos', label: '合照', sub: '在「这台弥撒」加、拿掉每一台的合照' },
  ];
  const ALL = AREAS.map(a => a.key).concat('access');   // access = 密码管理，只有最高权限
  const KEY = 'sicAccess';                               // 这部手机输过哪些密码：[{ h: 打乱后的密码, areas }]

  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
  const write = g => { try { localStorage.setItem(KEY, JSON.stringify(g)); } catch { /* 没关系 */ } queueAuth(); };
  const areasNow = () => new Set(read().flatMap(g => g.areas || []));
  const can = area => area ? areasNow().has(area) : areasNow().size > 0;
  const isMaster = () => areasNow().has('access');

  async function hash(pwd) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('sicmchoir|' + pwd.trim()));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // 平常用 REST（快，不用等 Firebase 载入）；REST 被挡（每天额度用完 429、伺服器出错）→ 改走 Firebase SDK
  let sdkP = null;
  const sdk = () => sdkP || (sdkP = Promise.all([
    import('/src/firebase.js'),
    import('https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js'),
    idToken().catch(() => null),   // 有通行证就先载入 Firebase 登录，SDK 写资料才会带上
  ]).then(([a, f]) => ({ db: a.db, ...f })));
  // REST 写资料用的 headers：有通行证就带上（资料库锁起来之后，没带会被挡）
  async function wh() {
    const t = await idToken().catch(() => null);
    return { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) };
  }
  // 回 Response，或者 null（= 要改走 SDK）
  async function rest(url, opts) {
    try {
      const r = await fetch(url, opts);
      return r.status === 429 || r.status >= 500 ? null : r;
    } catch { return null; }
  }

  // 试一个密码：拿去登录服务对（手机看不到密码表），对了就记在这部手机，回传它开的区
  // 后台密码要先用电话登录才算数（这样改了什么都查得到是谁）；没登录 → 丢错 code 'login'
  const loggedIn = () => !!me()?.ph;
  const needLogin = () => Object.assign(new Error('要先用电话登录'), { code: 'login' });
  async function tryPassword(pwd) {
    if (!pwd || !pwd.trim()) return null;
    if (!loggedIn()) throw needLogin();
    const h = await hash(pwd);
    const { j } = await callLogin('check', { keys: [h], member: proof().member });
    if (j.needLogin) throw needLogin();
    const a = j.keys?.[0];
    if (!a) return null;
    write(read().filter(x => x.h !== h).concat({ h, areas: a }));
    return a;
  }

  // 要进某一区：这部手机有了就直接进；没有就问密码
  async function unlock(area, msg) {
    if (can(area)) return true;
    if (!loggedIn()) { askLogin(); return false; }
    const p = prompt(msg || '🔒 后台区，请输入密码：');
    if (p === null) return false;
    let got;
    try { got = await tryPassword(p); } catch (err) {
      if (err.code === 'login') { askLogin(); return false; }
      alert('读不到密码表，检查一下网络。\n' + err.message); return false;
    }
    if (!got) { alert('❌ 密码错误'); return false; }
    if (area && !got.includes(area)) { alert('这个密码没有开这一页。要的话请 Ronald 在「密码管理」帮你的密码勾上。'); return false; }
    return true;
  }

  // 很久以前登录的手机没记打乱过的电话：当作没登录，先清掉让他重新用电话登录
  function askLogin() {
    if (me() && !me().ph) logout();
    const msg = '🔒 要先用电话号码登录，才可以输后台密码。\n（这样谁改了什么都记得到）';
    if (window.sicLogin) { alert(msg); window.sicLogin.open(); }
    else if (confirm(msg + '\n\n现在去登录？')) location.href = 'me.html';
  }

  // ───────── 团员登录（电话号码）─────────
  // 团员名单 members/{id} 只存电话打乱过的样子 phoneHash（+ 最后 4 码 phoneTail，有 phoneTail = 登记了电话），看不到原本的号码
  // 有开后台的团员（members/{id}.areas）还要 4 位数 PIN（pinHash，hasPin = 设了）；登入后记在 sicAccess：{ m: 团员id, h: pinHash, areas }
  // 打乱过的电话、PIN、密码表只有登录服务（/api/login）在对，网页不自己比
  const ME_KEY = 'sicMe';                                // 这部手机是谁：{ id, name }
  const API = 'https://firestore.googleapis.com/v1/projects/sicmchoir-yueyun/databases/(default)/documents';
  const API_KEY = 'AIzaSyD77WKlfYpUS1MJKu5J_xdV3adMZc5-c8U';
  const me = () => { try { return JSON.parse(localStorage.getItem(ME_KEY) || 'null'); } catch { return null; } };
  // 0149212571 / +60 14-921 2571 / 149212571 都当成同一个：60149212571
  const normPhone = p => { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('0')) d = '6' + d; else if (!d.startsWith('60')) d = '60' + d; return d; };
  const phoneHash = p => hash('phone|' + normPhone(p));
  const pinHash = (id, pin) => hash('pin|' + id + '|' + pin);
  // Firestore REST 回来的格式 → 普通物件（只取用得到的）
  const plain = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, 'arrayValue' in v ? (v.arrayValue.values || []).map(x => Object.values(x)[0]) : Object.values(v)[0]]));
  async function memberById(id) {
    const r = await rest(`${API}/members/${encodeURIComponent(id)}?key=${API_KEY}`, { cache: 'no-store' });
    if (!r) {
      const F = await sdk();
      const d = await F.getDoc(F.doc(F.db, 'members', id));
      return d.exists() ? { id, ...d.data() } : null;
    }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('读不到团员名单 ' + r.status);
    return { id, ...plain((await r.json()).fields) };
  }
  // 用电话找团员（登录服务找）；找不到 → null。phoneHash 是这边自己算的，拿来领通行证
  async function findByPhone(phone) {
    const h = await phoneHash(phone);
    const { status, j } = await callLogin('find', { phoneHash: h });
    return status === 404 ? null : { ...j, phoneHash: h };
  }
  // 第一次用：自己注册（电话还没登记的人）
  async function listMembers() {
    const out = [];
    let token = '';
    do {
      const r = await rest(`${API}/members?key=${API_KEY}&pageSize=300${token ? '&pageToken=' + token : ''}`, { cache: 'no-store' });
      if (!r) {
        const F = await sdk();
        return (await F.getDocs(F.collection(F.db, 'members'))).docs.map(d => ({ id: d.id, ...d.data() }));
      }
      if (!r.ok) throw new Error('读不到团员名单 ' + r.status);
      const j = await r.json();
      (j.documents || []).forEach(d => out.push({ id: d.name.split('/').pop(), ...plain(d.fields) }));
      token = j.nextPageToken || '';
    } while (token);
    return out;
  }
  // m = 名单上的那一位（照名字选的）；m 没有 = 新团员，info.name / fullName 新建一位
  // info：{ phone, gender: 'F'|'M', voiceSelf: 'S'|'A'|'T'|'B'|''（还不知道）}
  // 登录服务帮他写进名单（电话已经有人登记 → code phone-taken；那个名字已经有电话 → code name-taken）
  async function register(m, info) {
    const n = normPhone(info.phone), h = await phoneHash(n);
    const { status, j } = await callLogin('register', { id: m?.id || '', info: {
      phoneHash: h, phoneTail: n.slice(-4), gender: info.gender || '', voiceSelf: info.voiceSelf || '',
      rename: info.rename || '', name: info.name || '', fullName: info.fullName || '' } });
    if (status === 409) throw Object.assign(new Error('已经登记了'), { code: j.code, tail: j.tail });
    if (status !== 200) throw new Error('没存到 ' + status);
    return { ...j, phoneHash: h };
  }
  function setMe(m) {
    const prev = me();
    // ph = 打乱过的电话：拿来领通行证（证明是这位团员）
    const ph = m.phoneHash || (prev?.id === m.id ? prev.ph : '') || '';
    try {
      localStorage.setItem(ME_KEY, JSON.stringify({ id: m.id, name: m.name, ...(ph ? { ph } : {}) }));
      localStorage.setItem('sicMyName', m.name);          // 「这台弥撒」找我的位子用
      localStorage.removeItem('sicGuest');
    } catch { /* 没关系 */ }
    queueAuth();
  }
  // 后台 PIN：拿去登录服务对，对了就把这位团员开的区记在这部手机（密码管理勾了「最高权限」的人，PIN 也开最高权限）
  // 连错 5 次会锁 15 分钟 → 丢错 code 'locked'
  async function memberUnlock(m, pin) {
    const h = await pinHash(m.id, pin);
    const { j } = await callLogin('check', { pins: [{ m: m.id, h }] });
    const a = j.pins?.[0];
    if (!a && j.locked) throw Object.assign(new Error('PIN 锁住了'), { code: 'locked' });
    if (!a) return null;
    write(read().filter(x => x.m !== m.id).concat({ m: m.id, h, areas: a }));
    return a;
  }
  // 第一次：设 PIN（登录服务写进名单，要电话对得上），然后当作已解锁
  async function memberSetPin(m, pin) {
    const h = await pinHash(m.id, pin);
    const { status, j } = await callLogin('setPin', { member: { id: m.id, phoneHash: m.phoneHash || me()?.ph || '' }, h });
    if (status === 409) return memberUnlock(m, pin);   // 刚刚已经设过了：当作输 PIN
    if (status !== 200) throw new Error('PIN 没存到 ' + status);
    m.hasPin = true;
    write(read().filter(x => x.m !== m.id).concat({ m: m.id, h, areas: j.areas }));
    return j.areas;
  }
  // 登出：这部手机什么都不记得了（是谁、PIN、输过的后台密码），锁全部锁回去
  function logout() {
    try {
      localStorage.removeItem(ME_KEY); localStorage.removeItem('sicMyName'); localStorage.removeItem(KEY);
    } catch { /* 没关系 */ }
    queueAuth();
  }

  // 每次打开都对一下密码表：密码被改掉或拿掉权限的，这部手机也跟着拿掉
  // 团员登入的：对一下他在团员名单的 PIN 和开的区
  async function refresh() {
    const g = read();
    if (!g.length) return;
    let v;
    try { v = (await callLogin('check', { keys: g.filter(x => !x.m).map(x => x.h), pins: g.filter(x => x.m).map(x => ({ m: x.m, h: x.h })), member: proof().member })).j; }
    catch { return; }   // 没网络就先照旧
    let ki = 0, pi = 0;
    const next = g.map(x => { const a = x.m ? v.pins?.[pi++] : v.keys?.[ki++]; return a ? { ...(x.m ? { m: x.m } : {}), h: x.h, areas: a } : null; }).filter(Boolean);
    const changed = JSON.stringify(next) !== JSON.stringify(g);
    write(next);
    if (changed) queueAuth();   // 开的区变了（例如多了最高权限）：通行证也换新的
    return next;
  }
  // 名字改了（例如 Mok → Ronald Mok）或被合并掉：这部手机记的名字跟着更新；那一笔不在了就请他重新用电话登录
  async function syncMe() {
    const cur = me();
    if (!cur) return;
    let m;
    try { m = await memberById(cur.id); } catch { return; }   // 没网络就先照旧
    if (!m) { logout(); return; }
    if (m.name !== cur.name) { setMe(m); document.dispatchEvent(new CustomEvent('sic-me')); }
  }
  // ───────── 团员小测验：开／关 ─────────
  // Firestore config/quiz.open；Ronald 在「测验结果」页按开关。这部手机记住上次看到的，菜单一打开就对
  const QUIZ_KEY = 'sicQuizOpen';
  const quizCached = () => { try { return localStorage.getItem(QUIZ_KEY) === '1'; } catch { return false; } };
  const quizRemember = open => { try { localStorage.setItem(QUIZ_KEY, open ? '1' : '0'); } catch { /* 没关系 */ } return open; };
  async function quizLoad() {
    try {
      const r = await rest(`${API}/config/quiz?key=${API_KEY}`, { cache: 'no-store' });
      if (!r) {
        const F = await sdk();
        const d = await F.getDoc(F.doc(F.db, 'config', 'quiz'));
        return quizRemember(d.exists() && !!d.data().open);
      }
      if (r.status === 404) return quizRemember(false);
      if (!r.ok) return quizCached();
      return quizRemember(!!(await r.json()).fields?.open?.booleanValue);
    } catch { return quizCached(); }   // 没网络就照上次
  }
  async function quizSet(open) {
    const r = await rest(`${API}/config/quiz?key=${API_KEY}&updateMask.fieldPaths=open&updateMask.fieldPaths=updatedAt`, {
      method: 'PATCH', headers: await wh(),
      body: JSON.stringify({ fields: { open: { booleanValue: !!open }, updatedAt: { stringValue: new Date().toISOString() } } }),
    });
    if (!r) { const F = await sdk(); await F.setDoc(F.doc(F.db, 'config', 'quiz'), { open: !!open, updatedAt: new Date().toISOString() }, { merge: true }); }
    else if (!r.ok) throw new Error('没存到 ' + r.status);
    return quizRemember(!!open);
  }
  window.sicQuiz = { cached: quizCached, load: quizLoad, set: quizSet };

  function forget() { try { localStorage.removeItem(KEY); } catch { /* 没关系 */ } queueAuth(); }

  // ───────── 通行证（Firebase 登录）─────────
  // 这部手机输过的后台密码／PIN／电话 → 拿去 /api/login 换通行证；资料库锁起来之后，有通行证才能改资料
  // 一样的东西一天只换一次；什么都没有了（登出）就把通行证收回
  const AUTH_SIG = 'sicAuthSig';
  const LOGIN_URL = /^(localhost|127\.)/.test(location.hostname) ? 'https://sicmchoir-yueyun.vercel.app/api/login' : '/api/login';
  // 叫登录服务做事：回 { status, j }；连不上／服务器出错 → 丢错
  async function callLogin(action, body) {
    const r = await fetch(LOGIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) });
    const j = await r.json().catch(() => ({}));
    if (r.status >= 500 || r.status === 400) throw new Error(j.error || '登录服务 ' + r.status);
    return { status: r.status, j };
  }
  let authP = null;
  const authSdk = () => authP || (authP = Promise.all([
    import('/src/firebase.js'),
    import('https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js'),
  ]).then(([a, f]) => ({ auth: f.getAuth(a.app), ...f })));
  // 这部手机输过的密码／PIN／电话（打乱过的）：领通行证、叫登录服务做后台的事，都拿这个证明是谁
  function proof() {
    const g = read(), m = me();
    return {
      keys: g.filter(x => !x.m && x.h).map(x => x.h),
      pins: g.filter(x => x.m && x.h).map(x => ({ m: x.m, h: x.h })),
      member: m?.ph ? { id: m.id, phoneHash: m.ph } : null,
    };
  }
  // 后台的事（密码管理、换电话、清 PIN、合并团员）交给登录服务做，带上证明
  const staffCall = (action, body) => callLogin(action, { ...proof(), ...body });
  async function syncAuth() {
    const body = proof();
    const sig = JSON.stringify(body);
    const empty = !body.keys.length && !body.pins.length && !body.member;
    const old = lsGet(AUTH_SIG);
    if (empty && !old) return;                       // 没登录过，不用载入 Firebase 登录
    const F = await authSdk();
    await F.auth.authStateReady();
    const user = F.auth.currentUser;
    if (empty) { if (user) await F.signOut(F.auth); lsSet(AUTH_SIG, null); return; }
    const ak = [...areasNow()].sort().join();
    if (user && old && old.sig === sig && old.ak === ak && Date.now() - old.at < 864e5) return;
    const r = await fetch(LOGIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: sig });
    if (r.status === 401) { if (user) await F.signOut(F.auth); lsSet(AUTH_SIG, null); return; }
    if (!r.ok) throw new Error('领不到通行证 ' + r.status);
    const j = await r.json();
    await F.signInWithCustomToken(F.auth, j.token);
    lsSet(AUTH_SIG, { sig, ak, at: Date.now(), uid: j.uid, areas: j.areas, member: j.member });
  }
  let authT = null;
  function queueAuth() {
    clearTimeout(authT);
    authT = setTimeout(() => syncAuth().catch(err => console.warn('通行证', err)), 300);
  }
  // 现在的通行证（给要用 REST 写资料的地方加在 Authorization 上）；没有 → null
  async function idToken() {
    if (!lsGet(AUTH_SIG)) return null;
    const F = await authSdk();
    await F.auth.authStateReady();
    return F.auth.currentUser ? F.auth.currentUser.getIdToken() : null;
  }

  // ───────── 照片＋乐谱空间（Cloudinary）快满提醒：只给最高权限（Ronald）看 ─────────
  // 每 6 小时最多问一次 /api/cloudinary-usage；70% 起黄色提醒，85% 起红色
  const CLOUD_KEY = 'sicCloudUsage';
  const CLOUD_HIDE = 'sicCloudHide';
  const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 没关系 */ } };
  async function cloudUsage(fresh) {
    const c = lsGet(CLOUD_KEY);
    if (!fresh && c && Date.now() - c.at < 6 * 3600e3) return c.u;
    const r = await fetch('/api/cloudinary-usage', { cache: 'no-store' });
    if (!r.ok) throw new Error('问不到 ' + r.status);
    const u = await r.json();
    lsSet(CLOUD_KEY, { at: Date.now(), u });
    return u;
  }
  function cloudBanner(u) {
    let tone, html;
    if (!u.configured) {
      tone = 'background:#334155;color:#fff';
      html = '📦 <b>照片空间提醒还没接好</b>：要在 Vercel 加两把钥匙（CLOUDINARY_API_KEY、CLOUDINARY_API_SECRET），接好之后快满时这里会提醒你。';
    } else if (u.error) {
      tone = 'background:#334155;color:#fff';
      html = `📦 照片空间查不到（${u.error}）。钥匙可能填错了，去 Vercel 检查一下。`;
    } else {
      const p = Math.round(u.pct || 0);
      if (p < 70) return;
      tone = p >= 85 ? 'background:#dc2626;color:#fff' : 'background:#fbbf24;color:#0f172a';
      html = `📦 <b>照片和乐谱的存放空间已经用了 ${p}%</b>。到 100% 新照片、新乐谱会传不上去。<br>` +
        `现在要做：把旧合照下载备份，再从 App 拿掉；或者开一个新的免费帐号专放合照。`;
    }
    const day = new Date().toISOString().slice(0, 10);
    const hide = lsGet(CLOUD_HIDE);
    if (hide && hide.until >= day) return;
    const bar = document.createElement('div');
    bar.id = 'cloud-banner';
    // 用 inline style：有些页没有 Tailwind
    bar.style.cssText = `${tone};position:relative;z-index:60;display:flex;gap:12px;align-items:flex-start;padding:12px 16px;font-size:14px;line-height:1.6`;
    bar.innerHTML = `<div style="flex:1">${html}</div><button style="flex-shrink:0;text-decoration:underline;opacity:.85;background:none;border:0;color:inherit;font:inherit;cursor:pointer">知道了</button>`;
    bar.querySelector('button').onclick = () => {
      // 没接好：7 天后再提醒；已经快满：明天再提醒
      const d = new Date(Date.now() + (u.configured && !u.error ? 1 : 7) * 864e5).toISOString().slice(0, 10);
      lsSet(CLOUD_HIDE, { until: d });
      bar.remove();
    };
    document.body.prepend(bar);
  }
  function cloudWatch() {
    if (!isMaster() || /^(localhost|127\.)/.test(location.hostname)) return;
    const go = () => cloudUsage().then(cloudBanner).catch(() => { /* 没网络就算了 */ });
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
  }

  window.sicStaff = { AREAS, ALL, can, isStaff: () => can(), isMaster, unlock, tryPassword, refresh, forget, hash, staffCall, loggedIn, askLogin,
    cloudUsage, cloudBanner, idToken, syncAuth,
    me, findByPhone, phoneHash, normPhone, setMe, memberUnlock, memberSetPin, logout, listMembers, register, memberById, syncMe };

  try { localStorage.removeItem('sicStaff'); } catch { /* 旧的「输过 sic」记录不再用 */ }

  const tag = document.currentScript;
  const need = tag && tag.hasAttribute('data-require') ? (tag.getAttribute('data-require') || '') : null;
  syncMe();
  cloudWatch();
  queueAuth();
  if (need === null) { refresh(); return; }
  const kick = () => { document.documentElement.style.display = 'none'; location.replace('/'); };
  if (can(need)) {
    refresh().then(g => { if (g && !g.some(x => x.areas.includes(need))) { alert('你的密码已经换了或拿掉了这一页，请重新输入。'); kick(); } });
  } else if (!loggedIn()) {
    // 还没用电话登录：先去「我的资料」登录，再回来输密码
    document.documentElement.style.visibility = 'hidden';
    setTimeout(() => {
      if (me() && !me().ph) logout();
      alert('🔒 要先用电话号码登录，才可以输后台密码。\n（这样谁改了什么都记得到）');
      location.replace('me.html');
    }, 0);
  } else {
    document.documentElement.style.visibility = 'hidden';
    setTimeout(async () => {
      if (await unlock(need)) document.documentElement.style.visibility = '';
      else kick();
    }, 0);
  }
})();
