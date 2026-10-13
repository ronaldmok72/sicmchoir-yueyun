// 排歌页、这台弥撒总览共用：歌名整理、礼仪曲是哪一套
export const PROPER_KEYS = ['entrance', 'psalm', 'offertory', 'communion', 'thanks', 'recessional'];
// 礼仪曲（一整套）：复制文字时合成一行「弥撒曲：…」
export const ORDINARY = ['kyrie', 'gloria', 'alleluia', 'sanctus', 'mystery', 'agnus'];
export const MASS_SETS = [
  [/常年期/, '常年期'], [/四旬期/, '四旬期'], [/将临期/, '将临期'], [/圣诞期/, '圣诞期'], [/复活期/, '复活期'],
  [/光明弥撒/, '光明弥撒曲'], [/青年(版)?弥撒/, '青年弥撒曲'], [/生命树/, '在生命树下弥撒曲'],
];
export const massSetOf = t => (MASS_SETS.find(([re]) => re.test(t)) || [])[1] || null;
export const clean = t => String(t || '').replace(/^[a-z]\s+/, '');           // 去掉排序用的开头字母 "r 日升之处" → "日升之处"
// WA 文字只留歌名和编号：去掉 B4-2、S84、142bpm、V1、In-3、Key、Pop Balled 这类给乐手看的尾巴
export const TECH_TAIL = /(\s*[-_]?\s*(\bS\d+[\w-]*|\b\d+\s*bpm|\bV\d+\b|\bIn[-\d]|\bGuitar|\b[A-G][#b]?\s*Key|\bStandard|\bMedium|\bBigBand|\bfull\b|\b\d+\s*beat|\d+[’‘'.]\d\b|\b\d+['’‘]?s(?=\s|[A-Z]|$)|\b((Open|Fire|Hard|Heavy|Pop|Soft|Power|Easy|Modern|Folk|Country|Acoustic|Orchestral?)\s+)?(Rock|Pop|Balled|Ballad|Bld|Disco|Shuffle|Orchestral?|Unplugged|Acoustic)(?![A-Za-z]))|_).*$/;
export const waTitle = t => clean(t).replace(/\s*\bB\d+-\d+\b/g, '').replace(TECH_TAIL, '').replace(/\s+-\s*$/, '').trim();
