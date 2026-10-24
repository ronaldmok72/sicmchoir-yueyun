// 座位表：每个礼拜谁坐哪里、今天要拿哪些披肩
// Firestore seatings/{YYYY-MM-DD}：{ cols, nRows, seats: { 'r-c': 名字 }, absent: [名字], capes: { 名字: 这场穿的号码 }, voices: { 名字: 这场唱的声部 },
//   guests: [{ name, group, gender }]  ← 这一场来帮忙的人（慕道班、主日学…），不在团员名单、不会带到下一场
//   front: [名字|'']  ← 台前那一排（指挥、乐手、领唱…），椅子几张自己加减
//   extra: [名字] }   ← 这一场另外加的团员（名单上「没在来」的人也可以加）
// 人从团员名单拿；有职务的人（指挥、琴师、答唱咏，婚礼还有读经…）从职务表／排歌页拿，排在「还没排」最前面，座位右上角标职务
// 💒 婚礼：seatings/{日期_时间}（跟排歌页那台的 id 一样），多了 event、noCapes（不穿披肩）；
//   人只拿排歌页「来唱的团员」，琴师从「谁做什么」拿
import { collection, doc, setDoc, updateDoc, arrayUnion, query, where, documentId } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, getDocs, history } from "./firebase.js";
import { litDay } from "./liturgy.js";
import { genderOf, VOICE_SHORT, normVoice } from "./people.js";
import { timeText, findMember } from "./weddings-common.js";

const $ = id => document.getElementById(id);
const SEATINGS = 'seatings';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = iso(new Date());
const md = date => `${Number(date.slice(8))}/${Number(date.slice(5, 7))}`;
const week = date => '日一二三四五六'[new Date(date + 'T12:00').getDay()];

// Google Sheet 11/10/2026 那一次（第一次导入用）
const SEED = {
  date: '2026-10-11', cols: 5, rows: [
    ['Janet', 'Isabelle', 'Angeline', 'Emily', 'Natalie'],
    ['Joyce', 'SiauTing', 'Pauline', 'Teresa', 'Margaret'],
    ['Rosalind', 'Joseph', 'Shawn', 'Frank', 'Francis'],
    ['Kevin', 'Jasper', 'Thomas', 'Dominic', 'Lucas'],
    ['Theresa', '咏薇', 'Jessie', 'Anne', 'Timothy'],
  ],
};

// 台前的职务：新排的时候自动放进台前那一排
const STAGE = [['conductor', '指挥'], ['piano', '钢琴'], ['organ', '风琴'], ['guitar', '吉他'], ['drums', '鼓手']];
const STAGE_ROLES = new Set(STAGE.map(([, l]) => l));
// 座位右上角的职务小字
const TAG = { 指挥: '指', 钢琴: '琴', 风琴: '风', 吉他: '吉', 鼓手: '鼓', 答唱咏: '答', 领经: '领', 读经一: '读一', 读经二: '读二', 信友祷文: '信' };
const tagOf = role => TAG[role] || String(role).slice(0, 2);
const VOICE_STYLE = {
  S: ['bg-rose-50 border-rose-200', '女高'], A: ['bg-amber-50 border-amber-200', '女低'],
  T: ['bg-sky-50 border-sky-200', '男高'], B: ['bg-indigo-50 border-indigo-200', '男低'],
  '': ['bg-white border-slate-300', '主旋律'],
};
const GUEST_GROUPS = ['慕道班', '主日学', '天使团', '公青/专青', '其他 Guest'];
const GUEST_STYLE = 'bg-violet-50 border-violet-300 border-dashed';

let members = [], allM = [], byName = {}, active = new Set(), allCapes = [];   // members：有在来的；allM：名单上全部；allCapes：所有人的号码（没在来的也算，披肩还在）
let D = {}, S = {}, W = {};   // W：婚礼（排歌页 masses 里有 kind 的），照 id
let PRAC = [], RSVP = {};     // 练习点名（attendance 里 kind=practice 的）、投票 rsvp/{日期_mass}
let cur = null;      // { key（seatings 的 id）, date, noCapes, cols, front: [名字|''], rows: [[名字|'']], absent: [], capes: {}, voices: {}, guests: [], extra: [], draftFrom }
let sel = null;      // { kind: 'tray', name } | { kind: 'seat', r, c }（r = 'F' 是台前那一排）
let saveTimer = null;
let flash = '';      // 保存好之后要给人看的话（不然会被「已保存」盖掉）

const memberOf = name => byName[String(name || '').toLowerCase()];
const isEv = k => String(k || '').includes('_');   // 婚礼：id 带时间
const asMember = n => (findMember(n, members) || findMember(n, allM))?.name || n;   // 「Ronald Mok」→ 名单上的「Mok」
const W_STAGE = { pianist: '钢琴', organist: '风琴', 钢琴: '钢琴', 风琴: '风琴', 指挥: '指挥', 吉他: '吉他', 鼓手: '鼓手' };
const guestOf = name => (cur?.guests || []).find(g => g.name.toLowerCase() === String(name || '').toLowerCase());
const splitNames = v => String(v || '').split(/[\/、,，&]+/).map(s => s.trim()).filter(Boolean);
// 这一场唱的声部、穿的披肩：座位表这一天改过的先算，不然照团员名单
const voiceOf = name => normVoice(cur?.voices?.[name] ?? memberOf(name)?.voice);
const voiceChanged = name => !!cur?.voices && name in cur.voices;
//   这一场写了 0 = 这场不穿
const capeOf = name => cur?.noCapes ? null : cur?.capes && name in cur.capes ? (cur.capes[name] || null) : (memberOf(name)?.cape || null);
const capeOff = name => cur?.capes?.[name] === 0;
// 女声 F／男声 M：名单写了照写的；不然看这场的声部；再不然看披肩号码
const gender = name => guestOf(name) ? (guestOf(name).gender || '') : genderOf(memberOf(name), voiceOf(name));
const label = name => `${name}${capeOf(name) ? ` ${capeOf(name)}` : ''}${guestOf(name) ? `（${guestOf(name).group}）` : ''}`;

// ───────── 读取 ─────────
async function load() {
  $('status').textContent = '读取中…';
  // 职务表、点名一直累积：只读最近 60 天以后的（id 都是日期开头），省读取次数
  const since = c => query(collection(db, c), where(documentId(), '>=', addDays(TODAY, -60)));
  const [ms, ds, ss, wm, at, rv] = await Promise.all([
    getDocs(collection(db, 'members')), getDocs(since('duties')), history(SEATINGS), history('masses'),
    getDocs(since('attendance')).catch(() => null), history('rsvp').catch(() => null),
  ]);
  W = Object.fromEntries(wm.docs.filter(d => d.data().kind).map(d => [d.id, d.data()]));
  PRAC = (at?.docs || []).map(d => d.data()).filter(a => a.kind === 'practice');
  RSVP = Object.fromEntries((rv?.docs || []).map(d => [d.id, d.data()]));
  allM = ms.docs.map(d => ({ id: d.id, ...d.data() }));
  members = allM.filter(m => m.active !== false);
  active = new Set(members.map(m => m.name.toLowerCase()));
  allCapes = allM.filter(m => m.cape).map(m => ({ name: m.name, cape: m.cape }));
  // 没在来的也认得（另外加进来的时候要知道他的声部、披肩）；同名的话有在来的优先
  byName = Object.fromEntries(allM.filter(m => m.active === false).concat(members).map(m => [m.name.toLowerCase(), m]));
  $('member-names').innerHTML = members.concat(allM.filter(m => m.active === false)).map(m => `<option value="${esc(m.name)}">${esc(m.fullName || '')}</option>`).join('');
  D = Object.fromEntries(ds.docs.map(d => [d.id, d.data()]));
  S = Object.fromEntries(ss.docs.map(d => [d.id, d.data()]));
  $('status').textContent = '';
  $('seed-box').classList.toggle('hidden', Object.keys(S).length > 0);
  renderDates();
  openDate($('date').value);
}

