// 婚礼：跟主日弥撒一起在排歌页排，存 masses/{日期_时间}，例如 2026-10-17_0930
// kind = 'rite' 婚配礼仪（其中一方不是教友）／'wedding' 婚姻弥撒（全套）
// { date, time: '09:30', kind, title, note, setlistName,
//   slots: [{ key, label, songs: [{ id, title, imageUrl }] }],
//   roles: [{ role, name }], singers: [名字], createdAt, savedAt }
// 一天可以有好几台（9.30am、11.30am、1.30pm），所以 id 带时间；排歌页、这台弥撒都用这里

export const WEDDING_ROLES = ['领经', '读经一', '答唱咏', '读经二', '投影', '钢琴', '风琴', '领唱'];
// 职务名统一用中文：WA 名单写 Pianist／Organist 也认得
const ROLE_ZH = { pianist: '钢琴', piano: '钢琴', organist: '风琴', organ: '风琴', cantor: '答唱咏', conductor: '指挥', guitar: '吉他', drums: '鼓手', drummer: '鼓手' };
export const roleZh = r => ROLE_ZH[String(r || '').trim().toLowerCase()] || String(r || '').trim();
export const WEDDING_TIMES = ['09:30', '11:30', '13:30'];

// 09:30 → 9.30am、13:30 → 1.30pm（跟大家平常写的一样）
export function timeText(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}.${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}
// 名字 → 团员：名字／全名一样就是他（大小写、空格、中文名不管：「Agnes Tan」= Agnes Tan 陈玉华）
// 找不到再看第一个字：「Michael Ong」→ 团员名单里只有一个叫 Michael 的就是他
export function findMember(name, members) {
  const n = s => String(s || '').toLowerCase().replace(/\s+/g, '');
  const latin = s => n(String(s || '').replace(/[㐀-鿿]+/g, ''));
  const x = n(name);
  if (!x) return null;
  const keys = m => [m.name, m.fullName].flatMap(v => [n(v), latin(v)]).filter(Boolean);
  const exact = members.find(m => keys(m).includes(x));
  if (exact) return exact;
  const first = n(String(name).trim().split(/\s+/)[0]);
  const hit = members.filter(m => latin(String(m.name).split(/\s+/)[0]) === first);
  return hit.length === 1 ? hit[0] : null;
}
