// 自动排歌：照「同一个主日、同一个甲乙丙年」以前唱过的歌先排好
// 来源：① App 里排过的弥撒 ② 历年 Google Sheet 歌单（songlist-history.js）
// 固定部分（垂怜曲、圣圣圣…）照同一个礼仪季最近一场
import { litDay, keyOfTitle, SEASON_OF, cycleOf } from './liturgy.js';
import { HISTORY } from './songlist-history.js';
import { matchBlock } from './songlist-import.js';

export { PROPER_KEYS as PROPER } from './mass-common.js';
import { PROPER_KEYS as PROPER } from './mass-common.js';

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
    const extra = (m.slots || []).map((s, i) => ({ s, after: m.slots[i - 1]?.key })).filter(x => isCustom(x.s.key))
      .map(({ s, after }) => ({ key: s.key, after, label: s.label, note: s.note, songs: s.songs.map(x => ({ ...x })) }));
    list.push({ id: `app:${m.id}`, label: `${m.date.slice(0, 4)} ${ml.cycle}年 · ${m.title}（App）`, ly: ml.litYear, cycle: ml.cycle, rank: 1, songs, extra, note: m.note || '' });
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

const isCustom = k => String(k).startsWith('custom_');
// 同一个礼仪季、日期最接近（之前优先）的一场 App 弥撒 → 拿它的固定部分
export function ordinaryFrom(date, season, masses) {
  const hasOrdinary = m => (m.slots || []).some(s => !PROPER.includes(s.key) && !YEAR_ROUND.includes(s.key) && !isCustom(s.key) && s.songs.length);
  const same = masses.filter(m => m.date !== date && hasOrdinary(m) && SEASON_OF(keyOfTitle(m.title) || litDay(m.date).key) === season);
  const before = same.filter(m => m.date < date).sort((a, b) => b.date.localeCompare(a.date));
  return before[0] || same.sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}

// 一年到头都一样的（祷文、天主经、天下万国）：同季没排过，就拿最近任何一场
export const YEAR_ROUND = ['pre', 'post', 'pater', 'doxology'];
export function nearestMass(date, masses) {
  return masses.filter(m => m.date !== date).sort((a, b) => Math.abs(new Date(a.date) - new Date(date)) - Math.abs(new Date(b.date) - new Date(date)))[0] || null;
}

// 大阿门：同季那一场有就照它；没有 → 最近一场有排大阿门的（排过一次，之后每一台都会带上）
export function amenFrom(date, ordinary, masses) {
  const got = m => (m?.slots || []).find(s => s.key === 'amen')?.songs || [];
  if (got(ordinary).length) return got(ordinary).map(x => ({ ...x }));
  const near = masses.filter(m => m.date !== date && got(m).length)
    .sort((a, b) => Math.abs(new Date(a.date) - new Date(date)) - Math.abs(new Date(b.date) - new Date(date)))[0];
  return got(near).map(x => ({ ...x }));
}

// 组合成完整的 slots：template 顺序；换歌部分照来源，固定部分照同季那一场；来源自己加的位置插回原本的地方
export function buildSlots(template, source, ordinary, anyMass, amen = [], extra = source?.extra || []) {
  const songs = source ? source.songs : {};
  const from = (m, key) => ((m?.slots || []).find(s => s.key === key)?.songs || []).map(x => ({ ...x }));
  const out = template.map(t => ({
    key: t.key, label: t.label,
    songs: PROPER.includes(t.key) ? (songs[t.key] || []).map(x => ({ ...x }))
      : t.key === 'verse' ? []   // 福音前欢呼经文：每个主日不一样，不照同季带；空着 = 自动翻回答唱咏那页
      : t.key === 'amen' ? amen.map(x => ({ ...x }))
      : ordinary ? from(ordinary, t.key)
      : YEAR_ROUND.includes(t.key) ? from(anyMass, t.key) : [],
  }));
  const renamed = {};
  extra.forEach((x, n) => {
    const key = `custom_${Date.now()}_${n}`;
    renamed[x.key] = key;
    const after = renamed[x.after] || x.after;
    let at = out.findIndex(s => s.key === after) + 1;
    if (at <= 0) at = Math.max(0, out.findIndex(s => s.key === 'recessional'));
    out.splice(at, 0, { key, label: x.label, ...(x.note ? { note: x.note } : {}), songs: x.songs.map(y => ({ ...y })) });
  });
  return out;
}

