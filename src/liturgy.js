// 礼仪年：日期 → 哪一个主日／节日 + 甲乙丙年；礼仪名称（各种写法）→ 同一个 key
// key 例子：OT29（常年期第29主日）、ADV1、LENT3、EAS4、EASTER、PENTECOST、ALLSAINTS
// 不 import 任何东西，浏览器和 node 都能用

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const D = (y, m, d) => new Date(y, m - 1, d, 12);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const same = (a, b) => iso(a) === iso(b);

// 复活节（公历算法）
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return D(y, month, day);
}
// 将临期第一主日：圣诞前第四个主日
function advent1(y) {
  const xmas = D(y, 12, 25);
  const sunBefore = addDays(xmas, -(xmas.getDay() || 7));
  return addDays(sunBefore, -21);
}
// 主显节（马来西亚移到 1/2–1/8 之间的主日）、主受洗节（主显后的主日；主显在 1/7、1/8 就移到星期一）
function epiphany(y) { const d = D(y, 1, 2); return addDays(d, (7 - d.getDay()) % 7); }
function baptism(y) { const e = epiphany(y); return e.getDate() >= 7 ? addDays(e, 1) : addDays(e, 7); }

// 礼仪年 Y = 从 Y-1 年将临期到 Y 年基督君王节；Y%3：1 甲、2 乙、0 丙
export const cycleOf = litYear => ['丙', '甲', '乙'][litYear % 3];

export const SEASON_OF = k => k.startsWith('OT') ? 'OT' : k.startsWith('ADV') ? 'ADV' : k.startsWith('LENT') ? 'LENT' : k.startsWith('EAS') ? 'EAS' : ({
  XMASEVE: 'XMAS', XMAS: 'XMAS', HOLYFAMILY: 'XMAS', MARY: 'XMAS', EPIPHANY: 'XMAS', BAPTISM: 'XMAS', NYE: 'XMAS',
  ASH: 'LENT', PALM: 'LENT', HOLYTHU: 'TRIDUUM', GOODFRI: 'TRIDUUM', VIGIL: 'EAS', EASTER: 'EAS', ASCENSION: 'EAS', PENTECOST: 'EAS',
  IMMACULATE: 'ADV',
}[k] || 'OT');

const NAME = {
  ADV: n => `将临期第${n}主日`, LENT: n => `四旬期第${n}主日`, EAS: n => `复活期第${n}主日`, OT: n => `常年${n}主日`,
  XMASEVE: '圣诞前夕', XMAS: '圣诞节', HOLYFAMILY: '圣家节', MARY: '天主之母节', EPIPHANY: '主显节', BAPTISM: '主受洗节',
  ASH: '圣灰礼仪', PALM: '圣枝主日', HOLYTHU: '主的晚餐', GOODFRI: '主受难日', VIGIL: '复活前夕', EASTER: '复活节',
  ASCENSION: '耶稣升天节', PENTECOST: '圣神降临节', TRINITY: '天主圣三节', CORPUS: '基督圣体圣血节', SACREDHEART: '耶稣圣心节',
  ALLSAINTS: '诸圣节', ALLSOULS: '追思已亡节', HOLYCROSS: '光荣十字圣架节', ASSUMPTION: '圣母升天节', IMMACULATE: '圣母始胎无染原罪节', PRESENTATION: '献耶稣于圣殿节',
  TRANSFIG: '耶稣显圣容节', PATRON: '主保庆典', CNY: '新春感恩弥撒', NYE: '新年前夕', OT34: '耶稣普世君王节',
};
export function nameOf(key) {
  if (NAME[key]) return NAME[key];
  const m = key.match(/^([A-Z]+)(\d+)$/);
  return m && typeof NAME[m[1]] === 'function' ? NAME[m[1]](Number(m[2])) : key;
}

