// 历年排歌：每一年哪一天唱什么（像 Google Sheet 的歌单页）
// 来源：① App 里排过的弥撒（masses）② 2017–2020、2024–2026 的旧歌单（songlist-history.js）
// 同一天两边都有：用 App 的（那是后来真的唱的）
import { db, history as recentDocs } from "./firebase.js";
import { LIBRARY_DATA, loadLibrary } from "./library.js";
import { HISTORY } from "./songlist-history.js";
import { splitLine, splitSongs, matchSong } from "./songlist-import.js";
import { litDay, keyOfTitle, nameOf } from "./liturgy.js";
import { PROPER_KEYS, ORDINARY, massSetOf, waTitle } from "./mass-common.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = iso(new Date());
const LABEL = { entrance: '进堂咏', psalm: '答唱咏', offertory: '奉献咏', communion: '领主咏', thanks: '谢主咏', recessional: '礼成咏' };
const QUIET = ['pre', 'post', 'pater', 'doxology', 'welcome'];
const wd = d => '日一二三四五六'[new Date(d + 'T12:00').getDay()];

// ───────── 旧歌单的日期：标题有写（1/1/17）就照写的，没有就照礼仪年历推算 ─────────
// 农历新年每年不一样，推算不出来
const CNY = { 2017: '2017-01-28', 2018: '2018-02-16', 2019: '2019-02-05', 2020: '2020-01-25', 2024: '2024-02-10', 2025: '2025-01-29', 2026: '2026-02-17', 2027: '2027-02-06' };
const yearKeys = {};
function dateOfKey(k, y) {
  if (!yearKeys[y]) {
    const any = {}, sun = {};
    for (let d = new Date(y, 0, 1, 12); d.getFullYear() === y; d.setDate(d.getDate() + 1)) {
      const k2 = litDay(iso(d)).key;
      if (d.getDay() === 0) sun[k2] ??= iso(d); else any[k2] ??= iso(d);
    }
    yearKeys[y] = { ...any, ...sun, XMAS: `${y}-12-25` };
  }
  if (k === 'CNY') return CNY[y] || null;
  const d = yearKeys[y][k];
  // 第几主日那一天被大节日占了（2026 常年期第31主日 = 11/1 诸圣节）：平日推算出来的 → 移到最近的主日
  if (d && /^(OT|ADV|LENT|EAS)\d+$/.test(k) && new Date(d + 'T12:00').getDay() !== 0) {
    const x = new Date(d + 'T12:00'), w = x.getDay();
    x.setDate(x.getDate() + (w >= 4 ? 7 - w : -w));
    return iso(x);
  }
  return d || null;
}
// 表格最后几行常是下一个礼仪年的（ly > y）：12 月的照这一年，1 月的其实是明年
// 标题上的日期有时是从旧表抄过来没改（2026 的表写「24/12/2023」）：年份对不上就不信，照礼仪年历推算
function sheetDate(h) {
  const yearOf = mo => h.ly > h.y && mo === 1 ? h.y + 1 : h.y;
  const m = h.t.match(/(\d{1,2})\s*[/.]\s*(\d{1,2})(?:\s*[/.]\s*(\d{2,4}))?/);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) {
    const want = yearOf(+m[2]);
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : want;
    if (y === want) return `${y}-${pad(m[2])}-${pad(m[1])}`;
  }
  if (!h.k) return null;
  const d = dateOfKey(h.k, h.y);
  return d && h.ly > h.y && d.slice(5, 7) === '01' ? dateOfKey(h.k, h.y + 1) : d;
}

