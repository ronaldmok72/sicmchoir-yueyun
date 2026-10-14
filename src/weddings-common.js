// 婚礼弥撒（以后丧礼等特别弥撒也放这里）：Firestore special_masses/{日期_时间}，例如 2026-10-17_0930
// { date, time: '09:30', kind: 'wedding', title, note, setlistName,
//   slots: [{ key, label, short, songs: [{ id, title, imageUrl }] }],
//   roles: [{ role, name }], singers: [名字], createdAt, savedAt }
// 一天可以有好几台（9.30am、11.30am、1.30pm），所以 id 带时间；排歌页、这台弥撒都用这里
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

export const SPECIAL = 'special_masses';

// short = 复制 WA 文字时的简写（「进：主赐幸福」），空的就只写歌名
export const WEDDING_SLOTS = [
  { key: 'entrance', label: '进堂咏', short: '进' },
  { key: 'psalm', label: '答唱咏', short: '答' },
  { key: 'alleluia', label: '阿肋路亚', short: '' },
  { key: 'pater', label: '天主经', short: '' },
  { key: 'communion', label: '领主咏', short: '领' },
  { key: 'thanks', label: '谢主咏', short: '谢' },
  { key: 'recessional', label: '礼成咏', short: '礼' },
];
export const WEDDING_ROLES = ['领经', '读经一', '答唱咏', '读经二', '投影', 'Pianist', 'Organist', '领唱'];
export const WEDDING_TIMES = ['09:30', '11:30', '13:30'];

export const idOf = (date, time) => `${date}_${String(time || '0000').replace(':', '')}`;
// 09:30 → 9.30am、13:30 → 1.30pm（跟大家平常写的一样）
export function timeText(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}.${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}
export const setlistNameOf = w => {
  const [, mm, dd] = (w.date || '').split('-');
  return `${mm || ''}${dd || ''} ${timeText(w.time)} ${w.title || '婚礼'}`.replace(/\s+/g, ' ').trim();
};

// { 日期: [这一天的几台，照时间排] }
export async function loadSpecials(db) {
  const snap = await getDocs(collection(db, SPECIAL));
  const by = {};
  snap.docs.map(d => ({ id: d.id, ...d.data() })).forEach(w => (by[w.date] = by[w.date] || []).push(w));
  Object.values(by).forEach(l => l.sort((a, b) => (a.time || '').localeCompare(b.time || '')));
  return by;
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