// 日期（主日）→ { key, name, litYear, cycle }
export function litDay(dateStr) {
  const [y, mo, da] = dateStr.split('-').map(Number);
  const d = D(y, mo, da);
  const adv = advent1(y);
  const litYear = d >= adv ? y + 1 : y;
  const res = key => ({ key, name: nameOf(key), litYear, cycle: cycleOf(litYear), season: SEASON_OF(key) });

  // 固定日期的节日（落在主日时取代主日）
  if (mo === 11 && da === 1) return res('ALLSAINTS');
  if (mo === 11 && da === 2) return res('ALLSOULS');
  if (mo === 9 && da === 14) return res('HOLYCROSS');
  if (mo === 8 && da === 15) return res('ASSUMPTION');
  if (mo === 2 && da === 2) return res('PRESENTATION');
  if (mo === 8 && da === 6) return res('TRANSFIG');
  if (mo === 12 && da === 8 && d.getDay() !== 0) return res('IMMACULATE');
  if (mo === 12 && da === 24) return res('XMASEVE');
  if (mo === 12 && da === 25) return res('XMAS');
  if (mo === 12 && da === 31) return res('NYE');
  if (mo === 1 && da === 1) return res('MARY');

  const E = easter(y);
  const off = Math.round((d - E) / 864e5);
  const fixed = { [-46]: 'ASH', [-7]: 'PALM', [-3]: 'HOLYTHU', [-2]: 'GOODFRI', [-1]: 'VIGIL', 0: 'EASTER', 39: 'ASCENSION', 49: 'PENTECOST', 56: 'TRINITY', 63: 'CORPUS', 68: 'SACREDHEART' };
  if (fixed[off]) return res(fixed[off]);
  if (off > -46 && off < -7 && off % 7 === 0) return res(`LENT${(off + 49) / 7}`);
  if (off > 0 && off < 49 && off % 7 === 0) return res(`EAS${off / 7 + 1}`);

  // 圣诞期（12/25 之后到主受洗节）
  if (mo === 12 && da > 25) return res('HOLYFAMILY');
  if (d >= adv) return res(`ADV${Math.floor((d - adv) / 864e5 / 7) + 1}`);
  if (same(d, epiphany(y))) return res('EPIPHANY');
  if (same(d, baptism(y))) return res('BAPTISM');
  if (d < baptism(y)) return res('XMAS');

  // 常年期：主受洗后第一个主日是第 2 主日；圣神降临后从基督君王（第 34）倒数
  if (off < -46) {
    const firstSun = addDays(baptism(y), 7 - baptism(y).getDay() || 7);
    return res(`OT${Math.round((d - firstSun) / 864e5 / 7) + 2}`);
  }
  const king = addDays(adv, -7);
  return res(`OT${34 - Math.round((king - d) / 864e5 / 7)}`);
}

// ───────── 名称 → key（Sheet 里各种写法：常年期第廿九主日、聖枝主日、復活期第四主日…）─────────
const T2S = { 聖: '圣', 節: '节', 復: '复', 臨: '临', 顯: '显', 體: '体', 誕: '诞', 現: '现', 礼: '礼', 禮: '礼', 靈: '灵', 難: '难', 晚: '晚', 華: '华', 無: '无', 獻: '献', 慶: '庆', 歲: '岁', 開: '开', 齋: '斋', 為: '为', 們: '们', 穌: '稣', 稣: '稣', 經: '经', 門: '门', 葉: '叶', 萬: '万', 進: '进', 將: '将', 諸: '诸', 樞: '枢', 紀: '纪', 劝: '劝' };
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnNum(s) {
  if (/^\d+$/.test(s)) return Number(s);
  s = s.replace(/^廿/, '二十').replace(/^卅/, '三十');
  if (s === '十') return 10;
  const m = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? CN[m[1]] : 1) * 10 + (m[2] ? CN[m[2]] : 0);
  return CN[s] || null;
}
const NUM = '([0-9]+|[一二三四五六七八九十廿卅]+)';

export function keyOfTitle(title) {
  const t = String(title || '').split('').map(c => T2S[c] || c).join('').replace(/\s+/g, '');
  const num = re => { const m = t.match(re); return m ? cnNum(m[1]) : null; };
  let n;
  if (/君王/.test(t)) return 'OT34';
  if ((n = num(new RegExp(`常年期?第?${NUM}`))) ) return `OT${n}`;
  if ((n = num(new RegExp(`将临期?第?${NUM}`))) ) return `ADV${n}`;
  if ((n = num(new RegExp(`四旬期?第?${NUM}`))) ) return `LENT${n}`;
  if ((n = num(new RegExp(`复活期第?${NUM}`))) ) return `EAS${n}`;
  const pairs = [
    [/圣灰/, 'ASH'], [/圣枝|苦难主日/, 'PALM'], [/晚餐|圣周四|星期四.*洗脚/, 'HOLYTHU'], [/受难日|圣周五|主受难/, 'GOODFRI'],
    [/复活前夕|守夜/, 'VIGIL'], [/复活(节|主日)/, 'EASTER'], [/圣母.{0,2}升天/, 'ASSUMPTION'],
    [/追思已亡/, 'ALLSOULS'], [/十字圣架/, 'HOLYCROSS'], [/耶稣升天|主升天|升天节/, 'ASCENSION'],
    [/圣神降临|五旬/, 'PENTECOST'], [/圣三/, 'TRINITY'], [/圣体圣血|圣体节/, 'CORPUS'], [/圣心/, 'SACREDHEART'],
    [/诸圣/, 'ALLSAINTS'], [/无染原罪|始胎/, 'IMMACULATE'], [/献耶稣于圣殿|献主|奉献生活/, 'PRESENTATION'], [/显圣容/, 'TRANSFIG'],
    [/主保/, 'PATRON'], [/新春|新年感恩|农历/, 'CNY'], [/新年前夕|除夕/, 'NYE'], [/圣诞前夕|平安夜/, 'XMASEVE'], [/圣家/, 'HOLYFAMILY'],
    [/天主之母|元旦/, 'MARY'], [/主显/, 'EPIPHANY'], [/受洗/, 'BAPTISM'], [/圣诞/, 'XMAS'],
  ];
  for (const [re, k] of pairs) if (re.test(t)) return k;
  return null;
}
