// 点名 / 出席率
// 每一次点名 = attendance/{日期_种类} { date, kind, title, marks: { 团员id: P|T|L|A }, names: { 团员id: 名字 } }
// 每点一个人就存那一个人（两个人一起点也不会互相盖掉）
// 章程：3 个月出席 7 次（config/attendance.need 可以改）；有到 + 迟到早退 = 出席，请假不算出席也不算缺席
import { collection, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, onSnapshot } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { litDay } from "./liturgy.js";
import { DEFAULT_TIME, slotNow, tokenOf, randomSecret, hm } from "./checkin-common.js";

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
let events = {};             // 点名id → 资料
let need = 7;                // 每 3 个月要出席几次
let unsub = null;

const evId = (date, kind) => `${date}_${kind}`;
const curId = () => evId($('r-date').value, $('r-kind').value);
const titleFor = (date, kind) => kind === 'mass' ? (litDay(date)?.name || '弥撒') : KIND[kind];

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
    getDocs(collection(db, 'attendance')),
    getDoc(doc(db, 'config', 'attendance')).catch(() => null),
  ]);
  const all = ms.docs.map(d => ({ id: d.id, ...d.data() }));
  nameOf = Object.fromEntries(all.map(m => [m.id, m.name]));
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
  renderRoll();
}