function fromDoc(key, s) {
  const rows = Array.from({ length: s.nRows || 0 }, (_, r) => Array.from({ length: s.cols || 5 }, (_, c) => s.seats?.[`${r}-${c}`] || ''));
  return { key, date: key.slice(0, 10), noCapes: !!s.noCapes, cols: s.cols || 5, front: s.front ? [...s.front] : null, rows, absent: [...(s.absent || [])], capes: { ...(s.capes || {}) }, voices: { ...(s.voices || {}) }, guests: (s.guests || []).map(g => ({ ...g })), extra: [...(s.extra || [])] };
}

// 日期：排过的最近几次 + 接下来 6 个主日 + 还没到的婚礼
function renderDates() {
  const set = new Set(Object.keys(S).filter(k => !isEv(k)).sort().slice(-6));
  Object.keys(W).filter(k => W[k].date >= TODAY || S[k]).sort().slice(-8).forEach(k => set.add(k));
  const s = new Date(TODAY + 'T12:00');
  s.setDate(s.getDate() + (7 - s.getDay()) % 7);
  for (let i = 0; i < 6; i++, s.setDate(s.getDate() + 7)) set.add(iso(s));
  // 从「这台弥撒」总览点进来：?d=2026-10-18
  // 从排歌页「🪑 排座位」点进来：?e=2026-10-17_0930
  const qs = new URLSearchParams(location.search);
  const want = W[qs.get('e')] ? qs.get('e') : (qs.get('d') || '').match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  if (want) set.add(want);
  const list = [...set].sort();
  const keep = $('date').value || want;
  $('date').innerHTML = list.map(k => {
    const d = k.slice(0, 10), w = W[k];
    return `<option value="${k}">${w ? '💒 ' : ''}${md(d)} 星期${week(d)}　${w ? esc(`${timeText(w.time)} ${w.title}`) : esc(D[d]?.title || litDay(d).name)}${S[k] ? '　✓ 排好了' : ''}</option>`;
  }).join('');
  $('date').value = keep && list.includes(keep) ? keep : (list.find(d => d >= TODAY) || list.at(-1));
}

function openDate(key) {
  sel = null;
  if (S[key]) {
    cur = fromDoc(key, S[key]);
    if (!cur.front) { cur.front = []; const taken = seated(); cur.front = stageFront(key).filter(n => !taken.has(n.toLowerCase())); }   // 以前排的还没有台前那一排：指挥、乐手先放上去
  } else {
    cur = { key, date: key.slice(0, 10), noCapes: !!W[key], cols: 5, front: [], rows: [], absent: [], capes: {}, voices: {}, guests: [], extra: [] };   // 婚礼默认不穿披肩
    autoFill();             // 还没排过：先照上一次排好，当草稿
  }
  loadStatus();
  render();
}

// ───────── 谁在哪里 ─────────
// 这一场有职务的人 [{ name, role }]：主日照职务表（指挥、琴师、答唱咏…），婚礼照排歌页「谁做什么」（读经、领经…都算）
function rolePeople(key) {
  if (W[key]) return (W[key].roles || []).flatMap(r => {
    const raw = String(r.role || '').trim();
    const role = W_STAGE[raw.toLowerCase()] || raw;
    return raw ? splitNames(r.name).map(n => ({ name: asMember(n), role })) : [];
  });
  const d = D[key] || {};
  return [...STAGE, ['cantor', '答唱咏']].flatMap(([k, l]) => splitNames(d[k]).map(name => ({ name, role: l })));
}
const stagePeople = key => rolePeople(key).filter(p => STAGE_ROLES.has(p.role));
// 名字（小写）→ 这一场的职务
function roleMap() {
  const m = new Map();
  rolePeople(cur.key).forEach(p => { const k = p.name.toLowerCase(); m.set(k, [...(m.get(k) || []), p.role]); });
  return m;
}
const uniqNames = list => [...new Map(list.filter(Boolean).map(n => [n.toLowerCase(), n])).values()];
// 新排的台前：指挥、乐手（今天没来的不算）
function stageFront(key) {
  const off = new Set((cur?.absent || []).map(n => n.toLowerCase()));
  return uniqNames(stagePeople(key).map(p => p.name)).filter(n => !off.has(n.toLowerCase()));
}

// 座位：r = 'F' 是台前那一排，数字是第几排
const rowOf = r => r === 'F' ? cur.front : cur.rows[r];
const nameAt = (r, c) => rowOf(r)?.[c] || '';
const parseSeat = v => { const [a, b] = String(v).split('-'); return [a === 'F' ? 'F' : Number(a), Number(b)]; };
function seated() { return new Set([...cur.front, ...cur.rows.flat()].filter(Boolean).map(n => n.toLowerCase())); }
function trayPeople() {
  const taken = seated();
  const absent = new Set(cur.absent.map(n => n.toLowerCase()));
  const roles = roleMap();
  const order = { F: 0, M: 1, '': 2 };
  const pool = W[cur.key] ? (W[cur.key].singers || []).map(asMember) : members.map(m => m.name);   // 婚礼：只有来唱的人
  return uniqNames([...rolePeople(cur.key).map(p => p.name), ...pool, ...cur.extra, ...cur.guests.map(g => g.name)])
    .filter(n => !taken.has(n.toLowerCase()) && !absent.has(n.toLowerCase()))
    .sort((a, b) => roles.has(b.toLowerCase()) - roles.has(a.toLowerCase()) || order[gender(a)] - order[gender(b)] || (capeOf(a) || 999) - (capeOf(b) || 999) || a.localeCompare(b));
}

