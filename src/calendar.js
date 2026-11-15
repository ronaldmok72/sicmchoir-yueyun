// 礼仪日历：今年是甲／乙／丙年，接下来每个主日、星期四／六练歌、平日的大日子
// 全部照礼仪年历自己算（复活节倒推圣灰、升天、圣神降临……），不读资料库，不花读取次数
// 平日哪些大日子要唱：照 2017–2020、2024–2026 的旧歌单，几年里有几年唱过
// 真正的安排（练歌取消、改时间、哪台弥撒排了什么歌）看「这台弥撒」和公告；这里是推算，给大家先看、给执委年头排一整年用
import { litDay, litYearOf, nameOf, CNY, GOSPEL } from "./liturgy.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = s => new Date(s + 'T12:00');
const add = (s, n) => { const d = at(s); d.setDate(d.getDate() + n); return iso(d); };
const wk = s => '日一二三四五六'[at(s).getDay()];
const md = s => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;
const dmy = s => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
const TODAY = iso(new Date());

// 平日的大日子（落在主日的照主日那一台）。often：7 年里唱过几年 → 每年都有／多数年有／有时有
const WEEKDAY = {
  ASH: { often: 5, time: '晚上' },
  HOLYTHU: { often: 6, time: '晚上', noPractice: true },
  GOODFRI: { often: 4 },
  VIGIL: { often: 6, time: '晚上', noPractice: true },
  ASCENSION: { often: 7, time: '晚上' },
  SACREDHEART: { often: 5, time: '晚上' },
  ASSUMPTION: { often: 6, time: '晚上' },
  ALLSAINTS: { often: 6, time: '晚上 8pm' },
  ALLSOULS: { often: 4, time: '看情况' },
  IMMACULATE: { often: 3, time: '晚上', note: '近三年都有' },
  XMASEVE: { often: 5, time: '晚上 10:30pm', noPractice: true },
  XMAS: { often: 7, noPractice: true },
  NYE: { often: 2, time: '晚上', note: '有时跟元旦合并一台', noPractice: true },
  MARY: { often: 3, note: '有时跟新年前夕合并一台', noPractice: true },
  PRESENTATION: { often: 2 },
  TRANSFIG: { often: 2 },
};
const oftenText = n => n >= 5 ? '每年都有' : n >= 3 ? '多数年有' : '有时有';

// 某一天要做的事：[{ kind: 'mass'|'special'|'practice', title, time, note, often, key }]
function eventsOf(d) {
  const w = at(d).getDay(), mo = +d.slice(5, 7), da = +d.slice(8, 10), y = +d.slice(0, 4);
  const L = litDay(d), out = [];
  const special = (key, extra = {}) => out.push({ kind: 'special', key, title: nameOf(key), ...WEEKDAY[key], ...extra });

  if (w === 0) {
    let title = L.name, note = '';
    // 12/24 是主日：早上照常是将临期第四主日，晚上才是圣诞前夕
    if (mo === 12 && da === 24) { title = nameOf(`ADV${+litDay(add(d, -7)).key.slice(3) + 1}`); special('XMASEVE'); }
    // 12/31 是主日：早上是圣家节，晚上新年前夕
    else if (mo === 12 && da === 31) { title = nameOf('HOLYFAMILY'); special('NYE'); }
    // 8/15 是星期六：圣母升天移到 8/16 主日（2026 年就是这样）
    else if (mo === 8 && da === 16 && at(add(d, -1)).getDay() === 6) { title = nameOf('ASSUMPTION'); note = '8/15 是星期六，移到主日'; }
    if (CNY[y] === d) special('CNY', { often: 7 });
    out.unshift({ kind: 'mass', key: L.key, title, time: '早上 11am', note, cycle: L.cycle });
    return out;
  }

  // 平日的大日子
  if (WEEKDAY[L.key] && !(L.key === 'ASSUMPTION' && w === 6) && !(L.key === 'XMAS' && !(mo === 12 && da === 25))) special(L.key);   // 1/2–1/9 平日 litDay 也叫「圣诞节」（圣诞期），不算
  if (L.key === 'BAPTISM') special('BAPTISM', { often: 3, note: '主显节落在 1/7、1/8 时移到星期一' });
  if (CNY[y] === d) special('CNY', { often: 7, title: '新春感恩弥撒（农历新年初一）' });
  // 12/8 是主日：圣母始胎移到星期一
  if (mo === 12 && da === 9 && w === 1) special('IMMACULATE', { note: '12/8 是主日，移到星期一' });
  // 主保庆典：往年 7/28–7/30 左右，主保1日多在 7/29
  if (mo === 7 && da === 29) out.push({ kind: 'special', key: 'PATRON', title: '主保庆典（约 7/28–7/30）', often: 5, note: '确实日子每年看教会公告' });

  // 星期四、六练歌（那天晚上有大弥撒就不另外练）
  if (w === 4 || w === 6) {
    const busy = out.find(e => e.noPractice);
    out.unshift(busy
      ? { kind: 'practice', title: '练歌', off: true, note: `这晚是${busy.title}` }
      : { kind: 'practice', title: '练歌', time: '8pm–10:30pm', note: out.length ? `同一天有${out.map(e => e.title).join('、')}，看公告` : '' });
  }
  return out;
}

