// 执委专区：贴 Drive 链接或上传 PDF → AI（Gemini）读会议记录，整理成完整记录＋重点＋待办＋要报告的进展
// 钥匙放在 Vercel 的环境变量 GEMINI_API_KEY（Ronald 自己在 Google AI Studio 申请），只有这里看得到，网页拿不到。
// 只有开了「执委专区」的人能用：网页带 Firebase 通行证（Authorization: Bearer），这里验过才做
//
// 分两步（一次做完，长的会议会超时）：
// 第 1 步 POST { url } 或 { file: { data: base64, mime, name } }
//   → { meeting: { date, no, title, status, time, place, ..., agenda, minutes, next } }
// 第 2 步 POST { stage: 'summary', minutes, date, title, topics: ['指挥培训', ...] }（topics 是以前用过的进展分类）
//   → { summary: { points, todos, reports, events } }
// GET → { configured: true/false }
const crypto = require('crypto');

const PROJECT = 'sicmchoir-yueyun';
const MODELS = [process.env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'].filter(Boolean);
const MAX = 4 * 1024 * 1024;   // Vercel 一次最多收 4.5MB

// ───────── 验通行证（Firebase ID token，Google 签的） ─────────
let certs = null, certsUntil = 0;
async function googleCerts() {
  if (certs && Date.now() < certsUntil) return certs;
  const r = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  const age = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
  certs = await r.json();
  certsUntil = Date.now() + (age ? +age[1] : 3600) * 1000;
  return certs;
}
async function claimsOf(token) {
  const [h, b, s] = String(token || '').split('.');
  if (!h || !b || !s) return null;
  const head = JSON.parse(Buffer.from(h, 'base64url').toString());
  const body = JSON.parse(Buffer.from(b, 'base64url').toString());
  const cert = (await googleCerts())[head.kid];
  if (!cert || head.alg !== 'RS256') return null;
  if (!crypto.createVerify('RSA-SHA256').update(`${h}.${b}`).verify(cert, s, 'base64url')) return null;
  const now = Date.now() / 1000;
  if (body.aud !== PROJECT || body.iss !== `https://securetoken.google.com/${PROJECT}` || body.exp < now) return null;
  return body;
}

// ───────── 拿会议记录的内容 ─────────
// Google 文件 → 文字；Drive 上的 PDF → PDF。都要在 Drive 开「知道链接的人都能看」
async function fromUrl(url) {
  const id = (/\/d\/([\w-]{20,})/.exec(url) || /[?&]id=([\w-]{20,})/.exec(url) || [])[1];
  if (!id) throw new Error('这个不像 Google Drive 的链接');
  const doc = /docs\.google\.com\/document/.test(url);
  const r = await fetch(doc ? `https://docs.google.com/document/d/${id}/export?format=txt`
    : `https://drive.google.com/uc?export=download&id=${id}`, { redirect: 'follow' });
  const type = (r.headers.get('content-type') || '').split(';')[0];
  if (!r.ok || type === 'text/html') throw new Error('打不开这个链接：请在 Drive 按「分享」→ 一般存取权改成「知道链接的人」都能看；或者直接上传 PDF');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX) throw new Error('文件太大（超过 4MB）');
  if (doc || type.startsWith('text/')) return { text: buf.toString('utf8').replace(/^﻿/, '') };
  if (type === 'application/pdf' || buf.subarray(0, 5).toString() === '%PDF-') return { pdf: buf.toString('base64') };
  // Drive 上的 Word（有时只说是 octet-stream，看开头是不是 zip）：让 Google 转成文字
  if (/wordprocessingml|msword/.test(type) || buf.subarray(0, 2).toString() === 'PK') return fromUrl(`https://docs.google.com/document/d/${id}/edit`);
  throw new Error('只读得懂 PDF 和 Google 文件');
}