// 照上一次排：指挥、乐手放台前；没来的、在台前的从座位拿掉；还没位子的女声从前面补，男声从后面补
function autoFill() {
  const { key, date, noCapes, absent, capes, voices, guests, extra } = cur;   // 这一天自己改过的披肩、声部、加的人留着，不照上一次
  const front = stageFront(key);
  if (W[key]) {
    // 婚礼：来唱的人＋有职务的人（读经、领经…）全部放上去，女生在前、男生在后，每排 5 个
    cur = { key, date, noCapes, cols: 5, front, rows: [], absent, capes, voices, guests, extra, draftFrom: 'singers' };
    const names = trayPeople();
    if (names.length) { cur.rows = [names]; rearrange('gender'); }
    return;
  }
  const sundays = Object.keys(S).filter(k => !isEv(k));
  const prevDate = sundays.filter(d => d < date).sort().at(-1) || sundays.filter(d => d !== date).sort().at(-1);
  if (prevDate) {
    const p = fromDoc(prevDate, S[prevDate]);
    cur = { key, date, cols: p.cols, front, rows: p.rows, absent, capes, voices, guests, extra, draftFrom: prevDate };
  } else {
    cur = { key, date, cols: 5, front, rows: Array.from({ length: 5 }, () => Array(5).fill('')), absent, capes, voices, guests, extra, draftFrom: null };
  }
  const stage = new Set(front.map(n => n.toLowerCase()));
  const off = new Set(absent.map(n => n.toLowerCase()));
  const seen = new Set();
  cur.rows = cur.rows.map(row => row.map(n => {
    const k = n.toLowerCase();
    if (!n || !(active.has(k) || extra.some(x => x.toLowerCase() === k)) || stage.has(k) || off.has(k) || seen.has(k)) return '';
    seen.add(k);
    return n;
  }));
  if (!prevDate) return;    // 完全没有旧座位：全部留在「还没排」，自己放
  // 上一次在台前（指挥／琴师）、这次没有职务的人，补回座位；其他没坐过的留在「还没排」，有来才放
  const wasStage = new Set(stagePeople(prevDate).map(p => p.name.toLowerCase()));
  for (const name of trayPeople().filter(n => wasStage.has(n.toLowerCase()))) {
    const g = gender(name);
    let spot = findEmpty(g === 'M' ? 'back' : 'front');
    if (!spot) { cur.rows.push(Array(cur.cols).fill('')); spot = findEmpty(g === 'M' ? 'back' : 'front'); }
    cur.rows[spot[0]][spot[1]] = name;
  }
}
function findEmpty(from) {
  const order = cur.rows.map((_, i) => i);
  if (from === 'back') order.reverse();
  for (const r of order) { const c = cur.rows[r].indexOf(''); if (c >= 0) return [r, c]; }
  return null;
}

// 重新排：坐着的人照现在的先后分组，从前面排起，每一组开新的一排
//   gender：女生 → 男生 → 不知道男女的
//   voice ：S → A → 女声主旋律 → T → B → 男声主旋律 → 不知道男女的（大家都唱主旋律，没有声部的照男女排）
function groupOf(name, mode) {
  const g = gender(name), v = voiceOf(name);
  if (mode === 'gender') return [{ F: 0, M: 1, '': 2 }[g], 0];
  const order = { S: 0, A: 1, T: 3, B: 4 };
  if (v in order) return [order[v], 0];
  return [g === 'F' ? 2 : g === 'M' ? 5 : 6, 0];
}
function rearrange(mode) {
  const people = cur.rows.flat().filter(Boolean);
  const groups = [];
  people.forEach((n, i) => { const [g, sub] = groupOf(n, mode); (groups[g] ||= []).push({ n, sub, i }); });
  const rows = [];
  for (const grp of groups.filter(Boolean)) {
    const names = grp.sort((a, b) => a.sub - b.sub || a.i - b.i).map(x => x.n);
    for (let i = 0; i < names.length; i += cur.cols) rows.push(names.slice(i, i + cur.cols).concat(Array(cur.cols).fill('')).slice(0, cur.cols));
  }
  cur.rows = rows.length ? rows : cur.rows;   // 后面空的排不留，要多一排再按「＋ 一排」
}

// 今天在场的人（坐着的 + 台前的），披肩重复、谁可以借哪件
function present() {
  const off = new Set(cur.absent.map(n => n.toLowerCase()));
  return uniqNames([...cur.front, ...cur.rows.flat(), ...stagePeople(cur.key).map(p => p.name).filter(n => !off.has(n.toLowerCase()))]);
}
function dupCapes() {
  const by = {};
  present().forEach(n => { const c = capeOf(n); if (c) (by[c] ||= []).push(n); });
  return Object.entries(by).filter(([, l]) => l.length > 1).map(([c, l]) => [Number(c), l]);
}
// 同一组（女 1–30／男 31 起）里，今天没人穿的号码；越接近原本号码越前面
function freeCapes(near) {
  const here = new Set(present().map(n => n.toLowerCase()));
  const used = new Set(present().map(capeOf).filter(Boolean));
  const female = near <= 30;
  return [...new Set(allCapes.filter(m => !here.has(m.name.toLowerCase())).map(m => m.cape))]
    .filter(c => !used.has(c) && (c <= 30) === female)
    .sort((a, b) => Math.abs(a - near) - Math.abs(b - near) || a - b);
}

// ───────── 有没有练习、投票（主日才看）─────────
// 规矩：这个礼拜或上个礼拜的星期四／六，至少来一次练习，才排位子、拿披肩（= 主日前 1–10 天的练习点名有 P／T）
const addDays = (date, n) => { const d = new Date(date + 'T12:00'); d.setDate(d.getDate() + n); return iso(d); };
let practised = null, pracCount = 0;   // practised：这一场前有来练习的团员 id；null = 婚礼，不看
function loadStatus() {
  practised = null;
  if (W[cur.key]) return;
  const from = addDays(cur.date, -10), to = addDays(cur.date, -1);
  const ps = PRAC.filter(a => a.date >= from && a.date <= to);
  pracCount = ps.length;
  practised = new Set(ps.flatMap(a => Object.entries(a.marks || {}).filter(([, v]) => v === 'P' || v === 'T').map(([id]) => id)));
}
const votes = () => RSVP[`${cur.date}_mass`]?.votes || {};
const voteOf = name => { const m = memberOf(name); return m ? votes()[m.id] : undefined; };
const noPractice = name => { const m = memberOf(name); return !!(practised && pracCount && m && !guestOf(name) && !practised.has(m.id)); };
// 小记号：🙅 说不来、⚠️ 两个礼拜都没练、🙋 说会来（座位上只标前两个）
function mark(name, all) {
  if (!practised || !name) return '';
  if (voteOf(name) === 'N') return '🙅';
  if (noPractice(name)) return '⚠️';
  return all && voteOf(name) === 'Y' ? '🙋' : '';
}
function renderStatus() {
  const box = $('rsvp-box');
  box.classList.toggle('hidden', !practised);
  if (!practised) return;
  const v = votes();
  const nameOf = id => allM.find(m => m.id === id)?.name;
  const yes = Object.keys(v).filter(id => v[id] === 'Y').map(nameOf).filter(Boolean);
  const no = Object.keys(v).filter(id => v[id] === 'N').map(nameOf).filter(Boolean);
  const off = new Set(cur.absent.map(n => n.toLowerCase()));
  const noLeft = no.filter(n => !off.has(n.toLowerCase()));
  const sitting = present().filter(noPractice);
  box.innerHTML = `
    <div>🗳️ App 投票：🙋 会来 <b>${yes.length}</b>　🙅 不来 <b>${no.length}</b>${no.length ? `<span class="text-slate-500">（${no.map(esc).join('、')}）</span>` : ''}
      ${noLeft.length ? `<button id="btn-no-absent" class="ml-1 px-2 py-0.5 rounded-md bg-slate-700 text-white text-xs">说不来的 ${noLeft.length} 位放进「今天没来」</button>` : ''}</div>
    <div>${pracCount ? `🎵 前两个礼拜点名 ${pracCount} 次练习，有来的 ${practised.size} 位` : '🎵 前两个礼拜还没有练习点名'}
      ${sitting.length ? `<span class="text-amber-700">　⚠️ 排了位子但两个礼拜都没来练：${sitting.map(esc).join('、')}</span>` : ''}</div>
    <div class="text-[11px] text-slate-400">规矩：这个礼拜或上个礼拜的星期四／六至少来一次练习，才排位子、拿披肩。投票说会来的可以先排，当天没来再调。</div>`;
}
$('rsvp-box').addEventListener('click', e => {
  if (!e.target.closest('#btn-no-absent')) return;
  const v = votes();
  const no = Object.keys(v).filter(id => v[id] === 'N').map(id => allM.find(m => m.id === id)?.name).filter(Boolean);
  const k = new Set(no.map(n => n.toLowerCase()));
  cur.front = cur.front.map(n => k.has(n.toLowerCase()) ? '' : n);
  cur.rows = cur.rows.map(row => row.map(n => k.has(n.toLowerCase()) ? '' : n));
  no.forEach(n => { if (!cur.absent.some(a => a.toLowerCase() === n.toLowerCase())) cur.absent.push(n); });
  changed();
});