// 从 from 到 to（含）每天的事，按主日分成一个礼拜一块（星期一到主日）
function plan(from, to) {
  const weeks = [];
  let cur = null;
  for (let d = from; d <= to; d = add(d, 1)) {
    const ev = eventsOf(d);
    if (!cur || at(d).getDay() === 1) weeks.push(cur = { days: [] });
    if (ev.length) cur.days.push({ d, ev });
    if (at(d).getDay() === 0) cur.sun = d;
  }
  return weeks.filter(w => w.days.length);
}

// ───────── 画面 ─────────
function renderHead() {
  const Y = litYearOf(TODAY);
  const left = Math.round((at(Y.next) - at(TODAY)) / 864e5);
  const soon = left <= 28;
  $('cycle').innerHTML = `
    <div class="text-xs text-slate-500">现在是</div>
    <div class="flex items-end gap-3 mt-0.5">
      <div class="text-3xl font-bold text-indigo-700 leading-none">${Y.cycle}年</div>
      <div class="text-sm text-slate-600 pb-0.5">主日福音读${GOSPEL[Y.cycle]}</div>
    </div>
    <div class="text-xs text-slate-500 mt-2">这个礼仪年：${dmy(Y.start)} 将临期第一主日 → ${dmy(Y.end)}（基督君王节那一周是最后一周）</div>
    <div class="mt-3 rounded-xl ${soon ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-slate-50 text-slate-600'} px-3 py-2 text-sm">
      ${soon ? '🔔 ' : ''}<b>${dmy(Y.next)}</b>（星期日${left > 0 ? `，还有 ${left} 天` : ''}）将临期第一主日起是 <b>${Y.nextCycle}年</b>，读${GOSPEL[Y.nextCycle]}。
      之后：${[1, 2].map(i => { const n = litYearOf(add(Y.next, 366 * i - 1)); return `${n.start.slice(0, 4)} 年将临期起 ${n.cycle}年`; }).join('，')}。
    </div>`;
}

let range = '6';
function rangeDates() {
  if (range.startsWith('y')) { const y = range.slice(1); return [`${y}-01-01`, `${y}-12-31`]; }
  const end = at(TODAY); end.setMonth(end.getMonth() + Number(range));
  return [TODAY, iso(end)];
}

