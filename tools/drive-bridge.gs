// 乐韵 App 的 Drive 小程序：贴在 sicmchoir@gmail.com 的 Google Apps Script 里跑。
// 做四件事：① 收 App 传来的附件，存进 Drive ② 给登入的执委读附件
//           ③ 每晚收一份完整备份，更新「看得懂的表格」 ④ 把乐谱、合照从 Cloudinary 复制一份进 Drive
// 这里没有钥匙：每次都拿 App 的登录通行证去问 Google 是不是真的（下面的 API_KEY 本来就公开在 App 网页里）。

const API_KEY = 'AIzaSyD77WKlfYpUS1MJKu5J_xdV3adMZc5-c8U';
const PROJECT = 'sicmchoir-yueyun';
const TOP = 'SIC乐韵歌咏团';
const ROOT = 'App 备份';
const SHARE_TO = 'ronaldmok72@gmail.com';   // 备份文件夹分享给谁看（只能看）
const KEEP_DAYS = 30;                       // 每晚的备份留 30 天；每月 1 号那份一直留
const CLOUD = 'https://res.cloudinary.com/dsfhilcgz/';
const LIBRARY = 'https://sicmchoir-yueyun.vercel.app/src/library.js';
const MEDIA_INDEX = '已复制清单.json';
const IMAGE_OR_PDF = /^(image\/[a-z0-9.+-]+|application\/pdf)$/i;
const MARK = { P: '有到', T: '迟到/早退', L: '请假', A: '缺席' };
const KIND = { mass: '弥撒', practice: '练歌', other: '其他活动' };

const props = () => PropertiesService.getScriptProperties();

// 贴好之后按一次「执行」这个：开文件夹、分享、排好每小时复制乐谱
function setup() {
  const root = root_();
  ['财政附件', '每晚完整备份', '乐谱与合照'].forEach(n => child_(root, n));
  if (SHARE_TO) root.addViewer(SHARE_TO);
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'copyMedia').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('copyMedia').timeBased().everyHours(1).create();
  SpreadsheetApp.flush();
  Logger.log('好了：' + root.getUrl());
}

function doGet() { return out_({ ok: true, name: '乐韵 Drive 小程序' }); }

function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents);
    const who = verify_(b.token);
    if (!who) return out_({ error: '通行证不对，请重新登录' });
    const finance = (who.areas || []).some(a => a === 'committee' || a === 'access');
    if (b.action === 'backup') return out_(who.svc === true ? backup_(b) : { error: '没有权限' });
    if (!finance) return out_({ error: '要有「执委专区」权限' });
    if (b.action === 'upload') return out_(upload_(b));
    if (b.action === 'view') return out_(view_(b));
    if (b.action === 'trash') return out_(trash_(b));
    if (b.action === 'status') return out_(status_());
    return out_({ error: '不认识的动作' });
  } catch (err) {
    return out_({ error: String(err && err.message || err) });
  }
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// 拿通行证问 Google 是不是真的；是真的才看里面写的权限
function verify_(token) {
  if (!token) return null;
  const r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + API_KEY, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: token }), muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) return null;
  const user = (JSON.parse(r.getContentText()).users || [])[0];
  if (!user) return null;
  let p = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  while (p.length % 4) p += '=';
  const claims = JSON.parse(Utilities.newBlob(Utilities.base64Decode(p)).getDataAsString());
  return claims.aud === PROJECT && claims.sub === user.localId ? claims : null;
}

