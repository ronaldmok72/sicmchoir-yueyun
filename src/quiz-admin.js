import { collection, getDocs, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, RESULTS } from "./firebase.js";
import { QUESTIONS, CATEGORIES, INTENT } from "./quiz-data.js";

const $ = id => document.getElementById(id);
const QMAP = Object.fromEntries(QUESTIONS.map(q => [q.id, q]));
const CATS = Object.keys(CATEGORIES);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const RANK = { '✅': 0, '⏳': 1, '🔴': 2 };
const worst = (...g) => g.filter(Boolean).sort((a, b) => RANK[b] - RANK[a])[0] || '—';

let ALL = [];

// ───────── 密码 ─────────
// 要有「测验结果」那一区的密码（在密码管理设）
$('gate-form').addEventListener('submit', async e => {
  e.preventDefault();
  let areas = null;
  try { areas = await window.sicStaff?.tryPassword($('gate-pwd').value); } catch (err) { console.error(err); if (err.code === 'login') return window.sicStaff.askLogin(); }
  if (!areas?.includes('quiz')) { $('gate-err').classList.remove('hidden'); return; }
  enter();
});
function enter() {
  $('gate').classList.add('hidden');
  $('app').classList.remove('hidden');
  load();
  window.sicQuiz?.load().then(v => { quizOpen = v; renderSwitch(); });
}

// ───────── 测验开关：只有最高权限（Ronald）可以按 ─────────
let quizOpen = false;
function renderSwitch() {
  const master = window.sicStaff?.isMaster();
  $('qs-state').innerHTML = quizOpen
    ? '🟢 测验现在<b>开着</b>：全团在菜单看得到「团员小测验」'
    : '⚪ 测验现在<b>关着</b>：团员看不到，只有后台看得到';
  $('qs-sub').textContent = master ? '要做测验那天按「打开」，做完按「关掉」，以后随时可以再开。已经交的成绩不会不见。' : '只有 Ronald 可以开关。';
  const b = $('qs-btn');
  b.textContent = quizOpen ? '关掉测验' : '打开测验';
  b.className = `px-4 py-2 rounded-lg font-semibold text-white ${quizOpen ? 'bg-slate-600 hover:bg-slate-500' : 'bg-emerald-600 hover:bg-emerald-500'}${master ? '' : ' hidden'}`;
}
$('qs-btn').addEventListener('click', async () => {
  const want = !quizOpen;
  if (!confirm(want ? '打开测验？全团在菜单就看得到。' : '关掉测验？团员就看不到了（已经交的成绩不会不见）。')) return;
  $('qs-btn').disabled = true;
  try { quizOpen = await window.sicQuiz.set(want); } catch (err) { alert('没改到，检查一下网络。\n' + err.message); }
  $('qs-btn').disabled = false;
  renderSwitch();
});
if (window.sicStaff?.can('quiz')) enter();

$('btn-reload').addEventListener('click', load);
$('latest-only').addEventListener('change', render);

async function load() {
  $('headline').textContent = '读取中…';
  const snap = await getDocs(collection(db, RESULTS));
  ALL = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .map(r => ({ ...r, _t: r.createdAt?.toMillis?.() ?? (Date.parse(r.clientTime) || 0) }))
    .sort((a, b) => b._t - a._t);
  render();
}

function rows() {
  if (!$('latest-only').checked) return ALL;
  const seen = new Set();
  return ALL.filter(r => { if (seen.has(r.nameKey)) return false; seen.add(r.nameKey); return true; });
}
// 能力分：用这个人任何一份里最新打过的分
function scoreFor(r) {
  const hit = ALL.find(x => x.nameKey === r.nameKey && x.ronaldScore);
  return hit ? hit.ronaldScore : '';
}