// ───────── 画面 ─────────
function render() {
  const roles = rolePeople(cur.key);
  const w = W[cur.key];
  const from = w ? `排歌页「谁做什么」` : '职务表';
  const fromLink = w ? `mass.html?id=${encodeURIComponent(cur.key)}` : 'duties.html';
  $('stage').innerHTML = (w ? `<div class="mb-1">💒 <b>${esc(w.title)}</b> ${esc(timeText(w.time))}　来唱的 ${(w.singers || []).length} 位（<a href="${fromLink}" class="underline">在排歌页加减</a>）</div>` : '')
    + (roles.length
    ? `${roles.map(p => `${esc(p.role)}：<b>${esc(p.name)}</b>`).join('　')}<span class="text-slate-400 text-xs">　（照<a href="${fromLink}" class="underline">${from}</a>；有职务的人排在「还没排座位」最前面，放台前或座位都可以）</span>`
    : `<span class="text-slate-400 text-xs">${from}这${w ? '台' : '天'}还没排职务</span>`);
  $('cape-toggle').classList.toggle('hidden', !w);
  $('cape-on').checked = !cur.noCapes;
  $('capes-box').classList.toggle('hidden', !!cur.noCapes);
  $('act-cape-box').classList.toggle('hidden', !!cur.noCapes);
  $('rearrange').options[1].textContent = w ? '照来唱的名单重新排' : '照上一次的座位';
  $('cols').value = cur.cols;
  renderGrid();
  renderTray();
  renderGuests();
  renderCapes();
  renderAction();
  renderStatus();
  if (cur.draftFrom !== undefined && !S[cur.key]) {
    $('status').textContent = cur.draftFrom === 'singers'
      ? (cur.rows.length ? '照来唱的名单排好了，女生在前（草稿，动一下就自动保存）' : '这台还没填来唱的人，先去排歌页加')
      : cur.draftFrom ? `照 ${md(cur.draftFrom)} 排好了（草稿，动一下就自动保存）` : '还没有旧座位，从下面一个一个放';
  }
}

function chip(name, attrs, extra = '', roles = roleMap()) {
  const v = voiceOf(name);
  const g = guestOf(name);
  const job = roles.get(name.toLowerCase());
  return `<button ${attrs} draggable="true" class="px-2 py-1 rounded-lg border text-sm ${g ? GUEST_STYLE : VOICE_STYLE[v][0]} ${extra}">${job ? `<span class="px-1 mr-0.5 rounded bg-emerald-600 text-white text-[10px] align-middle">${esc(job.join('·'))}</span>` : ''}${esc(name)}${capeOf(name) ? `<span class="text-slate-400 text-xs"> ${capeOf(name)}</span>` : ''}${g ? `<span class="text-violet-600 text-xs"> ${esc(g.group)}</span>` : ''}${mark(name, true) ? `<span class="text-xs"> ${mark(name, true)}</span>` : ''}</button>`;
}

function seatBtn(r, c, n, dup, roles) {
  const on = sel?.kind === 'seat' && sel.r === r && sel.c === c;
  const v = voiceOf(n), cape = capeOf(n), g = n && guestOf(n);
  const tags = n ? roles.get(n.toLowerCase()) || [] : [];
  const st = mark(n, false);
  return `<button data-seat="${r}-${c}" draggable="${n ? 'true' : 'false'}" class="seat relative flex-1 min-w-0 ${r === 'F' ? 'max-w-[5.5rem]' : ''} h-12 rounded-lg border text-center px-0.5 ${!n ? 'border-dashed border-slate-200 bg-slate-50' : g ? GUEST_STYLE : VOICE_STYLE[v][0]} ${on ? 'ring-2 ring-indigo-500' : ''} ${sel && !on ? 'hover:border-indigo-400' : ''}">
    ${n ? `<span class="block truncate text-[12px] tracking-tight leading-tight">${esc(n)}</span><span class="block truncate text-[11px] leading-tight ${dup.has(cape) ? 'text-red-600 font-semibold' : g ? 'text-violet-600' : 'text-slate-400'}">${cape ? `#${cape}` : g ? esc(g.group) : cur.noCapes ? '' : capeOff(n) ? '不穿' : '没号码'}</span>` : ''}
    ${n && voiceChanged(n) ? `<span class="absolute -top-1.5 -left-1 px-1 rounded bg-slate-700 text-white text-[10px]">${v || '主'}</span>` : ''}
    ${tags.length ? `<span class="absolute -top-1.5 -right-1 px-1 rounded bg-emerald-600 text-white text-[10px] whitespace-nowrap" title="${esc(tags.join('、'))}">${esc(tags.map(tagOf).join('·'))}</span>` : ''}
    ${st ? `<span class="absolute -bottom-1.5 -right-1 text-[11px] leading-none">${st}</span>` : ''}
  </button>`;
}

function rowLabel(r, text) {
  const has = rowOf(r).some(Boolean);
  return `<div class="w-6 shrink-0 text-[11px] text-slate-400 flex flex-col items-center justify-center leading-tight" title="${r === 'F' ? '台前（指挥、乐手、领唱…）' : `第${r + 1}排`}">
    <span class="${r === 'F' ? 'text-[10px]' : ''}">${text}</span>
    ${has ? `<button data-clear-row="${r}" class="mt-0.5 text-[11px] text-slate-300 hover:text-red-500" title="清空这一排">✕</button>` : ''}
  </div>`;
}

