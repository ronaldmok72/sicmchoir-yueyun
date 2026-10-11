// 自动排歌：照「同一个主日、同一个甲乙丙年」以前唱过的歌先排好
// 来源：① App 里排过的弥撒 ② 历年 Google Sheet 歌单（songlist-history.js）
// 固定部分（垂怜曲、圣圣圣…）照同一个礼仪季最近一场
import { litDay, keyOfTitle, SEASON_OF, cycleOf } from './liturgy.js';
import { HISTORY } from './songlist-history.js';
import { matchBlock } from './songlist-import.js';

export const PROPER = ['entrance', 'psalm', 'offertory', 'communion', 'thanks', 'recessional'];

// 这一场是哪个礼仪日：名称认得出来就用名称（例如手动改成「主保庆典」），不然看日期
export function whichDay(date, title) {
  const lit = litDay(date);
  const k = keyOfTitle(title);
  return k && k !== lit.key ? { ...lit, key: k, season: SEASON_OF(k) } : lit;
}

// 所有可以照着排的来源，最合适的排最前面
export function sourcesFor(date, title, masses, library) {
  const day = whichDay(date, title);
  const list = [];
  masses.forEach(m => {
    if (m.date === date || keyOfTitle(m.title) !== day.key) return;
    const ml = litDay(m.date);
    const songs = {};
    (m.slots || []).filter(s => PROPER.includes(s.key)).forEach(s => { songs[s.key] = s.songs.map(x => ({ ...x })); });
    list.push({ id: `app:${m.id}`, label: `${m.date.slice(0, 4)} ${ml.cycle}年 · ${m.title}（App）`, ly: ml.litYear, cycle: ml.cycle, rank: 1, songs, note: m.note || '' });
  });
  HISTORY.forEach((h, i) => {
    if (h.k !== day.key) return;
    list.push({
      id: `sheet:${i}`, label: `${h.y} ${h.c}年歌单 · ${h.t}`, ly: h.ly, cycle: h.c, rank: 0,
      get songs() { return matchBlock(h.l, library); },
      note: h.n.filter(n => /光荣颂/.test(n)).map(n => n.replace(/^\*\s*/, '')).join('；'),
    });
  });
  list.sort((a, b) => (b.cycle === day.cycle) - (a.cycle === day.cycle) || b.ly - a.ly || b.rank - a.rank);
  return { day, sources: list };
}

// 同一个礼仪季、日期最接近（之前优先）的一场 App 弥撒 → 拿它的固定部分
export function ordinaryFrom(date, season, masses) {
  const hasOrdinary = m => (m.slots || []).some(s => !PROPER.includes(s.key) && !YEAR_ROUND.includes(s.key) && s.songs.length);
  const same = masses.filter(m => m.date !== date && hasOrdinary(m) && SEASON_OF(keyOfTitle(m.title) || litDay(m.date).key) === season);
  const before = same.filter(m => m.date < date).sort((a, b) => b.date.localeCompare(a.date));
  return before[0] || same.sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}

// 一年到头都一样的（祷文、天主经、天下万国）：同季没排过，就拿最近任何一场
export const YEAR_ROUND = ['pre', 'post', 'pater', 'doxology'];
export function nearestMass(date, masses) {
  return masses.filter(m => m.date !== date).sort((a, b) => Math.abs(new Date(a.date) - new Date(date)) - Math.abs(new Date(b.date) - new Date(date)))[0] || null;
}

// 组合成完整的 slots：template 顺序；换歌部分照来源，固定部分照同季那一场
export function buildSlots(template, source, ordinary, anyMass) {
  const songs = source ? source.songs : {};
  const from = (m, key) => ((m?.slots || []).find(s => s.key === key)?.songs || []).map(x => ({ ...x }));
  return template.map(t => ({
    key: t.key, label: t.label,
    songs: PROPER.includes(t.key) ? (songs[t.key] || []).map(x => ({ ...x }))
      : ordinary ? from(ordinary, t.key)
      : YEAR_ROUND.includes(t.key) ? from(anyMass, t.key) : [],
  }));
}

// 一步到位：给日期（和名称）→ { day, sources, source, slots, ordinary, note }
export function autofill(date, title, masses, library, template, sourceId) {
  const { day, sources } = sourcesFor(date, title, masses, library);
  const source = sources.find(s => s.id === sourceId) || sources[0] || null;
  const ordinary = ordinaryFrom(date, day.season, masses);
  const slots = buildSlots(template, source, ordinary, nearestMass(date, masses));
  return { day, sources, source, slots, ordinary, note: source?.note || '' };
}

export { litDay, cycleOf };
