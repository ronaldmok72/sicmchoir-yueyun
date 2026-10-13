// 团员名单、座位表、这台弥撒共用：声部名称、男声还是女声
// 每个人都会唱主旋律；有些人另外会唱声部（S A T B）。所以没填声部 = 只唱主旋律
export const VOICES = [
  { key: 'S', label: '女高音 S' }, { key: 'A', label: '女低音 A' },
  { key: 'T', label: '男高音 T' }, { key: 'B', label: '男低音 B' },
  { key: '', label: '只唱主旋律' },
];
export const VOICE_NAME = { ...Object.fromEntries(VOICES.map(v => [v.key, v.label])), M: '只唱主旋律' };
export const VOICE_SHORT = { S: 'S', A: 'A', T: 'T', B: 'B', M: '主旋律', '': '主旋律' };
// 旧资料（测验）里的「M 主旋律」跟没填一样
export const normVoice = v => (v === 'S' || v === 'A' || v === 'T' || v === 'B') ? v : '';

// 女声 F／男声 M：名单写了就照写的；不然看声部（S A 女、T B 男）；再不然看披肩号码（1–30 女、31 起男）
export function genderOf(m, voice = m?.voice) {
  if (!m) return '';
  if (m.gender === 'F' || m.gender === 'M') return m.gender;
  return genderFromVoice(voice) || (m.cape ? (m.cape <= 30 ? 'F' : 'M') : '');
}
export const genderFromVoice = v => (v === 'S' || v === 'A') ? 'F' : (v === 'T' || v === 'B') ? 'M' : '';