function renderGrid() {
  const dup = new Set(dupCapes().map(([c]) => c));
  const roles = roleMap();
  // 台前那一排：指挥、乐手、领唱…，椅子几张自己加减
  const front = `
    <div class="flex items-stretch justify-center gap-1 pb-2 mb-1 border-b border-dashed border-slate-200">
      ${rowLabel('F', '台前')}
      ${cur.front.map((n, c) => seatBtn('F', c, n, dup, roles)).join('') || '<div class="flex-1 text-xs text-slate-400 self-center">台前还没有椅子 →</div>'}
      <div class="flex flex-col gap-0.5 shrink-0 justify-center">
        <button data-front="+" class="px-1.5 rounded bg-slate-100 hover:bg-slate-200 text-xs" title="台前加一张椅子">＋</button>
        ${cur.front.length ? '<button data-front="-" class="px-1.5 rounded bg-slate-100 hover:bg-slate-200 text-xs" title="台前拿掉最后一张椅子">－</button>' : ''}
      </div>
    </div>`;
  $('grid').innerHTML = front + (cur.rows.map((row, r) => `
    <div class="flex items-stretch gap-1">
      ${rowLabel(r, r + 1)}
      ${row.map((n, c) => seatBtn(r, c, n, dup, roles)).join('')}
    </div>`).join('') || '<div class="text-sm text-slate-400 text-center py-4">还没有座位，按「＋ 一排」</div>');
  $('legend').innerHTML = ['S', 'A', 'T', 'B', ''].map(k => `<span class="flex items-center gap-1"><span class="w-3 h-3 rounded border ${VOICE_STYLE[k][0]}"></span>${VOICE_STYLE[k][1]}</span>`).join('')
    + (cur.guests.length ? `<span class="flex items-center gap-1"><span class="w-3 h-3 rounded border ${GUEST_STYLE}"></span>Guest</span>` : '');
}

function renderTray() {
  const t = trayPeople();
  $('tray-count').textContent = t.length ? `（${t.length}）` : '';
  const roles = roleMap();
  $('tray').innerHTML = t.map(n => chip(n, `data-tray="${esc(n)}"`, sel?.kind === 'tray' && sel.name === n ? 'ring-2 ring-indigo-500' : '', roles)).join('')
    || '<span class="text-xs text-slate-400 self-center">✅ 全部排好了</span>';
  $('absent-box').classList.toggle('hidden', !cur.absent.length);
  $('absent').innerHTML = cur.absent.map(n => `<button data-absent="${esc(n)}" class="px-2 py-1 rounded-lg border border-slate-200 bg-slate-100 text-slate-400 text-sm line-through">${esc(n)}</button>`).join('');
}

// 今天要拿的披肩：坐着的 + 台前的
function renderCapes() {
  const uniq = present();
  const withCape = uniq.filter(capeOf).sort((a, b) => capeOf(a) - capeOf(b));
  const off = uniq.filter(capeOff);
  const none = uniq.filter(n => !capeOf(n) && !guestOf(n) && !capeOff(n));
  const guests = uniq.filter(guestOf);
  const byGroup = {};
  guests.forEach(n => { const k = guestOf(n).group; byGroup[k] = (byGroup[k] || 0) + 1; });
  const f = withCape.filter(n => capeOf(n) <= 30).length;
  // 重复的：这场特别改过号码的人留着，不然名单上本来就是这个号码的人留着，其他人建议换
  const fixes = dupCapes().map(([c, l]) => {
    const keep = l.find(n => cur.capes?.[n] === c) || l.find(n => memberOf(n)?.cape === c) || l[0];
    const free = freeCapes(c);
    const moves = l.filter(n => n !== keep).map((n, i) => free[i]
      ? `<button data-cape-fix="${esc(n)}" data-cape="${free[i]}" class="px-2 py-0.5 rounded-md bg-red-600 text-white text-xs">${esc(n)} 改穿 #${free[i]}</button>`
      : `<span class="text-xs">${esc(n)}：找不到空的号码，点他的座位自己填</span>`).join(' ');
    return `<div class="flex flex-wrap items-center gap-1.5"><span>#${c}：${l.map(esc).join('、')}</span><span class="text-red-400">→</span>${moves}</div>`;
  });
  $('capes').innerHTML = `
    <div>要拿 <b>${withCape.length}</b> 件：女声 ${f} 件、男声 ${withCape.length - f} 件</div>
    <div class="flex flex-wrap gap-1">${withCape.map(n => `<span class="px-1.5 py-0.5 rounded text-xs ${cur.capes?.[n] ? 'bg-amber-100' : 'bg-slate-100'}"><b>${capeOf(n)}</b> ${esc(n)}</span>`).join('')}</div>
    ${uniq.some(n => cur.capes?.[n]) ? '<div class="text-xs text-slate-400">黄色的 = 这一场换了号码（同一件穿满 3 场，团员名单会自动改成这件）</div>' : ''}
    ${off.length ? `<div class="text-slate-500">🚫 这场不穿：${off.map(esc).join('、')}</div>` : ''}
    ${guests.length ? `<div class="text-violet-700">🙋 Guest ${guests.length} 位：${Object.entries(byGroup).map(([k, n]) => `${esc(k)} ${n}`).join('、')}<span class="text-xs text-slate-400">　要借披肩的话，点他的座位填号码</span></div>` : ''}
    ${none.length ? `<div class="text-amber-700">⏳ 还没有披肩号码：${none.map(esc).join('、')}　<span class="text-xs">点座位上的人可以填这一场穿几号，或者<a href="members.html" class="underline">去团员名单填</a></span></div>` : ''}
    ${fixes.length ? `<div class="text-red-600 space-y-1"><div>🔴 号码重复了（点一下就帮他换成今天没人穿的号码）</div>${fixes.join('')}</div>` : ''}`;
}

function renderAction() {
  $('action-bar').classList.toggle('hidden', !sel);
  if (!sel) return;
  const name = sel.kind === 'tray' ? sel.name : nameAt(sel.r, sel.c);
  $('action-text').textContent = sel.kind === 'tray' ? `${name}：点一个座位放进去` : `${name}：点另一个座位对调`;
  $('act-unseat').classList.toggle('hidden', sel.kind !== 'seat');
  // 坐好之后：这一场穿几号、唱什么声部（只改这一场）
  $('act-edit').classList.toggle('hidden', sel.kind !== 'seat');
  if (sel.kind !== 'seat') return;
  const m = memberOf(name), main = normVoice(m?.voice);
  const own = cur.capes && name in cur.capes;
  $('act-cape').value = capeOf(name) || '';
  $('act-cape-hint').textContent = own ? `${capeOff(name) ? '这场不穿' : '这场换了'}${m?.cape ? `（名单 #${m.cape}）` : ''}` : (m?.cape ? '照名单' : '名单没号码');
  $('act-cape-off').classList.toggle('hidden', capeOff(name));
  $('act-cape-reset').classList.toggle('hidden', !own);
  $('act-voices').innerHTML = ['', 'S', 'A', 'T', 'B'].map(v => `<button data-voice="${v}" class="px-2 py-0.5 rounded-md ${voiceOf(name) === v ? 'bg-white text-indigo-700 font-semibold' : 'bg-white/15 hover:bg-white/25'}">${VOICE_SHORT[v]}${v === main ? '<span class="text-[10px] opacity-70">·平常</span>' : ''}</button>`).join('');
}

