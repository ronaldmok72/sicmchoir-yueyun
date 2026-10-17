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
  const DOC_URL = 'https://firestore.googleapis.com/v1/projects/sicmchoir-yueyun/databases/(default)/documents/config/access?key=AIzaSyD77WKlfYpUS1MJKu5J_xdV3adMZc5-c8U';
  // 还没在「密码管理」设过任何密码之前，暂时用旧密码 sic 当最高权限，第一次进去就要换掉
  const BOOT = [{ id: 'boot', name: '最高权限（暂时）', hash: '', plain: 'sic', master: true, areas: ALL }];

  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
  const write = g => { try { localStorage.setItem(KEY, JSON.stringify(g)); } catch { /* 没关系 */ } };
  const areasNow = () => new Set(read().flatMap(g => g.areas || []));
  const can = area => area ? areasNow().has(area) : areasNow().size > 0;
  const isMaster = () => areasNow().has('access');

  async function hash(pwd) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('sicmchoir|' + pwd.trim()));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // 读密码表（不用等 Firebase 载入）；还没设过 → null
  let keysCache = null;
  async function loadKeys(fresh) {
    if (keysCache && !fresh) return keysCache;
    const r = await fetch(DOC_URL, { cache: 'no-store' });
    if (r.status === 404) return (keysCache = null);
    if (!r.ok) throw new Error('读不到密码表 ' + r.status);
    const j = await r.json();
    return (keysCache = JSON.parse(j.fields?.json?.stringValue || '[]'));
  }
  const areasOf = k => k.master ? ALL : (k.areas || []);

  // 试一个密码：对了就记在这部手机，回传它开的区
  async function tryPassword(pwd) {
    if (!pwd || !pwd.trim()) return null;
    const h = await hash(pwd);
    const keys = await loadKeys(true);
    const k = keys ? keys.find(k => k.hash === h) : BOOT.find(k => k.plain === pwd.trim());
    if (!k) return null;
    const g = read().filter(x => x.h !== h);
    g.push({ h, areas: areasOf(k), boot: !keys });
    write(g);
    return areasOf(k);
  }

  // 要进某一区：这部手机有了就直接进；没有就问密码
  async function unlock(area, msg) {
    if (can(area)) return true;
    const p = prompt(msg || '🔒 后台区，请输入密码：');
    if (p === null) return false;
    let got;
    try { got = await tryPassword(p); } catch (err) { alert('读不到密码表，检查一下网络。\n' + err.message); return false; }
    if (!got) { alert('❌ 密码错误'); return false; }
    if (area && !got.includes(area)) { alert('这个密码没有开这一页。要的话请 Ronald 在「密码管理」帮你的密码勾上。'); return false; }
    return true;
  }

  // ───────── 团员登录（电话号码）─────────
  // 团员名单 members/{id} 只存电话打乱过的样子 phoneHash（+ 最后 4 码 phoneTail），看不到原本的号码
  // 有开后台的团员（members/{id}.areas）还要 4 位数 PIN（pinHash）；登入后记在 sicAccess：{ m: 团员id, h: pinHash, areas }
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
    const r = await fetch(`${API}/members/${encodeURIComponent(id)}?key=${API_KEY}`, { cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('读不到团员名单 ' + r.status);
    return { id, ...plain((await r.json()).fields) };
  }
  // 用电话找团员；找不到 → null
  async function findByPhone(phone) {
    const h = await phoneHash(phone);
    const r = await fetch(`${API}:runQuery?key=${API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'members' }], where: { fieldFilter: { field: { fieldPath: 'phoneHash' }, op: 'EQUAL', value: { stringValue: h } } }, limit: 2 } }),
    });
    if (!r.ok) throw new Error('读不到团员名单 ' + r.status);
    const hit = (await r.json()).find(x => x.document);
    return hit ? { id: hit.document.name.split('/').pop(), ...plain(hit.document.fields) } : null;
  }
  // 第一次用：自己注册（电话还没登记的人）
  async function listMembers() {
    const out = [];
    let token = '';
    do {
      const r = await fetch(`${API}/members?key=${API_KEY}&pageSize=300${token ? '&pageToken=' + token : ''}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('读不到团员名单 ' + r.status);
      const j = await r.json();
      (j.documents || []).forEach(d => out.push({ id: d.name.split('/').pop(), ...plain(d.fields) }));
      token = j.nextPageToken || '';
    } while (token);
    return out;
  }
  const fv = v => typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) };
  // m = 名单上的那一位（照名字选的）；m 没有 = 新团员，info.name / fullName 新建一位
  // info：{ phone, gender: 'F'|'M', voiceSelf: 'S'|'A'|'T'|'B'|''（还不知道）}
  async function register(m, info) {
    const n = normPhone(info.phone);
    if (await findByPhone(n)) throw Object.assign(new Error('这个电话已经登记了'), { code: 'phone-taken' });
    const now = new Date().toISOString();
    const f = { phoneHash: await phoneHash(n), phoneTail: n.slice(-4), voiceSelf: info.voiceSelf || '', registeredAt: now, updatedAt: now };
    if (m) {
      const cur = await memberById(m.id);
      if (cur?.phoneHash) throw Object.assign(new Error('这个名字已经有电话了'), { code: 'name-taken', tail: cur.phoneTail });
      // 男女：名单没写、或者是猜的，才照他自己选的
      if (info.gender && (!cur?.gender || cur.genderGuess)) { f.gender = info.gender; f.genderGuess = false; }
      // 他打了比较完整的名字（名单上 Hans，他打 Hans Chew）：先记在全名，团员名单会建议改成这个名字
      if (info.rename && !cur?.fullName) f.fullName = info.rename;
      const r = await fetch(`${API}/members/${encodeURIComponent(m.id)}?key=${API_KEY}&${Object.keys(f).map(k => 'updateMask.fieldPaths=' + k).join('&')}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fv(v)])) }),
      });
      if (!r.ok) throw new Error('没存到 ' + r.status);
      return { ...cur, ...f };
    }
    Object.assign(f, { name: info.name.trim(), fullName: (info.fullName || '').trim(), gender: info.gender || '', active: true, selfJoined: true, createdAt: now });
    const r = await fetch(`${API}/members?key=${API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fv(v)])) }),
    });
    if (!r.ok) throw new Error('没存到 ' + r.status);
    return { id: (await r.json()).name.split('/').pop(), ...f };
  }
  function setMe(m) {
    try {
      localStorage.setItem(ME_KEY, JSON.stringify({ id: m.id, name: m.name }));
      localStorage.setItem('sicMyName', m.name);          // 「这台弥撒」找我的位子用
      localStorage.removeItem('sicGuest');
    } catch { /* 没关系 */ }
  }
  // 后台 PIN：对了就把这位团员开的区记在这部手机
  async function memberUnlock(m, pin) {
    const h = await pinHash(m.id, pin);
    if (h !== m.pinHash) return null;
    const areas = (m.areas || []).filter(a => ALL.includes(a) && a !== 'access');   // 最高权限只给 Ronald 的密码，不经电话
    write(read().filter(x => x.m !== m.id).concat({ m: m.id, h, areas }));
    return areas;
  }
  // 第一次：设 PIN（写进团员名单），然后当作已解锁
  async function memberSetPin(m, pin) {
    const h = await pinHash(m.id, pin);
    const r = await fetch(`${API}/members/${encodeURIComponent(m.id)}?key=${API_KEY}&updateMask.fieldPaths=pinHash`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { pinHash: { stringValue: h } } }),
    });
    if (!r.ok) throw new Error('PIN 没存到 ' + r.status);
    m.pinHash = h;
    return memberUnlock(m, pin);
  }
  function logout() {
    const m = me();
    try {
      localStorage.removeItem(ME_KEY); localStorage.removeItem('sicMyName');
      if (m) write(read().filter(x => x.m !== m.id));
    } catch { /* 没关系 */ }
  }

  // 每次打开都对一下密码表：密码被改掉或拿掉权限的，这部手机也跟着拿掉
  // 团员登入的：对一下他在团员名单的 PIN 和开的区
  async function refresh() {
    const g = read();
    if (!g.length) return;
    let keys;
    try { keys = await loadKeys(true); } catch { return; }   // 没网络就先照旧
    const next = (await Promise.all(g.map(async x => {
      if (x.m) {
        let m;
        try { m = await memberById(x.m); } catch { return x; }   // 没网络就先照旧
        return m && m.pinHash === x.h && (m.areas || []).length ? { m: x.m, h: x.h, areas: m.areas.filter(a => ALL.includes(a) && a !== 'access') } : null;
      }
      const k = keys ? keys.find(k => k.hash === x.h) : (x.boot ? BOOT[0] : null);
      return k ? { h: x.h, areas: areasOf(k), boot: !keys } : null;
    }))).filter(Boolean);
    write(next);
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
      const r = await fetch(`${API}/config/quiz?key=${API_KEY}`, { cache: 'no-store' });
      if (r.status === 404) return quizRemember(false);
      if (!r.ok) return quizCached();
      return quizRemember(!!(await r.json()).fields?.open?.booleanValue);
    } catch { return quizCached(); }   // 没网络就照上次
  }
  async function quizSet(open) {
    const r = await fetch(`${API}/config/quiz?key=${API_KEY}&updateMask.fieldPaths=open&updateMask.fieldPaths=updatedAt`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { open: { booleanValue: !!open }, updatedAt: { stringValue: new Date().toISOString() } } }),
    });
    if (!r.ok) throw new Error('没存到 ' + r.status);
    return quizRemember(!!open);
  }
  window.sicQuiz = { cached: quizCached, load: quizLoad, set: quizSet };

  function forget() { try { localStorage.removeItem(KEY); } catch { /* 没关系 */ } }

  window.sicStaff = { AREAS, ALL, can, isStaff: () => can(), isMaster, unlock, tryPassword, refresh, forget, hash, loadKeys,
    me, findByPhone, phoneHash, normPhone, setMe, memberUnlock, memberSetPin, logout, listMembers, register, memberById, syncMe };

  try { localStorage.removeItem('sicStaff'); } catch { /* 旧的「输过 sic」记录不再用 */ }

  const tag = document.currentScript;
  const need = tag && tag.hasAttribute('data-require') ? (tag.getAttribute('data-require') || '') : null;
  syncMe();
  if (need === null) { refresh(); return; }
  const kick = () => { document.documentElement.style.display = 'none'; location.replace('/'); };
  if (can(need)) {
    refresh().then(g => { if (g && !g.some(x => x.areas.includes(need))) { alert('你的密码已经换了或拿掉了这一页，请重新输入。'); kick(); } });
  } else {
    document.documentElement.style.visibility = 'hidden';
    setTimeout(async () => {
      if (await unlock(need)) document.documentElement.style.visibility = '';
      else kick();
    }, 0);
  }
})();