// ───────── 拍子摘要 ─────────
function tapSummary(r) {
  const R = r.tap?.results || {};
  if (r.tap?.skipped || !Object.keys(R).length) return { beat: '跳过', entry: '跳过', steady: null, sync: null, entries: [] };
  const sync = worst(R.beat4?.syncGrade, R.beat3?.syncGrade);
  const steady = worst(R.beat4?.steadyGrade, R.beat3?.steadyGrade);
  const entries = ['entry4', 'entry3', 'entrySlow'].map(k => R[k]).filter(Boolean);
  const icon = e => e.verdict === '刚好' ? '✅' : e.verdict === '没按' ? '🔴' : Math.abs(e.errBeats) <= 0.5 ? '⏳' : '🔴';
  const drifts = [R.beat4, R.beat3].filter(x => x && x.drift !== undefined).map(x => x.drift);
  const driftTxt = drifts.length ? (() => { const m = drifts.reduce((a, b) => a + b, 0) / drifts.length; return Math.abs(m) <= 4 ? '稳' : m > 0 ? '会变快' : '会变慢'; })() : '';
  return {
    beat: `跟 ${sync} · 稳 ${steady}${driftTxt ? ` <span class="text-slate-400">${driftTxt}</span>` : ''}`,
    entry: entries.map(e => `<span title="${esc(e.verdict)} ${e.errMs ?? ''}ms">${icon(e)}</span>`).join(' '),
    sync, steady, entries,
  };
}