// ───────── 改动 ─────────
function changed(keepSel = false) {
  delete cur.draftFrom;
  if (!keepSel) sel = null;
  render();
  clearTimeout(saveTimer);
  $('status').textContent = '保存中…';
  saveTimer = setTimeout(save, 500);
}
async function save() {
  const seats = {};
  cur.rows.forEach((row, r) => row.forEach((n, c) => { if (n) seats[`${r}-${c}`] = n; }));
  let adopted = [];
  try { adopted = await adoptCapes(); } catch (err) { console.error(err); }
  const data = { date: cur.date, ...(W[cur.key] ? { event: cur.key, noCapes: !!cur.noCapes } : {}), cols: cur.cols, nRows: cur.rows.length, seats, front: cur.front, absent: cur.absent, capes: cur.capes || {}, voices: cur.voices || {}, guests: cur.guests || [], extra: cur.extra || [], updatedAt: new Date().toISOString() };
  try {
    await setDoc(doc(db, SEATINGS, cur.key), data);
    const first = !S[cur.key];
    S[cur.key] = data;
    if (first) { renderDates(); $('seed-box').classList.add('hidden'); }
    $('status').textContent = adopted.length ? `✓ 已保存。📌 ${adopted.join('；')}` : flash ? `✓ 已保存。${flash}` : `✓ 已保存 ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    flash = '';
    if (adopted.length) render();
  } catch (err) {
    console.error(err);
    $('status').textContent = '保存失败：' + (err.code || err.message);
  }
}

// 同一个人穿同一件（不是名单上的号码）满 3 场：团员名单改成这件，这一场就不用再特别写
// 名单上有别的在来的团员是这个号码，就不动（免得两个人同一件）
async function adoptCapes() {
  const done = [];
  for (const [name, n] of Object.entries(cur.capes || {})) {
    const m = memberOf(name);
    if (!n || !m || m.cape === n || cur.noCapes) continue;
    const times = Object.entries(S).filter(([k, x]) => k !== cur.key && !x.noCapes && x.capes?.[name] === n).length + 1;
    if (times < 3 || members.some(x => x.id !== m.id && x.cape === n)) continue;
    await updateDoc(doc(db, 'members', m.id), { cape: n, updatedAt: new Date().toISOString() });
    m.cape = n;
    delete cur.capes[name];
    done.push(`${name} 穿 #${n} 满 ${times} 场，团员名单改成 #${n}`);
  }
  if (done.length) allCapes = allM.filter(m => m.cape).map(m => ({ name: m.name, cape: m.cape }));
  return done;
}

// 把「选中的」放到座位 r,c：从还没排的来就放进去（原本坐那里的回去）；从座位来就对调
function dropOn(from, r, c) {
  const to = rowOf(r);
  if (from.kind === 'tray') to[c] = from.name;
  else {
    if (from.r === r && from.c === c) { sel = null; render(); return; }
    const fr = rowOf(from.r);
    [to[c], fr[from.c]] = [fr[from.c], to[c]];
  }
  changed();
}
function unseat(from) {
  if (from.kind === 'seat') { rowOf(from.r)[from.c] = ''; changed(); }
}

$('grid').addEventListener('click', e => {
  const f = e.target.closest('[data-front]');
  if (f) {
    if (f.dataset.front === '+') cur.front.push('');
    else {
      const n = cur.front.at(-1);
      if (n && !confirm(`${n} 会回到「还没排座位」。确定？`)) return;
      cur.front.pop();
    }
    return changed();
  }
  const x = e.target.closest('[data-clear-row]');
  if (x) {
    const r = x.dataset.clearRow === 'F' ? 'F' : +x.dataset.clearRow;
    const who = rowOf(r).filter(Boolean);
    if (!who.length || !confirm(`${r === 'F' ? '台前' : `第 ${r + 1} 排`}的 ${who.length} 个人（${who.join('、')}）会回到「还没排座位」。确定？`)) return;
    rowOf(r).fill('');
    return changed();
  }
  const b = e.target.closest('[data-seat]'); if (!b) return;
  const [r, c] = parseSeat(b.dataset.seat);
  // 连按两下坐着的人 → 退回「还没排座位」
  const t = Date.now(), dbl = lastTap && lastTap.k === b.dataset.seat && t - lastTap.t < 450;
  lastTap = null;
  if (dbl && nameAt(r, c)) { rowOf(r)[c] = ''; return changed(); }
  if (sel) return dropOn(sel, r, c);
  if (nameAt(r, c)) { sel = { kind: 'seat', r, c }; lastTap = { k: b.dataset.seat, t }; render(); }
  else openPicker(r, c);
});
let lastTap = null;   // 上一下点到哪个座位（认连按两下用）

// 点空位：先问男生还是女生，再列出还没位子的人，点一个就坐进去
function openPicker(r, c, g = null) {
  const all = trayPeople();
  if (!all.length) { $('status').textContent = '✅ 全部人都排好了'; return; }
  const cnt = k => all.filter(n => gender(n) === k).length;
  const list = g === null ? [] : all.filter(n => g === 'all' || gender(n) === g || (g !== 'all' && !gender(n)));
  const roles = roleMap();
  let box = $('seat-picker');
  if (!box) {
    box = document.createElement('div');
    box.id = 'seat-picker';
    box.className = 'fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3';
    document.body.appendChild(box);
    box.addEventListener('click', e => {
      if (e.target === box || e.target.closest('[data-pick-close]')) return closePicker();
      const gb = e.target.closest('[data-pick-g]');
      if (gb) return openPicker(box.dataset.r === 'F' ? 'F' : +box.dataset.r, +box.dataset.c, gb.dataset.pickG);
      const pb = e.target.closest('[data-pick]');
      if (pb) {
        const rr = box.dataset.r === 'F' ? 'F' : +box.dataset.r;
        rowOf(rr)[+box.dataset.c] = pb.dataset.pick;
        closePicker();
        changed();
      }
    });
  }
  box.dataset.r = r; box.dataset.c = c;
  const where = r === 'F' ? `台前第 ${c + 1} 张` : `第 ${r + 1} 排第 ${c + 1} 个`;
  const tab = (k, label) => `<button data-pick-g="${k}" class="flex-1 py-2.5 rounded-xl border text-sm font-semibold ${g === k ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:border-indigo-400'}">${label}</button>`;
  box.innerHTML = `<div class="bg-white rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col p-4 shadow-xl">
    <div class="flex items-center mb-3"><div class="flex-1 font-semibold text-slate-800">🪑 ${where}：放谁？</div><button data-pick-close class="text-slate-400 hover:text-slate-700 px-2 text-lg">✕</button></div>
    <div class="flex gap-2 mb-3">${tab('F', `👩 女生（${cnt('F')}）`)}${tab('M', `👨 男生（${cnt('M')}）`)}${tab('all', `全部（${all.length}）`)}</div>
    <div class="flex-1 overflow-y-auto flex flex-wrap gap-1.5 content-start">
      ${g === null ? '<div class="text-sm text-slate-400 py-6 w-full text-center">先选男生还是女生</div>'
        : list.length ? list.map(n => chip(n, `data-pick="${esc(n)}"`, '', roles).replace('draggable="true"', '')).join('')
        : '<div class="text-sm text-slate-400 py-6 w-full text-center">没有人了</div>'}
    </div>
    ${g && g !== 'all' && list.some(n => !gender(n)) ? '<div class="text-[11px] text-slate-400 mt-2">没填男女的人两边都会出现</div>' : ''}
  </div>`;
}
function closePicker() { $('seat-picker')?.remove(); }
$('tray').addEventListener('click', e => {
  const b = e.target.closest('[data-tray]');
  if (!b) { if (sel?.kind === 'seat') unseat(sel); return; }
  sel = sel?.kind === 'tray' && sel.name === b.dataset.tray ? null : { kind: 'tray', name: b.dataset.tray };
  render();
});
$('absent').addEventListener('click', e => {
  const b = e.target.closest('[data-absent]'); if (!b) return;
  cur.absent = cur.absent.filter(n => n !== b.dataset.absent);
  changed();
});
$('act-cancel').addEventListener('click', () => { sel = null; render(); });
$('act-unseat').addEventListener('click', () => sel && unseat(sel));
$('act-absent').addEventListener('click', () => {
  if (!sel) return;
  const name = sel.kind === 'tray' ? sel.name : nameAt(sel.r, sel.c);
  if (sel.kind === 'seat') rowOf(sel.r)[sel.c] = '';
  if (!cur.absent.includes(name)) cur.absent.push(name);
  changed();
});
// 选了人之后点其他地方（不是座位、不是还没排的名单、不是上面那条动作栏）= 完成，取消选取；免得之后点到座位又换位
const KEEP_SEL = '[data-seat],[data-front],[data-clear-row],[data-tray],[data-absent],[data-pick],[data-pick-g],[data-pick-close],#action-bar,#tray,#seat-picker';
document.addEventListener('click', e => {
  if (!sel || e.target.closest(KEEP_SEL)) return;
  sel = null;
  render();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if ($('seat-picker')) return closePicker();
  if (sel) { sel = null; render(); }
});

