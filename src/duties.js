// 职务表：每一场谁当指挥、答唱咏、钢琴、风琴、吉他、鼓手
// Firestore duties/{YYYY-MM-DD}，人名存团员名单的「常用名字」（名单外的人也可以直接打名字）
import { collection, doc, setDoc, writeBatch } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, getDocs, history } from "./firebase.js";
import { litDay, tidyTitle } from "./liturgy.js";
import { DUTY_SEED } from "./duties-seed.js";
import { timeText, roleZh } from "./weddings-common.js";

const $ = id => document.getElementById(id);
const DUTIES = 'duties';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// key → 显示名称（也是团员名单「会做的职务」的名称）
export const DUTY_ROLES = [
  { key: 'conductor', label: '指挥' }, { key: 'cantor', label: '答唱咏' },
  { key: 'piano', label: '钢琴' }, { key: 'organ', label: '风琴' },
  { key: 'guitar', label: '吉他' }, { key: 'drums', label: '鼓手' },
];
const LABEL = Object.fromEntries(DUTY_ROLES.map(r => [r.key, r.label]));
// 每场都差不多是同一个人：可以一键补
const FIXED = ['conductor', 'piano', 'organ'];

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = iso(new Date());
const YEAR = TODAY.slice(0, 4);
const md = date => `${Number(date.slice(8))}/${Number(date.slice(5, 7))}`;
const week = date => '日一二三四五六'[new Date(date + 'T12:00').getDay()];

// 从「这台弥撒」总览点进来：?d=2026-10-18 → 那一天一定列出来，并且滚到那里
const WANT = (new URLSearchParams(location.search).get('d') || '').match(/^\d{4}-\d{2}-\d{2}$/)?.[0] || null;
let D = {};          // date → 职务
let members = [];
let massTitle = {};  // 排歌页排过的弥撒名称
// 💒 婚礼：职务存在婚礼那一份（masses/{日期_时间}.roles），跟排歌页同一份，这里改那里也会变
let W = {};          // id → 婚礼
// 婚礼的职务名称 → 团员名单「会做的职务」、职务表统计用的 key
const WED_AS = { Pianist: 'piano', Organist: 'organ', 钢琴: 'piano', 风琴: 'organ', 答唱咏: 'cantor', 指挥: 'conductor', 吉他: 'guitar', 鼓手: 'drums' };
const isDay = id => /^\d{4}-\d{2}-\d{2}$/.test(id);

async function load() {
  $('status').textContent = '读取中…';
  const [ds, ms, ma] = await Promise.all([
    history(DUTIES), getDocs(collection(db, 'members')), history('masses'),
  ]);
  D = Object.fromEntries(ds.docs.map(d => [d.id, d.data()]));
  members = ms.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => m.active !== false);
  massTitle = Object.fromEntries(ma.docs.filter(d => isDay(d.id)).map(d => [d.id, d.data().title]));
  W = Object.fromEntries(ma.docs.filter(d => d.data().kind).map(d => [d.id, { id: d.id, ...d.data() }]));
  $('status').textContent = '';
  render();
  if (WANT) (document.getElementById(`d-${WANT}`) || document.getElementById(`w-${WANT}`))?.scrollIntoView({ block: 'center' });
}

const titleOf = date => tidyTitle(D[date]?.title || massTitle[date] || litDay(date).name);

// 要显示哪些日期：接下来 = 今天以后有职务／有排歌的，加上接下来 8 个主日
function dates() {
  const set = new Set();
  if ($('range').value === 'year') {
    Object.keys(D).filter(d => d.startsWith(YEAR)).forEach(d => set.add(d));
  }
  Object.keys(D).concat(Object.keys(massTitle)).filter(d => isDay(d) && d >= TODAY).forEach(d => set.add(d));
  const s = new Date(TODAY + 'T12:00');
  s.setDate(s.getDate() + (7 - s.getDay()) % 7);
  for (let i = 0; i < 8; i++, s.setDate(s.getDate() + 7)) set.add(iso(s));
  if (WANT && !Object.values(W).some(w => w.date === WANT)) set.add(WANT);
  return [...set].sort();
}