// ───────── 画面 ─────────
function render() {
  const list = rows();
  if (!list.length) {
    $('headline').textContent = '还没有人做。';
    ['team-bars', 'team-intent', 'team-tap', 'team-misc', 'people', 'per-question'].forEach(id => { $(id).innerHTML = ''; });
    return;
  }
  const n = list.length;
  const catAvg = Object.fromEntries(CATS.map(c => {
    const a = list.reduce((s, r) => s + (r.scores?.[c]?.correct || 0), 0);
    const b = list.reduce((s, r) => s + (r.scores?.[c]?.total || 0), 0);
    return [c, pct(a, b)];
  }));
  const avgTotal = (list.reduce((s, r) => s + (r.totalCorrect || 0), 0) / n).toFixed(1);
  const weakCat = [...CATS].sort((a, b) => catAvg[a] - catAvg[b])[0];
  const wantCantor = list.filter(r => ['很想', '可以试试看'].includes(r.intent?.A));
  const wantCond = list.filter(r => ['很想', '可以试试看'].includes(r.intent?.B));

  $('headline').innerHTML = `已经有 <b>${n}</b> 人做完。全团平均 40 题答对 <b>${avgTotal}</b> 题；最弱的是<b class="text-amber-600">「${CATEGORIES[weakCat].short}」</b>（平均 ${catAvg[weakCat]}%）。想试领唱的 <b>${wantCantor.length}</b> 人，想试指挥的 <b>${wantCond.length}</b> 人。`;

  $('team-bars').innerHTML = CATS.map(c => `
    <div>
      <div class="flex justify-between text-sm mb-1"><span>${CATEGORIES[c].name}</span><span class="text-slate-500">${catAvg[c]}%</span></div>
      <div class="h-2.5 bg-slate-100 rounded-full overflow-hidden"><div class="h-full rounded-full ${catAvg[c] >= 75 ? 'bg-emerald-500' : catAvg[c] >= 50 ? 'bg-indigo-500' : 'bg-amber-500'}" style="width:${catAvg[c]}%"></div></div>
    </div>`).join('');

  // 意愿：按"很想 → 可以试试看"列名字，后面附他那一类的分数
  const nameList = (arr, key, cat) => {
    const order = ['很想', '可以试试看'];
    return order.map(lv => {
      const ppl = arr.filter(r => r.intent?.[key] === lv);
      if (!ppl.length) return '';
      return `<div><span class="text-slate-500">${lv}：</span>${ppl.map(r => `${esc(r.name)} <span class="text-slate-400">(${r.scores?.[cat]?.correct ?? 0}/${r.scores?.[cat]?.total ?? 0})</span>`).join('、')}</div>`;
    }).join('') || '<div class="text-slate-400">没有人</div>';
  };
  $('team-intent').innerHTML = `
    <div class="font-medium">领唱</div>${nameList(wantCantor, 'A', 'cantor')}
    <div class="font-medium pt-2">指挥</div>${nameList(wantCond, 'B', 'conductor')}
    <p class="text-xs text-slate-400 pt-1">括号里是他领唱／指挥那一部分答对几题。</p>`;

  // 听拍子
  const taps = list.map(tapSummary).filter(t => t.steady);
  const count = (arr, g) => arr.filter(x => x === g).length;
  const steadyArr = taps.map(t => t.steady), syncArr = taps.map(t => t.sync);
  const allEntries = taps.flatMap(t => t.entries);
  const ok = allEntries.filter(e => e.verdict === '刚好').length;
  const early = allEntries.filter(e => e.verdict === '太早').length;
  const late = allEntries.filter(e => e.verdict === '太晚').length;
  $('team-tap').innerHTML = taps.length ? `
    <div>做了的：${taps.length} 人（跳过 ${n - taps.length} 人）</div>
    <div>跟着钢琴点：✅ ${count(syncArr, '✅')} ⏳ ${count(syncArr, '⏳')} 🔴 ${count(syncArr, '🔴')}</div>
    <div>钢琴停了还稳不稳：✅ ${count(steadyArr, '✅')} ⏳ ${count(steadyArr, '⏳')} 🔴 ${count(steadyArr, '🔴')}</div>
    <div>进歌（每人 3 段，共 ${allEntries.length} 次）：刚好 ${ok}、太早 ${early}、太晚 ${late}</div>
    <p class="text-xs text-slate-400 pt-1">"稳"是钢琴停掉之后自己继续点，速度有没有跑掉——这比跟着钢琴点更能看出心里有没有拍子。</p>`
    : '<div class="text-slate-400">还没有人做这一关。</div>';

  // 声部 / 有把握 / 想加强
  const tally = (key, multi) => {
    const m = {};
    INTENT.find(i => i.id === key).options.forEach(o => { m[o] = 0; });
    list.forEach(r => { const v = r.intent?.[key]; (multi ? (v || []) : [v]).forEach(x => { if (x in m) m[x]++; }); });
    return Object.entries(m).map(([k, v]) => `${esc(k)} <b>${v}</b>`).join('　');
  };
  $('team-misc').innerHTML = `
    <div><div class="text-slate-500 mb-1">声部</div>${tally('E')}</div>
    <div><div class="text-slate-500 mb-1">觉得自己最有把握（可多选）</div>${tally('C', true)}</div>
    <div><div class="text-slate-500 mb-1">最想再加强</div>${tally('D')}</div>`;

  // 每个人
  const cell = (r, c) => {
    const s = r.scores?.[c]; if (!s) return '—';
    const p = pct(s.correct, s.total);
    return `<span class="${p >= 75 ? 'text-emerald-600' : p >= 50 ? '' : 'text-amber-600'}">${s.correct}/${s.total}</span>`;
  };
  $('people').innerHTML = list.map(r => {
    const t = tapSummary(r);
    const when = r._t ? new Date(r._t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '';
    const sc = scoreFor(r);
    const wrong = (r.questionIds || []).filter(id => !(r.correctIds || []).includes(id));
    const wrongHtml = wrong.map(id => {
      const q = QMAP[id]; if (!q) return '';
      const a = r.answers?.[String(id)];
      return `<li class="mb-1.5"><span class="text-slate-400">[${CATEGORIES[q.cat].short}]</span> ${q.q}<br><span class="text-red-500">选了：${a !== null && a !== undefined ? esc(q.options[a]) : '没答'}</span></li>`;
    }).join('');
    return `
      <tr class="border-b border-slate-100 align-top">
        <td class="py-2.5 pr-3">
          <details><summary class="cursor-pointer font-medium text-indigo-700">${esc(r.name)}</summary>
            <div class="mt-2 text-xs text-slate-600 max-w-md">
              <div class="text-slate-400 mb-1">${when} · 用了 ${Math.round((r.durationSec || 0) / 60)} 分钟 · 答错 ${wrong.length} 题</div>
              <ul class="list-none">${wrongHtml || '<li>全对</li>'}</ul>
            </div>
          </details>
        </td>
        <td class="py-2.5 pr-3 font-semibold">${r.totalCorrect ?? '—'}</td>
        ${CATS.map(c => `<td class="py-2.5 pr-3">${cell(r, c)}</td>`).join('')}
        <td class="py-2.5 pr-3 whitespace-nowrap">${t.beat}</td>
        <td class="py-2.5 pr-3 whitespace-nowrap">${t.entry}</td>
        <td class="py-2.5 pr-3 whitespace-nowrap">${esc(r.intent?.A || '')}</td>
        <td class="py-2.5 pr-3 whitespace-nowrap">${esc(r.intent?.B || '')}</td>
        <td class="py-2.5 pr-3 whitespace-nowrap">${esc(r.intent?.E || '')}</td>
        <td class="py-2.5 pr-3">
          <select data-score="${r.id}" class="border border-slate-300 rounded-md px-1.5 py-1 bg-white">
            ${['', 1, 2, 3, 4, 5].map(v => `<option value="${v}" ${String(sc) === String(v) ? 'selected' : ''}>${v === '' ? '—' : v}</option>`).join('')}
          </select>
        </td>
        <td class="py-2.5"><button data-del="${r.id}" data-name="${esc(r.name)}" class="text-xs text-slate-400 hover:text-red-500">删除</button></td>
      </tr>`;
  }).join('');

  $('people').querySelectorAll('[data-score]').forEach(sel => sel.addEventListener('change', async () => {
    const v = sel.value ? Number(sel.value) : null;
    sel.disabled = true;
    try {
      await updateDoc(doc(db, RESULTS, sel.dataset.score), { ronaldScore: v });
      const r = ALL.find(x => x.id === sel.dataset.score);
      if (r) r.ronaldScore = v;
      // 同一个人旧的那几份也清掉旧分数，免得显示错
      if (v === null) ALL.filter(x => x.nameKey === r?.nameKey).forEach(x => { x.ronaldScore = null; });
    } catch (e) { alert('存不进去：' + (e.code || e.message)); }
    sel.disabled = false;
  }));
  $('people').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(`删除「${b.dataset.name}」这一份结果？删了就找不回来。`)) return;
    try { await deleteDoc(doc(db, RESULTS, b.dataset.del)); ALL = ALL.filter(x => x.id !== b.dataset.del); render(); }
    catch (e) { alert('删不掉：' + (e.code || e.message)); }
  }));

  // 每一题
  const stat = {};
  list.forEach(r => (r.questionIds || []).forEach(id => {
    const s = stat[id] || (stat[id] = { shown: 0, right: 0, picks: {} });
    s.shown++;
    const a = r.answers?.[String(id)];
    if (a === 0) s.right++;
    else if (a !== null && a !== undefined) s.picks[a] = (s.picks[a] || 0) + 1;
  }));
  $('per-question').innerHTML = Object.entries(stat)
    .map(([id, s]) => ({ q: QMAP[id], s, p: pct(s.right, s.shown) }))
    .filter(x => x.q)
    .sort((a, b) => a.p - b.p)
    .map(({ q, s, p }) => {
      const top = Object.entries(s.picks).sort((a, b) => b[1] - a[1])[0];
      return `
        <div class="border-t border-slate-100 pt-3">
          <div class="flex gap-3 items-start">
            <div class="w-14 shrink-0 font-semibold ${p >= 75 ? 'text-emerald-600' : p >= 50 ? 'text-slate-700' : 'text-amber-600'}">${p}%</div>
            <div class="flex-1">
              <div><span class="text-slate-400">Q${q.id} [${CATEGORIES[q.cat].short}]</span> ${q.q}</div>
              <div class="text-emerald-700 text-xs mt-1">答案：${q.options[0]}</div>
              ${top ? `<div class="text-red-500 text-xs mt-0.5">最多人选错成：${q.options[top[0]]}（${top[1]} 人）</div>` : ''}
            </div>
            <div class="text-xs text-slate-400 shrink-0">${s.right}/${s.shown}</div>
          </div>
        </div>`;
    }).join('');
}
