// 照片＋乐谱的存放空间（Cloudinary）用了多少。
// 钥匙放在 Vercel 的环境变量（CLOUDINARY_API_KEY、CLOUDINARY_API_SECRET），只有这里看得到，网页拿不到。
const CLOUD = 'dsfhilcgz';

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!key || !secret) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).end(JSON.stringify({ configured: false }));
  }
  try {
    const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/usage`, {
      headers: { Authorization: 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64') },
    });
    if (!r.ok) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).end(JSON.stringify({ configured: true, error: `Cloudinary 回 ${r.status}` }));
    }
    const u = await r.json();
    const pick = o => (o ? { usage: o.usage ?? null, limit: o.limit ?? null, pct: o.used_percent ?? null } : null);
    const out = {
      configured: true,
      plan: u.plan || '',
      updated: u.last_updated || '',
      credits: pick(u.credits),
      storage: pick(u.storage),
      bandwidth: pick(u.bandwidth),
      objects: pick(u.objects),
    };
    // 拿最紧的那一项当「用了多少」
    out.pct = Math.max(...['credits', 'storage', 'bandwidth', 'objects'].map(k => out[k]?.pct ?? 0));
    res.setHeader('Cache-Control', 's-maxage=1800');
    return res.status(200).end(JSON.stringify(out));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).end(JSON.stringify({ configured: true, error: String(e.message || e) }));
  }
};
