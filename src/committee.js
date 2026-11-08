// 执委专区：每一场执委会议的议程、完整会议记录、重点（待办＋要报告的进展）
// 资料：Firestore meetings/{日期}，一场一份。只有密码管理开了「执委专区」的人看得到、改得到（规则要贴新的）
// 板块：TABS 一个一个排；以后要加新的板块（例如财政、资产），在 TABS 加一个 { key, label, render } 就好
import { collection, doc, setDoc, updateDoc, deleteDoc, deleteField, writeBatch, FieldPath } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, getDocs, getDoc } from "./firebase.js";
import { docx } from "./docx.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLL = 'meetings';
const view = $('view');

// 开新会议时先排好的议程（照以前的会议记录）
const AGENDA = ['开会祷', '核准上次会议记录', '上次会议待办跟进', '活动检讨（礼仪、新歌、各项事务）', '近期活动筹备',
  '组织与行政（新团员、人事）', '资产管理', '财政报告', '总务报告', '其他事项', '下次会议日期', '闭会祷'];

let MEETINGS = [];          // 新的在前
let tab = 'list', openId = null, editing = null;
let year = 'all', q = '';
let todoShow = 'open', todoWho = '';
let reportYear = null;
let YEARS = {};             // '2026' → 那一年的活动表
let PEOPLE = {};            // 团员id → { name, cname, noCname }（出席打卡、各人汇报显示中文名）
let yearEditing = null;     // 正在改哪一年的活动表
let ROSTER = {};            // 历届执委：roster_2016 → { term, start, text（一行一个岗位）, notes, by, updatedAt, history }
let rosterView = 'grid', rosterEdit = null, rosterHist = null, rosterQ = '';
let ITEMS = [], FIN = [];   // 团室物品、财政记录
let boardEdit = null, boardHist = null, itemQ = '', finYear = 'all';
let aiMode = null;          // 贴会议记录让 AI 整理：{ target: 要盖过去的那一场 id 或 null }
let aiReady = null;         // 服务器的 AI 钥匙放好了没有（问过一次就记住）
const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

const TABS = [
  { key: 'list', label: '📄 会议记录', render: renderList },
  { key: 'todo', label: '✅ 待办', render: renderTodos },
  { key: 'report', label: '📈 年度进展', render: renderReport },
  { key: 'roster', label: '🏛️ 历届执委', render: renderRoster },
  { key: 'items', label: '📦 团室物品', render: renderItems },
  { key: 'fin', label: '💰 财政记录', render: renderFin },
];

// ───────── 小工具 ─────────
const WD = '日一二三四五六';
const ymd = iso => (iso || '').split('-').map(Number);
const fmtDate = iso => { const [y, m, d] = ymd(iso); return y ? `${y}年${m}月${d}日（${WD[new Date(y, m - 1, d).getDay()]}）` : ''; };
const md = iso => { const [, m, d] = ymd(iso); return m ? `${m}月${d}日` : ''; };
const pad = n => String(n).padStart(2, '0');
const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
const titleOf = m => m.title || (m.no ? `${m.date.slice(0, 4)}年第${m.no}次执委会议` : `${m.date.slice(0, 4)}年执委会议`);
const byId = id => MEETINGS.find(m => m.id === id);
const asc = () => MEETINGS.slice().sort((a, b) => a.date.localeCompare(b.date));
const prevOf = m => asc().filter(x => x.date < m.date).pop() || null;

function norm(m) {
  const s = m.summary || {};
  return {
    ...m, date: m.date || m.id, agenda: m.agenda || [],
    summary: { points: s.points || [], todos: (s.todos || []).map(t => ({ ...t })), reports: s.reports || [], events: s.events || [] },
  };
}
// 存进资料库的样子（不带 id）
function clean(m) {
  const { id, ...rest } = m;
  return { ...rest, updatedAt: new Date().toISOString() };
}

