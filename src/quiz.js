import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, RESULTS } from "./firebase.js";
import { QUESTIONS, CATEGORIES, INTENT, QUIZ_VERSION } from "./quiz-data.js";
import { unlock, isRunning, now, click, playBars } from "./quiz-audio.js";

const $ = id => document.getElementById(id);
const DRAFT_KEY = 'sicQuizDraft';
const DONE_KEY = 'sicQuizDone';

// localStorage 可能被浏览器挡住（无痕模式等），全部包 try/catch
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 没关系 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 没关系 */ } },
};

const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const QMAP = Object.fromEntries(QUESTIONS.map(q => [q.id, q]));
const SECTIONS = ['s-closed', 's-start', 's-quiz', 's-intent', 's-tap', 's-saving', 's-result'];
const show = id => {
  SECTIONS.forEach(s => $(s).classList.toggle('hidden', s !== id));
  window.scrollTo(0, 0);
};

let S = null; // 当前进度

// 用电话登录过的：名字照团员名单，声部那题（E）照名单／注册时自己选的，不用再答
const gate = window.sicStaff;
const VOICE_E = { S: '女高音 S', A: '女低音 A', T: '男高音 T', B: '男低音 B' };
const intents = () => S?.skipE ? INTENT.filter(it => it.id !== 'E') : INTENT;
async function fromMember(st) {
  const who = gate?.me();
  if (!who) return st;
  st.memberId = who.id;
  try {
    const m = await gate.memberById(who.id);
    const v = ['S', 'A', 'T', 'B'].includes(m?.voice) ? m.voice : m?.voiceSelf;
    st.intent.E = VOICE_E[v] || (m?.registeredAt ? '不确定' : st.intent.E);
    st.skipE = !!st.intent.E;
  } catch { /* 没网络就照旧问 */ }
  return st;
}

function newState(name) {
  const order = shuffle(QUESTIONS.filter(q => q.star).map(q => q.id));
  const optOrder = {};
  order.forEach(id => { optOrder[id] = shuffle(QMAP[id].options.map((_, i) => i)); });
  return { v: QUIZ_VERSION, name, order, optOrder, answers: {}, idx: 0, intent: {}, tap: null, stage: 'quiz', startedAt: Date.now() };
}
const saveDraft = () => store.set(DRAFT_KEY, S);

function setProgress(label, done, total) {
  $('progress-wrap').classList.remove('hidden');
  $('progress-label').textContent = label;
  $('progress-count').textContent = total ? `${done} / ${total}` : '';
  $('progress-bar').style.width = total ? `${Math.round(done / total * 100)}%` : '100%';
}

// ───────────── ① 开始 ─────────────
function renderMe() {
  const who = gate?.me();
  $('me-note').classList.toggle('hidden', !who);
  $('btn-login').classList.toggle('hidden', !!who);
  $('name-box').classList.toggle('hidden', !!who);
  if (who) {
    $('me-note').textContent = `👋 ${who.name}（已用电话登录）`;
    $('name-input').value = who.name;
    $('btn-start').disabled = false;
  }
}
$('btn-login').addEventListener('click', () => window.sicLogin?.open());
document.addEventListener('sic-login', () => { window.sicLogin?.close(); renderMe(); });

function initStart() {
  renderMe();
  const draft = store.get(DRAFT_KEY);
  if (draft && draft.v === QUIZ_VERSION && draft.stage !== 'done') {
    $('name-input').value = draft.name;
    $('resume-note').textContent = `上次做到一半（${draft.name}），按"开始"会接着做。`;
    $('resume-note').classList.remove('hidden');
  }
  const input = $('name-input');
  const sync = () => { $('btn-start').disabled = !input.value.trim(); };
  input.addEventListener('input', sync);
  sync();
  $('btn-start').addEventListener('click', async () => {
    const name = gate?.me()?.name || input.value.trim();
    if (!name) return;
    const d = store.get(DRAFT_KEY);
    S = (d && d.v === QUIZ_VERSION && d.name === name && d.stage !== 'done') ? d : await fromMember(newState(name));
    saveDraft();
    goStage();
  });
}

