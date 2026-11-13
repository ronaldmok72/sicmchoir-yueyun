// 执委专区：贴 Drive 链接或上传 PDF → AI（Gemini）读会议记录，整理成完整记录＋重点＋待办＋要报告的进展
// 钥匙放在 Vercel 的环境变量 GEMINI_API_KEY（Ronald 自己在 Google AI Studio 申请），只有这里看得到，网页拿不到。
// 只有开了「执委专区」的人能用：网页带 Firebase 通行证（Authorization: Bearer），这里验过才做
//
// POST { url } 或 { file: { data: base64, mime, name } }，可加 topics: ['指挥培训', ...]（以前用过的进展分类）
//   → { meeting: { date, no, title, status, time, place, ..., minutes, summary: { points, todos, reports } } }
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
const SCHEMA = S('OBJECT', {
  properties: {
    date: S('STRING', { description: '开会日期 YYYY-MM-DD' }),
    no: S('STRING', { description: '这一年的第几次会议，数字；不知道就空' }),
    title: STR, status: S('STRING', { enum: ['done', 'agenda'] }),
    time: STR, place: STR, attend: STR, absent: STR, prayOpen: STR, prayClose: STR, recorder: STR,
    approveBy: STR, approveSecond: STR,
    agenda: S('ARRAY', { items: STR }),
    minutes: STR, next: STR,
    points: S('ARRAY', { items: STR }),
    todos: S('ARRAY', { items: S('OBJECT', { properties: { t: STR, who: STR, due: STR }, required: ['t', 'who', 'due'] }) }),
    reports: S('ARRAY', { items: S('OBJECT', { properties: { topic: STR, text: STR }, required: ['topic', 'text'] }) }),
    events: S('ARRAY', { items: STR }),
  },
  required: ['date', 'no', 'title', 'status', 'time', 'place', 'attend', 'absent', 'prayOpen', 'prayClose', 'recorder',
    'approveBy', 'approveSecond', 'agenda', 'minutes', 'next', 'points', 'todos', 'reports', 'events'],
});

const prompt = topics => `你是八打灵圣依纳爵天主堂「乐韵歌咏团」执委会的秘书助手。上面是一场执委会议的会议记录（或会前议程）。
把它整理成下面的格式，全部用简体中文，人名照原文。

资料栏：
- date：开会日期 YYYY-MM-DD。原文年份明显写错时（例如内容讲的是 2026 年的事，却写 2025），按内容改正，并在 minutes 第一行用括号注明「原文日期写 …，按内容是 …」。
- no：这一年的第几次会议（只要数字）；title：例如「2026年第三次会议」。
- status：有讨论内容、决议的是 done；只有议程、还没开的是 agenda。
- time、place、attend（出席）、absent（缺席）、prayOpen（开会祷）、prayClose（闭会祷）、recorder（记录员）、approveBy／approveSecond（核准前期记录的提议人／附议人）：原文没有就空字串。
- agenda：议程项目，一项一行，短短的。
- next：下次会议日期时间地点（有写才填）。

minutes（完整记录）：**细节全部保留**，不要删、不要缩成摘要；只是整理成好读的格式：
- 每个议程一段，标题用「### 」开头（例如「### 3. 歌咏团常规练习与管理」）
- 内容一行一点，用「- 」开头；下一层用两个空格再「- 」
- 重要的字（负责人、日期、金额、决议）可以用 **粗体**
- 出席率表之类的表格，压成一行一类，不要丢数字

重点（给忙的人 1 分钟看完）：
- points：4–8 句，每句一件最要紧的事（决议、日期、金额、新安排），白话，不要客套。
- todos：会议交代下来、要人去做的事。t 写要做什么；who 写负责人（原文没写就空）；due 有日期就写 YYYY-MM-DD（年份按开会日期推），没有就空。
- reports：年底要报告的进展，每项一个 topic（分类）＋ text（一两句写到哪了，带数字和日期）。
  topic 尽量用这些现有的分类：${topics.length ? topics.join('、') : '指挥培训、声乐培训、天使团、报佳音 Cantata、披肩／制服、设备、礼仪、新歌、组织与行政、改选与章程、财务、出席率、交流活动、培训'}；真的不合才开新的。

年度活动表（每年年尾交堂区，这场会议的会一条条自动加进去）：
- events：会议里提到「已经办完」（检讨到的）和「已经定好日子要办」的活动，一项一行，开头写月份：「5月 天使团参与侍奉母亲节弥撒」。跟开会不同年的写「2027年1月 …」。
  活动名要短，像「圣诞报佳音 Cantata」「复活节礼仪中文弥撒」「婚礼礼仪 – 2 场」「声乐培训」；有确切日子可加在后面「（22/8）」。
  只是提议、还没定的不要放；不要放「歌咏团执委会议」（会自动加）。`;

async function gemini(key, content, topics) {
  const parts = [content.pdf ? { inline_data: { mime_type: 'application/pdf', data: content.pdf } } : { text: content.text }, { text: prompt(topics) }];
  let busy = false;
  const tried = new Set(), gone = [];
  const once = async model => {
    tried.add(model);
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 32768, responseMimeType: 'application/json', responseSchema: SCHEMA },
      }),
    });
    const j = await r.json().catch(() => ({}));
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
  const due = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : '';
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(g.date || '') ? g.date : '',
    no: /^\d+$/.test(String(g.no || '').trim()) ? Number(g.no) : '',
    title: g.title || '', status: g.status === 'agenda' ? 'agenda' : 'done',
    time: g.time || '', place: g.place || '', attend: g.attend || '', absent: g.absent || '',
    prayOpen: g.prayOpen || '', prayClose: g.prayClose || '', recorder: g.recorder || '',
    approve: { by: g.approveBy || '', second: g.approveSecond || '' },
    agenda: (g.agenda || []).filter(Boolean), minutes: g.minutes || '', next: g.next || '',
    summary: {
      points: (g.points || []).filter(Boolean),
      todos: (g.todos || []).filter(t => t?.t).map(t => ({ t: t.t, who: t.who || '', due: due(t.due), done: false })),
      reports: (g.reports || []).filter(r => r?.text).map(r => ({ topic: r.topic || '其他', text: r.text })),
      events: (g.events || []).map(e => String(e || '').trim()).filter(e => /^(\d{4}\s*年\s*)?\d{1,2}\s*月/.test(e)),
    },
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
    let content;
    if (body.url) content = await fromUrl(String(body.url));
    else if (body.file?.data) {
      const mime = String(body.file.mime || '');
      if (body.file.data.length > MAX * 1.37) throw new Error('文件太大（超过 4MB）');
      if (mime === 'application/pdf') content = { pdf: body.file.data };
      else if (mime.startsWith('text/')) content = { text: Buffer.from(body.file.data, 'base64').toString('utf8') };
      else throw new Error('只读得懂 PDF（Word 请先导出成 PDF）');
    } else throw new Error('请贴 Drive 链接或选一个 PDF');
    const g = await gemini(key, content, topics);
    return res.status(200).end(JSON.stringify({ meeting: meetingOf(g) }));
  } catch (e) {
    return fail(400, String(e.message || e));
  }
};