function inline(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" class="text-indigo-600 underline break-all">$1</a>');
}
// 完整会议记录：# 标题、### 小标题、- 项目（前面空两格 = 往里缩），**粗体**
function rich(text) {
  return String(text || '').split('\n').map(raw => {
    const ind = raw.match(/^\s*/)[0].replace(/\t/g, '  ').length >= 2;
    const l = raw.trim();
    if (!l) return '<div class="h-2"></div>';
    let x;
    if ((x = l.match(/^#{1,2}\s+(.*)/))) return `<div class="mt-4 mb-1 font-semibold text-slate-900">${inline(x[1])}</div>`;
    if ((x = l.match(/^#{3,}\s+(.*)/))) return `<div class="mt-3 mb-0.5 font-semibold text-indigo-800">${inline(x[1])}</div>`;
    if ((x = l.match(/^[-•*]\s+(.*)/))) return `<div class="flex gap-1.5 ${ind ? 'ml-5' : ''}"><span class="text-slate-400">•</span><div class="min-w-0">${inline(x[1])}</div></div>`;
    return `<div class="${ind ? 'ml-5' : ''}">${inline(l)}</div>`;
  }).join('');
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = document.createElement('textarea');
    t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  }
  alert('已复制，可以贴到 WhatsApp 或 Word。');
}

// merge：只改表格里有的栏，别人打的卡、写的汇报（checkins、contribs）留着
const save = (id, m, merge = false) => window.sicStaff.withAuth(() => merge ? setDoc(doc(db, COLL, id), clean(m), { merge: true }) : setDoc(doc(db, COLL, id), clean(m)));
const fail = err => alert('保存失败：' + (err.code === 'permission-denied'
  ? '没有权限。请 Ronald 在「密码管理」帮你开「执委专区」，或 Firebase 规则还没贴新的。' : err.message));

// ───────── 读资料 ─────────
// 同一个 meetings 里还放每一年的「活动表」（id = year_2026，kind: 'year'），年尾交堂区报告用
async function load() {
  await window.sicStaff?.ensureAuth?.();
  const [s, ms] = await Promise.all([getDocs(collection(db, COLL)), getDocs(collection(db, 'members')).catch(() => null)]);
  const docs = s.docs.map(d => ({ id: d.id, ...d.data() }));
  if (ms) PEOPLE = Object.fromEntries(ms.docs.map(d => { const x = d.data(); return [d.id, { name: x.name || '', cname: x.cname || '', noCname: !!x.noCname }]; }));
  YEARS = Object.fromEntries(docs.filter(d => d.kind === 'year').map(d => [String(d.year), d]));
  ROSTER = Object.fromEntries(docs.filter(d => d.kind === 'roster').map(d => [d.id, d]));
  ITEMS = docs.filter(d => d.kind === 'item');
  FIN = docs.filter(d => d.kind === 'fin');
  MEETINGS = docs.filter(d => !['year', 'roster', 'item', 'fin'].includes(d.kind)).map(norm).sort((a, b) => b.date.localeCompare(a.date));
}

// ───────── 画面 ─────────
function render() {
  const open = MEETINGS.reduce((n, m) => n + m.summary.todos.filter(t => !t.done).length, 0);
  $('tabs').innerHTML = TABS.map(t => `<button data-tab="${t.key}" class="shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium border ${t.key === tab && !editing ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}">${t.label}${t.key === 'todo' && open ? ` <span class="ml-0.5 text-xs opacity-80">${open}</span>` : ''}</button>`).join('');
  if (editing) return renderEdit();
  if (yearEditing) return renderYearEdit();
  if (aiMode) return renderAi();
  if (tab === 'list' && openId) {
    const m = byId(openId);
    if (m) return renderDetail(m);
    openId = null;
  }
  TABS.find(t => t.key === tab).render();
}
function go(t, id = null) {
  tab = t; openId = id; editing = null; yearEditing = null; aiMode = null; rosterEdit = null; rosterHist = null; boardEdit = null; boardHist = null;
  const u = new URL(location.href);
  u.searchParams.delete('m'); u.searchParams.delete('tab');
  if (id) u.searchParams.set('m', id); else if (t !== 'list') u.searchParams.set('tab', t);
  window.history.replaceState(null, '', u);
  render();
  window.scrollTo(0, 0);
  if (id) refreshOne(id);
}

// ───────── 出席打卡、各人汇报 ─────────
// 每个人只写自己那一格（checkins.团员id、contribs.团员id），大家同时按也不会互相盖掉
const meNow = () => window.sicStaff?.me?.();
const nameOf = (id, fallback = '') => PEOPLE[id]?.cname || PEOPLE[id]?.name || fallback;
const byTime = o => Object.entries(o || {}).sort((a, b) => String(a[1].at).localeCompare(String(b[1].at)));
const checkinNames = m => byTime(m.checkins).map(([id, c]) => nameOf(id, c.n));
const contribList = m => byTime(m.contribs).filter(([, c]) => c.text).map(([id, c]) => ({ id, n: nameOf(id, c.n), text: c.text, at: c.at }));

// 打开一场会议时再拿一次最新的（别人刚打卡、刚写汇报）
async function refreshOne(id) {
  try {
    const d = await getDoc(doc(db, COLL, id));
    if (!d.exists()) return;
    const fresh = norm({ id, ...d.data() }), cur = byId(id);
    const same = cur && ['checkins', 'contribs', 'draft', 'updatedAt'].every(k => JSON.stringify(cur[k]) === JSON.stringify(fresh[k]));
    MEETINGS = MEETINGS.map(x => x.id === id ? fresh : x);
    if (!same && openId === id && !editing && !aiMode && !yearEditing) {
      const keep = $('my-contrib')?.value;   // 正在打的字别弄丢
      render();
      if (keep !== undefined && $('my-contrib')) $('my-contrib').value = keep;
    }
  } catch { /* 没网络就先用手上的 */ }
}

// 写自己那一格
async function writeMine(m, field, val) {
  const me = meNow();
  if (!me) { window.sicLogin?.open(); throw new Error('要先用电话登录'); }
  await window.sicStaff.withAuth(() => updateDoc(doc(db, COLL, m.id), new FieldPath(field, me.id), val === null ? deleteField() : val));
  m[field] = { ...(m[field] || {}) };
  if (val === null) delete m[field][me.id]; else m[field][me.id] = val;
}

// 打卡前：还没填中文名的先问一次（存进他的团员资料）
async function askCname(me) {
  const p = PEOPLE[me.id];
  if (!p || p.cname || p.noCname) return;
  const v = (prompt('请输入你的中文全名（会议记录、出席名单用）。\n真的没有中文名就按「取消」。') || '').replace(/\s+/g, '');
  const patch = v ? { cname: v } : { noCname: true };
  Object.assign(p, patch);
  try { await window.sicStaff.withAuth(() => updateDoc(doc(db, 'members', me.id), { ...patch, updatedAt: new Date().toISOString() })); }
  catch { /* 规则还没贴新的：这次先照用，下次再问 */ }
}

function togetherBox(m) {
  const me = meNow(), mine = me && m.checkins?.[me.id];
  const names = checkinNames(m), list = contribList(m);
  const myText = (me && m.contribs?.[me.id]?.text) || '';
  if (m.status !== 'agenda' && !names.length && !list.length) return '';
  const others = list.filter(c => c.id !== me?.id);
  return `
    <section class="mt-3 bg-white rounded-2xl border border-slate-200 p-4">
      <div class="flex items-center gap-2">
        <div class="font-semibold text-sm flex-1">✋ 出席打卡 <span class="font-normal text-xs text-slate-400">${names.length} 人</span></div>
        ${m.status === 'agenda' ? (!me ? '<button data-act="login" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">用电话登录再打卡</button>'
          : mine ? '<button data-act="uncheckin" class="text-xs text-slate-400 hover:text-red-500">取消打卡</button>'
          : '<button data-act="checkin" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold">✋ 我出席了</button>') : ''}
      </div>
      <div class="mt-2 text-sm ${names.length ? 'text-slate-700' : 'text-slate-400'}">${names.length ? names.map(esc).join('、') : '开会时每个人自己按「我出席了」，名字就会出现在这里，也会自动放进会议记录的出席名单。'}</div>
    </section>

    <section class="mt-3 bg-white rounded-2xl border border-slate-200 p-4">
      <div class="font-semibold text-sm">🗣️ 各人汇报 <span class="font-normal text-xs text-slate-400">${list.length} 人写了</span></div>
      ${m.status === 'agenda' ? (me ? `
        <div class="mt-2 text-xs text-slate-500">你要报告的事写在这里（例如你负责的活动、财政、礼仪），只有你能改你这一格。写完按保存，最后会一起整理进会议记录。</div>
        <textarea id="my-contrib" rows="${Math.max(4, myText.split('\n').length + 1)}" class="mt-1.5 ${inp} leading-relaxed" placeholder="例如：天使团现有 12 人，下次侍奉 9/27 师生弥撒……">${esc(myText)}</textarea>
        <div class="mt-1.5 flex items-center gap-2"><button data-act="contrib-save" class="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">保存我的汇报</button><span id="contrib-msg" class="text-xs text-emerald-600"></span></div>`
        : '<div class="mt-2 text-sm text-slate-500">用电话登录之后，就可以写你要报告的事。</div>') : ''}
      ${(m.status === 'agenda' ? others : list).length ? `<div class="mt-3 space-y-2">${(m.status === 'agenda' ? others : list).map(c => `
        <div class="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
          <div class="text-xs font-semibold text-indigo-800">${esc(c.n)}</div>
          <div class="mt-0.5 text-sm text-slate-700 whitespace-pre-wrap">${esc(c.text)}</div>
        </div>`).join('')}</div>` : ''}
    </section>${m.status === 'agenda' ? changesBox(m) : ''}`;
}

const pill = m => m.status === 'agenda'
  ? '<span class="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">会前议程</span>'
  : '<span class="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">已开完</span>';
const hay = m => [titleOf(m), m.date, m.place, m.attend, m.minutes, ...m.agenda, ...m.summary.points,
  ...m.summary.todos.map(t => `${t.t} ${t.who}`), ...m.summary.reports.map(r => `${r.topic} ${r.text}`)].join('\n').toLowerCase();

// 📄 会议记录：每一场
function renderList() {
  const years = [...new Set(MEETINGS.map(m => m.date.slice(0, 4)))];
  const chip = (v, label) => `<button data-year="${v}" class="shrink-0 px-3 py-1 rounded-full text-xs font-medium border ${year === v ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}">${label}</button>`;
  view.innerHTML = `
    <div class="flex gap-2 mb-2">
      <input id="q" type="search" value="${esc(q)}" placeholder="找会议：例如 报佳音、披肩、改选" class="flex-1 min-w-0 border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white">
      <button data-act="ai" class="shrink-0 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">📎 贴会议记录</button>
      <button data-act="new" class="shrink-0 px-3 py-2 rounded-xl bg-white border border-slate-200 hover:border-indigo-300 text-slate-600 text-sm" title="自己一格一格写">＋ 手写</button>
    </div>
    <div class="flex gap-1.5 overflow-x-auto no-scrollbar mb-3">${chip('all', '全部')}${years.map(y => chip(y, y + ' 年')).join('')}</div>
    <div id="mlist" class="space-y-2.5"></div>
    <div class="mt-10 pt-4 border-t border-slate-200 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-400">
      <button data-act="import" class="hover:text-indigo-600">⬆️ 导入以前的会议记录（文件）</button>
      <button data-act="backup" class="hover:text-indigo-600">⬇️ 下载全部备份</button>
    </div>`;
  $('q').addEventListener('input', e => { q = e.target.value; renderCards(); });
  renderCards();
}
function renderCards() {
  const ql = q.trim().toLowerCase();
  const today = todayIso();
  const list = MEETINGS.filter(m => (year === 'all' || m.date.startsWith(year)) && (!ql || hay(m).includes(ql)));
  $('mlist').innerHTML = list.map(m => {
    const open = m.summary.todos.filter(t => !t.done).length;
    const soon = m.status === 'agenda' && m.date >= today;
    let hit = '';
    if (ql) {
      const src = [m.minutes || '', ...m.summary.points].join(' ').replace(/\s+/g, ' ');
      const i = src.toLowerCase().indexOf(ql);
      if (i >= 0) hit = `<div class="mt-1.5 text-xs text-slate-500">…${esc(src.slice(Math.max(0, i - 20), i))}<mark class="bg-amber-100">${esc(src.slice(i, i + ql.length))}</mark>${esc(src.slice(i + ql.length, i + ql.length + 30))}…</div>`;
    }
    return `
      <button data-open="${esc(m.id)}" class="block w-full text-left bg-white rounded-2xl border ${soon ? 'border-amber-300' : 'border-slate-200'} hover:border-indigo-300 p-3.5">
        <div class="flex items-center gap-2"><div class="font-semibold min-w-0 truncate">${esc(titleOf(m))}</div>${pill(m)}</div>
        <div class="text-xs text-slate-500 mt-0.5">${fmtDate(m.date)}${m.time ? ' · ' + esc(m.time) : ''}${m.place ? ' · ' + esc(m.place) : ''}</div>
        ${m.summary.points.length ? `<ul class="mt-2 space-y-0.5 text-sm text-slate-600">${m.summary.points.slice(0, 3).map(p => `<li class="truncate">• ${esc(p)}</li>`).join('')}</ul>` : ''}
        ${open || m.driveUrl ? `<div class="mt-2 flex gap-3 text-xs">${open ? `<span class="text-indigo-700">✅ 还有 ${open} 件待办没做完</span>` : ''}${m.driveUrl ? '<span class="text-slate-400">📎 有原件</span>' : ''}</div>` : ''}
        ${hit}
      </button>`;
  }).join('') || `<div class="text-sm text-slate-400 text-center py-10">${MEETINGS.length ? '找不到' : '还没有会议记录。按「📎 贴会议记录」：贴 Google Drive 链接或上传 PDF，AI 会整理好完整记录、重点、待办、要报告的进展。'}</div>`;
}

// 一场会议：重点在上，完整记录在下
function renderDetail(m) {
  const prev = prevOf(m);
  const S = m.summary;
  const row = (k, v) => v ? `<div class="flex gap-2"><div class="w-24 shrink-0 text-slate-400">${k}</div><div class="min-w-0">${v}</div></div>` : '';
  const approve = m.approve && (m.approve.by || m.approve.second)
    ? `提议 ${esc(m.approve.by || '—')}、附议 ${esc(m.approve.second || '—')}` : (m.status === 'agenda' ? '<span class="text-slate-400">开会时填</span>' : '');
  const prevLink = prev ? `<button data-open="${esc(prev.id)}" class="text-indigo-600 underline">${esc(titleOf(prev))}（${md(prev.date)}）</button>` : '';
  // 会前：以前还没做完的待办，开会时逐项跟进
  const carry = m.status === 'agenda'
    ? asc().filter(x => x.date < m.date).flatMap(x => x.summary.todos.map((t, i) => ({ t, i, x }))).filter(o => !o.t.done) : [];

  view.innerHTML = `
    <button data-act="back" class="mb-3 text-sm text-slate-500 hover:text-indigo-600">← 全部会议</button>
    <section class="bg-white rounded-2xl border border-slate-200 p-4">
      <div class="flex items-start gap-2">
        <h2 class="text-lg font-semibold flex-1 min-w-0">${esc(titleOf(m))}</h2>${pill(m)}
      </div>
      <div class="text-sm text-slate-500 mt-0.5">${fmtDate(m.date)}${m.time ? ' · ' + esc(m.time) : ''}</div>
      <div class="mt-2 flex flex-wrap gap-2">
        ${m.driveUrl ? `<a href="${esc(m.driveUrl)}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm font-medium">📎 打开原件</a>` : ''}
        <button data-act="ai-this" class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-indigo-300 text-slate-600 text-sm">🤖 ${m.status === 'agenda' ? '贴会议记录整理' : '用会议记录重新整理'}</button>
        ${m.status === 'done' ? '<button data-act="word" class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-indigo-300 text-slate-600 text-sm">⬇️ 下载 Word</button>' : ''}
      </div>
      ${m.status === 'done' && !m.driveUrl ? '<div class="mt-2 text-xs text-amber-700">还没有原件：按「下载 Word」，放进 sicmchoir Drive 的「会议记录 Meeting Minutes」，再把链接贴回「修改 → 原件」。</div>' : ''}
      <div class="mt-3 space-y-1.5 text-sm">
        ${row('地点', esc(m.place))}
        ${row('出席', esc(m.attend || checkinNames(m).join('、')))}
        ${row('缺席', esc(m.absent))}
        ${row('开会祷', esc(m.prayOpen))}
        ${row('闭会祷', esc(m.prayClose))}
        ${row('核准上次记录', [approve, prevLink && `<div class="text-xs mt-0.5">上次：${prevLink}</div>`].filter(Boolean).join(''))}
        ${row('记录员', esc(m.recorder))}
      </div>
    </section>

    ${m.status === 'agenda' || m.draft ? draftBox(m) : ''}
    ${togetherBox(m)}

    ${carry.length ? `
    <section class="mt-3 bg-amber-50 rounded-2xl border border-amber-200 p-4">
      <div class="font-semibold text-amber-900 text-sm">上次会议还没做完的待办（开会时逐项问）</div>
      <div class="mt-2 space-y-1.5">${carry.map(o => todoLine(o.t, o.x, o.i, true)).join('')}</div>
    </section>` : ''}

    <section class="mt-3 bg-indigo-50/60 rounded-2xl border border-indigo-200 p-4">
      <div class="flex items-center gap-2">
        <div class="font-semibold text-indigo-900 flex-1">重点</div>
        ${S.points.length || S.todos.length ? '<button data-act="copy-sum" class="text-xs text-indigo-700 hover:underline">📋 复制重点</button>' : ''}
      </div>
      ${S.points.length ? `<ol class="mt-2 space-y-1 text-sm list-decimal pl-5">${S.points.map(p => `<li>${inline(p)}</li>`).join('')}</ol>`
        : `<div class="mt-2 text-sm text-slate-500">${m.status === 'agenda' ? '开完会再写重点。' : '还没写重点。'}<button data-act="edit" class="ml-1 text-indigo-600 underline">写重点</button></div>`}
      ${S.todos.length ? `<div class="mt-4 text-xs font-semibold text-slate-500">接下来要做（打勾 = 做完了）</div>
        <div class="mt-1.5 space-y-1.5">${S.todos.map((t, i) => todoLine(t, m, i)).join('')}</div>` : ''}
      ${S.reports.length ? `<div class="mt-4 text-xs font-semibold text-slate-500">要报告的进展（年尾整年报告会用到）</div>
        <div class="mt-1.5 space-y-1.5 text-sm">${S.reports.map(r => `<div><span class="inline-block mr-1 px-1.5 py-0.5 rounded bg-white border border-indigo-200 text-xs text-indigo-800">${esc(r.topic || '其他')}</span>${inline(r.text)}</div>`).join('')}</div>` : ''}
      ${S.events.length ? `<div class="mt-4 text-xs font-semibold text-slate-500">加进年度活动表的</div>
        <ul class="mt-1.5 space-y-0.5 text-sm list-disc pl-5">${S.events.map(e => `<li>${inline(e)}</li>`).join('')}</ul>` : ''}
    </section>

    ${m.agenda.length ? `
    <section class="mt-3 bg-white rounded-2xl border border-slate-200 p-4">
      <div class="font-semibold text-sm">议程</div>
      <ol class="mt-2 space-y-0.5 text-sm list-decimal pl-5 text-slate-700">${m.agenda.map(a => `<li>${inline(a)}</li>`).join('')}</ol>
    </section>` : ''}

    <section class="mt-3 bg-white rounded-2xl border border-slate-200 p-4">
      <div class="font-semibold text-sm">完整会议记录</div>
      ${m.minutes ? `<div class="mt-1 text-sm leading-relaxed text-slate-700">${rich(m.minutes)}</div>`
        : '<div class="mt-2 text-sm text-slate-400">开完会把完整记录贴在这里（按「修改」）。细节全部留着，上面的「重点」才是简单版。</div>'}
      ${m.next ? `<div class="mt-4 pt-3 border-t border-slate-100 text-sm"><span class="text-slate-400">下次会议：</span>${esc(m.next)}</div>` : ''}
    </section>

    <div class="mt-4 flex gap-2">
      <button data-act="edit" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">✎ 修改</button>
    </div>`;
}

// 开会笔记：会前一直写，开完会叫 AI 整理成正式记录；整理好之后收起来
function draftBox(m) {
  const tag = m.status === 'agenda' ? 'section' : 'details', head = m.status === 'agenda' ? 'div' : 'summary';
  return `
    <${tag} class="mt-3 bg-white rounded-2xl border border-slate-200 p-4">
      <${head} class="font-semibold text-sm ${head === 'summary' ? 'cursor-pointer text-slate-500' : ''}">📝 会议记录草稿</${head}>
      ${m.draft ? `<div class="mt-2 text-sm text-slate-700 whitespace-pre-wrap">${esc(m.draft)}</div>`
        : '<div class="mt-2 text-sm text-slate-500">这几个月有什么事就随手记在这里，乱写没关系（通常是秘书写）。每个人自己要报告的，写在下面的「各人汇报」。开完会按「整理成完整会议记录」，AI 会把草稿和大家的汇报一起整理成正式记录。</div>'}
      <div class="mt-3 flex flex-wrap gap-2">
        <button data-act="edit" class="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-indigo-300 text-slate-600 text-sm">✎ ${m.draft ? '继续写' : '开始写'}</button>
        ${m.draft || contribList(m).length ? '<button data-act="ai-draft" id="ai-draft" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">🤖 整理成完整会议记录</button>' : ''}
      </div>
      <div id="ai-msg" class="mt-2 text-sm"></div>
    </${tag}>`;
}

// 一件待办：打勾、谁做、几时之前、来自哪一场
function todoLine(t, m, i, showFrom = false) {
  const late = !t.done && t.due && t.due < todayIso();
  return `
    <label class="flex items-start gap-2 p-2 rounded-lg bg-white border ${late ? 'border-red-200' : 'border-slate-200'} text-sm cursor-pointer">
      <input type="checkbox" data-tick="${esc(m.id)}" data-i="${i}" class="mt-0.5 h-4 w-4 shrink-0" ${t.done ? 'checked' : ''}>
      <div class="min-w-0 flex-1">
        <div class="${t.done ? 'line-through text-slate-400' : ''}">${inline(t.t)}</div>
        <div class="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500">
          ${t.who ? `<span>👤 ${esc(t.who)}</span>` : ''}
          ${t.due ? `<span class="${late ? 'text-red-600 font-semibold' : ''}">⏰ ${md(t.due)}前${late ? '（过期了）' : ''}</span>` : ''}
          ${showFrom ? `<span>来自 ${esc(titleOf(m))}（${md(m.date)}）</span>` : ''}
        </div>
      </div>
    </label>`;
}

// ✅ 待办：全部会议的待办放一起
function renderTodos() {
  const all = asc().flatMap(m => m.summary.todos.map((t, i) => ({ t, i, m })));
  const whos = [...new Set(all.flatMap(o => String(o.t.who || '').split(/[、,，/&＋+]/).map(s => s.trim()).filter(Boolean)))].sort();
  const list = all.filter(o => (todoShow === 'all' || (todoShow === 'open' ? !o.t.done : o.t.done))
    && (!todoWho || String(o.t.who || '').includes(todoWho)))
    .sort((a, b) => (a.t.due || '9999').localeCompare(b.t.due || '9999') || b.m.date.localeCompare(a.m.date));
  const n = { open: all.filter(o => !o.t.done).length, done: all.filter(o => o.t.done).length, all: all.length };
  const chip = (v, label, on, attr) => `<button ${attr}="${esc(v)}" class="shrink-0 px-3 py-1 rounded-full text-xs font-medium border ${on ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}">${esc(label)}</button>`;
  view.innerHTML = `
    <div class="flex gap-1.5 overflow-x-auto no-scrollbar mb-2">
      ${chip('open', `还没做完 ${n.open}`, todoShow === 'open', 'data-show')}${chip('done', `做完了 ${n.done}`, todoShow === 'done', 'data-show')}${chip('all', `全部 ${n.all}`, todoShow === 'all', 'data-show')}
    </div>
    ${whos.length ? `<div class="flex gap-1.5 overflow-x-auto no-scrollbar mb-3">${chip('', '每个人', !todoWho, 'data-who')}${whos.map(w => chip(w, w, todoWho === w, 'data-who')).join('')}</div>` : ''}
    <div class="space-y-1.5">${list.map(o => todoLine(o.t, o.m, o.i, true)).join('')
      || `<div class="text-sm text-slate-400 text-center py-10">${all.length ? '没有' : '还没有待办。在每场会议的「重点」里加，这里就会全部列出来。'}</div>`}</div>`;
}

// 📈 年度进展：每一年 ① 每个月办了什么（年尾交堂区的活动表） ② 各项活动走到哪里（从会议的「要报告的进展」排出来）
function renderReport() {
  const years = [...new Set([String(new Date().getFullYear()), ...Object.keys(YEARS),
    ...MEETINGS.filter(m => m.summary.reports.length).map(m => m.date.slice(0, 4))])].sort().reverse();
  if (!years.includes(reportYear)) reportYear = years[0];
  const Y = YEARS[reportYear];
  const groups = new Map();
  asc().filter(m => m.date.startsWith(reportYear)).forEach(m => m.summary.reports.forEach(r => {
    const k = (r.topic || '其他').trim();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ m, text: r.text });
  }));
  const months = Y ? MONTHS.map((n, i) => [n, Y.months?.[i + 1] || []]).filter(([, a]) => a.length) : [];
  view.innerHTML = `
    <div class="flex gap-1.5 overflow-x-auto no-scrollbar mb-3">${years.map(y => `<button data-ryear="${y}" class="shrink-0 px-3 py-1 rounded-full text-xs font-medium border ${y === reportYear ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}">${y} 年</button>`).join('')}</div>

    <section class="bg-white rounded-2xl border border-slate-200 p-4">
      <div class="flex items-center gap-3">
        <div class="font-semibold text-sm flex-1">${reportYear} 年活动表 <span class="font-normal text-xs text-slate-400">每个月办了什么（年尾交堂区）</span></div>
        ${Y ? '<button data-act="print-year" class="shrink-0 text-xs text-indigo-700 hover:underline">🖨️ PDF</button><button data-act="copy-months" class="shrink-0 text-xs text-indigo-700 hover:underline">📋 复制</button>' : ''}
        <button data-act="year-edit" class="shrink-0 text-xs text-indigo-700 hover:underline">${Y ? '✎ 修改' : '＋ 开始写'}</button>
      </div>
      ${months.length ? `<div class="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">${months.map(([n, a]) => `
        <div><div class="text-xs font-semibold text-indigo-800">${n}</div>
          <ol class="mt-0.5 list-decimal pl-5 text-slate-700 space-y-0.5">${a.map(x => `<li>${inline(x)}</li>`).join('')}</ol></div>`).join('')}</div>`
        : '<div class="mt-2 text-sm text-slate-400">还没写。按「开始写」，每个月一行一项；有开执委会议的月份会先帮你填好。</div>'}
      ${Y?.notes ? `<div class="mt-4 pt-3 border-t border-slate-100 text-sm text-slate-600"><div class="text-xs font-semibold text-slate-500 mb-0.5">备注</div>${rich(Y.notes)}</div>` : ''}
      ${Y?.by ? `<div class="mt-2 text-xs text-slate-400">填表人：${esc(Y.by)}${Y.date ? '　日期：' + esc(Y.date) : ''}</div>` : ''}
    </section>

    <div class="mt-5 mb-2 flex items-center gap-3">
      <div class="font-semibold text-sm flex-1">各项进展 <span class="font-normal text-xs text-slate-400">从每场会议的「要报告的进展」排出来</span></div>
      ${groups.size ? '<button data-act="copy-year" class="shrink-0 text-xs text-indigo-700 hover:underline">📋 复制</button>' : ''}
    </div>
    <div class="space-y-2.5">${[...groups].map(([k, es]) => `
      <section class="bg-white rounded-2xl border border-slate-200 p-3.5">
        <div class="font-semibold text-sm text-indigo-900">${esc(k)}</div>
        <div class="mt-1.5 space-y-1 text-sm">${es.map(e => `<div class="flex gap-2"><button data-open="${esc(e.m.id)}" class="w-14 shrink-0 text-left text-xs text-slate-400 pt-0.5 hover:text-indigo-600">${md(e.m.date)}</button><div class="min-w-0">${inline(e.text)}</div></div>`).join('')}</div>
      </section>`).join('') || '<div class="text-sm text-slate-400 text-center py-6">这一年的会议还没写「要报告的进展」。</div>'}</div>`;
  view._groups = groups;
}

// 改一年的活动表：每个月一格，一行一项
function renderYearEdit() {
  const y = yearEditing, Y = YEARS[y];
  // 新的一年：有开执委会议的月份先填「歌咏团执委会议」
  const pre = i => Y ? (Y.months?.[i + 1] || []) : (MEETINGS.some(m => m.date.startsWith(`${y}-${pad(i + 1)}`)) ? ['歌咏团执委会议'] : []);
  view.innerHTML = `
    <form id="yform" class="space-y-3">
      <div class="flex items-center gap-2">
        <button type="button" data-act="cancel" class="text-sm text-slate-500 hover:text-indigo-600">← 取消</button>
        <h2 class="font-semibold flex-1 text-right">${y} 年活动表</h2>
      </div>
      <div class="text-xs text-slate-500">每个月一行一项，例如「周日中文弥撒 – 4 台」「婚礼礼仪 – 1 场」。</div>
      <div class="grid sm:grid-cols-2 gap-3">${MONTHS.map((n, i) => `
        <label class="block bg-white rounded-xl border border-slate-200 p-2.5"><div class="text-xs font-semibold text-indigo-800 mb-1">${n}</div>
          <textarea data-month="${i + 1}" rows="${Math.max(3, pre(i).length + 1)}" class="${inp}">${esc(pre(i).join('\n'))}</textarea></label>`).join('')}</div>
      <label class="block bg-white rounded-xl border border-slate-200 p-2.5"><div class="text-xs font-semibold text-slate-600 mb-1">备注（整年统计，例如几场婚礼、练习几次）</div>
        <textarea id="y-notes" rows="4" class="${inp}">${esc(Y?.notes)}</textarea></label>
      <div class="grid grid-cols-2 gap-3">
        <label class="block"><div class="text-xs text-slate-500 mb-0.5">填表人</div><input id="y-by" value="${esc(Y?.by)}" class="${inp}"></label>
        <label class="block"><div class="text-xs text-slate-500 mb-0.5">填表人英文名（堂区表格用）</div><input id="y-byEn" value="${esc(Y?.byEn)}" placeholder="例如 Agnes Yap" class="${inp}"></label>
        <label class="block"><div class="text-xs text-slate-500 mb-0.5">日期</div><input id="y-date" value="${esc(Y?.date)}" placeholder="例如 9/10/2026" class="${inp}"></label>
      </div>
      <div class="flex gap-2">
        <button class="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">保存</button>
        <button type="button" data-act="cancel" class="px-4 py-2 rounded-xl text-sm text-slate-500 hover:bg-slate-100">取消</button>
      </div>
    </form>`;
  $('yform').addEventListener('submit', async e => {
    e.preventDefault();
    const d = {
      kind: 'year', year: y, by: $('y-by').value.trim(), byEn: $('y-byEn').value.trim(), date: $('y-date').value.trim(), notes: $('y-notes').value.trim(),
      months: Object.fromEntries([...view.querySelectorAll('[data-month]')].map(t => [t.dataset.month, lines(t.value)])),
    };
    try { await save('year_' + y, d); } catch (err) { return fail(err); }
    YEARS[y] = { id: 'year_' + y, ...d };
    yearEditing = null;
    render();
  });
}

// 活动表照堂区表格的样子复制
const monthsText = y => {
  const Y = YEARS[y];
  return [`圣依纳爵堂 中文“乐韵”歌咏团 ${y} 年举办之活动与项目`,
    ...MONTHS.map((n, i) => [n, Y.months?.[i + 1] || []]).filter(([, a]) => a.length).map(([n, a]) => `${n}\n` + a.map((x, k) => `${k + 1}. ${x}`).join('\n')),
    Y.notes && '备注：\n' + Y.notes, Y.by && `填表人：${Y.by}${Y.date ? '　日期：' + Y.date : ''}`].filter(Boolean).join('\n\n');
};

// 活动表照堂区表格（EVENTS & ACTIVITIES HELD IN …）排好，开打印 → 存成 PDF
const MONTHS_EN = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
function printYear(y) {
  const Y = YEARS[y], w = window.open('', '_blank');
  if (!w) return alert('浏览器挡住了新窗口，请允许这个网站开新窗口再按一次。');
  const rows = MONTHS.map((n, i) => {
    const a = Y.months?.[i + 1] || [];
    return `<tr><td class="m"><b>${MONTHS_EN[i]}</b><br>${n}</td><td>${a.length ? `<ol>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}</td></tr>`;
  }).join('');
  const notes = lines(Y.notes).map(x => esc(x.replace(/^[-•]\s*/, '')));
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Mandarin Choir Ministry ${y}</title>
<style>
  @page { size: A4; margin: 18mm 18mm 16mm; }
  body { font-family: Calibri, "Microsoft YaHei", "PingFang SC", sans-serif; font-size: 10.5pt; color: #000; margin: 0; }
  .top { font-weight: bold; font-size: 11pt; margin-bottom: 14px; }
  .hd { display: flex; gap: 40px; margin: 4px 0; } .hd.en { font-weight: bold; font-size: 9pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  tr { break-inside: avoid; }
  td { border: 1px solid #000; vertical-align: top; padding: 3px 6px; }
  td.m { width: 26%; font-size: 9.5pt; line-height: 1.5; }
  ol { margin: 0; padding-left: 26px; } li { line-height: 1.5; }
  .notes { margin: 18px 0 0 50px; line-height: 1.6; } .notes u { display: inline-block; margin-bottom: 2px; }
  .foot { margin-top: 18px; font-size: 9pt; } .sign { display: flex; justify-content: space-between; margin-top: 14px; font-size: 9.5pt; }
  .tip { font: 13px sans-serif; background: #fef3c7; padding: 8px 12px; margin-bottom: 12px; border-radius: 6px; }
  @media print { .tip { display: none; } }
</style></head><body>
<div class="tip">在打印的窗口选「存成 PDF / Save as PDF」就能下载。</div>
<div class="top">ST. IGNATIUS CHURCH 圣依纳爵堂</div>
<div class="hd en"><span>EVENTS &amp; ACTIVITIES HELD IN ${y}.</span><span>NAME OF MINISTRY: SIC Mandarin Choir</span></div>
<div class="hd"><span><b>${y}</b> 年举办之活动与项目</span><span>善会/事工名称：中文“乐韵”歌咏团</span></div>
<table>${rows}</table>
${notes.length ? `<div class="notes"><u>备注：</u><br>${notes.join('<br>')}</div>` : ''}
<div class="foot"><b>Note:</b>&nbsp;&nbsp; List ministry’s activities including Church Events which your ministry was involved in organizing<br>备注：请列出本善会的所有活动，包括本善会有份协助筹办的堂区活动</div>
<div class="sign"><div><b>PREPARED BY:</b> ${esc(Y.byEn || Y.by)}<br>填表人/报告人： <b>${esc(Y.by)}</b></div><div><b>DATE:</b> ${esc(Y.date)}<br>日期：<b>${esc(Y.date)}</b></div></div>
<script>window.onload = () => setTimeout(() => print(), 300);<\/script>
</body></html>`);
  w.document.close();
}

// ───────── 修改／新会议 ─────────
const inp = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';
const todoRow = (t = {}) => `
  <div class="todo-row flex flex-wrap items-center gap-1.5 p-2 rounded-lg bg-slate-50 border border-slate-200">
    <input type="checkbox" class="r-done h-4 w-4" title="做完了" ${t.done ? 'checked' : ''}>
    <input class="r-t flex-1 min-w-[10rem] border border-slate-300 rounded-lg px-2 py-1.5 text-sm" placeholder="要做什么" value="${esc(t.t)}">
    <input class="r-who flex-1 min-w-[5rem] sm:flex-none sm:w-28 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" placeholder="谁负责" value="${esc(t.who)}">
    <input type="date" class="r-due w-36 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" title="几时之前" value="${esc(t.due)}">
    <button type="button" data-rm class="px-2 text-slate-400 hover:text-red-500" title="拿掉">✕</button>
  </div>`;
const reportRow = (r = {}) => `
  <div class="report-row flex flex-wrap items-start gap-1.5 p-2 rounded-lg bg-slate-50 border border-slate-200">
    <input class="r-topic w-36 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" list="topic-list" placeholder="哪一项活动" value="${esc(r.topic)}">
    <textarea class="r-text flex-1 min-w-[12rem] border border-slate-300 rounded-lg px-2 py-1.5 text-sm" rows="2" placeholder="这次报告了什么、走到哪里">${esc(r.text)}</textarea>
    <button type="button" data-rm class="px-2 pt-1.5 text-slate-400 hover:text-red-500" title="拿掉">✕</button>
  </div>`;

function blank() {
  const y = String(new Date().getFullYear());
  const nos = MEETINGS.filter(m => m.date.startsWith(y)).map(m => +m.no || 0);
  const last = MEETINGS[0];
  return norm({ id: '', date: '', no: nos.length ? Math.max(...nos) + 1 : '', status: 'agenda', agenda: AGENDA.slice(),
    time: last?.time || '2:30 PM – 5:00 PM', place: last?.place || '' });
}

// 会前的笔记先帮忙放好：上次开会到现在办过的活动（从年度活动表）、还没做完的待办
function draftSeed(m) {
  if (m.status !== 'agenda' || m.minutes) return '';
  const upto = m.date || todayIso();
  const last = asc().filter(x => x.status === 'done' && x.date < upto).pop();
  const ev = [];
  if (last) {
    let [y, mo] = ymd(last.date);
    const [ey, em] = ymd(upto);
    for (; y < ey || (y === ey && mo <= em); mo === 12 ? (y++, mo = 1) : mo++)
      (YEARS[y]?.months?.[mo] || []).filter(x => !x.includes('执委会议')).forEach(x => ev.push(`- ${mo}月 ${x}`));
  }
  const todos = asc().filter(x => x.date < upto).flatMap(x => x.summary.todos.filter(t => !t.done)
    .map(t => `- ${t.t}${t.who ? '（' + t.who + '）' : ''}`));
  return [
    ev.length && `【上次开会到现在办过的活动】（从年度活动表来，开会时检讨）\n${ev.join('\n')}`,
    todos.length && `【还没做完的待办】（开会时逐项问）\n${todos.join('\n')}`,
    '【这次的笔记】（想到什么就记；开完会把讨论和决议补上）\n',
  ].filter(Boolean).join('\n\n');
}

function renderEdit() {
  const m = editing;
  const draft = m.draft || draftSeed(m);
  // 会前还没整理的：下面那块收起来，免得以为要在那里写
  const S0 = m.summary;
  const sumTag = m.status === 'agenda' && !m._ai && !S0.points.length && !S0.todos.length && !S0.reports.length && !S0.events.length ? 'details' : 'section';
  const topics = [...new Set(MEETINGS.flatMap(x => x.summary.reports.map(r => r.topic)).filter(Boolean))];
  const f = (id, label, val, ph = '', type = 'text') => `<label class="block"><div class="text-xs text-slate-500 mb-0.5">${label}</div><input id="${id}" type="${type}" value="${esc(val)}" placeholder="${esc(ph)}" class="${inp}"></label>`;
  view.innerHTML = `
    <form id="mform" class="space-y-4">
      <div class="flex items-center gap-2">
        <button type="button" data-act="cancel" class="text-sm text-slate-500 hover:text-indigo-600">← 取消</button>
        <h2 class="font-semibold flex-1 text-right">${m.id ? '修改会议' : '新会议'}</h2>
      </div>
      ${m._ai ? `<div class="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">🤖 AI 整理好了，请看一遍，有错就改，再按最下面「保存」。${m.id ? `<br>保存后会盖过原本的「${esc(titleOf(byId(m.id) || m))}」。` : ''}</div>` : ''}

      <section class="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <label class="block"><div class="text-xs text-slate-500 mb-0.5">日期</div><input id="f-date" type="date" required value="${esc(m.date)}" class="${inp}"></label>
          ${f('f-no', '第几次', m.no, '例如 6', 'number')}
        </div>
        ${f('f-title', '名称（不填 = 「年份＋第几次执委会议」）', m.title, '例如 2026年第6次执委会议')}
        <label class="block"><div class="text-xs text-slate-500 mb-0.5">现在是</div>
          <select id="f-status" class="${inp}">
            <option value="agenda" ${m.status === 'agenda' ? 'selected' : ''}>会前议程（还没开）</option>
            <option value="done" ${m.status !== 'agenda' ? 'selected' : ''}>已开完，有会议记录</option>
          </select></label>
        <div class="grid grid-cols-2 gap-3">${f('f-time', '时间', m.time, '2:30 PM – 5:00 PM')}${f('f-place', '地点', m.place, '例如 Room 1.1')}</div>
        <label class="block"><div class="text-xs text-slate-500 mb-0.5">出席</div><textarea id="f-attend" rows="2" class="${inp}">${esc(m.attend || checkinNames(m).join('、'))}</textarea></label>
        <label class="block"><div class="text-xs text-slate-500 mb-0.5">缺席</div><textarea id="f-absent" rows="2" class="${inp}">${esc(m.absent)}</textarea></label>
        <div class="grid grid-cols-2 gap-3">${f('f-prayOpen', '开会祷', m.prayOpen)}${f('f-prayClose', '闭会祷', m.prayClose)}</div>
        <div class="text-xs font-semibold text-slate-600 pt-1">核准上次会议记录</div>
        <div class="grid grid-cols-2 gap-3">${f('f-approveBy', '提议', m.approve?.by)}${f('f-approveSecond', '附议', m.approve?.second)}</div>
        <div class="grid grid-cols-2 gap-3">${f('f-recorder', '记录员', m.recorder)}${f('f-drive', '原件（Drive 链接，贴上就能一按打开）', m.driveUrl, 'https://drive.google.com/…', 'url')}</div>
      </section>

      <section class="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
        <div class="font-semibold text-sm">📝 会议记录草稿 <span class="font-normal text-xs text-slate-400">会前、开会时都写在这里</span></div>
        <div class="text-xs text-slate-500">这几个月发生的事、开会讨论到的、决定了什么，全部随手记在这一格，乱写没关系。开完会按「用笔记整理成会议记录」，AI 会帮你填好下面的重点、待办、进展。</div>
        <textarea id="f-draft" rows="${Math.max(8, draft.split('\n').length + 2)}" class="${inp} leading-relaxed">${esc(draft)}</textarea>
      </section>

      <section class="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
        <div class="font-semibold text-sm">议程 <span class="font-normal text-xs text-slate-400">一行一项</span></div>
        <textarea id="f-agenda" rows="${Math.max(6, m.agenda.length + 1)}" class="${inp}">${esc(m.agenda.join('\n'))}</textarea>
      </section>

      <${sumTag} class="bg-indigo-50/60 rounded-2xl border border-indigo-200 p-4 space-y-3" ${sumTag === 'details' ? '' : 'open'}>
        <${sumTag === 'details' ? 'summary' : 'div'} class="font-semibold text-sm text-indigo-900 ${sumTag === 'details' ? 'cursor-pointer' : ''}">开完会的整理：重点、待办、进展、活动表</${sumTag === 'details' ? 'summary' : 'div'}>
        <div class="text-xs text-slate-500">开完会 AI 整理好会帮你填，你看一遍、要改就改。${sumTag === 'details' ? '会前不用填，写在上面的「会议记录草稿」就好。' : ''}</div>
        <label class="block"><div class="text-xs text-slate-500 mb-0.5">重点：这场会议最要紧的几件事，一行一点</div>
          <textarea id="f-points" rows="5" class="${inp}" placeholder="例如：改选定 10/4（日）">${esc(m.summary.points.join('\n'))}</textarea></label>
        <div>
          <div class="text-xs text-slate-500 mb-1">接下来要做（谁负责、几时之前）</div>
          <div id="f-todos" class="space-y-1.5">${m.summary.todos.map(todoRow).join('')}</div>
          <button type="button" data-act="add-todo" class="mt-1.5 text-sm text-indigo-700 hover:underline">＋ 加一件待办</button>
        </div>
        <div>
          <div class="text-xs text-slate-500 mb-1">要报告的进展：左格写是哪一项（可以从清单选，没有的就自己打新名字），右格写进展到哪里。同一项每次用同一个名字，年尾才排得在一起。</div>
          <div id="f-reports" class="space-y-1.5">${m.summary.reports.map(reportRow).join('')}</div>
          <button type="button" data-act="add-report" class="mt-1.5 text-sm text-indigo-700 hover:underline">＋ 加一项进展</button>
          <datalist id="topic-list">${topics.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
        </div>
        <label class="block"><div class="text-xs text-slate-500 mb-0.5">年度活动表：哪个月办了（或定好要办）什么活动。一行一项，开头写月份</div>
          <textarea id="f-events" rows="${Math.max(3, m.summary.events.length + 1)}" class="${inp}" placeholder="5月 天使团参与侍奉母亲节弥撒&#10;12月 圣诞报佳音 Cantata&#10;2027年1月 台马交流会（明年的就写年份）">${esc(m.summary.events.join('\n'))}</textarea>
          <div class="text-xs text-slate-400 mt-0.5">保存时会自动加进「📈 年度进展」里那一年的活动表，开会那个月也会自动加「歌咏团执委会议」；表里已经有的不会重复加。</div></label>
      </${sumTag}>

      <section class="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
        <div class="font-semibold text-sm">完整会议记录 <span class="font-normal text-xs text-slate-400">细节全部贴进来</span></div>
        <div class="text-xs text-slate-400">可以直接从 Word 贴上。想排得好看：一行开头写「### 」= 小标题，「- 」= 一个项目，前面空两格 = 往里缩。</div>
        <textarea id="f-minutes" rows="18" class="${inp} leading-relaxed">${esc(m.minutes)}</textarea>
        ${f('f-next', '下次会议', m.next, '例如 2027年1月（日）2:30 PM，2.6 课室')}
      </section>

      <div class="flex flex-wrap gap-2 items-center">
        <button class="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">保存</button>
        <button type="button" data-act="cancel" class="px-4 py-2 rounded-xl text-sm text-slate-500 hover:bg-slate-100">取消</button>
        ${m.id ? '<button type="button" data-act="delete" class="ml-auto px-3 py-2 rounded-xl text-sm text-red-500 hover:bg-red-50">删掉这场会议</button>' : ''}
      </div>
    </form>`;
  $('mform').addEventListener('submit', e => { e.preventDefault(); submit(); });
}

async function submit() {
  const v = id => $(id).value.trim();
  const date = v('f-date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return alert('请选日期');
  const { _ai, ...was } = editing;
  const m = {
    ...was, date, no: v('f-no') ? Number(v('f-no')) : '', title: v('f-title'), status: v('f-status'),
    time: v('f-time'), place: v('f-place'), attend: v('f-attend'), absent: v('f-absent'),
    prayOpen: v('f-prayOpen'), prayClose: v('f-prayClose'), recorder: v('f-recorder'), driveUrl: v('f-drive'),
    approve: { by: v('f-approveBy'), second: v('f-approveSecond') },
    draft: $('f-draft').value.replace(/\s+$/, ''),
    agenda: lines($('f-agenda').value), minutes: $('f-minutes').value.replace(/\s+$/, ''), next: v('f-next'),
    summary: {
      points: lines($('f-points').value),
      todos: [...view.querySelectorAll('.todo-row')].map(r => ({
        t: r.querySelector('.r-t').value.trim(), who: r.querySelector('.r-who').value.trim(),
        due: r.querySelector('.r-due').value, done: r.querySelector('.r-done').checked,
      })).filter(t => t.t),
      reports: [...view.querySelectorAll('.report-row')].map(r => ({
        topic: r.querySelector('.r-topic').value.trim(), text: r.querySelector('.r-text').value.trim(),
      })).filter(r => r.text),
      events: lines($('f-events').value),
    },
  };
  // 一场一份，用日期当名字；同一天第二场就加 -2
  const old = editing.id;
  let id = old && old.slice(0, 10) === date ? old : date;
  for (let k = 2; id !== old && byId(id); k++) id = `${date}-${k}`;
  const btn = view.querySelector('#mform button:not([type])');
  btn.disabled = true; btn.textContent = '保存中…';
  try {
    // 同一场：只改表格的栏（别人刚打的卡、写的汇报不会被盖掉）；搬到别的日期才整份搬过去
    const { checkins, contribs, ...body } = m;
    await save(id, old === id ? body : m, old === id);
    if (old && old !== id) await window.sicStaff.withAuth(() => deleteDoc(doc(db, COLL, old)));
    await addToYears(m, old && byId(old));
  } catch (err) { btn.disabled = false; btn.textContent = '保存'; return fail(err); }
  MEETINGS = MEETINGS.filter(x => x.id !== old && x.id !== id).concat(norm({ ...m, id })).sort((a, b) => b.date.localeCompare(a.date));
  go('list', id);
}

// 存会议时顺手补年度活动表：只加这次新写的（上次存过的不再加，免得表里删掉的又跑回来），表里已经有的也不加
const evKey = s => String(s).replace(/[\s，,。、（）()\-–—:：]/g, '').toLowerCase();
const evLines = m => !m ? [] : [...(m.status === 'done' ? [`${+m.date.slice(5, 7)}月 歌咏团执委会议`] : []), ...(m.summary?.events || [])];
async function addToYears(m, was) {
  const before = new Set(evLines(was).map(evKey));
  const changed = {};
  for (const s of evLines(m)) {
    if (before.has(evKey(s))) continue;
    const e = s.match(/^(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(.+)$/);
    if (!e || +e[2] < 1 || +e[2] > 12) continue;
    const y = e[1] || m.date.slice(0, 4), mo = String(+e[2]), t = e[3].trim(), k = evKey(t);
    const Y = changed[y] || structuredClone(YEARS[y] || { kind: 'year', year: y, by: '', date: '', notes: '', months: {} });
    const a = (Y.months ||= {})[mo] ||= [];
    // 「周日中文弥撒」跟「周日中文弥撒 – 4 台」算同一项
    if (a.some(x => { const kx = evKey(x); return kx === k || (Math.min(kx.length, k.length) >= 4 && (kx.includes(k) || k.includes(kx))); })) continue;
    a.push(t);
    changed[y] = Y;
  }
  for (const [y, Y] of Object.entries(changed)) {
    const { id, updatedAt, ...d } = Y;
    await save('year_' + y, d);
    YEARS[y] = { id: 'year_' + y, ...d };
  }
}

// ───────── 贴会议记录 → AI 整理 ─────────
function renderAi() {
  const t = aiMode.target && byId(aiMode.target);
  view.innerHTML = `
    <div class="flex items-center gap-2 mb-3">
      <button data-act="cancel" class="text-sm text-slate-500 hover:text-indigo-600">← 取消</button>
      <h2 class="font-semibold flex-1 text-right">${t ? esc(titleOf(t)) + '：' : ''}贴会议记录</h2>
    </div>
    <section class="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
      <div class="text-sm text-slate-600">AI 会读会议记录，整理出完整记录、重点、待办、要报告的进展。整理好你看一遍再保存。</div>
      <div id="ai-off" class="hidden rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">AI 还没接上（Vercel 里还没放 GEMINI_API_KEY），现在按了会失败。</div>
      <label class="block"><div class="text-xs text-slate-500 mb-0.5">Google Drive 链接（Google 文件或 PDF）</div>
        <input id="ai-url" type="url" value="${esc(t?.driveUrl)}" placeholder="https://drive.google.com/…" class="${inp}"></label>
      <div class="text-xs text-slate-400">链接要在 Drive 按「分享」→「知道链接的人」都能看。不想开分享，就在下面直接上传 PDF。</div>
      <label class="block"><div class="text-xs text-slate-500 mb-0.5">或者上传 PDF</div>
        <input id="ai-file" type="file" accept="application/pdf,.pdf,.txt" class="block w-full text-sm text-slate-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700"></label>
      <button data-act="ai-run" id="ai-go" class="w-full sm:w-auto px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">🤖 开始整理</button>
      <div id="ai-msg" class="text-sm"></div>
    </section>`;
  if (aiReady === null) fetch('/api/summarize').then(r => r.json()).then(j => { aiReady = !!j.configured; showAiOff(); }).catch(() => {});
  else showAiOff();
}
const showAiOff = () => $('ai-off')?.classList.toggle('hidden', aiReady !== false);
const fileB64 = f => new Promise((ok, no) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1]);
  r.onerror = () => no(r.error);
  r.readAsDataURL(f);
});

async function aiRun() {
  const url = $('ai-url').value.trim(), f = $('ai-file').files[0];
  const msg = t => { $('ai-msg').innerHTML = t; };
  if (!url && !f) return msg('<span class="text-rose-600">请贴 Drive 链接或选一个 PDF</span>');
  if (f && f.size > 4 * 1024 * 1024) return msg('<span class="text-rose-600">文件太大（超过 4MB）</span>');
  const btn = $('ai-go');
  btn.disabled = true; btn.textContent = '🤖 整理中…';
  msg('<span class="text-slate-500">AI 在读会议记录，大概 20 秒到 1 分钟，请别关这页。</span>');
  let g;
  try {
    g = await askAi(f ? { file: { data: await fileB64(f), mime: f.type || (/\.txt$/i.test(f.name) ? 'text/plain' : 'application/pdf'), name: f.name } } : { url });
  } catch (err) {
    btn.disabled = false; btn.textContent = '🤖 开始整理';
    return msg(`<span class="text-rose-600">${esc(err.message || err)}</span>`);
  }
  // 盖过哪一场：从那一场按进来的就是那一场；不然同一天已经有的（例如会前议程）
  openAi(g, aiMode.target ? byId(aiMode.target) : MEETINGS.find(x => g.date && x.date === g.date), url);
}

async function askAi(src) {
  const topics = [...new Set(MEETINGS.flatMap(x => x.summary.reports.map(r => r.topic)).filter(Boolean))];
  const body = JSON.stringify({ ...src, topics });
  const call = async () => {
    await window.sicStaff.ensureAuth();
    return fetch('/api/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await window.sicStaff.idToken()) }, body });
  };
  let r = await call();
  if (r.status === 401) { await window.sicStaff.ensureAuth(true); r = await call(); }
  const j = await r.json().catch(() => ({ error: '服务器没有回答（' + r.status + '）' }));
  if (!r.ok) throw new Error(j.error || r.status);
  return j.meeting;
}

// AI 整理好的 → 打开修改页给人看一遍再保存
function openAi(g, base, url) {
  editing = norm({ ...(base || blank()), ...g, date: g.date || base?.date || '', no: g.no || base?.no || '',
    id: base?.id || '', driveUrl: url || base?.driveUrl || '', draft: base?.draft || '', _ai: true });
  aiMode = null;
  render();
  window.scrollTo(0, 0);
}

// 用 App 里写的开会笔记整理：笔记连同这场会议的资料一起给 AI
async function aiDraft(m) {
  const btn = $('ai-draft'), msg = t => { $('ai-msg').innerHTML = t; };
  btn.disabled = true; btn.textContent = '🤖 整理中…';
  msg('<span class="text-slate-500">AI 在读笔记，大概 20 秒到 1 分钟，请别关这页。</span>');
  const text = [
    '（以下是执委在乐韵 App 里写的开会笔记草稿，加上每位执委自己写的汇报。会已经开完，请把两者合起来整理成一份完整、仔细的正式会议记录，status 用 done。'
      + '各人汇报的内容全部放进对应的议程段落，细节、数字、日期都保留，注明是谁报告的；笔记和汇报里没有的不要编。）',
    `会议：${titleOf(m)}`, `日期：${m.date}`, m.time && `时间：${m.time}`, m.place && `地点：${m.place}`,
    (m.attend || checkinNames(m).length) && `出席：${m.attend || checkinNames(m).join('、')}`, m.absent && `缺席：${m.absent}`, m.prayOpen && `开会祷：${m.prayOpen}`, m.prayClose && `闭会祷：${m.prayClose}`,
    m.approve?.by && `核准上次会议记录：提议 ${m.approve.by}、附议 ${m.approve.second || ''}`, m.recorder && `记录员：${m.recorder}`,
    m.agenda.length && '议程：\n' + m.agenda.map((a, i) => `${i + 1}. ${a}`).join('\n'),
    m.draft && '开会笔记（秘书／大家一起写的草稿）：\n' + m.draft,
    contribList(m).length && '各人汇报：\n' + contribList(m).map(c => `【${c.n}】\n${c.text}`).join('\n\n'),
  ].filter(Boolean).join('\n');
  let bin = '';
  new TextEncoder().encode(text).forEach(b => { bin += String.fromCharCode(b); });
  let g;
  try { g = await askAi({ file: { data: btoa(bin), mime: 'text/plain', name: 'notes.txt' } }); } catch (err) {
    btn.disabled = false; btn.textContent = '🤖 整理成完整会议记录';
    return msg(`<span class="text-rose-600">${esc(err.message || err)}</span>`);
  }
  openAi({ ...g, date: m.date }, m, '');
}

// 下载成 Word，放进 Drive 当原件备份
function wordOf(m) {
  const P = [], add = (text, o = {}) => P.push({ text, ...o });
  add('八打灵圣依纳爵堂 华文“乐韵”歌咏团', { bold: true, center: true, size: 14 });
  add('St. Ignatius Church Mandarin Choir', { center: true, size: 10 });
  add(titleOf(m) + ' 会议记录', { bold: true, center: true, size: 16, space: 6 });
  const info = [['日期', fmtDate(m.date)], ['时间', m.time], ['地点', m.place], ['出席', m.attend], ['缺席', m.absent],
    ['开会祷', m.prayOpen], ['闭会祷', m.prayClose],
    ['核准上次会议记录', m.approve?.by || m.approve?.second ? `提议 ${m.approve.by || '—'}、附议 ${m.approve.second || '—'}` : ''], ['记录员', m.recorder]];
  info.filter(([, v]) => v).forEach(([k, v], i) => add(`**${k}：**${v}`, { space: i ? 0 : 12 }));
  const head = t => add(t, { bold: true, size: 13, space: 14 });
  if (m.agenda.length) { head('议程'); m.agenda.forEach((a, i) => add(`${i + 1}. ${a}`, { indent: 1 })); }
  if (m.minutes) {
    head('会议记录');
    m.minutes.split('\n').forEach(l => {
      if (!l.trim()) return;
      const h = l.match(/^\s*#{1,6}\s*(.+)/);
      if (h) return add(h[1], { bold: true, size: 12, space: 8 });
      const b = l.match(/^(\s*)[-*•]\s+(.+)/);
      if (b) return add('• ' + b[2], { indent: 1 + Math.floor(b[1].replace(/\t/g, '  ').length / 2), bullet: true });
      add(l.trim());
    });
  }
  const S = m.summary;
  if (S.points.length) { head('重点'); S.points.forEach((p, i) => add(`${i + 1}. ${p}`, { indent: 1 })); }
  if (S.todos.length) {
    head('接下来要做');
    S.todos.forEach(t => add(`${t.done ? '☑' : '☐'} ${t.t}${t.who ? ' — ' + t.who : ''}${t.due ? `（${md(t.due)}前）` : ''}`, { indent: 1 }));
  }
  if (m.next) { head('下次会议'); add(m.next); }
  add(`（由乐韵 App 执委专区导出，${todayIso()}）`, { size: 9, space: 18 });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(docx(P));
  a.download = `${m.date} ${titleOf(m)} 会议记录.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ───────── 按钮 ─────────
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b) go(b.dataset.tab);
});

view.addEventListener('change', async e => {
  const c = e.target.closest('[data-tick]');
  if (!c) return;
  const m = byId(c.dataset.tick), t = m?.summary.todos[+c.dataset.i];
  if (!t) return;
  t.done = c.checked;
  try { await save(m.id, m); } catch (err) { t.done = !c.checked; c.checked = t.done; return fail(err); }
  render();
});

view.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.open) return go('list', b.dataset.open);
  if (b.dataset.year) { year = b.dataset.year; return renderList(); }
  if (b.dataset.show) { todoShow = b.dataset.show; return renderTodos(); }
  if (b.dataset.who !== undefined) { todoWho = b.dataset.who; return renderTodos(); }
  if (b.dataset.ryear) { reportYear = b.dataset.ryear; return renderReport(); }
  if (b.hasAttribute('data-rm')) return b.parentElement.remove();
  const m = byId(openId);
  switch (b.dataset.act) {
    case 'back': return go('list');
    case 'new': editing = blank(); render(); return window.scrollTo(0, 0);
    case 'ai': aiMode = { target: null }; render(); return window.scrollTo(0, 0);
    case 'ai-this': aiMode = { target: m.id }; render(); return window.scrollTo(0, 0);
    case 'ai-run': return aiRun();
    case 'ai-draft': return aiDraft(m);
    case 'login': return window.sicLogin?.open();
    case 'checkin': case 'uncheckin': {
      const me = meNow();
      if (!me) return window.sicLogin?.open();
      b.disabled = true;
      try {
        if (b.dataset.act === 'checkin') await askCname(me);
        await writeMine(m, 'checkins', b.dataset.act === 'checkin' ? { n: nameOf(me.id, me.name), at: new Date().toISOString() } : null);
      } catch (err) { b.disabled = false; return fail(err); }
      return renderDetail(m);
    }
    case 'contrib-save': {
      const me = meNow(), text = $('my-contrib').value.replace(/\s+$/, '');
      b.disabled = true;
      try { await writeMine(m, 'contribs', text ? { n: nameOf(me?.id, me?.name), text, at: new Date().toISOString() } : null); }
      catch (err) { b.disabled = false; return fail(err); }
      b.disabled = false;
      $('contrib-msg').textContent = '✅ 存好了';
      return;
    }
    case 'word': return wordOf(m);
    case 'edit': editing = norm(JSON.parse(JSON.stringify(m))); render(); return window.scrollTo(0, 0);
    case 'cancel': editing = null; yearEditing = null; aiMode = null; render(); return window.scrollTo(0, 0);
    case 'add-todo': $('f-todos').insertAdjacentHTML('beforeend', todoRow()); return $('f-todos').lastElementChild.querySelector('.r-t').focus();
    case 'add-report': $('f-reports').insertAdjacentHTML('beforeend', reportRow()); return $('f-reports').lastElementChild.querySelector('.r-topic').focus();
    case 'delete': {
      if (!confirm(`确定删掉「${titleOf(editing)}」？删了就找不回来（除非你有下载备份）。`)) return;
      try { await window.sicStaff.withAuth(() => deleteDoc(doc(db, COLL, editing.id))); } catch (err) { return fail(err); }
      MEETINGS = MEETINGS.filter(x => x.id !== editing.id);
      return go('list');
    }
    case 'copy-sum': {
      const S = m.summary;
      return copy([`【${titleOf(m)} 重点】${md(m.date)}`,
        S.points.length && '重点：\n' + S.points.map((p, i) => `${i + 1}. ${p}`).join('\n'),
        S.todos.length && '接下来要做：\n' + S.todos.map(t => `${t.done ? '✅' : '☐'} ${t.t}${t.who ? ' — ' + t.who : ''}${t.due ? `（${md(t.due)}前）` : ''}`).join('\n'),
      ].filter(Boolean).join('\n\n'));
    }
    case 'year-edit': yearEditing = reportYear; render(); return window.scrollTo(0, 0);
    case 'copy-months': return copy(monthsText(reportYear));
    case 'print-year': return printYear(reportYear);
    case 'copy-year':
      return copy([`乐韵歌咏团 ${reportYear} 年度进展（按执委会议记录整理）`,
        ...[...view._groups].map(([k, es]) => `【${k}】\n` + es.map(x => `- ${md(x.m.date)}：${x.text}`).join('\n'))].join('\n\n'));
    case 'import': return $('import-file').click();
    case 'backup': {
      const data = JSON.stringify({ meetings: [...asc(), ...Object.values(YEARS)].map(x => ({ ...x })) }, null, 2);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      a.download = `执委会议记录备份_${todayIso()}.json`;
      a.click();
      return setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  }
});

// 导入：以前的会议记录（JSON：[{ date, ... }] 或 { meetings: [...] }），同一天的会盖过去（会先问）；kind:'year' 的是那一年的活动表，kind:'roster' 的是历届执委（一届一份）
$('import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let list;
  try { const j = JSON.parse(await file.text()); list = (Array.isArray(j) ? j : j.meetings || []).filter(x => x.kind === 'year' ? /^\d{4}$/.test(x.year) : x.kind === 'roster' ? /^roster_\d{4}$/.test(x.id) : /^\d{4}-\d{2}-\d{2}/.test(x.id || x.date || '')); }
  catch { return alert('这个文件读不懂（要是 .json 文件）'); }
  if (!list.length) return alert('文件里没有会议记录');
  const key = x => x.kind === 'year' ? 'year_' + x.year : x.id || x.date;
  const same = list.filter(x => x.kind === 'year' ? YEARS[x.year] : x.kind === 'roster' ? ROSTER[x.id] : byId(key(x))).length;
  if (!confirm(`导入 ${list.length} 份${same ? `（其中 ${same} 份已经有了，会被文件里的盖过去）` : ''}？`)) return;
  try {
    await window.sicStaff.withAuth(() => {
      const b = writeBatch(db);
      list.forEach(x => b.set(doc(db, COLL, key(x)), clean(x.kind ? x : norm(x))));
      return b.commit();
    });
  } catch (err) { return fail(err); }
  await load();
  alert(`导入好了：${list.length} 份`);
  go('list');
});

// ───────── 历届执委 ─────────
// 一届一份：meetings/roster_2016（kind:'roster'）。内容是一行一个岗位：「主席：莫荣烽 Ronald Mok、…（括号里写备注）」
// 执委都可以直接改；每次改都把改之前的样子存进 history（最多 30 次），谁改错了按「还原」就回去
const rosterList = () => Object.values(ROSTER).sort((a, b) => (a.start || 0) - (b.start || 0));
const termEnd = r => Number((String(r.term).match(/\d{4}/g) || []).pop() || r.start);
const splitPeople = str => {
  const out = []; let cur = '', depth = 0;
  for (const ch of str) {
    if ('（('.includes(ch)) depth++;
    if ('）)'.includes(ch)) depth = Math.max(0, depth - 1);
    if (!depth && '、,，;；'.includes(ch)) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
const parseRoles = text => lines(text).map(l => {
  const m = l.match(/^([^：:]+)[：:](.*)$/);
  return m ? { role: m[1].trim(), people: splitPeople(m[2]) } : { role: '', people: splitPeople(l) };
});
const splitNote = p => { const m = p.match(/^(.*?)[（(](.*)[）)]\s*$/); return m ? { name: m[1].trim(), note: m[2].trim() } : { name: p.trim(), note: '' }; };
const cnPart = n => (n.match(/[\u4e00-\u9fff]+/) || [''])[0];
const enPart = n => n.replace(/[\u4e00-\u9fff]/g, ' ').trim().toLowerCase().replace(/\s+/g, ' ');
const stamp = iso => iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : '';
const whoNow = () => { const me = meNow(); return me ? nameOf(me.id, me.name) : '执委'; };

// 按人：同一个人中英文名写法不同也合在一起（有中文名的用中文名认人）
function rosterPeople() {
  const rows = [];
  rosterList().forEach(r => parseRoles(r.text).forEach(({ role, people }) => people.forEach(p => {
    const { name, note } = splitNote(p);
    if (name) rows.push({ name, note, role, term: r.term, start: r.start || 0 });
  })));
  const en2cn = {};
  rows.forEach(x => { const c = cnPart(x.name), e = enPart(x.name); if (c && e) en2cn[e] = c; });
  const map = new Map();
  rows.forEach(x => {
    const k = cnPart(x.name) || en2cn[enPart(x.name)] || enPart(x.name);
    if (!map.has(k)) map.set(k, { name: x.name, jobs: [] });
    const P = map.get(k);
    if (cnPart(x.name) && enPart(x.name)) P.name = x.name;           // 中英都有的写法当显示名（越后面的届越新）
    else if (!(cnPart(P.name) && enPart(P.name)) && x.name.length > P.name.length) P.name = x.name;
    P.jobs.push(x);
  });
  return [...map.values()].sort((a, b) => a.jobs[0].start - b.jobs[0].start || a.name.localeCompare(b.name, 'zh'));
}

function renderRoster() {
  if (rosterEdit) return renderRosterEdit();
  if (rosterHist) return renderRosterHist();
  const list = rosterList(), thisY = new Date().getFullYear();
  const pill = (v, t) => `<button data-ract="view" data-v="${v}" class="px-3 py-1 rounded-full text-xs font-medium border ${rosterView === v ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}">${t}</button>`;
  const head = `
    <div class="flex items-center gap-2 flex-wrap">
      ${pill('grid', '总表')}${pill('term', '按届看')}${pill('person', '按人看')}
      <div class="flex-1"></div>
      <button data-ract="new" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">➕ 补一届</button>
    </div>
    <p class="mt-2 text-xs text-slate-500 leading-relaxed">每位执委都可以补充、改正。每次改动都会记下是谁改的，改错了在「改动记录」按还原就回去。不确定的写「待确认」。</p>`;
  if (!list.length) {
    view.innerHTML = head + `<div class="mt-6 text-center text-sm text-slate-500 py-10 bg-white rounded-2xl border border-slate-200">还没有名单。<br>按「➕ 补一届」开始，或<button data-act="import" class="text-indigo-600 underline">导入名单文件</button>。</div>`;
    return;
  }
  if (rosterView === 'grid') {
    // 总表：一行一届、一栏一个岗位（跟 Notion 那张一样）；往下看一栏就是这个岗位历年是谁
    const ORDER = ['神师', '主席', '副主席', '秘书', '副秘书', '财政', '查帐', '总务'];
    const parsed = list.map(r => ({ r, roles: parseRoles(r.text) }));
    const extra = [...new Set(parsed.flatMap(x => x.roles.map(y => y.role || '其他')))].filter(k => !ORDER.includes(k));
    const cols = [...ORDER, ...extra];
    const cell = (x, c) => x.roles.filter(y => (y.role || '其他') === c).flatMap(y => y.people).map(p => {
      const { name, note } = splitNote(p);
      return `<div class="whitespace-nowrap">${esc(name)}${note ? `<div class="text-[11px] text-slate-400 whitespace-normal">${esc(note)}</div>` : ''}</div>`;
    }).join('');
    view.innerHTML = head + `
      <div class="mt-3 overflow-x-auto bg-white rounded-2xl border border-slate-200">
        <table class="text-sm border-collapse min-w-max">
          <thead><tr class="bg-slate-50 text-xs text-slate-500">
            <th class="sticky left-0 bg-slate-50 px-3 py-2 text-left font-semibold border-b border-r border-slate-200">届 ＼ 岗位</th>
            ${cols.map(c => `<th class="px-3 py-2 text-left font-semibold border-b border-slate-200">${esc(c)}</th>`).join('')}
          </tr></thead>
          <tbody>${parsed.map(x => {
            const now = x.r.start <= thisY && thisY <= termEnd(x.r);
            return `<tr class="align-top ${now ? 'bg-indigo-50/60' : ''}">
              <td class="sticky left-0 ${now ? 'bg-indigo-50' : 'bg-white'} px-3 py-2 border-b border-r border-slate-200 whitespace-nowrap font-semibold">
                <button data-ract="edit" data-id="${x.r.id}" class="hover:text-indigo-600 text-left">${esc(x.r.term)}</button>${now ? '<div class="text-[11px] font-normal text-indigo-600">现任</div>' : ''}</td>
              ${cols.map(c => `<td class="px-3 py-2 border-b border-slate-100 space-y-1">${cell(x, c) || '<span class="text-slate-300">—</span>'}</td>`).join('')}
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      <p class="mt-2 text-xs text-slate-400">往下看一栏，就是这个岗位历年是谁。手机上左右滑。按届的名字可以直接改那一届；备注和改动记录在「按届看」。</p>`;
    return;
  }
  if (rosterView === 'person') {
    const ql = rosterQ.trim().toLowerCase();
    const ppl = rosterPeople().filter(P => !ql || P.name.toLowerCase().includes(ql));
    view.innerHTML = head + `
      <input id="r-q" value="${esc(rosterQ)}" placeholder="找名字…" class="mt-3 ${inp}">
      <div class="mt-3 text-xs text-slate-400">${ppl.length} 人</div>
      <div class="mt-1 space-y-2">${ppl.map(P => `
        <div class="bg-white rounded-xl border border-slate-200 px-4 py-3">
          <div class="font-semibold text-sm">${esc(P.name)}</div>
          <div class="mt-1 space-y-0.5">${P.jobs.map(j => `<div class="text-sm text-slate-600"><span class="text-slate-400 tabular-nums">${esc(j.term)}</span>　${esc(j.role || '—')}${j.note ? `<span class="text-xs text-slate-400">（${esc(j.note)}）</span>` : ''}</div>`).join('')}</div>
        </div>`).join('')}</div>`;
    $('r-q').addEventListener('input', e => { rosterQ = e.target.value; const pos = e.target.selectionStart; renderRoster(); const i = $('r-q'); i.focus(); i.setSelectionRange(pos, pos); });
    return;
  }
  view.innerHTML = head + `<div class="mt-3 space-y-3">${list.slice().reverse().map(r => {
    const now = r.start <= thisY && thisY <= termEnd(r), next = r.start > thisY;
    return `
    <section class="bg-white rounded-2xl border ${now ? 'border-indigo-300 ring-1 ring-indigo-200' : 'border-slate-200'} p-4">
      <div class="flex items-center gap-2">
        <div class="font-bold">${esc(r.term)} 届</div>
        ${now ? '<span class="text-[11px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">现任</span>' : next ? '<span class="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">下一届</span>' : ''}
      </div>
      <div class="mt-2 divide-y divide-slate-100">${parseRoles(r.text).map(({ role, people }) => `
        <div class="py-1.5 flex gap-3">
          <div class="w-20 shrink-0 text-xs text-slate-400 pt-0.5">${esc(role || '其他')}</div>
          <div class="flex-1 text-sm text-slate-800">${people.map(p => { const { name, note } = splitNote(p); return `<div>${esc(name)}${note ? `<span class="text-xs text-slate-400">（${esc(note)}）</span>` : ''}</div>`; }).join('') || '<span class="text-slate-300">待补</span>'}</div>
        </div>`).join('') || '<div class="py-2 text-sm text-slate-400">还没有人名，待补。</div>'}</div>
      ${r.notes ? `<div class="mt-2 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 whitespace-pre-wrap">${esc(r.notes)}</div>` : ''}
      <div class="mt-3 flex items-center gap-3 text-xs text-slate-400">
        <span class="flex-1">${r.by ? `最后改：${esc(r.by)} · ${esc(stamp(r.updatedAt))}` : ''}</span>
        ${(r.history || []).length ? `<button data-ract="hist" data-id="${r.id}" class="hover:text-indigo-600">🕘 改动记录 ${r.history.length}</button>` : ''}
        <button data-ract="edit" data-id="${r.id}" class="text-indigo-600 font-medium">✏️ 改</button>
      </div>
    </section>`;
  }).join('')}</div>`;
}

function renderRosterEdit() {
  const isNew = rosterEdit === 'new', r = isNew ? { term: '', text: '神师：\n主席：\n副主席：\n秘书：\n副秘书：\n财政：\n查帐：\n总务：', notes: '' } : ROSTER[rosterEdit];
  view.innerHTML = `
    <button data-ract="cancel" class="text-sm text-slate-500 hover:text-indigo-600">‹ 回历届执委</button>
    <div class="mt-3 bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
      <div class="font-bold">${isNew ? '补一届' : esc(r.term) + ' 届'}</div>
      ${isNew ? `<label class="block space-y-1"><span class="text-xs text-slate-500">哪一届（例如 2012 - 2013）</span><input id="r-term" class="${inp}" placeholder="2012 - 2013"></label>` : ''}
      <label class="block space-y-1">
        <span class="text-xs text-slate-500">一行一个岗位：「岗位：名字、名字」。备注放括号，例如「秘书：王黛红（2018 起，代秘书）」。有中文名写中文名＋英文名。</span>
        <textarea id="r-text" rows="${Math.max(9, lines(r.text).length + 2)}" class="${inp} leading-relaxed">${esc(r.text)}</textarea>
      </label>
      <label class="block space-y-1"><span class="text-xs text-slate-500">这一届的备注（资料从哪里来、哪里待确认）</span>
        <textarea id="r-notes" rows="3" class="${inp}">${esc(r.notes || '')}</textarea></label>
      <div class="flex gap-2"><button data-ract="save" class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">保存</button>
        <button data-ract="cancel" class="px-4 py-2 rounded-lg border border-slate-300 text-sm">取消</button></div>
      ${isNew ? '' : '<p class="text-xs text-slate-400">保存后，改之前的样子会留在「改动记录」，随时可以还原。</p>'}
    </div>`;
}

function renderRosterHist() {
  const r = ROSTER[rosterHist];
  view.innerHTML = `
    <button data-ract="cancel" class="text-sm text-slate-500 hover:text-indigo-600">‹ 回历届执委</button>
    <div class="mt-3 font-bold">${esc(r.term)} 届 · 改动记录</div>
    <p class="mt-1 text-xs text-slate-500">下面是每次改动<b>之前</b>的样子，新的在上面。按「还原」会把现在的换回那个版本（现在的也会留进记录）。</p>
    <div class="mt-3 space-y-3">${(r.history || []).map((h, i) => `
      <div class="bg-white rounded-xl border border-slate-200 p-3">
        <div class="flex items-center gap-2 text-xs text-slate-500"><span class="flex-1">${esc(stamp(h.at))}${h.by ? ' · ' + esc(h.by) + ' 存的版本' : ''}</span>
          <button data-ract="restore" data-id="${r.id}" data-i="${i}" class="px-2.5 py-1 rounded-lg border border-slate-300 hover:border-indigo-400 text-slate-700">↩️ 还原</button></div>
        <pre class="mt-2 text-xs text-slate-700 whitespace-pre-wrap font-sans">${esc(h.text)}${h.notes ? '\n\n备注：' + esc(h.notes) : ''}</pre>
      </div>`).join('')}</div>`;
}

// 存一届：先拿最新的，别人刚改过就不盖（叫他再看一次）
async function rosterSave(id, { term, text, notes }, isNew) {
  const ref = doc(db, COLL, id);
  const snap = await getDoc(ref), cur = snap.exists() ? snap.data() : null;
  if (isNew && cur) throw new Error('这一届已经有了，回去在那一届按「改」');
  if (!isNew && cur && ROSTER[id] && cur.updatedAt !== ROSTER[id].updatedAt) {
    ROSTER[id] = { id, ...cur };
    alert(`刚刚 ${cur.by || '有人'} 也改了这一届，已经换成最新的。请再看一下，需要的话再改。`);
    return false;
  }
  const history = cur ? [{ at: cur.updatedAt || '', by: cur.by || '', text: cur.text || '', notes: cur.notes || '' }, ...(cur.history || [])].slice(0, 30) : [];
  const out = { kind: 'roster', term, start: Number((term.match(/\d{4}/) || [0])[0]), text, notes, by: whoNow(), updatedAt: new Date().toISOString(), history };
  await window.sicStaff.withAuth(() => setDoc(ref, out));
  ROSTER[id] = { id, ...out };
  return true;
}

view.addEventListener('click', async e => {
  const b = e.target.closest('[data-ract]');
  if (!b) return;
  const act = b.dataset.ract, id = b.dataset.id;
  if (act === 'view') { rosterView = b.dataset.v; return renderRoster(); }
  if (act === 'new') { rosterEdit = 'new'; renderRoster(); return window.scrollTo(0, 0); }
  if (act === 'edit') { rosterEdit = id; renderRoster(); return window.scrollTo(0, 0); }
  if (act === 'hist') { rosterHist = id; renderRoster(); return window.scrollTo(0, 0); }
  if (act === 'cancel') { rosterEdit = rosterHist = null; return renderRoster(); }
  if (act === 'save') {
    const isNew = rosterEdit === 'new';
    const term = isNew ? $('r-term').value.trim().replace(/\s*[-–—~至]\s*/, ' - ') : ROSTER[rosterEdit].term;
    const start = (term.match(/\d{4}/) || [])[0];
    if (!start) return alert('请写哪一届，例如 2012 - 2013');
    const key = isNew ? 'roster_' + start : rosterEdit;
    b.disabled = true;
    try {
      const ok = await rosterSave(key, { term, text: $('r-text').value.replace(/\s+$/, ''), notes: $('r-notes').value.trim() }, isNew);
      if (ok) rosterEdit = null; else rosterEdit = key;
    } catch (err) { b.disabled = false; return fail(err); }
    return renderRoster();
  }
  if (act === 'restore') {
    const r = ROSTER[id], h = r.history[Number(b.dataset.i)];
    if (!confirm(`把 ${r.term} 届换回 ${stamp(h.at)} 的版本？`)) return;
    b.disabled = true;
    try { if (await rosterSave(id, { term: r.term, text: h.text, notes: h.notes }, false)) rosterHist = null; }
    catch (err) { b.disabled = false; return fail(err); }
    return renderRoster();
  }
});

// ───────── 📦 团室物品、💰 财政记录 ─────────
// 都放在 meetings（只有执委看得到、改得到）：kind 'item' 一件一份，kind 'fin' 一笔一份
// 执委都可以加、改；每次改都留旧版本（最多 30 个）可以还原，删除也只是收起来，可以救回来
const STATUS = ['可以用', '要修理', '坏了', '借出去', '找不到'];
const STATUS_C = { 可以用: 'bg-emerald-100 text-emerald-800', 要修理: 'bg-amber-100 text-amber-800', 坏了: 'bg-red-100 text-red-700', 借出去: 'bg-sky-100 text-sky-800', 找不到: 'bg-slate-200 text-slate-600' };
const ITEM_F = ['name', 'qty', 'place', 'status', 'keeper', 'note'];
const FIN_F = ['date', 'type', 'cents', 'what', 'who', 'note'];
const listOf = kind => kind === 'item' ? ITEMS : FIN;
const fieldsOf = (kind, x) => Object.fromEntries((kind === 'item' ? ITEM_F : FIN_F).map(k => [k, x[k] ?? '']));
const backTab = kind => kind === 'item' ? '回团室物品' : '回财政记录';
const redraw = kind => kind === 'item' ? renderItems() : renderFin();
const rm = c => 'RM ' + (Number(c || 0) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const delta = x => x.type === 'out' ? -Number(x.cents || 0) : Number(x.cents || 0);

async function boardSave(kind, id, data) {
  const list = listOf(kind), key = id || `${kind}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const put = x => { const i = list.findIndex(y => y.id === key); if (i < 0) list.push(x); else list[i] = x; };
  const ref = doc(db, COLL, key);
  let history = [];
  if (id) {
    const snap = await getDoc(ref), cur = snap.exists() ? snap.data() : null;
    const local = list.find(y => y.id === key);
    if (cur && local && cur.updatedAt !== local.updatedAt) {
      put({ id: key, ...cur });
      alert(`刚刚 ${cur.by || '有人'} 也改了这一笔，已经换成最新的。请再看一下，需要的话再改。`);
      return false;
    }
    if (cur) { const { history: h = [], kind: _k, by, updatedAt, ...old } = cur; history = [{ ...old, at: updatedAt || '', by: by || '' }, ...h].slice(0, 30); }
  }
  const out = { kind, ...data, by: whoNow(), updatedAt: new Date().toISOString(), history };
  await window.sicStaff.withAuth(() => setDoc(ref, out));
  put({ id: key, ...out });
  return true;
}

// 改动记录（两个板块共用）
const histLine = (kind, h) => kind === 'item'
  ? [h.name, h.qty && `× ${h.qty}`, h.place, h.status, h.keeper && `管理：${h.keeper}`, h.note, h.removed && '（已删除）'].filter(Boolean).join(' · ')
  : [h.date, h.type === 'out' ? '支出' : '收入', rm(h.cents), h.what, h.who && `经手：${h.who}`, h.note, h.removed && '（已删除）'].filter(Boolean).join(' · ');
function renderBoardHist(kind) {
  const x = listOf(kind).find(y => y.id === boardHist);
  view.innerHTML = `
    <button data-bact="cancel" data-k="${kind}" class="text-sm text-slate-500 hover:text-indigo-600">‹ ${backTab(kind)}</button>
    <h2 class="mt-2 font-semibold">🕘 改动记录</h2>
    <div class="mt-1 text-sm text-slate-700">现在：${esc(histLine(kind, x))}</div>
    <div class="mt-3 space-y-2">${(x.history || []).map((h, i) => `
      <div class="bg-white rounded-xl border border-slate-200 p-3 text-sm">
        <div class="text-slate-700">${esc(histLine(kind, h))}</div>
        <div class="mt-1 flex items-center gap-2 text-xs text-slate-400"><span class="flex-1">${esc(h.by || '?')} · ${esc(stamp(h.at))}</span>
          <button data-bact="restore" data-k="${kind}" data-id="${x.id}" data-i="${i}" class="px-2.5 py-1 rounded-lg border border-slate-300 hover:border-indigo-400 text-slate-700">↩️ 还原</button></div>
      </div>`).join('')}</div>`;
}
const foot = (kind, x) => `<div class="mt-1.5 flex items-center gap-3 text-xs text-slate-400">
  <span class="flex-1 min-w-0 truncate">${esc(x.by || '')}${x.updatedAt ? ' · ' + esc(stamp(x.updatedAt)) : ''}</span>
  ${(x.history || []).length ? `<button data-bact="hist" data-k="${kind}" data-id="${x.id}" class="hover:text-indigo-600">🕘 ${x.history.length}</button>` : ''}
  <button data-bact="edit" data-k="${kind}" data-id="${x.id}" class="text-indigo-600 font-medium">✏️ 改</button></div>`;
const goneBox = (kind, gone) => gone.length ? `<details class="mt-4 text-sm"><summary class="cursor-pointer text-xs text-slate-400">已删除 ${gone.length} 笔（可以救回来）</summary>
  <div class="mt-2 space-y-1.5">${gone.map(x => `<div class="flex items-center gap-2 bg-white rounded-lg border border-slate-200 px-3 py-2"><span class="flex-1 min-w-0 text-slate-500 text-xs">${esc(histLine(kind, { ...x, removed: false }))}</span><button data-bact="unremove" data-k="${kind}" data-id="${x.id}" class="shrink-0 text-xs text-indigo-600">救回来</button></div>`).join('')}</div></details>` : '';
const editFoot = (kind, isNew) => `<div class="flex items-center gap-2">
  <button data-bact="save" data-k="${kind}" class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">保存</button>
  <button data-bact="cancel" data-k="${kind}" class="px-4 py-2 rounded-lg border border-slate-300 text-sm">取消</button>
  ${isNew ? '' : `<button data-bact="remove" data-k="${kind}" class="ml-auto text-xs text-red-500 hover:underline">删除</button>`}</div>`;

// 📦 团室物品：照存放位置分组
function renderItems() {
  if (boardHist) return renderBoardHist('item');
  if (boardEdit) return renderItemEdit();
  const live = ITEMS.filter(x => !x.removed);
  view.innerHTML = `
    <div class="flex items-center gap-2">
      <div class="flex-1 text-sm text-slate-500">团室里有什么、放哪里、谁管。一共 <b>${live.length}</b> 项${live.some(x => x.status === '要修理' || x.status === '坏了') ? `，<span class="text-amber-700">${live.filter(x => x.status === '要修理' || x.status === '坏了').length} 项要处理</span>` : ''}</div>
      <button data-bact="new" data-k="item" class="shrink-0 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">➕ 加一项</button>
    </div>
    <input id="b-q" value="${esc(itemQ)}" type="search" placeholder="找物品、位置、谁管…" class="mt-3 ${inp}">
    <div id="b-list" class="mt-3"></div>
    ${goneBox('item', ITEMS.filter(x => x.removed))}`;
  drawItems();
}
function drawItems() {
  const q = itemQ.trim().toLowerCase();
  const list = ITEMS.filter(x => !x.removed && (!q || ITEM_F.map(k => x[k]).join(' ').toLowerCase().includes(q))).sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
  const groups = {};
  list.forEach(x => (groups[x.place || '还没写位置'] ||= []).push(x));
  $('b-list').innerHTML = !ITEMS.some(x => !x.removed) ? '<div class="text-sm text-slate-400 text-center py-8">还没有记录。按「➕ 加一项」开始，总务报告时一边讲一边加就好。</div>'
    : !list.length ? '<div class="text-sm text-slate-400 text-center py-6">找不到。</div>'
    : Object.keys(groups).sort((a, b) => a.localeCompare(b, 'zh')).map(g => `
      <div class="text-xs font-semibold text-slate-500 mt-3 mb-1.5">📍 ${esc(g)}（${groups[g].length}）</div>
      <div class="space-y-2">${groups[g].map(x => `
        <div class="bg-white rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm">
          <div class="flex items-center gap-2"><div class="flex-1 min-w-0 font-semibold">${esc(x.name)}${x.qty ? ` <span class="font-normal text-slate-500">× ${esc(x.qty)}</span>` : ''}</div>
            ${x.status ? `<span class="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_C[x.status] || 'bg-slate-100 text-slate-600'}">${esc(x.status)}</span>` : ''}</div>
          ${x.keeper || x.note ? `<div class="mt-0.5 text-xs text-slate-500">${x.keeper ? '管理：' + esc(x.keeper) : ''}${x.keeper && x.note ? ' · ' : ''}${esc(x.note || '')}</div>` : ''}
          ${foot('item', x)}
        </div>`).join('')}</div>`).join('');
}
function renderItemEdit() {
  const isNew = boardEdit === 'new', x = isNew ? { status: '可以用' } : ITEMS.find(y => y.id === boardEdit);
  const places = [...new Set(ITEMS.map(y => y.place).filter(Boolean))];
  view.innerHTML = `
    <button data-bact="cancel" data-k="item" class="text-sm text-slate-500 hover:text-indigo-600">‹ ${backTab('item')}</button>
    <div class="mt-2 bg-white rounded-2xl border border-slate-200 p-4 space-y-3 text-sm">
      <label class="block">物品名字<input id="b-name" value="${esc(x.name || '')}" placeholder="例如：披肩、谱架、音响" class="mt-1 ${inp}"></label>
      <div class="grid grid-cols-2 gap-3">
        <label class="block">数量<input id="b-qty" value="${esc(x.qty || '')}" placeholder="例如：60" class="mt-1 ${inp}"></label>
        <label class="block">状况<select id="b-status" class="mt-1 ${inp}">${STATUS.map(s => `<option ${s === x.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      </div>
      <label class="block">放在哪里<input id="b-place" list="b-places" value="${esc(x.place || '')}" placeholder="例如：团室大柜第二层" class="mt-1 ${inp}"><datalist id="b-places">${places.map(p => `<option value="${esc(p)}">`).join('')}</datalist></label>
      <label class="block">谁管<input id="b-keeper" value="${esc(x.keeper || '')}" class="mt-1 ${inp}"></label>
      <label class="block">备注<textarea id="b-note" rows="2" class="mt-1 ${inp}">${esc(x.note || '')}</textarea></label>
      ${editFoot('item', isNew)}
    </div>`;
}

// 💰 财政记录：一笔一笔，自动算余额
function renderFin() {
  if (boardHist) return renderBoardHist('fin');
  if (boardEdit) return renderFinEdit();
  const live = FIN.filter(x => !x.removed).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
  let run = 0;
  const withBal = live.map(x => ({ ...x, bal: (run += delta(x)) }));
  const years = [...new Set(live.map(x => String(x.date).slice(0, 4)))].sort().reverse();
  const y = String(new Date().getFullYear());
  const sum = (t, yr) => live.filter(x => x.type === t && String(x.date).startsWith(yr)).reduce((s, x) => s + Number(x.cents || 0), 0);
  if (finYear !== 'all' && !years.includes(finYear)) finYear = 'all';
  const show = withBal.filter(x => finYear === 'all' || String(x.date).startsWith(finYear)).reverse();
  const yp = (v, t) => `<button data-bact="year" data-k="fin" data-v="${v}" class="px-3 py-1 rounded-full text-xs font-medium border ${finYear === v ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}">${t}</button>`;
  view.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 p-4">
      <div class="flex items-start gap-2">
        <div class="flex-1"><div class="text-xs text-slate-500">现在余额</div><div class="text-2xl font-semibold ${run < 0 ? 'text-red-600' : ''}">${rm(run)}</div></div>
        <button data-bact="new" data-k="fin" class="shrink-0 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">➕ 记一笔</button>
      </div>
      <div class="mt-2 text-sm text-slate-600">今年收入 <b class="text-emerald-700">${rm(sum('in', y))}</b> · 今年支出 <b class="text-red-600">${rm(sum('out', y))}</b></div>
      <div class="mt-1 text-xs text-slate-400">余额是下面每一笔加起来算的。第一笔请记「承前余额」（类别选收入）。</div>
    </div>
    ${years.length > 1 ? `<div class="mt-3 flex flex-wrap gap-1.5">${yp('all', '全部')}${years.map(v => yp(v, v)).join('')}</div>` : ''}
    <div class="mt-3 space-y-2">${show.length ? show.map(x => `
      <div class="bg-white rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm">
        <div class="flex items-baseline gap-2"><div class="flex-1 min-w-0 font-semibold">${esc(x.what)}</div><div class="shrink-0 font-semibold ${x.type === 'out' ? 'text-red-600' : 'text-emerald-700'}">${x.type === 'out' ? '−' : '＋'} ${rm(x.cents)}</div></div>
        <div class="mt-0.5 flex items-baseline gap-2 text-xs text-slate-500"><div class="flex-1 min-w-0">${esc(x.date)}${x.who ? ' · 经手：' + esc(x.who) : ''}${x.note ? ' · ' + esc(x.note) : ''}</div><div class="shrink-0 text-slate-400">余 ${rm(x.bal)}</div></div>
        ${foot('fin', x)}
      </div>`).join('') : '<div class="text-sm text-slate-400 text-center py-8">还没有记录。财政报告时一边讲一边记就好。</div>'}</div>
    ${goneBox('fin', FIN.filter(x => x.removed))}`;
}
function renderFinEdit() {
  const isNew = boardEdit === 'new', x = isNew ? { date: todayStr(), type: 'out' } : FIN.find(y => y.id === boardEdit);
  view.innerHTML = `
    <button data-bact="cancel" data-k="fin" class="text-sm text-slate-500 hover:text-indigo-600">‹ ${backTab('fin')}</button>
    <div class="mt-2 bg-white rounded-2xl border border-slate-200 p-4 space-y-3 text-sm">
      <div class="grid grid-cols-2 gap-3">
        <label class="block">日期<input id="b-date" type="date" value="${esc(x.date || '')}" class="mt-1 ${inp}"></label>
        <label class="block">类别<select id="b-type" class="mt-1 ${inp}"><option value="in" ${x.type === 'in' ? 'selected' : ''}>收入</option><option value="out" ${x.type === 'out' ? 'selected' : ''}>支出</option></select></label>
      </div>
      <label class="block">金额（RM）<input id="b-amount" inputmode="decimal" value="${x.cents != null && x.cents !== '' ? (Number(x.cents) / 100).toFixed(2) : ''}" placeholder="例如：120.50" class="mt-1 ${inp}"></label>
      <label class="block">事项<input id="b-what" value="${esc(x.what || '')}" placeholder="例如：承前余额、买披肩、奉献" class="mt-1 ${inp}"></label>
      <label class="block">经手人<input id="b-who" value="${esc(x.who || '')}" class="mt-1 ${inp}"></label>
      <label class="block">备注<textarea id="b-note" rows="2" class="mt-1 ${inp}">${esc(x.note || '')}</textarea></label>
      ${editFoot('fin', isNew)}
    </div>`;
}
function readBoardForm(kind) {
  const v = id => $(id).value.trim();
  if (kind === 'item') {
    if (!v('b-name')) { alert('请写物品名字'); return null; }
    return { name: v('b-name'), qty: v('b-qty'), place: v('b-place'), status: v('b-status'), keeper: v('b-keeper'), note: v('b-note') };
  }
  const amt = v('b-amount').replace(/[,\s]|^RM/gi, '');
  if (!/^\d+(\.\d{1,2})?$/.test(amt) || Number(amt) <= 0) { alert('金额写数字，例如 120.50'); return null; }
  if (!v('b-date')) { alert('请选日期'); return null; }
  if (!v('b-what')) { alert('请写事项'); return null; }
  return { date: v('b-date'), type: v('b-type'), cents: Math.round(Number(amt) * 100), what: v('b-what'), who: v('b-who'), note: v('b-note') };
}

// 开会时：上次开会到现在，物品和财政改了什么，大家一起看；要更新一按就去
function changesBox(m) {
  const prev = MEETINGS.filter(x => x.date < m.date && x.status !== 'agenda').map(x => x.date).sort().at(-1) || '';
  const after = x => !x.removed && String(x.updatedAt || '').slice(0, 10) > prev;
  const items = ITEMS.filter(after), fin = FIN.filter(after).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const more = (a, n) => a.length > n ? `<div class="text-xs text-slate-400">还有 ${a.length - n} 项，到板块里看</div>` : '';
  return `
    <section class="mt-3 bg-white rounded-2xl border border-slate-200 p-4">
      <div class="font-semibold text-sm">📦💰 上次开会到现在的更新</div>
      <div class="mt-1 text-xs text-slate-500">财政、总务报告时，直接在这里更新，记录就跟着最新。</div>
      ${fin.length ? `<div class="mt-2 space-y-0.5 text-sm">${fin.slice(0, 6).map(x => `<div>${esc(x.date)} · ${esc(x.what)} <b class="${x.type === 'out' ? 'text-red-600' : 'text-emerald-700'}">${x.type === 'out' ? '−' : '＋'}${rm(x.cents)}</b></div>`).join('')}${more(fin, 6)}</div>` : ''}
      ${items.length ? `<div class="mt-2 space-y-0.5 text-sm">${items.slice(0, 6).map(x => `<div>${esc(x.name)}${x.qty ? ` × ${esc(x.qty)}` : ''}${x.status ? ` · ${esc(x.status)}` : ''}${x.place ? ` · ${esc(x.place)}` : ''}</div>`).join('')}${more(items, 6)}</div>` : ''}
      <div class="mt-2 flex flex-wrap gap-2">
        <button data-bact="goto" data-v="fin" class="px-3 py-1.5 rounded-lg border border-slate-300 text-sm hover:border-indigo-400">💰 更新财政记录</button>
        <button data-bact="goto" data-v="items" class="px-3 py-1.5 rounded-lg border border-slate-300 text-sm hover:border-indigo-400">📦 更新团室物品</button>
      </div>
    </section>`;
}

view.addEventListener('input', e => { if (e.target.id === 'b-q') { itemQ = e.target.value; drawItems(); } });
view.addEventListener('click', async e => {
  const b = e.target.closest('[data-bact]');
  if (!b) return;
  const act = b.dataset.bact, kind = b.dataset.k, id = b.dataset.id;
  if (act === 'goto') { go(b.dataset.v); return window.scrollTo(0, 0); }
  if (act === 'year') { finYear = b.dataset.v; return renderFin(); }
  if (act === 'new') { boardEdit = 'new'; redraw(kind); return window.scrollTo(0, 0); }
  if (act === 'edit') { boardEdit = id; redraw(kind); return window.scrollTo(0, 0); }
  if (act === 'hist') { boardHist = id; redraw(kind); return window.scrollTo(0, 0); }
  if (act === 'cancel') { boardEdit = boardHist = null; return redraw(kind); }
  const run = async (key, data) => {
    b.disabled = true;
    try { if (await boardSave(kind, key, data)) boardEdit = boardHist = null; }
    catch (err) { b.disabled = false; return fail(err); }
    redraw(kind);
  };
  if (act === 'save') {
    const data = readBoardForm(kind);
    if (data) await run(boardEdit === 'new' ? null : boardEdit, data);
    return;
  }
  if (act === 'remove') {
    if (!confirm('删除这一笔？（之后还可以在最下面救回来）')) return;
    return run(boardEdit, { ...fieldsOf(kind, listOf(kind).find(x => x.id === boardEdit)), removed: true });
  }
  if (act === 'unremove') return run(id, fieldsOf(kind, listOf(kind).find(x => x.id === id)));
  if (act === 'restore') {
    const x = listOf(kind).find(y => y.id === id), h = x.history[Number(b.dataset.i)];
    if (!confirm(`换回 ${stamp(h.at)} 的版本？`)) return;
    const { at, by, ...data } = h;
    return run(id, data);
  }
});

// 在这一页用电话登录了 → 打卡、汇报那格换成他的
document.addEventListener('sic-login', () => { window.sicLogin?.close(); if (!editing && !rosterEdit && !boardEdit) render(); });

// ───────── 开始 ─────────
(async () => {
  const u = new URL(location.href);
  openId = u.searchParams.get('m');
  if (TABS.some(t => t.key === u.searchParams.get('tab'))) tab = u.searchParams.get('tab');
  try { await load(); }
  catch (err) {
    view.innerHTML = `<div class="text-sm text-red-600 text-center py-10">读不到会议记录：${esc(err.code === 'permission-denied' ? '你的密码还没开「执委专区」' : err.message)}</div>`;
    return;
  }
  render();
})();