// 这一场的披肩号码、声部
const selName = () => sel?.kind === 'seat' ? nameAt(sel.r, sel.c) : null;
// 填名单上的号码 = 照名单；删掉号码 = 这场不穿
$('act-cape').addEventListener('change', () => {
  const name = selName(); if (!name) return;
  const n = Number($('act-cape').value) || 0;
  cur.capes ||= {};
  if (n && n === memberOf(name)?.cape) delete cur.capes[name];
  else if (n) cur.capes[name] = n;
  else if (memberOf(name)?.cape) cur.capes[name] = 0;
  else delete cur.capes[name];
  changed(true);
});
$('act-cape-off').addEventListener('click', () => {
  const name = selName(); if (!name) return;
  cur.capes ||= {};
  cur.capes[name] = 0;
  changed(true);
});
$('act-cape-reset').addEventListener('click', () => {
  const name = selName(); if (!name) return;
  if (cur.capes) delete cur.capes[name];
  changed(true);
});
$('act-cape').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('act-voices').addEventListener('click', e => {
  const b = e.target.closest('[data-voice]'); const name = selName();
  if (!b || !name) return;
  cur.voices ||= {};
  if (b.dataset.voice === normVoice(memberOf(name)?.voice)) delete cur.voices[name];
  else cur.voices[name] = b.dataset.voice;
  changed(true);
});
$('capes').addEventListener('click', e => {
  const b = e.target.closest('[data-cape-fix]'); if (!b) return;
  cur.capes ||= {};
  cur.capes[b.dataset.capeFix] = Number(b.dataset.cape);
  changed();
});

// ───────── 加人：名单上的团员（没在来的也可以），或这一场来帮忙的 guest ─────────
function renderGuests() {
  if (!$('guest-group').options.length) $('guest-group').innerHTML = GUEST_GROUPS.map(g => `<option>${g}</option>`).join('');
  const extra = cur.extra.map(n => `<span class="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-lg border border-slate-300 bg-slate-50 text-sm">
      ${esc(n)}<span class="text-xs text-slate-500">另外加的团员</span>
      <button data-extra-del="${esc(n)}" class="px-1 text-slate-400 hover:text-red-600" title="拿掉">✕</button>
    </span>`);
  $('guest-list').innerHTML = extra.concat(cur.guests.map(g => {
    const where = cur.rows.findIndex(row => row.includes(g.name));
    return `<span class="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-lg border text-sm ${GUEST_STYLE}">
      ${esc(g.name)}<span class="text-xs text-violet-600">${esc(g.group)}${g.gender ? ` · ${g.gender === 'F' ? '女' : '男'}` : ''}${where >= 0 ? ` · 第${where + 1}排` : ''}</span>
      <button data-guest-del="${esc(g.name)}" class="px-1 text-slate-400 hover:text-red-600" title="拿掉">✕</button>
    </span>`;
  })).join('') || '<span class="text-xs text-slate-400">这一场没有另外加的人</span>';
}
// 名单上的团员：婚礼加进排歌页「来唱的团员」；主日有在来的本来就在「还没排」，没在来的记在 extra
async function addKnown(m) {
  const k = m.name.toLowerCase();
  cur.absent = cur.absent.filter(n => n.toLowerCase() !== k);
  if (seated().has(k)) return `${m.name} 已经有位子`;
  const w = W[cur.key];
  if (w) {
    if (!(w.singers || []).some(n => asMember(n).toLowerCase() === k)) {
      await updateDoc(doc(db, 'masses', cur.key), { singers: arrayUnion(m.name) });
      w.singers = [...(w.singers || []), m.name];
      return `${m.name} 加进来唱了（排歌页也加上了）`;
    }
  } else if (!active.has(k) && !cur.extra.some(n => n.toLowerCase() === k)) cur.extra.push(m.name);
  return `${m.name} 在「还没排座位」里`;
}
$('guest-form').addEventListener('submit', async e => {
  e.preventDefault();
  const names = splitNames($('guest-name').value);
  if (!names.length) return;
  const group = $('guest-group').value, g = $('guest-gender').value;
  const bad = names.filter(guestOf);
  if (bad.length) return alert(`「${bad.join('、')}」这一场已经加过了。`);
  const msgs = [];
  let fresh = 0;
  try {
    for (const n of names) {
      // 名字完全一样 = 团员；只是第一个字一样（Theresa Ng / Theresa 玉娥、Gabriel / Gabriel Chong）→ 问一下，不自己猜
      let m = memberOf(n) || findMember(n, members, true) || findMember(n, allM, true);
      if (!m) {
        const guess = findMember(n, members) || findMember(n, allM);
        if (guess && confirm(`「${n}」就是名单上的「${guess.name}」吗？

确定 = 同一个人
取消 = 不同人，当 guest 加进来`)) m = guess;
      }
      if (m) msgs.push(await addKnown(m));
      else { cur.guests.push({ name: n, group, gender: g }); fresh++; }
    }
  } catch (err) { console.error(err); alert('没加到，检查一下网络：' + (err.code || err.message)); }
  $('guest-name').value = '';
  changed();
  flash = $('status').textContent = [...msgs, fresh ? `加了 ${fresh} 位 guest` : ''].filter(Boolean).join('；') + '。点一下再点座位放进去';
});
$('guest-list').addEventListener('click', e => {
  const b = e.target.closest('[data-extra-del]'); if (!b) return;
  const k = b.dataset.extraDel.toLowerCase();
  cur.extra = cur.extra.filter(n => n.toLowerCase() !== k);
  cur.front = cur.front.map(n => n.toLowerCase() === k ? '' : n);
  cur.rows = cur.rows.map(row => row.map(n => n.toLowerCase() === k ? '' : n));
  changed();
});
$('guest-list').addEventListener('click', e => {
  const b = e.target.closest('[data-guest-del]'); if (!b) return;
  const name = b.dataset.guestDel;
  const seatedNow = seated().has(name.toLowerCase());
  if (seatedNow && !confirm(`拿掉 guest「${name}」？他的座位会空出来。`)) return;
  cur.guests = cur.guests.filter(g => g.name !== name);
  cur.rows = cur.rows.map(row => row.map(n => n === name ? '' : n));
  cur.front = cur.front.map(n => n === name ? '' : n);
  cur.absent = cur.absent.filter(n => n !== name);
  if (cur.capes) delete cur.capes[name];
  if (cur.voices) delete cur.voices[name];
  changed();
});