// ───────── 叫 AI 整理 ─────────
const S = (type, extra = {}) => ({ type, ...extra });
const STR = S('STRING');
// 分两步做（内容长的会议一步做完会超时）：
//   第 1 步 → 读原始资料，写完整会议记录（资料栏＋minutes）
//   第 2 步 stage:'summary' → 只读第 1 步写好的记录，抽出重点、待办、进展、年度活动（很快）
const SCHEMA_MIN = S('OBJECT', {
  properties: {
    date: S('STRING', { description: '开会日期 YYYY-MM-DD' }),
    no: S('STRING', { description: '这一年的第几次会议，数字；不知道就空' }),
    title: STR, status: S('STRING', { enum: ['done', 'agenda'] }),
    time: STR, place: STR, attend: STR, absent: STR, prayOpen: STR, prayClose: STR, recorder: STR,
    approveBy: STR, approveSecond: STR,
    agenda: S('ARRAY', { items: STR }),
    minutes: STR, next: STR,
  },
  required: ['date', 'no', 'title', 'status', 'time', 'place', 'attend', 'absent', 'prayOpen', 'prayClose', 'recorder',
    'approveBy', 'approveSecond', 'agenda', 'minutes', 'next'],
});
const SCHEMA_SUM = S('OBJECT', {
  properties: {
    points: S('ARRAY', { items: STR }),
    todos: S('ARRAY', { items: S('OBJECT', { properties: { t: STR, who: STR, due: STR }, required: ['t', 'who', 'due'] }) }),
    reports: S('ARRAY', { items: S('OBJECT', { properties: { topic: STR, text: STR }, required: ['topic', 'text'] }) }),
    events: S('ARRAY', { items: STR }),
  },
  required: ['points', 'todos', 'reports', 'events'],
});

const promptMin = () => `你是八打灵圣依纳爵天主堂「乐韵歌咏团」执委会的秘书助手。上面是一场执委会议的资料（会议记录、会前议程，或几个人写的草稿＋录音补充）。
**从头到尾全部读完**：资料可能来自好几个人（秘书草稿、另一位秘书的草稿、各人汇报、录音补充），每一份都要用上；同一件事几份都有写，合成一条，不要重复。
全部用简体中文，人名照原文。

资料栏：
- date：开会日期 YYYY-MM-DD。原文年份明显写错时（例如内容讲的是 2026 年的事，却写 2025），按内容改正，并在 minutes 第一行用括号注明「原文日期写 …，按内容是 …」。
- no：这一年的第几次会议（只要数字）；title：例如「2026年第三次会议」。
- status：有讨论内容、决议的是 done；只有议程、还没开的是 agenda。
- time、place、attend（出席）、absent（缺席）、prayOpen（开会祷）、prayClose（闭会祷）、recorder（记录员）、approveBy／approveSecond（核准前期记录的提议人／附议人）：原文没有就空字串。
- agenda：议程项目，一项一行，短短的。
- next：下次会议日期时间地点（有写才填）。

minutes（完整记录）：要完整、有细节，但不啰嗦。照以前会议记录的样子：
- 每个议程一段，标题用「### 」加中文序号（例如「### 三、上次会议待办跟进」）
- 内容一行一点，用「- 」开头；下一层用两个空格再「- 」
- 每一点写清楚：谁报告／谁提议、讨论到什么、最后怎么定；数字、日期、金额、人名全部保留
- 会议**通过的决定**，那一点开头加编号「**【决议 第几次会议-序号】**」（例如第 6 次会议：【决议 6-1】、【决议 6-2】…，整份按顺序编），以后可以追溯
- 交代给人去做的事，在那一点后面写「→ 负责：某某（期限）」
- 只是提议、还没定的，写「（待定）」，不要写成决议
- 出席率表之类的表格，压成一行一类，不要丢数字
- 资料里没有的不要编`;