function root_() {
  const id = props().getProperty('rootId');
  if (id) {
    try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* 被删了就重开 */ }
  }
  const r = child_(child_(DriveApp.getRootFolder(), TOP), ROOT);
  props().setProperty('rootId', r.getId());
  return r;
}
function child_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
// 同名的先丢垃圾桶再写新的
function writeText_(folder, name, text) {
  const it = folder.getFilesByName(name);
  while (it.hasNext()) it.next().setTrashed(true);
  return folder.createFile(name, text, 'application/json');
}
const safeName_ = s => String(s || '').replace(/[\\/:*?"<>|\r\n\t]+/g, '-').slice(0, 150) || '附件';

// ───────── 附件 ─────────
function upload_(b) {
  if (!IMAGE_OR_PDF.test(b.mime || '')) return { error: '只收图片或 PDF' };
  if (!b.data || b.data.length > 30e6) return { error: '文件太大（最多 20MB）' };
  const year = /^\d{4}-/.test(b.date || '') ? b.date.slice(0, 4) : '没写日期';
  const folder = child_(child_(root_(), '财政附件'), year);
  const name = safeName_(b.name);
  const f = folder.createFile(Utilities.newBlob(Utilities.base64Decode(b.data), b.mime, name));
  return { id: f.getId(), name: f.getName(), mime: b.mime };
}
// 只碰得到「财政附件」里面的文件，这个账号的其他文件一律碰不到
function financeFile_(id) {
  const f = DriveApp.getFileById(String(id || ''));
  const base = child_(root_(), '财政附件').getId();
  const years = f.getParents();
  while (years.hasNext()) {
    const up = years.next().getParents();
    while (up.hasNext()) if (up.next().getId() === base) return f;
  }
  return null;
}
// App 里拿掉附件、这一笔存好之后才叫这里；进垃圾桶，30 天内救得回
function trash_(b) {
  const f = financeFile_(b.id);
  if (!f) return { error: '这个文件不是财政附件' };
  f.setTrashed(true);
  return { ok: true };
}
function view_(b) {
  const f = financeFile_(b.id);
  if (!f) return { error: '这个文件不是财政附件' };
  const blob = f.getBlob();
  return { name: f.getName(), mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

function status_() {
  const p = props();
  return {
    lastBackupAt: p.getProperty('lastBackupAt') || null,
    counts: JSON.parse(p.getProperty('lastCounts') || '{}'),
    media: JSON.parse(p.getProperty('mediaStatus') || '{}'),
    url: root_().getUrl(),
  };
}

// ───────── 每晚备份 ─────────
function backup_(b) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.day || '') || !b.data) return { error: '备份资料不完整' };
  const folder = child_(root_(), '每晚完整备份');
  writeText_(folder, b.day + '.json', JSON.stringify(b.data));
  prune_(folder, b.day);
  sheet_(b.data);
  const counts = {};
  Object.keys(b.data).forEach(c => { counts[c] = Object.keys(b.data[c]).length; });
  props().setProperties({ lastBackupAt: new Date().toISOString(), lastCounts: JSON.stringify(counts) });
  props().deleteProperty('mediaIdle');
  return { ok: true, counts };
}
function prune_(folder, today) {
  const it = folder.getFiles(), now = Date.parse(today);
  while (it.hasNext()) {
    const f = it.next(), m = f.getName().match(/^(\d{4}-\d{2}-(\d{2}))\.json$/);
    if (m && m[2] !== '01' && (now - Date.parse(m[1])) / 864e5 > KEEP_DAYS) f.setTrashed(true);
  }
}
function sheet_(data) {
  const p = props();
  let ss = null;
  try { const id = p.getProperty('sheetId'); if (id) ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
  if (!ss) {
    ss = SpreadsheetApp.create('乐韵 App 资料（每晚更新）');
    DriveApp.getFileById(ss.getId()).moveTo(root_());
    p.setProperty('sheetId', ss.getId());
  }
  const tabs = tabs_(data), names = tabs.map(t => t.name);
  tabs.forEach(t => writeTab_(ss, t));
  ss.getSheets().filter(s => names.indexOf(s.getName()) < 0).forEach(s => ss.deleteSheet(s));
}
function writeTab_(ss, t) {
  const sh = ss.getSheetByName(t.name) || ss.insertSheet(t.name);
  sh.clear();
  const rows = [t.head].concat(t.rows), width = t.head.length;
  const all = sh.getRange(1, 1, rows.length, width);
  all.setNumberFormat('@');   // 一律当文字，日期才不会被 Google 改成月/日/年，也不会把内容当公式跑
  (t.money || []).forEach(c => sh.getRange(2, c + 1, Math.max(rows.length - 1, 1), 1).setNumberFormat('#,##0.00'));
  all.setValues(rows.map(r => r.map(v => typeof v === 'number' ? v : String(v == null ? '' : v).slice(0, 49000))));
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, width).setFontWeight('bold');
}

const dmy_ = iso => /^\d{4}-\d{2}-\d{2}/.test(iso || '') ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : String(iso || '');
const list_ = o => Object.keys(o || {}).map(id => Object.assign({ id: id }, o[id]));
const byDate_ = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id));

