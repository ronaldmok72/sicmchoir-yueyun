// 执委专区：每一场执委会议的议程、完整会议记录、重点（待办＋要报告的进展）
// 资料：Firestore meetings/{日期}，一场一份。只有密码管理开了「执委专区」的人看得到、改得到（规则要贴新的）
// 板块：TABS 一个一个排；以后要加新的板块（例如财政、资产），在 TABS 加一个 { key, label, render } 就好
import { collection, doc, setDoc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, getDocs } from "./firebase.js";

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
let yearEditing = null;     // 正在改哪一年的活动表
let aiMode = null;          // 贴会议记录让 AI 整理：{ target: 要盖过去的那一场 id 或 null }
let aiReady = null;         // 服务器的 AI 钥匙放好了没有（问过一次就记住）
const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

const TABS = [
  { key: 'list', label: '📄 会议记录', render: renderList },
  { key: 'todo', label: '✅ 待办', render: renderTodos },
  { key: 'report', label: '📈 年度进展', render: renderReport },
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

const save = (id, m) => window.sicStaff.withAuth(() => setDoc(doc(db, COLL, id), clean(m)));
const fail = err => alert('保存失败：' + (err.code === 'permission-denied'
  ? '没有权限。请 Ronald 在「密码管理」帮你开「执委专区」，或 Firebase 规则还没贴新的。' : err.message));

// ───────── 读资料 ─────────
// 同一个 meetings 里还放每一年的「活动表」（id = year_2026，kind: 'year'），年尾交堂区报告用
async function load() {
  await window.sicStaff?.ensureAuth?.();
  const s = await getDocs(collection(db, COLL));
  const docs = s.docs.map(d => ({ id: d.id, ...d.data() }));
  YEARS = Object.fromEntries(docs.filter(d => d.kind === 'year').map(d => [String(d.year), d]));
  MEETINGS = docs.filter(d => d.kind !== 'year').map(norm).sort((a, b) => b.date.localeCompare(a.date));
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
  tab = t; openId = id; editing = null; yearEditing = null; aiMode = null;
  const u = new URL(location.href);
  u.searchParams.delete('m'); u.searchParams.delete('tab');
  if (id) u.searchParams.set('m', id); else if (t !== 'list') u.searchParams.set('tab', t);
  window.history.replaceState(null, '', u);
  render();
  window.scrollTo(0, 0);
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
        <button data-act="ai-this" class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-indigo-300 text-slate-600 text-sm">🤖 ${m.status === 'agenda' ? '开完会：贴会议记录整理' : '用会议记录重新整理'}</button>
      </div>
      <div class="mt-3 space-y-1.5 text-sm">
        ${row('地点', esc(m.place))}
        ${row('出席', esc(m.attend))}
        ${row('缺席', esc(m.absent))}
        ${row('开会祷', esc(m.prayOpen))}
        ${row('闭会祷', esc(m.prayClose))}
        ${row('核准上次记录', [approve, prevLink && `<div class="text-xs mt-0.5">上次：${prevLink}</div>`].filter(Boolean).join(''))}
        ${row('记录员', esc(m.recorder))}
      </div>
    </section>

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
        ${Y ? '<button data-act="copy-months" class="shrink-0 text-xs text-indigo-700 hover:underline">📋 复制</button>' : ''}
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
      kind: 'year', year: y, by: $('y-by').value.trim(), date: $('y-date').value.trim(), notes: $('y-notes').value.trim(),
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

function renderEdit() {
  const m = editing;
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
        <label class="block"><div class="text-xs text-slate-500 mb-0.5">出席</div><textarea id="f-attend" rows="2" class="${inp}">${esc(m.attend)}</textarea></label>
        <label class="block"><div class="text-xs text-slate-500 mb-0.5">缺席</div><textarea id="f-absent" rows="2" class="${inp}">${esc(m.absent)}</textarea></label>
        <div class="grid grid-cols-2 gap-3">${f('f-prayOpen', '开会祷', m.prayOpen)}${f('f-prayClose', '闭会祷', m.prayClose)}</div>
        <div class="text-xs font-semibold text-slate-600 pt-1">核准上次会议记录</div>
        <div class="grid grid-cols-2 gap-3">${f('f-approveBy', '提议', m.approve?.by)}${f('f-approveSecond', '附议', m.approve?.second)}</div>
        <div class="grid grid-cols-2 gap-3">${f('f-recorder', '记录员', m.recorder)}${f('f-drive', '原件（Drive 链接，贴上就能一按打开）', m.driveUrl, 'https://drive.google.com/…', 'url')}</div>
      </section>

      <section class="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
        <div class="font-semibold text-sm">议程 <span class="font-normal text-xs text-slate-400">一行一项</span></div>
        <textarea id="f-agenda" rows="${Math.max(6, m.agenda.length + 1)}" class="${inp}">${esc(m.agenda.join('\n'))}</textarea>
      </section>

      <section class="bg-indigo-50/60 rounded-2xl border border-indigo-200 p-4 space-y-3">
        <div class="font-semibold text-sm text-indigo-900">重点（简单版）</div>
        <label class="block"><div class="text-xs text-slate-500 mb-0.5">这场会议的重点，一行一点</div>
          <textarea id="f-points" rows="5" class="${inp}" placeholder="例如：改选定 10/4（日）">${esc(m.summary.points.join('\n'))}</textarea></label>
        <div>
          <div class="text-xs text-slate-500 mb-1">接下来要做（谁负责、几时之前）</div>
          <div id="f-todos" class="space-y-1.5">${m.summary.todos.map(todoRow).join('')}</div>
          <button type="button" data-act="add-todo" class="mt-1.5 text-sm text-indigo-700 hover:underline">＋ 加一件待办</button>
        </div>
        <div>
          <div class="text-xs text-slate-500 mb-1">要报告的进展（同一项活动用同一个名字，年尾才排得在一起）</div>
          <div id="f-reports" class="space-y-1.5">${m.summary.reports.map(reportRow).join('')}</div>
          <button type="button" data-act="add-report" class="mt-1.5 text-sm text-indigo-700 hover:underline">＋ 加一项进展</button>
          <datalist id="topic-list">${topics.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
        </div>
        <label class="block"><div class="text-xs text-slate-500 mb-0.5">加进年度活动表（办完的、定好日子的活动；一行一项，开头写月份，例如「5月 天使团参与侍奉母亲节弥撒」，明年的写「2027年1月 …」）</div>
          <textarea id="f-events" rows="${Math.max(3, m.summary.events.length + 1)}" class="${inp}">${esc(m.summary.events.join('\n'))}</textarea>
          <div class="text-xs text-slate-400 mt-0.5">保存时会自动加进那一年的活动表，开会那个月也会自动加「歌咏团执委会议」；表里已经有的不会重复加。</div></label>
      </section>

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
    await save(id, m);
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
  const topics = [...new Set(MEETINGS.flatMap(x => x.summary.reports.map(r => r.topic)).filter(Boolean))];
  const body = JSON.stringify(f ? { file: { data: await fileB64(f), mime: f.type || (/\.txt$/i.test(f.name) ? 'text/plain' : 'application/pdf'), name: f.name }, topics } : { url, topics });
  const call = async () => {
    await window.sicStaff.ensureAuth();
    return fetch('/api/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await window.sicStaff.idToken()) }, body });
  };
  let j;
  try {
    let r = await call();
    if (r.status === 401) { await window.sicStaff.ensureAuth(true); r = await call(); }
    j = await r.json().catch(() => ({ error: '服务器没有回答（' + r.status + '）' }));
    if (!r.ok) throw new Error(j.error || r.status);
  } catch (err) {
    btn.disabled = false; btn.textContent = '🤖 开始整理';
    return msg(`<span class="text-rose-600">${esc(err.message || err)}</span>`);
  }
  const g = j.meeting;
  // 盖过哪一场：从那一场按进来的就是那一场；不然同一天已经有的（例如会前议程）
  const base = aiMode.target ? byId(aiMode.target) : MEETINGS.find(x => g.date && x.date === g.date);
  editing = norm({ ...(base || blank()), ...g, date: g.date || base?.date || '', no: g.no || base?.no || '',
    id: base?.id || '', driveUrl: url || base?.driveUrl || '', _ai: true });
  aiMode = null;
  render();
  window.scrollTo(0, 0);
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

// 导入：以前的会议记录（JSON：[{ date, ... }] 或 { meetings: [...] }），同一天的会盖过去（会先问）；kind:'year' 的是那一年的活动表
$('import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let list;
  try { const j = JSON.parse(await file.text()); list = (Array.isArray(j) ? j : j.meetings || []).filter(x => x.kind === 'year' ? /^\d{4}$/.test(x.year) : /^\d{4}-\d{2}-\d{2}/.test(x.id || x.date || '')); }
  catch { return alert('这个文件读不懂（要是 .json 文件）'); }
  if (!list.length) return alert('文件里没有会议记录');
  const key = x => x.kind === 'year' ? 'year_' + x.year : x.id || x.date;
  const same = list.filter(x => x.kind === 'year' ? YEARS[x.year] : byId(key(x))).length;
  if (!confirm(`导入 ${list.length} 份${same ? `（其中 ${same} 份已经有了，会被文件里的盖过去）` : ''}？`)) return;
  try {
    await window.sicStaff.withAuth(() => {
      const b = writeBatch(db);
      list.forEach(x => b.set(doc(db, COLL, key(x)), clean(x.kind === 'year' ? x : norm(x))));
      return b.commit();
    });
  } catch (err) { return fail(err); }
  await load();
  alert(`导入好了：${list.length} 份`);
  go('list');
});

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