const promptSum = topics => `上面是乐韵歌咏团一场执委会议的正式会议记录。只根据这份记录，抽出下面几样（不要编记录里没有的）：

- points：4–8 句，给忙的人 1 分钟看完，每句一件最要紧的事（决议、日期、金额、新安排），白话，不要客套；是决议的句子开头带编号，例如「【6-2】…」。
- todos：会议交代下来、要人去做的事（记录里「→ 负责：」的都要有）。t 写要做什么；who 写负责人（没写就空）；due 有日期就写 YYYY-MM-DD（年份按开会日期推），没有就空。
- reports：年底要报告的进展，每项一个 topic（分类）＋ text（一两句写到哪了，带数字和日期）。
  topic 尽量用这些现有的分类：${topics.length ? topics.join('、') : '指挥培训、声乐培训、天使团、报佳音 Cantata、披肩／制服、设备、礼仪、新歌、组织与行政、改选与章程、财务、出席率、交流活动、培训'}；真的不合才开新的。
- events（年度活动表，每年年尾交堂区）：记录里提到「已经办完」（检讨到的）和「已经定好日子要办」的活动，一项一行，开头写月份：「5月 天使团参与侍奉母亲节弥撒」。跟开会不同年的写「2027年1月 …」。
  活动名要短，像「圣诞报佳音 Cantata」「复活节礼仪中文弥撒」「婚礼礼仪 – 2 场」「声乐培训」；有确切日子可加在后面「（22/8）」。
  只是提议、还没定的不要放；不要放「歌咏团执委会议」（会自动加）。`;

async function gemini(key, content, instruction, schema) {
  const parts = [content.pdf ? { inline_data: { mime_type: 'application/pdf', data: content.pdf } } : { text: content.text }, { text: instruction }];
  let busy = false, slow = false;
  const tried = new Set(), gone = [];
  const deadline = Date.now() + 270e3;   // Vercel 最多给 300 秒，留点时间回话
  // 整理会议记录不用「想」很久：叫它少想、直接写（新旧型号写法不一样）
  const think = model => /gemini-2\.5/.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: 'low' };   // 新型号（含 gemini-flash-latest）；不认的话下面会自动不加再试
  const once = async (model, noThink) => {
    tried.add(model);
    const left = deadline - Date.now();
    if (left < 20e3) { slow = true; return null; }
    const cfg = { temperature: 0.2, maxOutputTokens: 32768, responseMimeType: 'application/json', responseSchema: schema };
    const tc = !noThink && think(model);
    if (tc) cfg.thinkingConfig = tc;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), Math.min(left, 200e3));
    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', signal: ac.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: cfg }),
      });
    } catch (e) {
      if (e.name === 'AbortError') { slow = true; return null; }   // 太久 → 换下一个
      throw e;
    } finally { clearTimeout(timer); }
    const j = await r.json().catch(() => ({}));
    // 这个型号不认「少想」的写法 → 同一个型号不加再试一次
    if (r.status === 400 && tc && /think/i.test(j.error?.message || '')) return once(model, true);
    if (r.status === 404) { gone.push(model); return null; }   // 型号退休了 → 试下一个
    // 太多人用（503）／一时出错（500）→ 换下一个型号
    if (r.status === 503 || r.status === 500) { busy = true; return null; }
    if (r.status === 429) throw new Error('AI 今天的免费额度用完了，明天再试');
    if (!r.ok) throw new Error('AI 出错：' + (j.error?.message || r.status));
    const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    if (!text) throw new Error('AI 没有回答（' + (j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason || '不知道原因') + '）');
    return JSON.parse(text);
  };
  for (const model of MODELS) {
    const g = await once(model);
    if (g) return g;
  }
  // 认识的型号都不在了 → 问 Google 现在有哪些，挑 flash 的（新的先试，lite 最后）
  for (const model of (await currentModels(key)).filter(m => !tried.has(m)).slice(0, 4)) {
    const g = await once(model);
    if (g) return g;
  }
  if (slow) throw new Error('AI 整理太久没做完（内容很长）。再按一次试试；还是不行，请跟 Ronald 说');
  if (busy) throw new Error('Google 的 AI 现在太多人用，请过一两分钟再按一次');
  throw new Error(`找不到可以用的 AI 型号（试过 ${gone.join('、')}），请跟 Ronald 说`);
}

