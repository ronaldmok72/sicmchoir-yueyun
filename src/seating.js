// 座位表：每个礼拜谁坐哪里、今天要拿哪些披肩
// Firestore seatings/{YYYY-MM-DD}：{ cols, nRows, seats: { 'r-c': 名字 }, absent: [名字] }
// 人从团员名单拿；指挥、琴师、乐手从职务表拿（他们在台前，不排座位）
import { collection, getDocs, doc, setDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { litDay } from "./liturgy.js";

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
  M: ['bg-slate-100 border-slate-300', '主旋律'], '': ['bg-white border-slate-300', '还不知道声部'],
};

let members = [], byName = {};
let D = {}, S = {};
let cur = null;      // { date, cols, rows: [[名字|'']], absent: [], draftFrom }
let sel = null;      // { kind: 'tray', name } | { kind: 'seat', r, c }
let saveTimer = null;

const memberOf = name => byName[String(name || '').toLowerCase()];
const splitNames = v => String(v || '').split(/[\/、,，&]+/).map(s => s.trim()).filter(Boolean);
// 女声 / 男声：先看声部，再看披肩号码（女声 1–30，男声 31 起）
function gender(name) {
  const m = memberOf(name);
  if (!m) return '';
  if (m.voice === 'S' || m.voice === 'A') return 'F';
  if (m.voice === 'T' || m.voice === 'B') return 'M';
  if (m.cape) return m.cape <= 30 ? 'F' : 'M';
  return '';
}
const capeOf = name => memberOf(name)?.cape || null;
const label = name => `${name}${capeOf(name) ? ` ${capeOf(name)}` : ''}`;

// ───────── 读取 ─────────
async function load() {
  $('status').textContent = '读取中…';
  const [ms, ds, ss] = await Promise.all([
    getDocs(collection(db, 'members')), getDocs(collection(db, 'duties')), getDocs(collection(db, SEATINGS)),
  ]);
  members = ms.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => m.active !== false);
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
  return { date, cols: s.cols || 5, rows, absent: [...(s.absent || [])] };
}

// 日期：排过的最近几次 + 接下来 6 个主日
function renderDates() {
  const set = new Set(Object.keys(S).sort().slice(-6));
  const s = new Date(TODAY + 'T12:00');
  s.setDate(s.getDate() + (7 - s.getDay()) % 7);
  for (let i = 0; i < 6; i++, s.setDate(s.getDate() + 7)) set.add(iso(s));
  const list = [...set].sort();
  const keep = $('date').value;
  $('date').innerHTML = list.map(d => `<option value="${d}">${md(d)} 星期${week(d)}　${esc(D[d]?.title || litDay(d).name)}${S[d] ? '　✓ 排好了' : ''}</option>`).join('');
  $('date').value = keep && list.includes(keep) ? keep : (list.find(d => d >= TODAY) || list.at(-1));
}