function renderRoll() {
  const e = events[curId()];
  const marks = e?.marks || {};
  const q = $('r-q').value.trim().toLowerCase();
  const people = members.concat(Object.keys(marks).filter(id => !members.some(m => m.id === id)).map(id => ({ id, name: nameOf[id] || '（已离团）', gone: true })));
  const n = k => people.filter(p => marks[p.id] === k).length;
  const none = people.filter(p => !marks[p.id]).length;
  $('r-count').innerHTML = `<div class="flex flex-wrap gap-x-4 gap-y-1">
      <span>✅ 有到 <b>${n('P')}</b></span><span>⏰ 迟到/早退 <b>${n('T')}</b></span>
      <span>📝 请假 <b>${n('L')}</b></span><span>❌ 缺席 <b>${n('A')}</b></span>
      <span class="${none ? 'text-slate-500' : 'text-emerald-600'}">${none ? `还没点 <b>${none}</b> 人` : '✓ 全部点完了'}</span>
    </div>
    <div class="text-xs text-slate-400 mt-1">点一下就存好了，再点一次同一个就取消。</div>`;
  $('r-list').innerHTML = people.filter(p => !q || `${p.name} ${p.fullName || ''}`.toLowerCase().includes(q)).map(p => `
    <div class="flex flex-wrap items-center gap-2 px-3 py-2.5">
      <div class="flex-1 min-w-[6rem] text-sm">
        <span class="font-semibold">${esc(p.name)}</span>
        ${p.fullName && p.fullName !== p.name ? `<span class="text-xs text-slate-400 ml-1">${esc(p.fullName)}</span>` : ''}
        ${p.gone ? '<span class="text-xs text-slate-400 ml-1">不在名单了</span>' : ''}
        ${e?.times?.[p.id] ? `<div class="text-[11px] text-slate-400">📱 到 ${hm(e.times[p.id].in)}${e.times[p.id].out ? ` · 走 ${hm(e.times[p.id].out)}` : ''}</div>` : ''}
      </div>
      <div class="flex gap-1">
        ${MARKS.map(m => `<button data-id="${esc(p.id)}" data-mark="${m.k}" class="px-2 py-1 text-xs rounded-lg border ${marks[p.id] === m.k ? m.on : 'border-slate-200 text-slate-500 hover:bg-slate-50'}">${m.label}</button>`).join('')}
      </div>
    </div>`).join('') || '<div class="p-4 text-sm text-slate-400">名单是空的，先去「团员名单」加人。</div>';
  $('r-del').classList.toggle('hidden', !e);
  $('r-qr').classList.toggle('hidden', $('r-date').value !== TODAY);
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
  events[curId()] = { ...(e || base()), marks: { ...(e?.marks || {}), [id]: off ? undefined : k } };
  if (off) delete events[curId()].marks[id];
  renderRoll();
  try {
    if (off) await updateDoc(ref, { [`marks.${id}`]: deleteField(), updatedAt: new Date().toISOString() });
    else await setDoc(ref, { ...base(), marks: { [id]: k }, names: { [id]: nameOf[id] || '' } }, { merge: true });
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
  if (!confirm(`还没点的 ${rest.length} 个人，全部算「有到」？\n\n${rest.map(m => m.name).join('、')}`)) return;
  try {
    await setDoc(doc(db, 'attendance', curId()), {
      ...base(),
      marks: Object.fromEntries(rest.map(m => [m.id, 'P'])),
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
// 开 QR 时这一次的点名还没有 qr 密码就生一个，开始/结束时间照种类先填好（练歌 8pm–10pm）
let qrTimer = null, qrObj = null;
async function openQr() {
  const id = curId(), e = events[id];
  const [ds, de] = DEFAULT_TIME[$('r-kind').value] || ['', ''];
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
  const list = [
    { key: 'r3', label: '最近 3 个月', from: back(3), to: TODAY, q: 1 },
    { key: 'r24', label: '最近 2 年（改选看这个）', from: back(24), to: TODAY, q: 8 },
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
  const keep = $('s-period').value || 'r3';
  $('s-period').innerHTML = periods().map(p => `<option value="${p.key}">${esc(p.label)}</option>`).join('');
  $('s-period').value = periods().some(p => p.key === keep) ? keep : 'r3';
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
    evs.forEach(e => { const k = e.marks?.[id]; k ? c[k]++ : c.none++; });
    const att = c.P + c.T;
    return { id, name: nameOf[id] || '（已离团）', gone: !members.some(m => m.id === id), c, att, ok: want ? att >= want : null };
  }).filter(r => !r.gone || r.att + r.c.L + r.c.A);
  rows.sort((a, b) => (a.ok === b.ok ? 0 : a.ok ? 1 : -1) || a.att - b.att || a.name.localeCompare(b.name, 'zh'));
  const okN = rows.filter(r => r.ok).length, badN = rows.filter(r => r.ok === false).length;
  const first = Object.values(events).map(e => e.date).sort()[0];

  $('s-head').innerHTML = !evs.length
    ? '<div class="text-slate-500">这段时间还没有点名记录。</div>'
    : `<div class="font-semibold text-base">${want ? `✅ ${okN} 人达标　🔴 ${badN} 人还没够` : `共 ${rows.length} 人`}</div>
       <div class="text-slate-600">这段时间点了 <b>${evs.length}</b> 次名（${dm(evs[0].date)}–${dm(evs.at(-1).date)}）${want ? `，要出席 <b>${want}</b> 次才算达标` : ''}。</div>
       ${want && evs.length < want ? `<div class="text-amber-700">⚠️ 这段时间只点了 ${evs.length} 次，比要求的 ${want} 次还少，现在谁都还不可能达标——等点名记录多一点再看。</div>` : ''}
       ${first && first > p.from && p.key !== 'all' ? `<div class="text-xs text-slate-400">点名记录从 ${dm(first)} 才开始，之前纸上的没算进来。</div>` : ''}`;

  $('s-list').innerHTML = evs.length ? rows.map(r => `
    <div class="flex items-center gap-3 px-3.5 py-2.5">
      <div class="flex-1 min-w-0">
        <div class="font-semibold">${esc(r.name)}${r.gone ? ' <span class="text-xs font-normal text-slate-400">不在名单了</span>' : ''}</div>
        <div class="text-xs text-slate-500">出席 ${r.att}${r.c.T ? `（含迟到/早退 ${r.c.T}）` : ''} · 请假 ${r.c.L} · 缺席 ${r.c.A}${r.c.none ? ` · 没点到 ${r.c.none}` : ''}</div>
      </div>
      <div class="text-right shrink-0">
        ${r.ok === null ? '' : r.ok ? '<div class="text-emerald-600 font-semibold">✅ 达标</div>' : `<div class="text-red-600 font-semibold">🔴 差 ${want - r.att} 次</div>`}
        <div class="text-xs text-slate-400">${Math.round(r.att / evs.length * 100)}%</div>
      </div>
    </div>`).join('') : '';
  lastStats = { p, evs, rows, want, kind };
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
  if (s.want) {
    const ok = s.rows.filter(r => r.ok), bad = s.rows.filter(r => r.ok === false);
    t += `，要出席 ${s.want} 次\n\n✅ 达标（${ok.length} 人）：${ok.map(r => r.name).join('、') || '—'}\n\n🔴 还没够（${bad.length} 人）：\n${bad.map(r => `• ${r.name} ${r.att} 次（差 ${s.want - r.att}）`).join('\n') || '—'}`;
  } else {
    t += `\n\n${s.rows.map(r => `• ${r.name} ${r.att} 次`).join('\n')}`;
  }
  try { await navigator.clipboard.writeText(t); toast('✓ 复制了，去 WhatsApp 贴上'); }
  catch { prompt('复制这段：', t); }
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
  $('r-date').value = TODAY;
  $('r-kind').value = new Date().getDay() === 0 ? 'mass' : 'practice';
  openEvent();
  let t = 'roll';
  try { t = sessionStorage.getItem('attTab') || 'roll'; } catch { /* 没关系 */ }
  tab(t);
}).catch(err => { console.error(err); toast('读取失败：' + (err.code || err.message), true); });
