// 点名 / 出席率
// 每一次点名 = attendance/{日期_种类} { date, kind, title, marks: { 团员id: P|T|L|A }, names: { 团员id: 名字 } }
// 每点一个人就存那一个人（两个人一起点也不会互相盖掉）
// 章程：3 个月出席 7 次（config/attendance.need 可以改）；有到 + 迟到早退 = 出席，请假不算出席也不算缺席
import { collection, doc, setDoc, updateDoc, deleteDoc, deleteField, onSnapshot } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, getDocs, getDoc, history } from "./firebase.js";
import { litDay } from "./liturgy.js";
import { DEFAULT_TIME, slotNow, tokenOf, randomSecret, hm, PTS, markOf, scoreOf, fmtPts } from "./checkin-common.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dm = s => { const [, m, d] = s.split('-'); return `${+d}/${+m}`; };
const TODAY = ymd(new Date());

const MARKS = [
  { k: 'P', label: '有到', on: 'bg-emerald-600 text-white border-emerald-600' },
  { k: 'T', label: '迟到/早退', on: 'bg-amber-500 text-white border-amber-500' },
  { k: 'L', label: '请假', on: 'bg-sky-600 text-white border-sky-600' },
  { k: 'A', label: '缺席', on: 'bg-red-600 text-white border-red-600' },
];
const KIND = { mass: '弥撒', practice: '练歌', other: '其他活动' };

let members = [];            // 现在在团的人
let nameOf = {};             // 团员id → 名字（包括已经不在团的）
let fullOf = {};             // 团员id → 全名
let rsvp = {};               // 这次点名的投票（团员在「这台弥撒」页按的会来／不来）：{ 团员id: 'Y'|'N' }
let events = {};             // 点名id → 资料
let extras = {};             // 这台弥撒页加的特别练习：rsvp/{日期}_other = { label, start, end }
let votes = {};              // 点名id → 投票 { 团员id: 'Y'|'N' }（rsvp/{日期_种类}，按「不来」= 请假）
let need = 7;                // 每 3 个月要出席几次
let unsub = null;

const evId = (date, kind) => `${date}_${kind}`;
const evKey = e => evId(e.date, e.kind);
const curId = () => evId($('r-date').value, $('r-kind').value);
const titleFor = (date, kind) => kind === 'mass' ? (litDay(date)?.name || '弥撒') : kind === 'other' && extras[evId(date, kind)]?.label || KIND[kind];

function toast(msg, bad) {
  const s = $('status');
  s.textContent = msg;
  s.classList.toggle('bg-red-600', !!bad);
  s.style.opacity = '1';
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { s.style.opacity = '0'; }, bad ? 4000 : 1200);
}