function openDate(date) {
  sel = null;
  if (S[date]) cur = fromDoc(date, S[date]);
  else {
    cur = { date, cols: 5, rows: [], absent: [] };
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
  const absent = cur.absent;
  if (prevDate) {
    const p = fromDoc(prevDate, S[prevDate]);
    cur = { date: cur.date, cols: p.cols, rows: p.rows, absent, draftFrom: prevDate };
  } else {
    cur = { date: cur.date, cols: 5, rows: Array.from({ length: 5 }, () => Array(5).fill('')), absent, draftFrom: null };
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
  const v = memberOf(name)?.voice || '';
  return `<button ${attrs} draggable="true" class="px-2 py-1 rounded-lg border text-sm ${VOICE_STYLE[v][0]} ${extra}">${esc(name)}${capeOf(name) ? `<span class="text-slate-400 text-xs"> ${capeOf(name)}</span>` : ''}</button>`;
}

function renderGrid() {
  const cant = cantors(cur.date);
  $('grid').innerHTML = cur.rows.map((row, r) => `
    <div class="flex items-stretch gap-1">
      <div class="w-4 shrink-0 text-[11px] text-slate-400 flex items-center justify-center" title="第${r + 1}排">${r + 1}</div>
      ${row.map((n, c) => {
        const on = sel?.kind === 'seat' && sel.r === r && sel.c === c;
        const v = memberOf(n)?.voice || '';
        return `<button data-seat="${r}-${c}" draggable="${n ? 'true' : 'false'}" class="seat relative flex-1 min-w-0 h-12 rounded-lg border text-center px-0.5 ${n ? VOICE_STYLE[v][0] : 'border-dashed border-slate-200 bg-slate-50'} ${on ? 'ring-2 ring-indigo-500' : ''} ${sel && !on ? 'hover:border-indigo-400' : ''}">
          ${n ? `<span class="block truncate text-[12px] tracking-tight leading-tight">${esc(n)}</span><span class="block text-[11px] text-slate-400 leading-tight">${capeOf(n) ? `#${capeOf(n)}` : '没号码'}</span>` : ''}
          ${n && cant.has(n.toLowerCase()) ? '<span class="absolute -top-1.5 -right-1 px-1 rounded bg-emerald-600 text-white text-[10px]">答</span>' : ''}
        </button>`;
      }).join('')}
    </div>`).join('') || '<div class="text-sm text-slate-400 text-center py-4">还没有座位，按「＋ 一排」</div>';
  $('legend').innerHTML = ['S', 'A', 'T', 'B', 'M', ''].map(k => `<span class="flex items-center gap-1"><span class="w-3 h-3 rounded border ${VOICE_STYLE[k][0]}"></span>${VOICE_STYLE[k][1]}</span>`).join('');
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
  const people = [...cur.rows.flat().filter(Boolean), ...stagePeople(cur.date).map(p => p.name)];
  const uniq = [...new Map(people.map(n => [n.toLowerCase(), n])).values()];
  const withCape = uniq.filter(capeOf).sort((a, b) => capeOf(a) - capeOf(b));
  const none = uniq.filter(n => !capeOf(n));
  const f = withCape.filter(n => capeOf(n) <= 30).length;
  const byCape = {};
  withCape.forEach(n => (byCape[capeOf(n)] ||= []).push(n));
  const dup = Object.entries(byCape).filter(([, l]) => l.length > 1);
  $('capes').innerHTML = `
    <div>要拿 <b>${withCape.length}</b> 件：女声 ${f} 件、男声 ${withCape.length - f} 件</div>
    <div class="flex flex-wrap gap-1">${withCape.map(n => `<span class="px-1.5 py-0.5 rounded bg-slate-100 text-xs"><b>${capeOf(n)}</b> ${esc(n)}</span>`).join('')}</div>
    ${none.length ? `<div class="text-amber-700">⏳ 还没有披肩号码：${none.map(esc).join('、')}　<a href="members.html" class="underline text-xs">去团员名单填</a></div>` : ''}
    ${dup.length ? `<div class="text-red-600">🔴 号码重复：${dup.map(([c, l]) => `#${c} ${l.map(esc).join('、')}`).join('；')}</div>` : ''}`;
}

function renderAction() {
  $('action-bar').classList.toggle('hidden', !sel);
  if (!sel) return;
  const name = sel.kind === 'tray' ? sel.name : cur.rows[sel.r][sel.c];
  $('action-text').textContent = sel.kind === 'tray' ? `${name}：点一个座位放进去` : `${name}：点另一个座位对调`;
  $('act-unseat').classList.toggle('hidden', sel.kind !== 'seat');
}

// ───────── 改动 ─────────
function changed() {
  delete cur.draftFrom;
  sel = null;
  render();
  clearTimeout(saveTimer);
  $('status').textContent = '保存中…';
  saveTimer = setTimeout(save, 500);
}
async function save() {
  const seats = {};
  cur.rows.forEach((row, r) => row.forEach((n, c) => { if (n) seats[`${r}-${c}`] = n; }));
  const data = { date: cur.date, cols: cur.cols, nRows: cur.rows.length, seats, absent: cur.absent, updatedAt: new Date().toISOString() };
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
$('btn-auto').addEventListener('click', () => {
  if (cur.rows.flat().some(Boolean) && !confirm('照上一次的座位重新排？现在这一页排的会被盖掉（「今天没来」的会保留）。')) return;
  autoFill();
  if (!cur.draftFrom) { alert('还没有更早的座位可以照。'); return; }
  const from = cur.draftFrom;
  changed();
  $('status').textContent = `照 ${md(from)} 排好了，保存中…`;
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