// 今年每个人每个职务做了几次、最近一次是哪天
function stats() {
  const st = {};
  Object.entries(D).filter(([d]) => d.startsWith(YEAR)).sort(([a], [b]) => a.localeCompare(b)).forEach(([d, x]) => {
    DUTY_ROLES.forEach(({ key }) => {
      const n = x[key];
      if (!n) return;
      const s = ((st[key] ||= {})[n] ||= { count: 0, last: null, next: null });
      s.count++;
      if (d <= TODAY) s.last = d; else if (!s.next) s.next = d;
    });
  });
  // 婚礼的钢琴、风琴、答唱咏也算（轮答唱咏才公平）
  Object.values(W).filter(w => w.date.startsWith(YEAR)).forEach(w => (w.roles || []).forEach(r => {
    const key = WED_AS[r.role], n = String(r.name || '').trim();
    if (!key || !n) return;
    const s = ((st[key] ||= {})[n] ||= { count: 0, last: null, next: null });
    s.count++;
    if (w.date <= TODAY) { if (!s.last || w.date > s.last) s.last = w.date; } else if (!s.next || w.date < s.next) s.next = w.date;
  }));
  return st;
}

// ───────── 画面 ─────────
function render() {
  $('seed-box').classList.toggle('hidden', Object.keys(D).length > 0);
  $('seed-count').textContent = DUTY_SEED.length;
  const list = dates();
  const weds = Object.values(W).filter(w => $('range').value === 'year' ? w.date.startsWith(YEAR) : w.date >= TODAY);
  // 日期和婚礼排在一起（同一天的话婚礼在前）
  const rows = list.map(date => ({ date })).concat(weds.map(w => ({ date: w.date, w })))
    .sort((a, b) => a.date.localeCompare(b.date) || (b.w ? 1 : 0) - (a.w ? 1 : 0) || (a.w?.time || '').localeCompare(b.w?.time || ''));
  $('list').innerHTML = rows.map(({ date, w }) => w ? wedCard(w) : dayCard(date, list)).join('');
  renderStats();
}

function wedCard(w) {
  const roles = w.roles || [];
  return `
      <div id="w-${w.date}" class="bg-white rounded-xl border ${w.date === WANT ? 'border-rose-400 ring-1 ring-rose-200' : 'border-rose-200'} px-3 py-2.5 ${w.date < TODAY ? 'opacity-60' : ''}">
        <div class="flex items-baseline gap-2 mb-2">
          <span class="font-semibold text-sm">${md(w.date)}</span>
          <span class="text-xs text-slate-400 shrink-0">星期${week(w.date)} ${esc(timeText(w.time))}</span>
          <span class="flex-1 min-w-0 truncate text-sm text-rose-700">💒 ${esc(w.title || '')}</span>
          <a href="mass.html?id=${encodeURIComponent(w.id)}" class="text-xs text-indigo-600 hover:underline shrink-0">歌、来唱的人 ›</a>
        </div>
        <div class="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
          ${roles.map((r, i) => `
            <button data-wed="${esc(w.id)}" data-idx="${i}" class="text-left rounded-lg px-2 py-1.5 border ${r.name ? 'border-slate-200 bg-slate-50 hover:border-indigo-300' : 'border-dashed border-slate-200 hover:border-indigo-300'}">
              <span class="block text-[10px] text-slate-400">${esc(roleZh(r.role))}</span>
              <span class="block truncate text-sm ${r.name ? 'text-slate-800' : 'text-slate-300'}">${esc(r.name || '＋')}</span>
            </button>`).join('')}
        </div>
        <div class="text-[11px] text-slate-400 mt-1.5">🎤 来唱 ${(w.singers || []).length} 位${(w.singers || []).length ? '：' + w.singers.map(esc).join('、') : ''}</div>
      </div>`;
}

