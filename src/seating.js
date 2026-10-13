// 座位表：每个礼拜谁坐哪里、今天要拿哪些披肩
// Firestore seatings/{YYYY-MM-DD}：{ cols, nRows, seats: { 'r-c': 名字 }, absent: [名字], capes: { 名字: 这场穿的号码 }, voices: { 名字: 这场唱的声部 } }
// 人从团员名单拿；指挥、琴师、乐手从职务表拿（他们在台前，不排座位）
import { collection, getDocs, doc, setDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { litDay } from "./liturgy.js";
import { genderOf, VOICE_SHORT, normVoice } from "./people.js";

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

// 台前的职务（不排座位）
const STAGE = [['conductor', '指挥'], ['piano', '钢琴'], ['organ', '风琴'], ['guitar', '吉他'], ['drums', '鼓手']];
const VOICE_STYLE = {
  S: ['bg-rose-50 border-rose-200', '女高'], A: ['bg-amber-50 border-amber-200', '女低'],
  T: ['bg-sky-50 border-sky-200', '男高'], B: ['bg-indigo-50 border-indigo-200', '男低'],
  '': ['bg-white border-slate-300', '主旋律'],
};

let members = [], byName = {}, allCapes = [];   // allCapes：名单上所有人的号码（没在来的也算，披肩还在）
let D = {}, S = {};
let cur = null;      // { date, cols, rows: [[名字|'']], absent: [], capes: {}, voices: {}, draftFrom }
let sel = null;      // { kind: 'tray', name } | { kind: 'seat', r, c }
let saveTimer = null;

const memberOf = name => byName[String(name || '').toLowerCase()];
const splitNames = v => String(v || '').split(/[\/、,，&]+/).map(s => s.trim()).filter(Boolean);
// 这一场唱的声部、穿的披肩：座位表这一天改过的先算，不然照团员名单
const voiceOf = name => normVoice(cur?.voices?.[name] ?? memberOf(name)?.voice);
const voiceChanged = name => !!cur?.voices && name in cur.voices;
const capeOf = name => cur?.capes?.[name] || memberOf(name)?.cape || null;
// 女声 F／男声 M：名单写了照写的；不然看这场的声部；再不然看披肩号码
const gender = name => genderOf(memberOf(name), voiceOf(name));
const label = name => `${name}${capeOf(name) ? ` ${capeOf(name)}` : ''}`;

// ───────── 读取 ─────────
async function load() {
  $('status').textContent = '读取中…';
  const [ms, ds, ss] = await Promise.all([
    getDocs(collection(db, 'members')), getDocs(collection(db, 'duties')), getDocs(collection(db, SEATINGS)),
  ]);
  const all = ms.docs.map(d => ({ id: d.id, ...d.data() }));
  members = all.filter(m => m.active !== false);
  allCapes = all.filter(m => m.cape).map(m => ({ name: m.name, cape: m.cape }));
  byName = Object.fromEntries(members.map(m => [m.name.toLowerCase(), m]));
  D = Object.fromEntries(ds.docs.map(d => [d.id, d.data()]));
  S = Object.fromEntries(ss.docs.map(d => [d.id, d.data()]));
  $('status').textContent = '';
  $('seed-box').classList.toggle('hidden', Object.keys(S).length > 0);
  renderDates();
  openDate($('date').value);
}

function fromDoc(date, s) {
  const rows = Array.from({ length: s.nRows || 0 }, (_, r) => Array.from({ length: s.cols || 5 }, (_, c) => s.seats?.[`${r}-${c}`] || ''));
  return { date, cols: s.cols || 5, rows, absent: [...(s.absent || [])], capes: { ...(s.capes || {}) }, voices: { ...(s.voices || {}) } };
}

// 日期：排过的最近几次 + 接下来 6 个主日
function renderDates() {
  const set = new Set(Object.keys(S).sort().slice(-6));
  const s = new Date(TODAY + 'T12:00');
  s.setDate(s.getDate() + (7 - s.getDay()) % 7);
  for (let i = 0; i < 6; i++, s.setDate(s.getDate() + 7)) set.add(iso(s));
  // 从「这台弥撒」总览点进来：?d=2026-10-18
  const want = (new URLSearchParams(location.search).get('d') || '').match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  if (want) set.add(want);
  const list = [...set].sort();
  const keep = $('date').value || want;
  $('date').innerHTML = list.map(d => `<option value="${d}">${md(d)} 星期${week(d)}　${esc(D[d]?.title || litDay(d).name)}${S[d] ? '　✓ 排好了' : ''}</option>`).join('');
  $('date').value = keep && list.includes(keep) ? keep : (list.find(d => d >= TODAY) || list.at(-1));
}

function openDate(date) {
  sel = null;
  if (S[date]) cur = fromDoc(date, S[date]);
  else {
    cur = { date, cols: 5, rows: [], absent: [], capes: {}, voices: {} };
    autoFill();             // 还没排过：先照上一次排好，当草稿
  }
  render();
}

// ───────── 谁在哪里 ─────────
function stagePeople(date) {
  const d = D[date] || {};
  return STAGE.flatMap(([k, l]) => splitNames(d[k]).map(name => ({ name, role: l })));
}
const cantors = date => new Set(splitNames(D[date]?.cantor).map(n => n.toLowerCase()));
function seated() { return new Set(cur.rows.flat().filter(Boolean).map(n => n.toLowerCase())); }
function trayPeople() {
  const taken = seated();
  const stage = new Set(stagePeople(cur.date).map(p => p.name.toLowerCase()));
  const absent = new Set(cur.absent.map(n => n.toLowerCase()));
  const order = { F: 0, M: 1, '': 2 };
  return members.map(m => m.name)
    .filter(n => !taken.has(n.toLowerCase()) && !stage.has(n.toLowerCase()) && !absent.has(n.toLowerCase()))
    .sort((a, b) => order[gender(a)] - order[gender(b)] || (capeOf(a) || 999) - (capeOf(b) || 999) || a.localeCompare(b));
}

// 照上一次排：没来的、在台前的拿掉；还没位子的女声从前面补，男声从后面补
function autoFill() {
  const prevDate = Object.keys(S).filter(d => d < cur.date).sort().at(-1) || Object.keys(S).filter(d => d !== cur.date).sort().at(-1);
  const { absent, capes, voices } = cur;   // 这一天自己改过的披肩、声部留着，不照上一次
  if (prevDate) {
    const p = fromDoc(prevDate, S[prevDate]);
    cur = { date: cur.date, cols: p.cols, rows: p.rows, absent, capes, voices, draftFrom: prevDate };
  } else {
    cur = { date: cur.date, cols: 5, rows: Array.from({ length: 5 }, () => Array(5).fill('')), absent, capes, voices, draftFrom: null };
  }
  const stage = new Set(stagePeople(cur.date).map(p => p.name.toLowerCase()));
  const off = new Set(absent.map(n => n.toLowerCase()));
  const seen = new Set();
  cur.rows = cur.rows.map(row => row.map(n => {
    const k = n.toLowerCase();
    if (!n || !memberOf(n) || stage.has(k) || off.has(k) || seen.has(k)) return '';
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
  const people = [...cur.rows.flat().filter(Boolean), ...stagePeople(cur.date).map(p => p.name)];
  return [...new Map(people.map(n => [n.toLowerCase(), n])).values()];
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

// ───────── 画面 ─────────
function render() {
  const stage = stagePeople(cur.date);
  const cantor = splitNames(D[cur.date]?.cantor);
  $('stage').innerHTML = stage.length || cantor.length
    ? `${stage.map(p => `${p.role}：<b>${esc(label(p.name))}</b>`).join('　')}${cantor.length ? `　答唱咏：<b>${esc(cantor.join('、'))}</b>` : ''}<span class="text-slate-400 text-xs">　（台前的人不排座位，照<a href="duties.html" class="underline">职务表</a>）</span>`
    : `<span class="text-slate-400 text-xs">职务表这天还没排，指挥和琴师也会出现在「还没排座位」里</span>`;
  $('cols').value = cur.cols;
  renderGrid();
  renderTray();
  renderCapes();
  renderAction();
  if (cur.draftFrom !== undefined && !S[cur.date]) {
    $('status').textContent = cur.draftFrom ? `照 ${md(cur.draftFrom)} 排好了（草稿，动一下就自动保存）` : '还没有旧座位，从下面一个一个放';
  }
}

function chip(name, attrs, extra = '') {
  const v = voiceOf(name);
  return `<button ${attrs} draggable="true" class="px-2 py-1 rounded-lg border text-sm ${VOICE_STYLE[v][0]} ${extra}">${esc(name)}${capeOf(name) ? `<span class="text-slate-400 text-xs"> ${capeOf(name)}</span>` : ''}</button>`;
}

function renderGrid() {
  const cant = cantors(cur.date);
  const dup = new Set(dupCapes().map(([c]) => c));
  $('grid').innerHTML = cur.rows.map((row, r) => `
    <div class="flex items-stretch gap-1">
      <div class="w-4 shrink-0 text-[11px] text-slate-400 flex items-center justify-center" title="第${r + 1}排">${r + 1}</div>
      ${row.map((n, c) => {
        const on = sel?.kind === 'seat' && sel.r === r && sel.c === c;
        const v = voiceOf(n), cape = capeOf(n);
        return `<button data-seat="${r}-${c}" draggable="${n ? 'true' : 'false'}" class="seat relative flex-1 min-w-0 h-12 rounded-lg border text-center px-0.5 ${n ? VOICE_STYLE[v][0] : 'border-dashed border-slate-200 bg-slate-50'} ${on ? 'ring-2 ring-indigo-500' : ''} ${sel && !on ? 'hover:border-indigo-400' : ''}">
          ${n ? `<span class="block truncate text-[12px] tracking-tight leading-tight">${esc(n)}</span><span class="block text-[11px] leading-tight ${dup.has(cape) ? 'text-red-600 font-semibold' : 'text-slate-400'}">${cape ? `#${cape}` : '没号码'}</span>` : ''}
          ${n && voiceChanged(n) ? `<span class="absolute -top-1.5 -left-1 px-1 rounded bg-slate-700 text-white text-[10px]">${v || '主'}</span>` : ''}
          ${n && cant.has(n.toLowerCase()) ? '<span class="absolute -top-1.5 -right-1 px-1 rounded bg-emerald-600 text-white text-[10px]">答</span>' : ''}
        </button>`;
      }).join('')}
    </div>`).join('') || '<div class="text-sm text-slate-400 text-center py-4">还没有座位，按「＋ 一排」</div>';
  $('legend').innerHTML = ['S', 'A', 'T', 'B', ''].map(k => `<span class="flex items-center gap-1"><span class="w-3 h-3 rounded border ${VOICE_STYLE[k][0]}"></span>${VOICE_STYLE[k][1]}</span>`).join('');
}

function renderTray() {
  const t = trayPeople();
  $('tray-count').textContent = t.length ? `（${t.length}）` : '';
  $('tray').innerHTML = t.map(n => chip(n, `data-tray="${esc(n)}"`, sel?.kind === 'tray' && sel.name === n ? 'ring-2 ring-indigo-500' : '')).join('')
    || '<span class="text-xs text-slate-400 self-center">✅ 全部排好了</span>';
  $('absent-box').classList.toggle('hidden', !cur.absent.length);
  $('absent').innerHTML = cur.absent.map(n => `<button data-absent="${esc(n)}" class="px-2 py-1 rounded-lg border border-slate-200 bg-slate-100 text-slate-400 text-sm line-through">${esc(n)}</button>`).join('');
}

// 今天要拿的披肩：坐着的 + 台前的
function renderCapes() {
  const uniq = present();
  const withCape = uniq.filter(capeOf).sort((a, b) => capeOf(a) - capeOf(b));
  const none = uniq.filter(n => !capeOf(n));
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
    ${uniq.some(n => cur.capes?.[n]) ? '<div class="text-xs text-slate-400">黄色的 = 这一场换了号码（只算这一场，名单不会变）</div>' : ''}
    ${none.length ? `<div class="text-amber-700">⏳ 还没有披肩号码：${none.map(esc).join('、')}　<span class="text-xs">点座位上的人可以填这一场穿几号，或者<a href="members.html" class="underline">去团员名单填</a></span></div>` : ''}
    ${fixes.length ? `<div class="text-red-600 space-y-1"><div>🔴 号码重复了（点一下就帮他换成今天没人穿的号码）</div>${fixes.join('')}</div>` : ''}`;
}

function renderAction() {
  $('action-bar').classList.toggle('hidden', !sel);
  if (!sel) return;
  const name = sel.kind === 'tray' ? sel.name : cur.rows[sel.r][sel.c];
  $('action-text').textContent = sel.kind === 'tray' ? `${name}：点一个座位放进去` : `${name}：点另一个座位对调`;
  $('act-unseat').classList.toggle('hidden', sel.kind !== 'seat');
  // 坐好之后：这一场穿几号、唱什么声部（只改这一场）
  $('act-edit').classList.toggle('hidden', sel.kind !== 'seat');
  if (sel.kind !== 'seat') return;
  const m = memberOf(name), main = normVoice(m?.voice);
  $('act-cape').value = capeOf(name) || '';
  $('act-cape-hint').textContent = cur.capes?.[name] ? (m?.cape ? `名单上是 #${m.cape}` : '名单上没号码') : (m?.cape ? '照名单' : '');
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
  const data = { date: cur.date, cols: cur.cols, nRows: cur.rows.length, seats, absent: cur.absent, capes: cur.capes || {}, voices: cur.voices || {}, updatedAt: new Date().toISOString() };
  try {
    await setDoc(doc(db, SEATINGS, cur.date), data);
    const first = !S[cur.date];
    S[cur.date] = data;
    if (first) { renderDates(); $('seed-box').classList.add('hidden'); }
    $('status').textContent = `✓ 已保存 ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (err) {
    console.error(err);
    $('status').textContent = '保存失败：' + (err.code || err.message);
  }
}

// 把「选中的」放到座位 r,c：从还没排的来就放进去（原本坐那里的回去）；从座位来就对调
function dropOn(from, r, c) {
  if (from.kind === 'tray') cur.rows[r][c] = from.name;
  else {
    if (from.r === r && from.c === c) { sel = null; render(); return; }
    [cur.rows[r][c], cur.rows[from.r][from.c]] = [cur.rows[from.r][from.c], cur.rows[r][c]];
  }
  changed();
}
function unseat(from) {
  if (from.kind === 'seat') { cur.rows[from.r][from.c] = ''; changed(); }
}

$('grid').addEventListener('click', e => {
  const b = e.target.closest('[data-seat]'); if (!b) return;
  const [r, c] = b.dataset.seat.split('-').map(Number);
  if (sel) return dropOn(sel, r, c);
  if (cur.rows[r][c]) { sel = { kind: 'seat', r, c }; render(); }
});
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
  const name = sel.kind === 'tray' ? sel.name : cur.rows[sel.r][sel.c];
  if (sel.kind === 'seat') cur.rows[sel.r][sel.c] = '';
  if (!cur.absent.includes(name)) cur.absent.push(name);
  changed();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sel) { sel = null; render(); } });

// 这一场的披肩号码、声部
const selName = () => sel?.kind === 'seat' ? cur.rows[sel.r][sel.c] : null;
$('act-cape').addEventListener('change', () => {
  const name = selName(); if (!name) return;
  const n = Number($('act-cape').value) || 0;
  cur.capes ||= {};
  if (!n || n === memberOf(name)?.cape) delete cur.capes[name];
  else cur.capes[name] = n;
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

// 电脑拖拉
let dragFrom = null;
document.addEventListener('dragstart', e => {
  const seat = e.target.closest?.('[data-seat]'), tray = e.target.closest?.('[data-tray]');
  if (seat) { const [r, c] = seat.dataset.seat.split('-').map(Number); dragFrom = { kind: 'seat', r, c }; }
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
  const [r, c] = t.dataset.seat.split('-').map(Number);
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
$('rearrange').addEventListener('change', () => {
  const mode = $('rearrange').value;
  $('rearrange').value = '';
  if (mode === 'prev') {
    if (cur.rows.flat().some(Boolean) && !confirm('照上一次的座位重新排？现在这一页排的会被盖掉（「今天没来」和这一场改过的披肩、声部会保留）。')) return;
    autoFill();
    if (!cur.draftFrom) { alert('还没有更早的座位可以照。'); return; }
    const from = cur.draftFrom;
    changed();
    $('status').textContent = `照 ${md(from)} 排好了，保存中…`;
  } else if (mode) {
    rearrange(mode);
    changed();
    $('status').textContent = (mode === 'voice' ? '按声部一排一排排好了' : '女生在前、男生在后排好了') + '，保存中…';
  }
});

// ───────── 复制文字 ─────────
$('btn-copy').addEventListener('click', async () => {
  const title = D[cur.date]?.title || litDay(cur.date).name;
  const stage = stagePeople(cur.date);
  const cant = splitNames(D[cur.date]?.cantor);
  const lines = [`*座位表 ${md(cur.date)} ${title}*`];
  if (stage.length) lines.push(stage.map(p => `${p.role}：${label(p.name)}`).join('　'));
  if (cant.length) lines.push(`答唱咏：${cant.join('、')}`);
  lines.push('');
  cur.rows.forEach((row, r) => { if (row.some(Boolean)) lines.push(`第${r + 1}排：${row.filter(Boolean).map(label).join('、')}`); });
  if (cur.absent.length) lines.push('', `没来：${cur.absent.join('、')}`);
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
document.querySelector('[data-day-link]')?.addEventListener('click', e => { const d = cur?.date; if (d) e.currentTarget.href = `day.html?d=${d}`; });
