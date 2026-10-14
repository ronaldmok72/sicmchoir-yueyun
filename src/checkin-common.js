// 现场 QR 签到：点名页开 QR，团员用手机扫 → checkin.html?e=点名id&k=时段.暗号
// QR 每 30 秒换一次，暗号 = SHA-256(这次点名的 qr 密码 | 时段) 前 10 码；
// 截图传给没来的人也没用（过 1–2 分钟就失效）
// attendance/{id} 多了：qr（密码）、start / end（'20:00' / '22:00'，开始后才到 = 迟到，结束前走 = 早退）、
// times: { 团员id: { in: ISO, out: ISO } }
export const STEP = 30000;
export const DEFAULT_TIME = { practice: ['20:00', '22:00'] };   // 星期四、六练歌 8pm–10pm

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
// 迟到或早退 → T；不然 P
export function markFor(t, start, end) {
  const late = start && t?.in && hm(t.in) > start;
  const early = end && t?.out && hm(t.out) < end;
  return late || early ? 'T' : 'P';
}