function goStage() {
  if (S.stage === 'quiz') renderQuestion();
  else if (S.stage === 'intent') renderIntent();
  else if (S.stage === 'tap') startTap();
  else submit();
}

// ───────────── ② 选择题 ─────────────
function renderQuestion() {
  show('s-quiz');
  const total = S.order.length;
  const id = S.order[S.idx];
  const q = QMAP[id];
  setProgress('选择题', S.idx, total);
  $('q-cat').textContent = `第 ${S.idx + 1} 题 · ${CATEGORIES[q.cat].short}`;
  $('q-text').innerHTML = q.q;
  const box = $('q-options');
  box.innerHTML = '';
  S.optOrder[id].forEach((orig, k) => {
    const b = document.createElement('button');
    b.className = 'opt w-full text-left px-4 py-3.5 rounded-xl border border-white/10 bg-zinc-900 text-zinc-200 hover:border-white/25 transition-colors leading-snug';
    b.innerHTML = `<span class="text-zinc-500 mr-2">${'ABCD'[k]}.</span>${q.options[orig]}`;
    b.setAttribute('aria-pressed', S.answers[id] === orig ? 'true' : 'false');
    b.addEventListener('click', () => {
      S.answers[id] = orig;
      saveDraft();
      box.querySelectorAll('.opt').forEach(x => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      $('btn-next').disabled = false;
    });
    box.appendChild(b);
  });
  $('btn-prev').disabled = S.idx === 0;
  $('btn-next').disabled = S.answers[id] === undefined;
  $('btn-next').textContent = S.idx === total - 1 ? '做完了，下一步' : '下一题';
}

function initQuizNav() {
  $('btn-prev').addEventListener('click', () => {
    if (S.idx > 0) { S.idx--; saveDraft(); renderQuestion(); }
  });
  $('btn-next').addEventListener('click', () => {
    if (S.answers[S.order[S.idx]] === undefined) return;
    if (S.idx < S.order.length - 1) { S.idx++; saveDraft(); renderQuestion(); }
    else { S.stage = 'intent'; saveDraft(); renderIntent(); }
  });
}

// ───────────── ③ 意愿题 ─────────────
function renderIntent() {
  show('s-intent');
  setProgress('几个小问题', 0, 0);
  const list = $('intent-list');
  list.innerHTML = '';
  intents().forEach(it => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="text-white mb-3 leading-relaxed">${it.id}. ${it.q}</div>`;
    const row = document.createElement('div');
    row.className = 'flex flex-wrap gap-2';
    it.options.forEach(opt => {
      const b = document.createElement('button');
      b.className = 'chip px-4 py-2.5 rounded-xl border border-white/10 bg-zinc-900 text-zinc-300 text-sm';
      const cur = S.intent[it.id];
      const on = it.type === 'multi' ? (cur || []).includes(opt) : cur === opt;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.textContent = opt;
      b.addEventListener('click', () => {
        if (it.type === 'multi') {
          const set = new Set(S.intent[it.id] || []);
          set.has(opt) ? set.delete(opt) : set.add(opt);
          S.intent[it.id] = it.options.filter(o => set.has(o));
          b.setAttribute('aria-pressed', set.has(opt) ? 'true' : 'false');
        } else {
          S.intent[it.id] = opt;
          row.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true');
        }
        saveDraft();
        checkIntent();
      });
      row.appendChild(b);
    });
    wrap.appendChild(row);
    list.appendChild(wrap);
  });
  checkIntent();
}
function checkIntent() {
  const ok = intents().every(it => it.type === 'multi' ? (S.intent[it.id] || []).length > 0 : !!S.intent[it.id]);
  $('btn-intent-next').disabled = !ok;
}
$('btn-intent-next').addEventListener('click', () => { S.stage = 'tap'; saveDraft(); startTap(); });

// ───────────── ④ 听拍子小测 ─────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitUntil = t => sleep(Math.max(0, (t - now()) * 1000));
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

let taps = null; // 正在收集时是数组
function onTap(e) {
  if (!isRunning()) unlock();
  if (!taps) return;
  if (e) e.preventDefault();
  taps.push(now());
  const pad = $('tap-pad');
  pad.classList.add('hit');
  setTimeout(() => pad.classList.remove('hit'), 90);
}
$('tap-pad').addEventListener('pointerdown', onTap);
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !$('s-tap').classList.contains('hidden')) onTap(e);
});

function tapUI({ info, pad = false, status = '', actions = [] }) {
  if (info !== undefined) $('tap-info').innerHTML = info;
  $('tap-pad').classList.toggle('hidden', !pad);
  $('tap-status').innerHTML = status;
  const box = $('tap-actions');
  box.innerHTML = '';
  actions.forEach(([label, fn, primary]) => {
    const b = document.createElement('button');
    b.className = primary
      ? 'flex-1 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold'
      : 'px-5 py-3.5 rounded-xl bg-zinc-800 text-zinc-300';
    b.textContent = label;
    b.addEventListener('click', fn);
    box.appendChild(b);
  });
}
// 每按一个按钮都顺手把声音叫醒（iPhone 第二段起没声音就是因为没叫）
const waitClick = (info, actions) => new Promise(res => tapUI({ info, actions: actions.map(([l, v, p]) => [l, () => { unlock().then(() => res(v)); }, p]) }));

// 在 [起点, 终点] 之间收集按键；phases = [[时间, 提示文字], ...]
async function collect(endT, phases) {
  taps = [];
  tapUI({ pad: true, status: '' });
  phases.forEach(([t, text]) => setTimeout(() => { $('tap-status').innerHTML = text; }, Math.max(0, (t - now()) * 1000)));
  await waitUntil(endT);
  const got = taps;
  taps = null;
  return got;
}

// 校正：8 下"哒"，算出这支手机＋耳朵慢多少
async function calibrate() {
  const spb = 0.6;
  const t0 = now() + 1.0;
  const clicks = Array.from({ length: 8 }, (_, i) => t0 + i * spb);
  clicks.forEach((t, i) => click(t, i === 0));
  const got = await collect(clicks[7] + 0.5, [[now(), '准备…'], [t0 - 0.1, '跟着"哒"点！']]);
  const offs = [];
  clicks.slice(2).forEach(c => {
    let best = null;
    got.forEach(t => { const d = t - c; if (Math.abs(d) < 0.3 && (best === null || Math.abs(d) < Math.abs(best))) best = d; });
    if (best !== null) offs.push(best);
  });
  if (offs.length < 4) return null;
  return Math.min(0.5, Math.max(0, median(offs)));
}

function gradeSync(ms) { return ms <= 50 ? '✅' : ms <= 100 ? '⏳' : '🔴'; }
function gradeSteady(drift, cv) {
  const a = Math.abs(drift);
  if (a <= 4 && cv <= 6) return '✅';
  if (a <= 8 && cv <= 12) return '⏳';
  return '🔴';
}

// 第一关：先听 1 小节 → 跟着点 2 小节 → 钢琴停，自己继续点 4 小节
async function beatTrial(bpb, bpm, lat) {
  const spb = 60 / bpm;
  const t0 = now() + 1.2;
  playBars({ t0, bpm, beatsPerBar: bpb, bars: 3 });
  const beat = i => t0 + i * spb;
  const syncStart = bpb, contStart = 3 * bpb, endIdx = 7 * bpb;
  const got = (await collect(beat(endIdx) + 0.3, [
    [now(), '先听…'],
    [beat(syncStart) - spb * 0.6, '跟着钢琴点！'],
    [beat(contStart) - spb * 0.3, '钢琴停了——<b class="text-white">继续点</b>，保持一样的速度'],
  ])).map(t => t - lat);

  const errs = [];
  for (let i = syncStart; i < contStart; i++) {
    let best = null;
    got.forEach(t => { const d = t - beat(i); if (Math.abs(d) < spb / 2 && (best === null || Math.abs(d) < Math.abs(best))) best = d; });
    if (best !== null) errs.push(best);
  }
  const cont = got.filter(t => t > beat(contStart) - spb / 2);
  const itis = [];
  for (let k = 1; k < cont.length; k++) {
    const d = cont[k] - cont[k - 1];
    if (d > spb * 0.5 && d < spb * 1.6) itis.push(d);
  }
  const r = { bpb, bpm, taps: got.length, syncHits: errs.length, syncBeats: contStart - syncStart };
  if (errs.length >= (contStart - syncStart) / 2) {
    r.syncMs = Math.round(mean(errs.map(Math.abs)) * 1000);
    r.syncBias = Math.round(mean(errs) * 1000); // 负数＝习惯点早，正数＝习惯点晚
    r.syncGrade = gradeSync(r.syncMs);
  } else r.syncGrade = '🔴';
  if (itis.length >= 5) {
    const m = mean(itis);
    const sd = Math.sqrt(mean(itis.map(x => (x - m) ** 2)));
    r.drift = Math.round((spb - m) / spb * 1000) / 10; // 正数＝越点越快
    r.cv = Math.round(sd / m * 1000) / 10;
    r.steadyGrade = gradeSteady(r.drift, r.cv);
  } else r.steadyGrade = '🔴';
  return r;
}

function describeBeat(r) {
  const sync = r.syncMs !== undefined
    ? `跟着钢琴点：${r.syncGrade} 平均差 ${r.syncMs} 毫秒`
    : '跟着钢琴点：🔴 点得太少，看不出来';
  let steady;
  if (r.drift === undefined) steady = '钢琴停了之后：🔴 点得太少，看不出来';
  else {
    const dir = Math.abs(r.drift) <= 4 ? '速度很稳' : r.drift > 0 ? `越点越快（快了约 ${Math.abs(r.drift)}%）` : `越点越慢（慢了约 ${Math.abs(r.drift)}%）`;
    steady = `钢琴停了之后：${r.steadyGrade} ${dir}`;
  }
  return [sync, steady];
}

// 第二关：前奏 4 小节，前奏停了不会再有声音，觉得该开口唱就按
async function entryTrial(bpb, bpm, style, lat) {
  const spb = 60 / bpm;
  const t0 = now() + 1.2;
  playBars({ t0, bpm, beatsPerBar: bpb, bars: 4, style });
  const target = t0 + 4 * bpb * spb;
  const got = await collect(target + 2.5, [[now(), '前奏来了，觉得<b class="text-white">该开口唱了</b>就按一下']]);
  const first = got.find(t => t > t0 + bpb * spb);
  const r = { bpb, bpm, style, taps: got.filter(t => t > t0).length };
  if (first === undefined) { r.verdict = '没按'; return r; }
  const err = first - lat - target;
  r.errMs = Math.round(err * 1000);
  r.errBeats = Math.round(err / spb * 10) / 10;
  const tol = style === 'slow' ? 0.15 : 0.12;
  r.verdict = Math.abs(err) <= tol ? '刚好' : err < 0 ? '太早' : '太晚';
  return r;
}
function describeEntry(label, r) {
  if (r.verdict === '没按') return `${label}：🔴 没按`;
  const icon = r.verdict === '刚好' ? '✅' : Math.abs(r.errBeats) <= 0.5 ? '⏳' : '🔴';
  const howMuch = r.verdict === '刚好' ? '' : Math.abs(r.errBeats) >= 0.8 ? `（差了大约 ${Math.abs(r.errBeats)} 拍）` : `（差了 ${Math.abs(r.errMs) / 1000} 秒）`;
  return `${label}：${icon} ${r.verdict}${howMuch}`;
}

const BEAT_TRIALS = [
  { key: 'beat4', label: '4 拍', bpb: 4, bpm: 96 },
  { key: 'beat3', label: '3 拍', bpb: 3, bpm: 108 },
];
const ENTRY_TRIALS = [
  { key: 'entry4', label: '4 拍的歌', bpb: 4, bpm: 92, style: 'normal' },
  { key: 'entry3', label: '3 拍的歌', bpb: 3, bpm: 104, style: 'normal' },
  { key: 'entrySlow', label: '慢歌', bpb: 4, bpm: 66, style: 'slow' },
];
const TOTAL_SEG = 1 + BEAT_TRIALS.length + ENTRY_TRIALS.length;

async function startTap() {
  show('s-tap');
  setProgress('听拍子小测', 0, 0);
  const T = S.tap || { results: {} };
  S.tap = T;

  const go = await waitClick(`
    <p class="text-white font-semibold">听拍子小测（约 5 分钟）</p>
    <p>🔈 <b class="text-white">请用手机喇叭或有线耳机</b>，<b class="text-red-300">不要用蓝牙耳机</b>——蓝牙会让声音慢 0.15–0.3 秒，结果会全部不准。</p>
    <p>找个安静的地方，把音量开到听得清楚。iPhone 请把<b class="text-white">侧边的静音键拨开</b>。</p>
    <p>做法很简单：<b class="text-white">听到声音，就点下面那个大按钮</b>。一共 ${TOTAL_SEG} 段，每段开始前都会先说明。</p>
    <p class="text-zinc-400">每段只有一次机会，听清楚说明再按开始。</p>`,
    [['现在不方便，跳过', 'skip'], ['开始', 'go', true]]);
  if (go === 'skip') { T.skipped = true; return finishTap(); }

  // 先试听，确定有声音才开始
  for (;;) {
    click(now() + 0.15, true); click(now() + 0.65); click(now() + 1.15);
    const heard = await waitClick(`
      <p class="text-white font-semibold">试听</p>
      <p>刚才应该听到 <b class="text-white">3 下"哒"</b>。听到了吗？</p>`,
      [['没听到', false], ['听到了', true, true]]);
    if (heard) break;
    const again = await waitClick(`
      <p class="text-white font-semibold">没声音的话，试试这几样</p>
      <p>1. 把音量调大（按手机侧边的音量键）</p>
      <p>2. iPhone：把侧边的<b class="text-white">静音键拨开</b>（看不到橙色）</p>
      <p>3. 拿掉蓝牙耳机</p>
      <p>4. 还是不行：关掉这个网页再打开，会从这里接着做</p>`,
      [['跳过这部分', 'skip'], ['再听一次', 'again', true]]);
    if (again === 'skip') { T.skipped = true; return finishTap(); }
  }

  // 校正
  while (T.latencyMs === undefined) {
    await waitClick(`
      <p class="text-white font-semibold">第 1 / ${TOTAL_SEG} 段：校正</p>
      <p>每支手机出声音的速度都不一样。接下来会有 <b class="text-white">8 下"哒"</b>，每听到一下，就点一下下面的大按钮。</p>
      <p class="text-zinc-400">这一步只是让 App 知道你的手机慢多少，不算分。</p>`, [['开始', true, true]]);
    const lat = await calibrate();
    if (lat === null) {
      await waitClick('<p>没点到够，再来一次。</p><p>听到"哒"就马上点大按钮，<b class="text-white">一下"哒"点一下</b>。</p>', [['好', true, true]]);
    } else {
      T.latencyMs = Math.round(lat * 1000);
    }
  }
  const lat = T.latencyMs / 1000;

  // 第一关（每段只有一次机会：练的就是一听就抓到）
  let seg = 1;
  for (const tr of BEAT_TRIALS) {
    seg++;
    await waitClick(`
      <p class="text-white font-semibold">第 ${seg} / ${TOTAL_SEG} 段：跟拍子（${tr.label}）</p>
      <p>钢琴会先弹 1 小节给你听，然后<b class="text-white">跟着拍子一直点</b>。</p>
      <p>过一会儿<b class="text-white">钢琴会停</b>——不要停，<b class="text-white">继续照同样的速度点</b>，直到屏幕说结束。</p>`,
      [['开始', true, true]]);
    const r = await beatTrial(tr.bpb, tr.bpm, lat);
    T.results[tr.key] = r;
    saveDraft();
    const lines = describeBeat(r).map(l => `<p>${l}</p>`).join('');
    await waitClick(`<p class="text-white font-semibold">${tr.label}：结束</p>${lines}`, [['下一段', true, true]]);
  }

  // 第二关
  for (const tr of ENTRY_TRIALS) {
    seg++;
    await waitClick(`
      <p class="text-white font-semibold">第 ${seg} / ${TOTAL_SEG} 段：进歌（${tr.label}）</p>
      <p>这一段<b class="text-white">不是跟拍子</b>。钢琴会弹一段前奏（大约 10 秒），弹完就停，不会有人唱。</p>
      <p>前奏弹的时候<b class="text-white">先不要按</b>。等你觉得"<b class="text-white">现在该开口唱第一个字了</b>"，才按<b class="text-white">一下</b>大按钮。</p>`,
      [['开始', true, true]]);
    let r = await entryTrial(tr.bpb, tr.bpm, tr.style, lat);
    // 一听就按、或跟着拍子一直按 → 是没看懂，不是进歌问题；给一次重来
    if (r.taps >= 3 || (r.errBeats !== undefined && r.errBeats <= -tr.bpb)) {
      await waitClick(`
        <p class="text-white font-semibold">再来一次</p>
        <p>${r.taps >= 3 ? `你按了 ${r.taps} 下。` : '你在前奏还没弹完就按了。'}</p>
        <p>这一段是：<b class="text-white">整段前奏听完，到该唱第一个字时，只按一下</b>。前奏中间不要按。</p>`,
        [['再来', true, true]]);
      r = await entryTrial(tr.bpb, tr.bpm, tr.style, lat);
      r.tries = 2;
    }
    T.results[tr.key] = r;
    saveDraft();
    await waitClick(`<p class="text-white font-semibold">结束</p><p>${describeEntry(tr.label, r)}</p>`, [['下一段', true, true]]);
  }
  finishTap();
}

function finishTap() {
  S.tap.done = true;
  S.stage = 'submit';
  saveDraft();
  submit();
}

// ───────────── ⑤ 送出 ─────────────
function computeScores() {
  const scores = {};
  Object.keys(CATEGORIES).forEach(c => { scores[c] = { correct: 0, total: 0 }; });
  const correctIds = [];
  S.order.forEach(id => {
    const q = QMAP[id];
    scores[q.cat].total++;
    if (S.answers[id] === 0) { scores[q.cat].correct++; correctIds.push(id); }
  });
  return { scores, correctIds };
}

async function submit() {
  show('s-saving');
  $('progress-wrap').classList.add('hidden');
  const { scores, correctIds } = computeScores();
  const answers = {};
  S.order.forEach(id => { answers[String(id)] = S.answers[id] ?? null; });
  const doc = {
    name: S.name,
    nameKey: S.name.trim().toLowerCase(),
    version: QUIZ_VERSION,
    createdAt: serverTimestamp(),
    clientTime: new Date().toISOString(),
    durationSec: Math.round((Date.now() - S.startedAt) / 1000),
    questionIds: S.order,
    answers,
    correctIds,
    totalCorrect: correctIds.length,
    totalQuestions: S.order.length,
    scores,
    intent: S.intent,
    ...(S.memberId ? { memberId: S.memberId } : {}),
    tap: S.tap || { skipped: true },
    ua: navigator.userAgent.slice(0, 200),
  };
  try {
    $('save-error').classList.add('hidden');
    $('btn-retry-save').classList.add('hidden');
    const ref = await addDoc(collection(db, RESULTS), doc);
    const done = { id: ref.id, name: S.name, scores, correctIds, order: S.order, answers: S.answers, tap: doc.tap };
    store.set(DONE_KEY, done);
    store.del(DRAFT_KEY);
    renderResult(done);
  } catch (err) {
    console.error(err);
    $('save-error').textContent = `送不出去（${err.code || err.message}）。检查一下网络再按一次；你的答案都还在这支手机里。`;
    $('save-error').classList.remove('hidden');
    $('btn-retry-save').classList.remove('hidden');
  }
}
$('btn-retry-save').addEventListener('click', submit);

// ───────────── ⑥ 结果 ─────────────
function renderResult(d) {
  show('s-result');
  $('r-name').textContent = d.name;
  const cats = Object.keys(CATEGORIES);
  const pct = c => d.scores[c].total ? d.scores[c].correct / d.scores[c].total : 0;
  const total = cats.reduce((s, c) => s + d.scores[c].correct, 0);
  const totalQ = cats.reduce((s, c) => s + d.scores[c].total, 0);
  const sorted = [...cats].sort((a, b) => pct(b) - pct(a));
  const best = sorted[0], weak = sorted[sorted.length - 1];
  $('r-summary').innerHTML = pct(best) - pct(weak) < 0.1
    ? `40 题答对 <b>${total}</b> 题，四个部分都很平均。`
    : `40 题答对 <b>${total}</b> 题。你最强的是<b class="text-indigo-300">「${CATEGORIES[best].short}」</b>，可以多加强<b class="text-amber-300">「${CATEGORIES[weak].short}」</b>。`;
  if (totalQ !== 40) $('r-summary').innerHTML = $('r-summary').innerHTML.replace('40 题', `${totalQ} 题`);

  $('r-bars').innerHTML = cats.map(c => {
    const p = Math.round(pct(c) * 100);
    return `<div>
      <div class="flex justify-between text-sm mb-1.5"><span>${CATEGORIES[c].name}</span><span class="text-zinc-400">${d.scores[c].correct} / ${d.scores[c].total}</span></div>
      <div class="h-2.5 bg-zinc-800 rounded-full overflow-hidden"><div class="h-full rounded-full ${p >= 75 ? 'bg-emerald-500' : p >= 50 ? 'bg-indigo-500' : 'bg-amber-500'}" style="width:${p}%"></div></div>
    </div>`;
  }).join('');

  const t = d.tap || {};
  const R = t.results || {};
  const tapLines = [];
  if (t.skipped) tapLines.push('这次跳过了。');
  BEAT_TRIALS.forEach(tr => { if (R[tr.key]) tapLines.push(`<div class="text-zinc-400 mt-2">跟拍子 · ${tr.label}</div>`, ...describeBeat(R[tr.key]).map(l => `<div>${l}</div>`)); });
  const entries = ENTRY_TRIALS.filter(tr => R[tr.key]);
  if (entries.length) tapLines.push('<div class="text-zinc-400 mt-3">进歌</div>', ...entries.map(tr => `<div>${describeEntry(tr.label, R[tr.key])}</div>`));
  $('r-tap').innerHTML = tapLines.join('') || '没有资料。';

  const wrong = d.order.filter(id => !d.correctIds.includes(id));
  $('r-wrong').innerHTML = wrong.length
    ? wrong.map(id => {
        const q = QMAP[id];
        const mine = d.answers[id];
        return `<div class="border-t border-white/5 pt-3">
          <div class="text-zinc-200 mb-1.5">${q.q}</div>
          ${mine !== undefined && mine !== null ? `<div class="text-red-300/90">你选：${q.options[mine]}</div>` : ''}
          <div class="text-emerald-300/90">答案：${q.options[0]}</div>
          <div class="text-zinc-500 text-xs mt-1">来源：${q.src}</div>
        </div>`;
      }).join('')
    : '<div class="text-emerald-300">全部答对 🎉</div>';
}

// ───────────── 启动 ─────────────
initQuizNav();
const done = store.get(DONE_KEY);
// 测验关着：团员看到「没有开」（做过的还是可以看自己的结果）；有后台权限的照样可以试
const quizOpen = await (window.sicQuiz?.load() ?? true);
if (!quizOpen && gate?.isStaff()) $('closed-note').classList.remove('hidden');
if (!quizOpen && !gate?.isStaff() && !done) {
  show('s-closed');
} else if (done && new URLSearchParams(location.search).get('again') === null) {
  renderResult(done);
  const p = document.createElement('p');
  p.className = 'text-xs text-zinc-600 text-center';
  p.innerHTML = '<a href="?again" class="underline">重新做一次（会另外送一份）</a>';
  $('s-result').appendChild(p);
} else {
  show('s-start');
  initStart();
}