// 电脑拖拉
let dragFrom = null;
document.addEventListener('dragstart', e => {
  const seat = e.target.closest?.('[data-seat]'), tray = e.target.closest?.('[data-tray]');
  if (seat) { const [r, c] = parseSeat(seat.dataset.seat); dragFrom = { kind: 'seat', r, c }; }
  else if (tray) dragFrom = { kind: 'tray', name: tray.dataset.tray };
  else return;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', 'seat');
});
const dropTarget = e => e.target.closest?.('[data-seat]') || e.target.closest?.('#tray');
document.addEventListener('dragover', e => {
  const t = dragFrom && dropTarget(e); if (!t) return;
  e.preventDefault();
  document.querySelectorAll('.drop-over').forEach(x => x !== t && x.classList.remove('drop-over'));
  t.classList.add('drop-over');
});
document.addEventListener('drop', e => {
  const t = dragFrom && dropTarget(e); if (!t) return;
  e.preventDefault();
  t.classList.remove('drop-over');
  const from = dragFrom; dragFrom = null;
  if (t.id === 'tray') return unseat(from);
  const [r, c] = parseSeat(t.dataset.seat);
  dropOn(from, r, c);
});
document.addEventListener('dragend', () => { dragFrom = null; document.querySelectorAll('.drop-over').forEach(x => x.classList.remove('drop-over')); });

// 排数、每排几个位
$('btn-row-add').addEventListener('click', () => { cur.rows.push(Array(cur.cols).fill('')); changed(); });
$('btn-row-del').addEventListener('click', () => {
  if (!cur.rows.length) return;
  const n = cur.rows.at(-1).filter(Boolean).length;
  if (n && !confirm(`最后一排有 ${n} 个人，他们会回到「还没排座位」。确定？`)) return;
  cur.rows.pop(); changed();
});
$('cols').addEventListener('change', () => {
  const k = Number($('cols').value);
  const lost = cur.rows.flatMap(row => row.slice(k)).filter(Boolean);
  if (lost.length && !confirm(`${lost.join('、')} 会回到「还没排座位」。确定？`)) { $('cols').value = cur.cols; return; }
  cur.cols = k;
  cur.rows = cur.rows.map(row => row.slice(0, k).concat(Array(Math.max(0, k - row.length)).fill('')));
  changed();
});

$('date').addEventListener('change', () => { clearTimeout(saveTimer); openDate($('date').value); });
$('cape-on').addEventListener('change', () => { cur.noCapes = !$('cape-on').checked; changed(); });
$('rearrange').addEventListener('change', () => {
  const mode = $('rearrange').value;
  $('rearrange').value = '';
  if (mode === 'prev') {
    if (cur.rows.flat().some(Boolean) && !confirm(W[cur.key] ? '照来唱的名单重新排？现在这一页排的会被盖掉。' : '照上一次的座位重新排？现在这一页排的会被盖掉（「今天没来」和这一场改过的披肩、声部会保留）。')) return;
    autoFill();
    if (!cur.draftFrom) { alert('还没有更早的座位可以照。'); return; }
    const from = cur.draftFrom;
    changed();
    $('status').textContent = from === 'singers' ? '照来唱的名单排好了，保存中…' : `照 ${md(from)} 排好了，保存中…`;
  } else if (mode) {
    rearrange(mode);
    changed();
    $('status').textContent = (mode === 'voice' ? '按声部一排一排排好了' : '女生在前、男生在后排好了') + '，保存中…';
  }
});

// ───────── 复制文字 ─────────
$('btn-copy').addEventListener('click', async () => {
  const w = W[cur.key];
  const title = w ? `${timeText(w.time)} ${w.title}` : D[cur.date]?.title || litDay(cur.date).name;
  const roles = rolePeople(cur.key);
  const lines = [`*座位表 ${md(cur.date)} ${title}*`];
  if (roles.length) lines.push(roles.map(p => `${p.role}：${p.name}`).join('　'));
  lines.push('');
  if (cur.front.some(Boolean)) lines.push(`台前：${cur.front.filter(Boolean).map(label).join('、')}`);
  cur.rows.forEach((row, r) => { if (row.some(Boolean)) lines.push(`第${r + 1}排：${row.filter(Boolean).map(label).join('、')}`); });
  if (cur.absent.length) lines.push('', `没来：${cur.absent.join('、')}`);
  const gs = present().filter(guestOf);
  if (gs.length) lines.push('', `Guest ${gs.length} 位：${gs.map(n => `${n}（${guestOf(n).group}）`).join('、')}`);
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    $('status').textContent = '✓ 已复制，可以贴去 WA';
  } catch {
    prompt('复制下面的文字：', lines.join('\n'));
  }
});

// ───────── 第一次导入 ─────────
$('btn-seed').addEventListener('click', async () => {
  if (Object.keys(S).length) return;
  $('btn-seed').disabled = true;
  const seats = {};
  SEED.rows.forEach((row, r) => row.forEach((n, c) => { if (n) seats[`${r}-${c}`] = n; }));
  const data = { date: SEED.date, cols: SEED.cols, nRows: SEED.rows.length, seats, absent: [], updatedAt: new Date().toISOString() };
  try {
    await setDoc(doc(db, SEATINGS, SEED.date), data);
    S[SEED.date] = data;
    $('seed-box').classList.add('hidden');
    renderDates();
    openDate($('date').value);
  } catch (err) { console.error(err); alert('导入失败：' + (err.code || err.message)); $('btn-seed').disabled = false; }
});

load().catch(err => { console.error(err); $('status').textContent = '读取失败：' + (err.code || err.message); });

// 「📅 总览」带着现在这一天过去
window.sicNavDate = () => cur?.date;   // 菜单去别页时带着这个日期