// 一步到位：给日期（和名称）→ { day, sources, source, slots, ordinary, note }
export function autofill(date, title, masses, library, template, sourceId) {
  const { day, sources } = sourcesFor(date, title, masses, library);
  const source = sources.find(s => s.id === sourceId) || sources[0] || null;
  const ordinary = ordinaryFrom(date, day.season, masses);
  // 自己加的位置（复活前夕的复活宣报、洗礼连祷…）每年都一样：照最近一次 App 里排的，不管甲乙丙年
  const extraFrom = source?.extra?.length ? source : sources.filter(s => s.extra?.length).sort((a, b) => b.ly - a.ly)[0];
  const slots = buildSlots(template, source, ordinary, nearestMass(date, masses), template.some(t => t.key === 'amen') ? amenFrom(date, ordinary, masses) : [], extraFrom?.extra || []);
  return { day, sources, source, slots, ordinary, note: source?.note || '' };
}

// ───────── 选歌时的推荐 ─────────
// 旧歌单对到曲库很花时间：对过一次就记住
const blockCache = new Map();
const historySongs = (i, library) => {
  if (!blockCache.has(i)) blockCache.set(i, matchBlock(HISTORY[i].l, library));
  return blockCache.get(i);
};
const DAY = 864e5;
// 页面打开后慢慢先对好（一次 20 份），第一次点「选歌」就不会卡
export function warmHistory(library) {
  let i = 0;
  const step = () => {
    const end = Math.min(i + 20, HISTORY.length);
    for (; i < end; i++) historySongs(i, library);
    if (i < HISTORY.length) setTimeout(step, 30);
  };
  setTimeout(step, 500);
}

// 给一个位置推荐歌：
//   sameDay = 以前这个主日在这个位置唱过的（★ 同一个甲乙丙年）
//   season  = 这个礼仪季在这个位置常唱的（答唱咏每个主日不一样，不推荐）
//   recent  = 前后 5 个礼拜已经排了的歌 → { id: 相差几天 }，提醒不要太密
export function suggestFor(date, title, slotKey, masses, library) {
  const { day, sources } = sourcesFor(date, title, masses, library);
  const add = (map, x, extra) => {
    if (!x.id || x.missing) return;
    const e = map.get(x.id) || { song: x, n: 0, tags: [], sameCycle: false };
    e.n++;
    Object.assign(e, extra(e));
    map.set(x.id, e);
  };
  const same = new Map();
  sources.forEach(s => (s.songs[slotKey] || []).forEach(x => add(same, x, e => ({
    tags: e.tags.concat(`${s.label.slice(0, 4)}${s.cycle}`), sameCycle: e.sameCycle || s.cycle === day.cycle,
  }))));
  const sameDay = [...same.values()].sort((a, b) => b.sameCycle - a.sameCycle || b.n - a.n);

  const season = new Map();
  if (slotKey !== 'psalm') {
    masses.forEach(m => {
      if (m.date === date || SEASON_OF(keyOfTitle(m.title) || litDay(m.date).key) !== day.season) return;
      (m.slots || []).filter(s => s.key === slotKey).forEach(s => s.songs.forEach(x => add(season, x, () => ({}))));
    });
    if (PROPER.includes(slotKey)) HISTORY.forEach((h, i) => {
      if (SEASON_OF(h.k) !== day.season) return;
      (historySongs(i, library)[slotKey] || []).forEach(x => add(season, x, () => ({})));
    });
  }
  const seasonList = [...season.values()].filter(e => !same.has(e.song.id) && e.n >= 2).sort((a, b) => b.n - a.n).slice(0, 12);

  const recent = {};
  const t0 = new Date(date + 'T12:00').getTime();
  masses.forEach(m => {
    if (m.date === date) return;
    const diff = Math.round((new Date(m.date + 'T12:00').getTime() - t0) / DAY);
    if (Math.abs(diff) > 35) return;
    (m.slots || []).forEach(s => s.songs.forEach(x => {
      if (x.id && (recent[x.id] === undefined || Math.abs(diff) < Math.abs(recent[x.id]))) recent[x.id] = diff;
    }));
  });
  return { day, sameDay, season: seasonList, recent };
}

export { litDay, cycleOf };