function dayCard(date, list) {
  const x = D[date] || {};
  const past = date < TODAY;
  return `
    <div id="d-${date}" class="bg-white rounded-xl border ${date === (WANT || list.find(d => d >= TODAY)) ? 'border-indigo-300 ring-1 ring-indigo-100' : 'border-slate-200'} px-3 py-2.5 ${past ? 'opacity-60' : ''}">
      <div class="flex items-baseline gap-2 mb-2">
        <span class="font-semibold text-sm">${md(date)}</span>
        <span class="text-xs text-slate-400">星期${week(date)}</span>
        <button data-title="${date}" class="flex-1 min-w-0 truncate text-left text-sm text-slate-600 hover:text-indigo-600" title="改名称">${esc(titleOf(date))}</button>
        ${x.note ? `<span class="text-xs text-amber-600 truncate max-w-[40%]">${esc(x.note)}</span>` : ''}
      </div>
      <div class="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        ${DUTY_ROLES.map(({ key, label }) => `
          <button data-date="${date}" data-role="${key}" class="text-left rounded-lg px-2 py-1.5 border ${x[key] ? 'border-slate-200 bg-slate-50 hover:border-indigo-300' : 'border-dashed border-slate-200 hover:border-indigo-300'}">
            <span class="block text-[10px] text-slate-400">${label}</span>
            <span class="block truncate text-sm ${x[key] ? 'text-slate-800' : 'text-slate-300'}">${esc(x[key] || '＋')}</span>
          </button>`).join('')}
      </div>
    </div>`;
}

function renderStats() {
  const st = stats();
  $('stats-body').innerHTML = DUTY_ROLES.filter(r => st[r.key]).map(({ key, label }) => `
    <div><div class="text-xs font-semibold text-slate-500 mb-1">${label}</div>
      <div class="flex flex-wrap gap-1.5">${Object.entries(st[key]).sort((a, b) => b[1].count - a[1].count)
        .map(([n, s]) => `<span class="px-2 py-0.5 rounded-md bg-slate-100">${esc(n)} <b>${s.count}</b></span>`).join('')}</div>
    </div>`).join('') || '<div class="text-slate-400">还没有记录</div>';
}

$('range').addEventListener('change', render);
$('list').addEventListener('click', async e => {
  const t = e.target.closest('[data-title]');
  if (t) {
    const date = t.dataset.title;
    const name = prompt(`${md(date)} 这一场叫什么？`, titleOf(date));
    if (name && name.trim()) await save(date, { title: name.trim() });
    return;
  }
  const b = e.target.closest('[data-role]');
  if (b) openPicker(b.dataset.date, b.dataset.role);
  const wb = e.target.closest('[data-wed]');
  if (wb) openPicker(W[wb.dataset.wed].date, null, wb.dataset.wed, +wb.dataset.idx);
});

async function save(date, patch) {
  D[date] = { ...(D[date] || {}), date, title: titleOf(date), ...patch };
  render();
  try {
    await setDoc(doc(db, DUTIES, date), { date, title: D[date].title, ...patch, updatedAt: new Date().toISOString() }, { merge: true });
    $('status').textContent = `✅ 已保存 ${md(date)}`;
  } catch (err) {
    console.error(err);
    alert('保存失败：' + (err.code || err.message));
  }
}

