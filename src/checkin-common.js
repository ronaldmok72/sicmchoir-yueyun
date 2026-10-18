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
// 2026-10-18 起：扫了签到就算整场到（P）；只有早走、走前签退在 end 之前 → T（早退）
// 不再照签到时间自动算迟到（忘了扫、晚上才补扫的人会被冤枉）；真的迟到由点名的人手动改
export function markFor(t, start, end) {
  const early = end && t?.out && hm(t.out) < end;
  return early ? 'T' : 'P';
}