// ───────── 两边整理成一样的样子 ─────────
// { id, date, y, title, key, cycle, src, wed, draft, sets, notes, rows: [{ label, note, songs: [{ id, title, missing, note }] }] }
function fromMass(m) {
  const slots = m.slots || [];
  const odd = s => ORDINARY.includes(s.key) && s.songs.some(x => !massSetOf(x.title));
  const show = slots.filter(s => (PROPER_KEYS.includes(s.key) || !ORDINARY.includes(s.key) && !QUIET.includes(s.key) && !LABEL[s.key] || odd(s)) && s.songs.length);
  const lit = litDay(m.date);
  return {
    id: 'app:' + m.id, date: m.date, y: +m.date.slice(0, 4), title: m.title || lit.name, key: m.kind ? null : keyOfTitle(m.title) || lit.key,
    cycle: lit.cycle, src: 'app', wed: !!m.kind, time: m.time, draft: !m.setlistName, massId: m.id, setlistName: m.setlistName,
    sets: [...new Set(slots.filter(s => ORDINARY.includes(s.key)).flatMap(s => s.songs.map(x => massSetOf(x.title))).filter(Boolean))],
    notes: m.note ? [m.note] : [],
    rows: show.map(s => ({ label: s.label, note: s.note, songs: s.songs.map(x => ({ id: x.missing ? null : x.id, title: x.title, missing: !!x.missing, note: x.note })) })),
    text: [m.title, m.note, ...slots.flatMap(s => [s.label, s.note, ...s.songs.map(x => x.title)])].join(' ').toLowerCase(),
  };
}
function fromSheet(h, i) {
  const date = sheetDate(h);
  let rows = null;
  return {
    id: 'sheet:' + i, date, y: date ? +date.slice(0, 4) : h.y, title: h.t.replace(/[（(][^）)]*\d[^）)]*[）)]/g, '').trim() || h.t, key: h.k, cycle: h.c, src: 'sheet',
    sets: [], notes: [...h.l.filter(l => !splitLine(l)), ...h.n],
    // 对到曲库很花时间：要显示才对
    get rows() {
      return rows ||= h.l.map(splitLine).filter(Boolean).map(p => ({
        label: LABEL[p.key], songs: splitSongs(p.text).map(t => { const s = matchSong(t, LIBRARY_DATA); return s ? { id: s.id, title: s.title } : { title: t, missing: true }; }),
      }));
    },
    text: [h.t, ...h.l, ...h.n].join(' ').toLowerCase(),
    order: i,
  };
}

let ALL = [];
const state = { year: null, q: '', key: null };

// ───────── 画面 ─────────
const scoreLink = (x, ids) => `songs.html?ids=${[...new Set(ids)].map(encodeURIComponent).join(',')}#${encodeURIComponent(x.id)}`;
function card(e) {
  const ids = e.rows.flatMap(r => r.songs).filter(x => x.id).map(x => x.id);
  const song = x => x.id
    ? `<a href="${esc(scoreLink(x, ids))}" class="text-slate-800 hover:text-indigo-600 underline decoration-slate-200 underline-offset-4">${esc(waTitle(x.title))}</a>${x.note ? `<span class="text-xs text-indigo-600">（${esc(x.note)}）</span>` : ''}`
    : `<span class="text-slate-500">${esc(x.title)}</span>`;
  const [, mm, dd] = (e.date || '').split('-');
  const when = e.date ? `${+dd}/${+mm}（${wd(e.date)}）` : '日期不详';
  const staff = e.src === 'app' && window.sicStaff?.can('mass');
  const links = [
    e.src === 'app' && !e.wed ? `<a href="day.html?d=${e.date}" class="hover:text-indigo-600">📅 那一天</a>` : '',
    e.key ? `<button data-key="${esc(e.key)}" class="hover:text-indigo-600">🔁 其他年份的${esc(nameOf(e.key))}</button>` : '',
    staff ? `<a href="mass.html?id=${encodeURIComponent(e.massId)}" class="hover:text-indigo-600">✏️ 改</a>` : '',
  ].filter(Boolean);
  return `
    <div class="bg-white rounded-xl border ${e.date === nextDate ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200'} px-3 py-2.5" ${e.date === nextDate ? 'id="next"' : ''}>
      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span class="font-semibold text-sm">${when}</span>
        <span class="text-sm text-slate-700">${e.wed ? '💒 ' : ''}${esc(e.title)}</span>
        ${e.cycle && !e.wed ? `<span class="text-[11px] text-slate-400">${e.cycle}年</span>` : ''}
        ${e.draft ? '<span class="text-[11px] text-amber-600">还在排</span>' : ''}
        <span class="ml-auto text-[10px] ${e.src === 'app' ? 'text-emerald-600' : 'text-slate-400'}">${e.src === 'app' ? 'App' : '旧歌单'}</span>
      </div>
      ${e.sets.length ? `<div class="text-xs text-slate-500 mt-1">弥撒曲：${esc(e.sets.join('、'))}</div>` : ''}
      <div class="mt-1 divide-y divide-slate-50">
        ${e.rows.map(r => `
          <div class="flex gap-2 py-1 text-sm">
            <div class="w-14 shrink-0 text-xs text-slate-400 pt-0.5">${esc(r.label)}${r.note ? `<div class="text-[10px] leading-snug">${esc(r.note)}</div>` : ''}</div>
            <div class="flex-1 min-w-0">${r.songs.map(song).join('<span class="text-slate-300"> ／ </span>')}</div>
          </div>`).join('')}
      </div>
      ${e.notes.length ? `<div class="text-xs text-slate-400 mt-1">${e.notes.map(esc).join('<br>')}</div>` : ''}
      ${links.length ? `<div class="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-slate-400">${links.join('')}</div>` : ''}
    </div>`;
}