// ───────── 选人 ─────────
let pick = null;
// 婚礼的那一格：wed = 婚礼 id，idx = 第几个职务；role = 对应的职务 key（Pianist → piano，领经没有）
function openPicker(date, role, wed, idx) {
  const wr = wed && W[wed].roles[idx];
  pick = { date, role: wed ? WED_AS[wr.role] || null : role, wed, idx, label: wed ? roleZh(wr.role) : LABEL[role] };
  $('picker-title').textContent = wed ? `${md(date)} 💒 ${timeText(W[wed].time)} · ${roleZh(wr.role)}` : `${md(date)} ${titleOf(date)} · ${LABEL[role]}`;
  $('picker-search').value = '';
  $('picker').classList.remove('hidden');
  renderPicker();
  setTimeout(() => $('picker-search').focus(), 50);
}
function closePicker() { $('picker').classList.add('hidden'); pick = null; }
$('picker-close').addEventListener('click', closePicker);
$('picker').addEventListener('click', e => { if (e.target === $('picker')) closePicker(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePicker(); });
$('picker-search').addEventListener('input', renderPicker);
$('picker-search').addEventListener('keydown', async e => {
  if (e.key !== 'Enter' || !pick) return;
  const v = $('picker-search').value.trim();
  if (!v) return;
  const hit = members.find(m => m.name.toLowerCase() === v.toLowerCase());
  await choose(hit ? hit.name : v);
});
$('picker-clear').addEventListener('click', () => pick && choose(''));
async function choose(name) {
  const { date, role, wed, idx } = pick;
  closePicker();
  if (!wed) return save(date, { [role]: name });
  const w = W[wed];
  w.roles = w.roles.map((r, i) => i === idx ? { ...r, name } : r);
  render();
  try {
    await setDoc(doc(db, 'masses', wed), { roles: w.roles, savedAt: new Date().toISOString() }, { merge: true });
    $('status').textContent = `✅ 已保存 ${md(date)} 婚礼`;
  } catch (err) { console.error(err); alert('保存失败：' + (err.code || err.message)); }
}

function renderPicker() {
  if (!pick) return;
  const { date, role, wed, idx, label } = pick;
  const q = $('picker-search').value.trim().toLowerCase();
  const st = (role && stats()[role]) || {};
  const cur = D[date] || {};
  const curName = wed ? W[wed].roles[idx].name : cur[role];
  // 这一天（这一台）已经做别的职务
  const busy = n => wed ? W[wed].roles.filter((r, i) => i !== idx && r.name === n).map(r => r.role) : DUTY_ROLES.filter(r => r.key !== role && cur[r.key] === n).map(r => r.label);
  const label2 = role ? LABEL[role] : label;   // 团员名单「会做的职务」的叫法（Pianist → 钢琴）
  const match = m => !q || `${m.name} ${m.fullName || ''}`.toLowerCase().includes(q);
  const can = members.filter(m => (m.roles || []).includes(label2) && match(m));
  // 答唱咏：今年做得少、很久没做的排前面（轮流）；其他职务：常做的排前面
  const rotate = role === 'cantor';
  can.sort((a, b) => {
    const sa = st[a.name] || { count: 0 }, sb = st[b.name] || { count: 0 };
    return rotate ? sa.count - sb.count || (sa.last || '').localeCompare(sb.last || '') : sb.count - sa.count;
  });
  const others = q || !can.length ? members.filter(m => !(m.roles || []).includes(label2) && match(m)) : [];
  const row = m => {
    const s = st[m.name];
    const b = busy(m.name);
    return `<button data-name="${esc(m.name)}" class="w-full text-left flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-indigo-50 ${curName === m.name ? 'bg-indigo-50' : ''}">
      <span class="flex-1 min-w-0 truncate text-sm">${esc(m.name)}${curName === m.name ? ' ✓' : ''}</span>
      ${b.length ? `<span class="text-[11px] text-amber-600 shrink-0">这天已经是${b.join('、')}</span>` : ''}
      ${role ? `<span class="text-[11px] text-slate-400 shrink-0">${s ? `今年 ${s.count} 次${s.last ? ` · 上次 ${md(s.last)}` : ''}${s.next ? ` · 已排 ${md(s.next)}` : ''}` : '今年还没做'}</span>` : ''}
    </button>`;
  };
  $('picker-list').innerHTML =
    (can.length ? `<div class="px-3 pt-1 pb-1 text-[11px] text-slate-400">会做${label2}的${rotate ? '（今年做得少的在前面）' : ''}</div>${can.map(row).join('')}` : '')
    + (others.length ? `<div class="px-3 pt-3 pb-1 text-[11px] text-slate-400">其他团员</div>${others.map(row).join('')}` : '')
    + (!can.length && !others.length ? `<div class="text-sm text-slate-400 text-center py-6">${q ? `名单里没有「${esc(q)}」，按 Enter 直接用这个名字` : `团员名单里还没有人勾「${label2}」。打名字搜，或到团员名单勾选`}</div>` : '')
    + (q && (can.length || others.length) ? '<div class="text-[11px] text-slate-400 text-center py-2">不是团员？打完整名字按 Enter</div>' : '')
    + (!q && can.length ? '<div class="text-[11px] text-slate-400 text-center py-2">要选别人：打名字搜</div>' : '');
}
$('picker-list').addEventListener('click', async e => {
  const b = e.target.closest('button[data-name]');
  if (!b || !pick) return;
  await choose(b.dataset.name);
});

// ───────── 固定的补上：指挥、钢琴、风琴空着的，填今年最常做的人 ─────────
$('btn-fill').addEventListener('click', async () => {
  const st = stats();
  const top = Object.fromEntries(FIXED.map(k => [k, Object.entries(st[k] || {}).sort((a, b) => b[1].count - a[1].count)[0]?.[0]]));
  const plan = [];
  dates().filter(d => d >= TODAY).forEach(date => {
    const x = D[date] || {};
    const patch = {};
    FIXED.forEach(k => {
      const n = top[k];
      // 同一天已经做别的职务就不填（例如 Mok 那天弹琴，就不再填指挥）
      if (n && !x[k] && !DUTY_ROLES.some(r => x[r.key] === n)) patch[k] = n;
    });
    if (Object.keys(patch).length) plan.push({ date, patch });
  });
  if (!plan.length) return alert('接下来的指挥、钢琴、风琴都有人了。');
  const lines = plan.map(({ date, patch }) => `${md(date)} ${titleOf(date)}：${Object.entries(patch).map(([k, v]) => `${LABEL[k]} ${v}`).join('、')}`);
  if (!confirm(`空着的填今年最常做的人：\n\n${lines.join('\n')}\n\n确定？（之后点格子还可以改）`)) return;
  const b = writeBatch(db);
  const now = new Date().toISOString();
  plan.forEach(({ date, patch }) => b.set(doc(db, DUTIES, date), { date, title: titleOf(date), ...patch, updatedAt: now }, { merge: true }));
  await b.commit();
  await load();
  $('status').textContent = `✅ 补好 ${plan.length} 场`;
});

$('btn-add-date').addEventListener('click', async () => {
  const v = prompt('哪一天？（例如 2026-12-08）', '');
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return;
  const date = v.trim();
  const name = prompt('这一场叫什么？', titleOf(date));
  if (!name) return;
  await save(date, { title: name.trim() });
});

// ───────── 复制给 WhatsApp ─────────
$('btn-copy').addEventListener('click', async () => {
  const next = Object.keys(D).filter(d => d >= TODAY && DUTY_ROLES.some(r => D[d][r.key])).sort().slice(0, 4);
  if (!next.length) return alert('接下来还没有排职务。');
  const text = ['*歌咏团职务表*', ...next.flatMap(d => ['', `*${md(d)} ${titleOf(d)}*`,
    DUTY_ROLES.filter(r => D[d][r.key]).map(r => `${r.label}：${D[d][r.key]}`).join('\n')])].join('\n');
  try { await navigator.clipboard.writeText(text); $('status').textContent = '✅ 已复制，可以贴到 WhatsApp'; }
  catch { prompt('复制下面这段：', text); }
});

// ───────── 第一次导入 ─────────
$('btn-seed').addEventListener('click', async () => {
  if (Object.keys(D).length) return;
  $('btn-seed').disabled = true;
  $('btn-seed').textContent = '导入中…';
  const now = new Date().toISOString();
  const b = writeBatch(db);
  DUTY_SEED.forEach(s => b.set(doc(db, DUTIES, s.date), { ...s, updatedAt: now }));
  try { await b.commit(); } catch (err) { console.error(err); alert('导入失败：' + (err.code || err.message)); }
  await load();
});

load().catch(err => { console.error(err); $('status').textContent = '读取失败：' + (err.code || err.message); });

// 「📅 总览」带着现在这一天过去
window.sicNavDate = () => WANT;   // 菜单去别页时带着这个日期