async function load() {
  const [ms, ev, cfg] = await Promise.all([
    getDocs(collection(db, 'members')),
    history('attendance'),
    getDoc(doc(db, 'config', 'attendance')).catch(() => null),
    history('rsvp').then(q => {
      votes = Object.fromEntries(q.docs.map(d => [d.id, d.data().votes || {}]));
      extras = Object.fromEntries(q.docs.filter(d => d.data().extra).map(d => [d.id, d.data()]));
    }).catch(() => {}),
  ]);
  const all = ms.docs.map(d => ({ id: d.id, ...d.data() }));
  nameOf = Object.fromEntries(all.map(m => [m.id, m.name]));
  fullOf = Object.fromEntries(all.map(m => [m.id, m.fullName || '']));
  members = all.filter(m => m.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  events = Object.fromEntries(ev.docs.map(d => [d.id, d.data()]));
  Object.values(events).forEach(e => Object.entries(e.names || {}).forEach(([id, n]) => { nameOf[id] ??= n; }));
  if (cfg?.exists() && cfg.data().need) need = cfg.data().need;
  $('s-need').value = need;
}

// ---------- 点名 ----------
function openEvent() {
  if (qrTimer) closeQr();
  const id = curId();
  $('r-title').textContent = titleFor($('r-date').value, $('r-kind').value);
  if (unsub) unsub();
  // 别的手机同时在点，这里也会跟着更新
  unsub = onSnapshot(doc(db, 'attendance', id), s => {
    if (s.exists()) events[id] = s.data(); else delete events[id];
    renderRoll();
  }, err => console.error(err));
  rsvp = {};
  getDoc(doc(db, 'rsvp', id)).then(s => { votes[id] = s.exists() ? s.data().votes || {} : {}; if (curId() === id) { rsvp = votes[id]; renderRoll(); } }).catch(() => {});
  renderRoll();
}

function renderRoll() {
  const e = events[curId()];
  const marks = e?.marks || {};
  const q = $('r-q').value.trim().toLowerCase();
  const people = members.concat(Object.keys(marks).filter(id => !members.some(m => m.id === id)).map(id => ({ id, name: nameOf[id] || '（已离团）', gone: true })));
  const k = p => markOf(e, p.id, rsvp[p.id]);
  const n = x => people.filter(p => k(p) === x).length;
  const none = people.filter(p => !k(p)).length;
  const autoL = people.filter(p => !marks[p.id] && rsvp[p.id] === 'N').length;
  const yes = Object.values(rsvp).filter(v => v === 'Y').length, no = Object.values(rsvp).filter(v => v === 'N').length;
  $('r-count').innerHTML = `<div class="flex flex-wrap gap-x-4 gap-y-1">
      <span>✅ 有到 <b>${n('P')}</b></span><span>⏰ 迟到/早退 <b>${n('T')}</b></span>
      <span>📝 请假 <b>${n('L')}</b>${autoL ? `<span class="text-xs text-slate-400">（${autoL} 位在 App 按了不来）</span>` : ''}</span><span>❌ 缺席 <b>${n('A')}</b></span>
      <span class="${none ? 'text-slate-500' : 'text-emerald-600'}">${none ? `还没点 <b>${none}</b> 人（不点就算缺席）` : '✓ 全部点完了'}</span>
    </div>
    ${yes + no ? `<div class="text-xs text-slate-600 mt-1">🗳️ App 投票：🙋 说会来 <b>${yes}</b>　🙅 说不来 <b>${no}</b>（名字旁边有标）</div>` : ''}
    <div class="text-xs text-slate-400 mt-1">点一下就存好了，再点一次同一个就取消。扫 QR 的会自动点好；在「这台弥撒」按了不来的，自动算请假。</div>
    <div class="text-[11px] text-slate-400 mt-0.5">积分：有到 1 · 迟到/早退 0.8（扫码的照实际：各扣 0.2）· 只签到没签退 0.5 · 请假 0.1 · 缺席 0</div>`;
  $('r-list').innerHTML = people.filter(p => !q || `${p.name} ${p.fullName || ''}`.toLowerCase().includes(q)).map(p => `
    <div class="flex flex-wrap items-center gap-2 px-3 py-2.5">
      <div class="flex-1 min-w-[6rem] text-sm">
        <span class="font-semibold">${esc(p.name)}</span>
        ${p.fullName && p.fullName !== p.name ? `<span class="text-xs text-slate-400 ml-1">${esc(p.fullName)}</span>` : ''}
        ${p.gone ? '<span class="text-xs text-slate-400 ml-1">不在名单了</span>' : ''}
        ${rsvp[p.id] === 'Y' ? '<span class="text-xs text-emerald-700 ml-1">🙋 说会来</span>' : rsvp[p.id] === 'N' ? `<span class="text-xs text-sky-700 ml-1">🙅 说不来${marks[p.id] ? '' : '（算请假）'}</span>` : ''}
        ${k(p) ? `<span class="text-xs text-slate-400 ml-1">${fmtPts(scoreOf(e, p.id, rsvp[p.id]))} 分</span>` : ''}
        ${e?.times?.[p.id] ? `<div class="text-[11px] text-slate-400">📱 到 ${hm(e.times[p.id].in)}${e.times[p.id].out ? ` · 走 ${hm(e.times[p.id].out)}` : ' · <span class="text-amber-600">还没签退</span>'}</div>` : ''}
      </div>
      <div class="flex gap-1">
        ${MARKS.map(m => `<button data-id="${esc(p.id)}" data-mark="${m.k}" class="px-2 py-1 text-xs rounded-lg border ${marks[p.id] === m.k ? m.on : 'border-slate-200 text-slate-500 hover:bg-slate-50'}">${m.label}</button>`).join('')}
      </div>
    </div>`).join('') || '<div class="p-4 text-sm text-slate-400">名单是空的，先去「团员名单」加人。</div>';
  $('r-del').classList.toggle('hidden', !e);
  $('r-qr').classList.toggle('hidden', $('r-date').value !== TODAY || $('r-kind').value === 'mass');   // 弥撒不用扫码签到（只用「会来」排座位）
  renderRecent();
  renderQrCount();
}

function renderRecent() {
  const list = Object.entries(events).sort((a, b) => b[1].date.localeCompare(a[1].date)).slice(0, 8);
  const cur = curId();
  $('r-recent').innerHTML = list.length ? '<span class="text-xs text-slate-400 self-center">点过的：</span>' + list.map(([id, e]) => `
    <button data-ev="${esc(id)}" class="px-2 py-1 text-xs rounded-lg border ${id === cur ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}">${dm(e.date)} ${esc(KIND[e.kind] || '')}</button>`).join('') : '';
}

const base = () => {
  const date = $('r-date').value, kind = $('r-kind').value;
  return { date, kind, title: titleFor(date, kind), updatedAt: new Date().toISOString() };
};

async function mark(id, k) {
  const ref = doc(db, 'attendance', curId());
  const e = events[curId()];
  const off = e?.marks?.[id] === k;
  // 先在画面上改好，再存
  events[curId()] = { ...(e || base()), marks: { ...(e?.marks || {}), [id]: off ? undefined : k }, pts: { ...(e?.pts || {}), [id]: off ? undefined : PTS[k] } };
  if (off) { delete events[curId()].marks[id]; delete events[curId()].pts[id]; }
  renderRoll();
  try {
    if (off) await updateDoc(ref, { [`marks.${id}`]: deleteField(), [`pts.${id}`]: deleteField(), updatedAt: new Date().toISOString() });
    else await setDoc(ref, { ...base(), marks: { [id]: k }, pts: { [id]: PTS[k] }, names: { [id]: nameOf[id] || '' } }, { merge: true });
    toast('✓ 存好了');
  } catch (err) { console.error(err); toast('❌ 没存到，检查网络再点一次', true); }
}

$('r-list').addEventListener('click', e => {
  const b = e.target.closest('button[data-mark]');
  if (b) mark(b.dataset.id, b.dataset.mark);
});
$('r-recent').addEventListener('click', e => {
  const b = e.target.closest('button[data-ev]'); if (!b) return;
  const ev = events[b.dataset.ev];
  $('r-date').value = ev.date; $('r-kind').value = ev.kind;
  openEvent();
});
$('r-date').addEventListener('change', () => {
  const d = $('r-date').value; if (!d) return;
  if (!events[curId()]) $('r-kind').value = new Date(d + 'T00:00').getDay() === 0 ? 'mass' : 'practice';
  openEvent();
});
$('r-kind').addEventListener('change', openEvent);
$('r-q').addEventListener('input', renderRoll);

$('r-rest').addEventListener('click', async () => {
  const marks = events[curId()]?.marks || {};
  const rest = members.filter(m => !marks[m.id]);
  if (!rest.length) return toast('全部都点了');
  const kOf = m => rsvp[m.id] === 'N' ? 'L' : 'A';   // 在 App 按了不来 → 请假
  const lv = rest.filter(m => kOf(m) === 'L'), ab = rest.filter(m => kOf(m) === 'A');
  if (!confirm(`还没点的 ${rest.length} 个人：\n${ab.length ? `\n❌ 算缺席（${ab.length}）：${ab.map(m => m.name).join('、')}\n` : ''}${lv.length ? `\n📝 在 App 按了不来，算请假（${lv.length}）：${lv.map(m => m.name).join('、')}\n` : ''}\n确定？（别的请假要先点「请假」）`)) return;
  try {
    await setDoc(doc(db, 'attendance', curId()), {
      ...base(),
      marks: Object.fromEntries(rest.map(m => [m.id, kOf(m)])),
      pts: Object.fromEntries(rest.map(m => [m.id, PTS[kOf(m)]])),
      names: Object.fromEntries(rest.map(m => [m.id, m.name])),
    }, { merge: true });
    toast('✓ 存好了');
  } catch (err) { console.error(err); toast('❌ 没存到，检查网络', true); }
});

$('r-del').addEventListener('click', async () => {
  const e = events[curId()]; if (!e) return;
  if (!confirm(`删掉 ${dm(e.date)}「${e.title}」这一次的点名？出席率会少算这一次。`)) return;
  try { await deleteDoc(doc(db, 'attendance', curId())); toast('删掉了'); }
  catch (err) { console.error(err); toast('❌ 删不到，检查网络', true); }
});

// ---------- 现场 QR 签到 ----------
// 开 QR 时这一次的点名还没有 qr 密码就生一个，开始/结束时间照种类先填好（练歌 8pm–10.30pm：8.30pm 后到算迟到、10pm 前走算早退）
let qrTimer = null, qrObj = null;
async function openQr() {
  const id = curId(), e = events[id];
  const x = extras[id];   // 特别练习：用加的时候填的时间
  const [ds, de] = x ? [x.start || '', x.end || ''] : DEFAULT_TIME[$('r-kind').value] || ['', ''];
  const patch = { ...base() };
  if (!e?.qr) patch.qr = randomSecret();
  if (e?.start === undefined) patch.start = ds;
  if (e?.end === undefined) patch.end = de;
  try { await setDoc(doc(db, 'attendance', id), patch, { merge: true }); }
  catch (err) { console.error(err); return toast('❌ 开不到，检查网络', true); }
  events[id] = { ...(events[id] || {}), ...patch, marks: events[id]?.marks || {} };
  $('qr-title').textContent = `${dm($('r-date').value)} ${titleFor($('r-date').value, $('r-kind').value)}`;
  $('qr-start').value = events[id].start || '';
  $('qr-end').value = events[id].end || '';
  $('qr-box').classList.remove('hidden');
  try { await navigator.wakeLock?.request('screen'); } catch { /* 没关系 */ }
  drawQr();
  clearInterval(qrTimer);
  qrTimer = setInterval(drawQr, 1000);
  renderQrCount();
}
let lastSlot = null;
async function drawQr() {
  const e = events[curId()];
  const slot = slotNow();
  if (!e?.qr || slot === lastSlot) return;
  lastSlot = slot;
  const url = `${location.origin}/checkin.html?e=${encodeURIComponent(curId())}&k=${slot}.${await tokenOf(e.qr, slot)}`;
  const size = Math.max(200, Math.min(innerWidth - 64, innerHeight - 340, 440));
  if (!qrObj || qrObj._size !== size) {
    $('qr').innerHTML = '';
    qrObj = new QRCode($('qr'), { text: url, width: size, height: size, correctLevel: QRCode.CorrectLevel.M });
    qrObj._size = size;
  } else qrObj.makeCode(url);
}
function closeQr() {
  clearInterval(qrTimer); qrTimer = null; lastSlot = null;
  $('qr-box').classList.add('hidden');
}
function renderQrCount() {
  if ($('qr-box').classList.contains('hidden')) return;
  const e = events[curId()] || {};
  const t = Object.entries(e.times || {});
  const ins = t.filter(([, x]) => x.in).sort((a, b) => b[1].in.localeCompare(a[1].in));
  const outs = t.filter(([, x]) => x.out).length;
  $('qr-count').innerHTML = `已签到 <b class="text-lg">${ins.length}</b> 人${outs ? `　·　签退 <b>${outs}</b> 人` : ''}`;
  $('qr-recent').textContent = ins.length ? '刚到：' + ins.slice(0, 8).map(([id, x]) => `${nameOf[id] || e.names?.[id] || '?'} ${hm(x.in)}${e.marks?.[id] === 'T' ? '⏰' : ''}`).join('、') : '';
}
$('r-qr').addEventListener('click', openQr);
$('qr-close').addEventListener('click', closeQr);
['start', 'end'].forEach(k => $('qr-' + k).addEventListener('change', async () => {
  try { await updateDoc(doc(db, 'attendance', curId()), { [k]: $('qr-' + k).value, updatedAt: new Date().toISOString() }); toast('✓ 时间改好了'); }
  catch (err) { console.error(err); toast('❌ 没存到', true); }
}));
window.addEventListener('resize', () => { if (qrTimer) { qrObj = null; lastSlot = null; drawQr(); } });

// ---------- 出席率 ----------
// 每一段时间：from–to，要几个「3 个月」（算要出席几次）
function periods() {
  const now = new Date();
  const back = m => { const d = new Date(now); d.setMonth(d.getMonth() - m); return ymd(d); };
  const y = now.getFullYear();
  // 次数可以叠加：3 个月 7 次 → 一年 28 次（够了可以提名、晋升）
  const list = [
    { key: 'y', label: `今年 ${y}`, from: `${y}-01-01`, to: `${y}-12-31`, q: 4 },
    { key: 'r3', label: '最近 3 个月', from: back(3), to: TODAY, q: 1 },
    { key: 'r12', label: '最近 12 个月', from: back(12), to: TODAY, q: 4 },
  ];
  // 有点名记录的每一季
  const qs = new Set(Object.values(events).map(e => `${e.date.slice(0, 4)}-${Math.floor((+e.date.slice(5, 7) - 1) / 3) + 1}`));
  qs.add(`${now.getFullYear()}-${Math.floor(now.getMonth() / 3) + 1}`);
  [...qs].sort().reverse().forEach(k => {
    const [y, n] = k.split('-').map(Number);
    const m1 = (n - 1) * 3 + 1;
    list.push({ key: 'q' + k, label: `${y} 年第 ${n} 季（${m1}–${m1 + 2} 月）`, from: `${y}-${String(m1).padStart(2, '0')}-01`, to: `${y}-${String(m1 + 2).padStart(2, '0')}-31`, q: 1 });
  });
  list.push({ key: 'all', label: '全部', from: '0000', to: '9999', q: 0 });
  return list;
}

function renderPeriods() {
  const keep = $('s-period').value || 'y';
  $('s-period').innerHTML = periods().map(p => `<option value="${p.key}">${esc(p.label)}</option>`).join('');
  $('s-period').value = periods().some(p => p.key === keep) ? keep : 'y';
}

let lastStats = null;
function renderStats() {
  const p = periods().find(x => x.key === $('s-period').value) || periods()[0];
  const kind = $('s-kind').value;
  const evs = Object.values(events).filter(e => e.date >= p.from && e.date <= p.to && (!kind || e.kind === kind)).sort((a, b) => a.date.localeCompare(b.date));
  const want = p.q ? need * p.q : 0;
  const ids = new Set(members.map(m => m.id));
  evs.forEach(e => Object.keys(e.marks || {}).forEach(id => ids.add(id)));
  const rows = [...ids].map(id => {
    const c = { P: 0, T: 0, L: 0, A: 0, none: 0 };
    let score = 0;
    evs.forEach(e => {
      const v = votes[evKey(e)]?.[id];
      const k = markOf(e, id, v);
      k ? c[k]++ : c.none++;
      score += scoreOf(e, id, v);
    });
    score = Math.round(score * 10) / 10;
    const att = c.P + c.T;
    return { id, name: nameOf[id] || '（已离团）', gone: !members.some(m => m.id === id), c, att, score, ok: want ? score >= want : null };
  }).filter(r => !r.gone || r.att + r.c.L + r.c.A);
  // 出席最多的排最前面（看谁最活跃）；一次都没出席的收在最后一行
  rows.sort((a, b) => b.score - a.score || b.att - a.att || a.name.localeCompare(b.name, 'zh'));
  const came = rows.filter(r => r.att), zero = rows.filter(r => !r.att);
  const okN = rows.filter(r => r.ok).length;
  const first = Object.values(events).map(e => e.date).sort()[0];
  const pct = r => Math.round(r.att / evs.length * 100);
  const top = came.filter(r => r.score === came[0]?.score).map(r => r.name);
  const rank = r => came.findIndex(x => x.score === r.score) + 1;   // 一样多分的同一名

  $('s-head').innerHTML = !evs.length
    ? '<div class="text-slate-500">这段时间还没有点名记录。</div>'
    : `<div class="font-semibold text-base">🏆 积分最高${came.length ? `（${fmtPts(came[0].score)} 分${came[0].score === evs.length ? '，全勤' : ''}）` : ''}：${top.map(esc).join('、') || '—'}</div>
       <div class="text-slate-600">这段时间点了 <b>${evs.length}</b> 次名（${dm(evs[0].date)}–${dm(evs.at(-1).date)}），<b>${came.length}</b> 人有来过。</div>
       ${want ? `<div class="text-slate-600">${okN ? `✅ <b>${okN}</b> 人已经够 ${want} 次。` : ''}${p.q >= 4 ? `一年积分 <b>${want}</b> 分就可以提名、晋升` : `这段时间要 <b>${want}</b> 分`}（每 3 个月 ${need} 分，会一直累积上去）。</div>` : ''}
       <div class="text-xs text-slate-400">积分：完整出席 1 · 迟到、早退各扣 0.2 · 只签到没签退 0.5 · 请假 0.1（在 App 按不来也算）· 缺席 0</div>
       ${first && first > p.from && p.key !== 'all' ? `<div class="text-xs text-slate-400">点名记录从 ${dm(first)} 才开始，之前纸上的没算进来，次数会慢慢累积。</div>` : ''}`;

  $('s-list').innerHTML = evs.length ? came.map(r => `
    <div class="flex items-center gap-3 px-3.5 py-2.5">
      <div class="w-6 shrink-0 text-center text-xs ${rank(r) <= 3 ? 'font-semibold text-amber-600' : 'text-slate-400'}">${rank(r)}</div>
      <div class="flex-1 min-w-0">
        <div class="font-semibold">${esc(r.name)}${r.ok ? ' <span class="text-xs font-normal text-emerald-600">✅ 够 ' + want + ' 分</span>' : ''}${r.gone ? ' <span class="text-xs font-normal text-slate-400">不在名单了</span>' : ''}</div>
        ${want ? `<div class="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div class="h-full rounded-full ${r.ok ? 'bg-emerald-500' : 'bg-indigo-400'}" style="width:${Math.min(100, r.score / want * 100)}%"></div></div>` : ''}
        <div class="text-xs text-slate-500 mt-0.5">出席 ${r.att} 次${r.c.T ? `（迟到/早退 ${r.c.T}）` : ''} · 请假 ${r.c.L} · 缺席 ${r.c.A + r.c.none}${r.c.none ? `（其中 ${r.c.none} 次没点到）` : ''}</div>
      </div>
      <div class="text-right shrink-0">
        <div class="font-semibold">${fmtPts(r.score)}${want ? `<span class="text-xs font-normal text-slate-400"> / ${want}</span>` : ''} 分</div>
        <div class="text-xs text-slate-400">出席 ${pct(r)}%</div>
      </div>
    </div>`).join('') + (zero.length ? `
    <div class="px-3.5 py-2.5 text-xs text-slate-400 leading-relaxed">这段时间还没出席记录（${zero.length} 位）：${zero.map(r => esc(r.name)).join('、')}</div>` : '') : '';
  lastStats = { p, evs, rows: came, zero, want, kind };
}

$('s-period').addEventListener('change', renderStats);
$('s-kind').addEventListener('change', renderStats);
$('s-need').addEventListener('change', async () => {
  const v = Math.round(+$('s-need').value);
  if (!(v >= 1)) { $('s-need').value = need; return; }
  need = v;
  renderStats();
  try { await setDoc(doc(db, 'config', 'attendance'), { need, updatedAt: new Date().toISOString() }, { merge: true }); toast('✓ 标准改好了'); }
  catch (err) { console.error(err); toast('❌ 没存到', true); }
});

$('s-copy').addEventListener('click', async () => {
  const s = lastStats; if (!s?.evs.length) return;
  const kindTxt = s.kind ? `只算${KIND[s.kind]}，` : '';
  let t = `📊 *乐韵歌咏团出席率*\n${s.p.label}（${dm(s.evs[0].date)}–${dm(s.evs.at(-1).date)}），${kindTxt}点名 ${s.evs.length} 次`;
  t += `\n\n🏆 积分（出席次数）：\n${s.rows.map(r => `${s.rows.findIndex(x => x.score === r.score) + 1}. ${r.name} ${fmtPts(r.score)} 分（${r.att} 次）${r.ok ? ' ✅' : ''}`).join('\n')}`;
  if (s.want) t += `\n\n✅ = 已经够 ${s.want} 分${s.p.q >= 4 ? '（一年 ' + s.want + ' 分可以提名、晋升）' : ''}`;
  t += `\n\n积分：完整出席 1｜迟到、早退各扣 0.2｜只签到没签退 0.5｜请假 0.1｜缺席 0`;
  try { await navigator.clipboard.writeText(t); toast('✓ 复制了，去 WhatsApp 贴上'); }
  catch { prompt('复制这段：', t); }
});

// 下载 CSV（Excel、Google Sheet 都打得开）：一人一行，前面是总数，后面每一次点名一格
$('s-csv').addEventListener('click', () => {
  const s = lastStats; if (!s?.evs.length) return;
  const WORD = { P: '有到', T: '迟到/早退', L: '请假', A: '缺席' };
  const cell = v => { const t = String(v ?? ''); return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const head = ['名字', '全名', '积分', '出席次数', '出席率%', '有到', '迟到/早退', '请假', '缺席（含没点到）', '其中没点到', ...(s.want ? [`够 ${s.want} 次`] : []),
    ...s.evs.map(e => `${e.date} ${KIND[e.kind] || ''}`)];
  const body = s.rows.concat(s.zero).map(r => [r.name, fullOf[r.id] || '', r.score, r.att, Math.round(r.att / s.evs.length * 100), r.c.P, r.c.T, r.c.L, r.c.A + r.c.none, r.c.none,
    ...(s.want ? [r.ok ? '✅' : ''] : []), ...s.evs.map(e => { const v = votes[evKey(e)]?.[r.id], k = markOf(e, r.id, v); return k ? `${WORD[k]}${!e.marks?.[r.id] ? '（App 不来）' : ''} ${fmtPts(scoreOf(e, r.id, v))}` : '缺席（没点到） 0'; })]);
  const csv = '\ufeff' + [head, ...body].map(row => row.map(cell).join(',')).join('\r\n');   // 前面加 BOM，Excel 打开中文才不会乱码
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `乐韵出席_${s.evs[0].date}_到_${s.evs.at(-1).date}${s.kind ? '_' + KIND[s.kind] : ''}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('✓ 下载了，用 Excel 或 Google Sheet 打开');
});

// ---------- 切换 ----------
function tab(name) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('bg-white', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('shadow-sm', b.dataset.tab === name));
  $('tab-roll').classList.toggle('hidden', name !== 'roll');
  $('tab-stats').classList.toggle('hidden', name !== 'stats');
  if (name === 'stats') { renderPeriods(); renderStats(); }
  try { sessionStorage.setItem('attTab', name); } catch { /* 没关系 */ }
}
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => tab(b.dataset.tab)));

load().then(() => {
  // 从「这台弥撒」按「📋 点名」来：?d=2026-10-25&k=mass → 直接开那一次
  const qs = new URLSearchParams(location.search);
  const wantD = (qs.get('d') || '').match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  const d = wantD || TODAY;
  $('r-date').value = d;
  $('r-kind').value = ['mass', 'practice', 'other'].includes(qs.get('k')) ? qs.get('k') : new Date(d + 'T00:00').getDay() === 0 ? 'mass' : 'practice';
  openEvent();
  let t = 'roll';
  try { t = wantD ? 'roll' : sessionStorage.getItem('attTab') || 'roll'; } catch { /* 没关系 */ }
  tab(t);
}).catch(err => { console.error(err); toast('读取失败：' + (err.code || err.message), true); });