let nextDate = null;
function render() {
  const years = [...new Set(ALL.map(e => e.y))].sort((a, b) => b - a);
  $('years').innerHTML = years.map(y => `<button data-year="${y}" class="shrink-0 px-3 py-1.5 rounded-lg text-sm ${!state.q && !state.key && y === state.year ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:border-indigo-300'}">${y}</button>`).join('')
    + '<span class="shrink-0 self-center text-[11px] text-slate-400 pl-1">2021–2023 疫情期间没做歌单</span>';
  const q = state.q.trim().toLowerCase();
  let list, head;
  if (state.key) {
    list = ALL.filter(e => e.key === state.key).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    head = `🔁 历年的「${esc(nameOf(state.key))}」（${list.length} 次） <button data-clear class="ml-2 text-indigo-600 hover:underline">✕ 回到 ${state.year}</button>`;
  } else if (q) {
    const k = keyOfTitle(q);
    list = ALL.filter(e => e.text.includes(q) || (k && e.key === k)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    head = `找到 ${list.length} 场有「${esc(state.q.trim())}」${list.length > 80 ? '（先列最近的 80 场，打多几个字缩小范围）' : ''}`;
    list = list.slice(0, 80);
  } else {
    list = ALL.filter(e => e.y === state.year).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.order ?? 0) - (b.order ?? 0));
    head = `${state.year} 年一共 ${list.length} 场`;
  }
  nextDate = list.map(e => e.date).filter(d => d && d >= today).sort()[0] || null;
  $('head').innerHTML = head;
  // 一年的：按月份分开；找歌的：按年份分开
  let last = null;
  $('list').innerHTML = list.map(e => {
    const group = state.key || q ? `${e.y} 年` : e.date ? `${+e.date.slice(5, 7)} 月` : '日期不详';
    const sep = group !== last ? `<div class="pt-2 text-xs font-semibold text-slate-500">${group}</div>` : '';
    last = group;
    return sep + card(e);
  }).join('') || '<div class="text-sm text-slate-400 text-center py-10">没有找到</div>';
}

$('years').addEventListener('click', e => {
  const b = e.target.closest('[data-year]');
  if (!b) return;
  state.year = +b.dataset.year; state.key = null; state.q = ''; $('q').value = '';
  render();
  window.scrollTo({ top: 0 });
});
$('q').addEventListener('input', () => { state.q = $('q').value; state.key = null; render(); });
$('list').addEventListener('click', e => {
  const b = e.target.closest('[data-key]');
  if (!b) return;
  state.key = b.dataset.key; state.q = ''; $('q').value = '';
  render();
  window.scrollTo({ top: 0 });
});
$('head').addEventListener('click', e => { if (e.target.closest('[data-clear]')) { state.key = null; render(); } });

(async function init() {
  try {
    const [snap] = await Promise.all([recentDocs('masses'), loadLibrary(db)]);
    const app = snap.docs.map(d => fromMass({ id: d.id, ...d.data() })).filter(e => e.date);
    // 同一天（或同一个主日前后 3 天）App 已经有：旧歌单那份不列
    const near = (a, b) => Math.abs(new Date(a) - new Date(b)) <= 3 * 864e5;
    const sheet = HISTORY.map(fromSheet).filter(s => !app.some(a => !a.wed && s.date && (a.date === s.date || (a.key && a.key === s.key && near(a.date, s.date)))));
    ALL = app.concat(sheet);
  } catch (err) {
    console.error(err);
    $('list').innerHTML = `<div class="text-sm text-red-500 text-center py-10">读取失败：${esc(err.code || err.message)}</div>`;
    return;
  }
  const qs = new URLSearchParams(location.search);
  state.year = +qs.get('y') || new Date().getFullYear();
  if (!ALL.some(e => e.y === state.year)) state.year = Math.max(...ALL.map(e => e.y));
  if (qs.get('k')) state.key = qs.get('k');
  render();
  document.getElementById('next')?.scrollIntoView({ block: 'center' });
})();