// 把资料排成人看得懂的表格：财政、团室物品、团员、出席、会议记录
function tabs_(d) {
  const meet = list_(d.meetings);
  let bal = 0;
  const fin = meet.filter(x => x.kind === 'fin' && !x.removed).sort(byDate_).map(x => {
    const rm = Number(x.cents || 0) / 100;
    bal += x.type === 'out' ? -rm : rm;
    const files = (x.files || []).map(f => 'https://drive.google.com/file/d/' + f.id + '/view').join('\n');
    return [dmy_(x.date), x.type === 'out' ? '支出' : '收入', rm, Math.round(bal * 100) / 100, x.what, x.who, x.note, files, x.by];
  });
  const items = meet.filter(x => x.kind === 'item' && !x.removed).sort((a, b) => String(a.place).localeCompare(String(b.place)))
    .map(x => [x.name, x.qty, x.place, x.status, x.keeper, x.note]);
  const people = list_(d.members).filter(m => m.name).sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map(m => [m.active === false ? '已离开' : '在团', m.name, m.fullName, m.cname, m.voice, (m.roles || []).join('、'), m.note]);
  const att = [];
  list_(d.attendance).sort(byDate_).forEach(x => Object.keys(x.marks || {}).forEach(id => {
    att.push([dmy_(x.date), KIND[x.kind] || x.kind, x.title, (x.names || {})[id] || id, MARK[x.marks[id]] || x.marks[id]]);
  }));
  const minutes = meet.filter(x => ['fin', 'item', 'year', 'roster'].indexOf(x.kind) < 0).sort(byDate_).reverse().map(x => {
    const s = x.summary || {};
    return [dmy_(x.date || x.id), x.title, x.time, x.place, x.attend, x.absent, (s.points || []).join('\n'), x.minutes];
  });
  return [
    { name: '财政记录', head: ['日期', '类别', '金额 RM', '余额 RM', '事项', '经手人', '备注', '附件', '记录的人'], rows: fin, money: [2, 3] },
    { name: '团室物品', head: ['物品', '数量', '放在哪里', '状况', '谁管', '备注'], rows: items },
    { name: '团员名单', head: ['状态', '名字', '全名', '中文名', '声部', '职务', '备注'], rows: people },
    { name: '出席记录', head: ['日期', '活动', '名称', '团员', '记录'], rows: att },
    { name: '会议记录', head: ['日期', '名称', '时间', '地点', '出席', '缺席', '重点', '完整记录'], rows: minutes },
  ];
}

// ───────── 乐谱、合照复制一份进 Drive（每小时跑，做完就休息到下一次备份） ─────────
function mediaKey_(u) { return decodeURIComponent(u.split('/').pop().split('?')[0]); }
function collect_(v, set) {
  if (typeof v === 'string') { if (v.indexOf(CLOUD) === 0) set[v] = 1; return; }
  if (v && typeof v === 'object') Object.keys(v).forEach(k => collect_(v[k], set));
}
// 只要原图：网址里有缩图设定的（多一层路径）不要
const originalOnly_ = u => /\/upload\/(v\d+\/)?[^\/]+$/.test(u);
function mediaUrls_(folder) {
  const set = {};
  const it = child_(root_(), '每晚完整备份').getFiles();
  let latest = null;
  while (it.hasNext()) { const f = it.next(); if (!latest || f.getName() > latest.getName()) latest = f; }
  if (latest) collect_(JSON.parse(latest.getBlob().getDataAsString()), set);
  const lib = UrlFetchApp.fetch(LIBRARY, { muteHttpExceptions: true });
  if (lib.getResponseCode() === 200) (lib.getContentText().match(/https:\/\/res\.cloudinary\.com\/dsfhilcgz\/[^"'\s]+/g) || []).forEach(u => { set[u] = 1; });
  return Object.keys(set).filter(originalOnly_);
}
function copyMedia() {
  const p = props();
  if (p.getProperty('mediaIdle')) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const started = Date.now(), base = child_(root_(), '乐谱与合照');
    const saved = base.getFilesByName(MEDIA_INDEX);
    const idx = saved.hasNext() ? JSON.parse(saved.next().getBlob().getDataAsString()) : {};
    const urls = mediaUrls_(base);
    const todo = urls.filter(u => { const e = idx[mediaKey_(u)]; return !e || (e.fail && e.fail < 3); });
    const save = () => writeText_(base, MEDIA_INDEX, JSON.stringify(idx));
    let n = 0;
    for (let i = 0; i < todo.length && Date.now() - started < 270000; i++) {
      const key = mediaKey_(todo[i]);
      try {
        const r = UrlFetchApp.fetch(todo[i], { muteHttpExceptions: true });
        if (r.getResponseCode() !== 200) throw new Error(String(r.getResponseCode()));
        const f = child_(base, /^photo_/.test(key) ? '合照' : '乐谱').createFile(r.getBlob().setName(safeName_(key)));
        idx[key] = { id: f.getId() };
      } catch (err) {
        idx[key] = { fail: ((idx[key] || {}).fail || 0) + 1 };
      }
      if (++n % 25 === 0) save();
    }
    if (n) save();
    const left = urls.filter(u => { const e = idx[mediaKey_(u)]; return !e || (e.fail && e.fail < 3); }).length;
    const failed = Object.keys(idx).filter(k => idx[k].fail).length;
    p.setProperty('mediaStatus', JSON.stringify({ total: urls.length, left: left, failed: failed, at: new Date().toISOString() }));
    if (!left) p.setProperty('mediaIdle', '1');
  } finally {
    lock.releaseLock();
  }
}