const OFTEN_CLS = n => n >= 5 ? 'bg-emerald-100 text-emerald-700' : n >= 3 ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500';
function renderList() {
  const [from, to] = rangeDates();
  let lastMonth = '', lastCycle = '';
  const html = plan(from, to).map(w => {
    const sun = w.days.find(x => at(x.d).getDay() === 0);
    const head = [];
    const m = (w.sun || w.days[0].d).slice(0, 7);
    if (m !== lastMonth) { lastMonth = m; head.push(`<div class="pt-3 pb-1 px-1 text-sm font-bold text-slate-700">${+m.slice(0, 4)} 年 ${+m.slice(5)} 月</div>`); }
    const cyc = sun ? litDay(sun.d).cycle : '';
    if (sun && lastCycle && cyc !== lastCycle) head.push(`<div class="mt-2 mb-2 rounded-xl bg-indigo-600 text-white px-3 py-2 text-sm font-semibold">🔔 新的礼仪年开始：${cyc}年（读${GOSPEL[cyc]}）</div>`);
    if (sun) lastCycle = cyc;

    const practice = w.days.flatMap(x => x.ev.filter(e => e.kind === 'practice').map(e => ({ d: x.d, ...e })));
    const specials = w.days.flatMap(x => x.ev.filter(e => e.kind === 'special').map(e => ({ d: x.d, ...e })));
    const mass = sun?.ev.find(e => e.kind === 'mass');
    const past = (w.sun || w.days.at(-1).d) < TODAY;
    return head.join('') + `
      <div class="bg-white rounded-xl border ${sun?.d === nextSun ? 'border-indigo-300 ring-1 ring-indigo-100' : 'border-slate-200'} px-3 py-2.5 ${past ? 'opacity-50' : ''}">
        ${mass ? `<a href="day.html?d=${sun.d}" class="flex items-start gap-2">
          <div class="w-11 shrink-0"><div class="text-sm font-bold">${md(sun.d)}</div><div class="text-[11px] text-slate-400">星期日</div></div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold text-slate-900">${esc(mass.title)} <span class="ml-1 text-[11px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-normal">${mass.cycle}年</span>${sun.d === nextSun ? ' <span class="text-[11px] text-indigo-600">这个主日</span>' : ''}</div>
            <div class="text-xs text-slate-500">${esc(mass.time)}${mass.note ? ` · ${esc(mass.note)}` : ''}</div>
          </div>
          <div class="text-slate-300 text-sm">›</div></a>` : ''}
        ${specials.map(e => `
          <div class="flex items-start gap-2 ${mass ? 'mt-2 pt-2 border-t border-slate-100' : ''}">
            <div class="w-11 shrink-0"><div class="text-sm font-bold">${md(e.d)}</div><div class="text-[11px] text-slate-400">星期${wk(e.d)}</div></div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-semibold text-amber-800">⭐ ${esc(e.title)} <span class="ml-1 text-[11px] px-1.5 py-0.5 rounded-full font-normal ${OFTEN_CLS(e.often)}">往年${oftenText(e.often)}</span></div>
              <div class="text-xs text-slate-500">${[e.time, e.note].filter(Boolean).map(esc).join(' · ') || '时间看公告'}</div>
            </div>
          </div>`).join('')}
        ${practice.length ? `<div class="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">🎵 练歌　${practice.map(p => p.off
          ? `<span class="line-through text-slate-400">星期${wk(p.d)} ${md(p.d)}</span><span class="text-slate-400">（${esc(p.note)}）</span>`
          : `星期${wk(p.d)} ${md(p.d)}${p.note ? `<span class="text-amber-700">（${esc(p.note)}）</span>` : ''}`).join('　')}　<span class="text-slate-400">8pm–10:30pm</span></div>` : ''}
      </div>`;
  }).join('');
  $('list').innerHTML = html || '<div class="text-sm text-slate-400 text-center py-6">这段时间没有日子。</div>';
  document.querySelectorAll('[data-range]').forEach(b => {
    const on = b.dataset.range === range;
    b.className = `px-3 py-1.5 rounded-lg text-sm border ${on ? 'bg-indigo-600 text-white border-indigo-600 font-semibold' : 'bg-white text-slate-700 border-slate-200'}`;
  });
  $('year').value = range.startsWith('y') ? range : '';
}

// 复制成文字：贴去 WhatsApp、Google Sheet 排一整年用（只有主日和大日子，练歌不列）
function asText() {
  const [from, to] = rangeDates();
  const lines = [];
  for (const w of plan(from, to)) for (const { d, ev } of w.days) for (const e of ev) {
    if (e.kind === 'practice') continue;
    lines.push(`${dmy(d)} 星期${wk(d)}　${e.title}${e.kind === 'mass' ? `（${e.cycle}年）` : ''}${e.time && e.kind !== 'mass' ? `　${e.time}` : ''}${e.note ? `　${e.note}` : ''}`);
  }
  const Y = litYearOf(from);
  return `SIC 乐韵 礼仪日历 ${dmy(from)} – ${dmy(to)}\n（照礼仪年历推算；平日的大日子看往年习惯，确实时间看公告）\n${Y.start <= from ? `现在是${Y.cycle}年，${dmy(Y.next)} 起是${Y.nextCycle}年\n` : ''}\n${lines.join('\n')}`;
}
async function copy() {
  const t = asText();
  try { await navigator.clipboard.writeText(t); $('copy').textContent = '✅ 复制好了'; }
  catch { prompt('复制下面这段：', t); }
  setTimeout(() => { $('copy').textContent = '📋 复制成文字'; }, 2000);
}

// 这个主日（今天是主日就今天）
const nextSun = (() => { const d = at(TODAY); d.setDate(d.getDate() + (7 - d.getDay()) % 7); return iso(d); })();

renderHead();
const y0 = new Date().getFullYear();
$('year').innerHTML = '<option value="">整年…</option>' + [0, 1, 2].map(i => `<option value="y${y0 + i}">${y0 + i} 年 1–12 月</option>`).join('');
document.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => { range = b.dataset.range; renderList(); }));
$('year').addEventListener('change', e => { if (e.target.value) { range = e.target.value; renderList(); } });
$('copy').addEventListener('click', copy);
renderList();
