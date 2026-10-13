// 团员名单、座位表、这台弥撒共用：声部名称、男声还是女声
export const VOICES = [
  { key: 'S', label: '女高音 S' }, { key: 'A', label: '女低音 A' },
  { key: 'T', label: '男高音 T' }, { key: 'B', label: '男低音 B' },
  { key: 'M', label: '主旋律' }, { key: '', label: '还不知道' },
];
export const VOICE_NAME = Object.fromEntries(VOICES.map(v => [v.key, v.label]));
export const VOICE_SHORT = { S: 'S', A: 'A', T: 'T', B: 'B', M: '主旋律', '': '' };

// 女声 F／男声 M：名单上写了就照写的；不然看声部（S A 女、T B 男）；再不然看披肩号码（1–30 女、31 起男）
export function genderOf(m, voice = m?.voice) {
  if (!m) return '';
  if (m.gender === 'F' || m.gender === 'M') return m.gender;
  if (voice === 'S' || voice === 'A') return 'F';
  if (voice === 'T' || voice === 'B') return 'M';
  if (m.cape) return m.cape <= 30 ? 'F' : 'M';
  return '';
}
// 声部定了男女就不用另外选
export const genderFromVoice = v => (v === 'S' || v === 'A') ? 'F' : (v === 'T' || v === 'B') ? 'M' : '';
