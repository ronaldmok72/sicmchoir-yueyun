// 现场 QR 签到：点名页开 QR，团员用手机扫 → checkin.html?e=点名id&k=时段.暗号
// QR 每 30 秒换一次，暗号 = SHA-256(这次点名的 qr 密码 | 时段) 前 10 码；
// 截图传给没来的人也没用（过 1–2 分钟就失效）
// attendance/{id} 多了：qr（密码）、start / end（'20:30' / '22:00'：start 后才到 = 迟到，end 前走 = 早退）、
// times: { 团员id: { in: ISO, out: ISO } }
export const STEP = 30000;
// 星期四、六练歌 8pm–10.30pm，前后各留半小时：8.30pm 后才到算迟到、10pm 前走算早退
export const DEFAULT_TIME = { practice: ['20:30', '22:00'] };

export const slotNow = () => Math.floor(Date.now() / STEP);
export async function tokenOf(secret, slot) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}|${slot}`));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 10);
}
// 前 2 分钟内的 QR 都算（扫得慢、两部手机时间差一点也没关系）
export async function tokenOk(secret, k) {
  const [s, t] = String(k || '').split('.');
  const slot = Number(s), now = slotNow();
  if (!secret || !t || !(slot >= now - 4 && slot <= now + 2)) return false;
  return (await tokenOf(secret, slot)) === t;
}
export const randomSecret = () => [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');

export const hm = iso => iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
// 迟到（start 后才签到）或早退（end 前签退）→ T；不然 P
export const lateOf = (t, start) => !!(start && t?.in && hm(t.in) > start);
export const earlyOf = (t, end) => !!(end && t?.out && hm(t.out) < end);
export function markFor(t, start, end) {
  return lateOf(t, start) || earlyOf(t, end) ? 'T' : 'P';
}

// ───────── 出席积分（2026-10-18 Ronald 定，暂时版）─────────
// 完整出席 1 分；迟到扣 0.2、早退扣 0.2；有签到没签退只给 0.5（不知道几点走）；请假 0.1；缺席 0
// 10/25：忘了签到、走的时候才签退 → 也是 0.5（不知道几点到），早退照扣 0.2
// 每次点名存在 attendance/{id}.pts[团员id]；手动点的照下面 PTS；没点到、但在「这台弥撒」按了不来 → 算请假
export const PTS = { P: 1, T: 0.8, L: 0.1, A: 0 };
export const IN_ONLY = 0.5;
const r1 = x => Math.round(x * 10) / 10;
export function scanScore(t, start, end) {
  if (!t?.in) return t?.out ? r1(IN_ONLY - (earlyOf(t, end) ? 0.2 : 0)) : 0;
  if (!t.out) return IN_ONLY;
  return r1(1 - (lateOf(t, start) ? 0.2 : 0) - (earlyOf(t, end) ? 0.2 : 0));
}
// 这一次点名，这个人算什么（P/T/L/A，没点又没投票 → ''）
export const markOf = (e, id, vote) => e?.marks?.[id] || (vote === 'N' ? 'L' : '');
export function scoreOf(e, id, vote) {
  if (e?.pts && id in e.pts && e.marks?.[id]) return e.pts[id];
  const k = markOf(e, id, vote);
  return k ? PTS[k] : 0;
}
export const fmtPts = x => String(r1(x));