async function currentModels(key) {
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
    const j = await r.json();
    const ver = n => Number((n.match(/(\d+(?:\.\d+)?)/) || [0, 0])[1]);
    return (j.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''))
      .filter(n => /^gemini-[\d.]+-flash/.test(n) && !/image|tts|audio|live|thinking/.test(n))
      .sort((a, b) => (/lite/.test(a) - /lite/.test(b)) || (/preview|exp/.test(a) - /preview|exp/.test(b)) || (ver(b) - ver(a)));
  } catch { return []; }
}

// AI 回来的 → 跟 App 里一场会议一样的样子
function meetingOf(g) {
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(g.date || '') ? g.date : '',
    no: /^\d+$/.test(String(g.no || '').trim()) ? Number(g.no) : '',
    title: g.title || '', status: g.status === 'agenda' ? 'agenda' : 'done',
    time: g.time || '', place: g.place || '', attend: g.attend || '', absent: g.absent || '',
    prayOpen: g.prayOpen || '', prayClose: g.prayClose || '', recorder: g.recorder || '',
    approve: { by: g.approveBy || '', second: g.approveSecond || '' },
    agenda: (g.agenda || []).filter(Boolean), minutes: g.minutes || '', next: g.next || '',
  };
}
function summaryOf(g) {
  const due = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : '';
  return {
    points: (g.points || []).filter(Boolean),
    todos: (g.todos || []).filter(t => t?.t).map(t => ({ t: t.t, who: t.who || '', due: due(t.due), done: false })),
    reports: (g.reports || []).filter(r => r?.text).map(r => ({ topic: r.topic || '其他', text: r.text })),
    events: (g.events || []).map(e => String(e || '').trim()).filter(e => /^(\d{4}\s*年\s*)?\d{1,2}\s*月/.test(e)),
  };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const key = process.env.GEMINI_API_KEY;
  if (req.method === 'GET') return res.status(200).end(JSON.stringify({ configured: !!key }));
  if (req.method !== 'POST') return res.status(405).end('{}');
  const fail = (code, error) => res.status(code).end(JSON.stringify({ error }));
  if (!key) return fail(503, 'AI 还没接上：Vercel 里还没放 GEMINI_API_KEY');

  let who;
  try { who = await claimsOf((req.headers.authorization || '').replace(/^Bearer /, '')); } catch { who = null; }
  if (!who || !(who.areas || []).includes('committee')) return fail(401, '没有权限（要开「执委专区」）');

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const topics = (Array.isArray(body.topics) ? body.topics : []).map(String).slice(0, 40);
    // 第 2 步：只读第 1 步写好的记录
    if (body.stage === 'summary') {
      const minutes = String(body.minutes || '').slice(0, 200000);
      if (!minutes.trim()) throw new Error('还没有会议记录可以抽重点');
      const head = `会议：${String(body.title || '')}　日期：${String(body.date || '')}\n\n`;
      const g = await gemini(key, { text: head + minutes }, promptSum(topics), SCHEMA_SUM);
      return res.status(200).end(JSON.stringify({ summary: summaryOf(g) }));
    }
    let content;
    if (body.url) content = await fromUrl(String(body.url));
    else if (body.file?.data) {
      const mime = String(body.file.mime || '');
      if (body.file.data.length > MAX * 1.37) throw new Error('文件太大（超过 4MB）');
      if (mime === 'application/pdf') content = { pdf: body.file.data };
      else if (mime.startsWith('text/')) content = { text: Buffer.from(body.file.data, 'base64').toString('utf8') };
      else throw new Error('只读得懂 PDF（Word 请先导出成 PDF）');
    } else throw new Error('请贴 Drive 链接或选一个 PDF');
    // 第 1 步：完整会议记录
    const g = await gemini(key, content, promptMin(), SCHEMA_MIN);
    return res.status(200).end(JSON.stringify({ meeting: meetingOf(g) }));
  } catch (e) {
    return fail(400, String(e.message || e));
  }
};
