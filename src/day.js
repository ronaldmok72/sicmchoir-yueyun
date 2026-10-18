// 这台弥撒：一天的所有东西放在一页——唱什么歌、谁指挥／答唱咏／弹琴、谁坐哪里、要带哪件披肩
// 团员打开就看得到；指挥（输过密码）还会看到「还要处理的」，点一下跳去那一页改
// 资料都是排歌页、职务表、座位表存的（masses / duties / seatings / members），这里只读
// 这里会写的只有两样：团员投票会不会来（rsvp/{日期_practice|mass}）、合照（photos/{日期 或 婚礼id}，相片本身放 Cloudinary）
import { collection, getDocs, doc, setDoc, updateDoc, deleteField, arrayUnion } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { litDay, tidyTitle } from "./liturgy.js";
import { waTitle, ORDINARY, massSetOf, PROPER_KEYS } from "./mass-common.js";
import { loadNotices, noticeHtml } from "./notices-common.js";
import { timeText, findMember, roleZh } from "./weddings-common.js";
import { CECILIA, bookName, loadPrayer } from "./prayer-common.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = iso(new Date());
const md = date => `${Number(date.slice(8))}/${Number(date.slice(5, 7))}`;
const week = date => '日一二三四五六'[new Date(date + 'T12:00').getDay()];
const staff = () => !!window.sicStaff?.isStaff();
const splitNames = v => String(v || '').split(/[\/、,，&]+/).map(s => s.trim()).filter(Boolean);

const ROLES = [['conductor', '指挥'], ['cantor', '答唱咏'], ['piano', '钢琴'], ['organ', '风琴'], ['guitar', '吉他'], ['drums', '鼓手']];
const NEEDED = ['conductor', 'cantor', 'piano', 'organ'];          // 每台都要有人
const STAGE = ['conductor', 'piano', 'organ', 'guitar', 'drums'];   // 在台前，不坐歌咏团座位
const MUST_SONG = ['entrance', 'offertory', 'communion', 'recessional'];
const MUST_ORD = ['kyrie', 'alleluia', 'sanctus', 'agnus'];
const LABEL = { entrance: '进堂咏', psalm: '答唱咏', offertory: '奉献咏', communion: '领主咏', thanks: '谢主咏', recessional: '礼成咏', kyrie: '垂怜曲', alleluia: '福音前欢呼', sanctus: '圣圣圣', agnus: '羔羊颂' };

let masses = {}, duties = {}, seatings = {}, members = {};
let notices = [], songTitles = {};
let specials = {};   // 婚礼 { 日期: [几台] }：排歌页 masses 里有 kind 的
let wseats = {};     // 婚礼的座位表 seatings/{日期_时间}
let memberList = [];
let rsvps = {};      // rsvp/{日期_kind}：{ votes: { 团员id: 'Y'|'N' }, names }
let photos = {};     // photos/{日期 或 婚礼id}：{ items: [{ url, by, at }] }
let date = null;
window.sicNavDate = () => date;   // 菜单去排歌／职务表／座位表时带着这个日期
let me = '';
try { me = localStorage.getItem('sicMyName') || ''; } catch { /* 没关系 */ }

async function load() {
  const [ma, du, se, mb, cs, rv, ph] = await Promise.all(['masses', 'duties', 'seatings', 'members', 'custom_songs', 'rsvp', 'photos'].map(c => getDocs(collection(db, c)).catch(() => ({ docs: [] }))));
  rsvps = Object.fromEntries(rv.docs.map(d => [d.id, d.data()]));
  photos = Object.fromEntries(ph.docs.map(d => [d.id, d.data()]));
  notices = (await loadNotices(db).catch(() => ({ active: [] }))).active;
  const all = ma.docs.map(d => ({ id: d.id, ...d.data() }));
  masses = Object.fromEntries(all.filter(m => !m.kind).map(m => [m.date || m.id, m]));
  specials = {};
  all.filter(m => m.kind).sort((a, b) => (a.time || '').localeCompare(b.time || '')).forEach(w => (specials[w.date] ||= []).push(w));
  // 歌名以曲库为准（改过名的歌显示新名字）
  const title = songTitles = Object.fromEntries(cs.docs.map(d => [d.id, d.data().title]));
  Object.values(masses).forEach(m => (m.slots || []).forEach(sl => (sl.songs || []).forEach(x => { if (title[x.id]) x.title = title[x.id]; })));
  duties = Object.fromEntries(du.docs.map(d => [d.id, d.data()]));
  seatings = Object.fromEntries(se.docs.filter(d => !d.id.includes('_')).map(d => [d.id, d.data()]));
  wseats = Object.fromEntries(se.docs.filter(d => d.id.includes('_')).map(d => [d.id, d.data()]));
  members = Object.fromEntries(mb.docs.map(d => d.data()).filter(m => m.active !== false).map(m => [m.name.toLowerCase(), m]));
  memberList = Object.values(members);
  Object.values(specials).flat().forEach(w => (w.slots || []).forEach(sl => (sl.songs || []).forEach(x => { if (title[x.id]) x.title = title[x.id]; })));
  const list = dates();
  const want = new URLSearchParams(location.search).get('d');
  date = list.includes(want) ? want : (list.find(d => d >= TODAY) || list.at(-1));
  $('loading').classList.add('hidden');
  $('day').classList.remove('hidden');
  render();
}

// 可以看的日期：最近过去的一个主日 + 接下来有排东西的 + 接下来 8 个主日
function dates() {
  const set = new Set();
  [masses, duties, seatings, specials].forEach(o => Object.keys(o).filter(d => d >= TODAY).forEach(d => set.add(d)));
  const s = new Date(TODAY + 'T12:00');
  s.setDate(s.getDate() + (7 - s.getDay()) % 7);
  for (let i = 0; i < 8; i++, s.setDate(s.getDate() + 7)) set.add(iso(s));
  const past = Object.keys(masses).concat(Object.keys(seatings)).filter(d => d < TODAY).sort().at(-1);
  if (past) set.add(past);
  const want = new URLSearchParams(location.search).get('d');
  if (/^\d{4}-\d{2}-\d{2}$/.test(want || '')) set.add(want);
  // 太远的（三个月后）先不列，免得一长串
  const far = new Date(TODAY + 'T12:00'); far.setDate(far.getDate() + 92);
  return [...set].filter(d => d <= iso(far) || d === want).sort();
}
// 只有婚礼弥撒的那天（星期六）：不算主日，不用排座位、职务表
const onlySpecial = d => !!specials[d]?.length && !masses[d] && !duties[d] && !seatings[d];
const titleOf = d => onlySpecial(d) ? specials[d].map(w => `💒 ${timeText(w.time)}`).join(' ') : tidyTitle(masses[d]?.title || duties[d]?.title || litDay(d).name);

// ───────── 还要处理的（指挥才看到）─────────
// level: red = 一定要处理；wait = 还没做完
function issues(d) {
  const out = [];
  const m = masses[d], du = duties[d] || {}, se = seatings[d];
  const go = (page, label) => ({ href: `${page}?d=${d}`, label });
  if (!m) out.push({ level: 'red', text: '还没排歌', ...go('mass.html', '去排歌') });
  else {
    const slot = k => (m.slots || []).find(s => s.key === k);
    const missing = (m.slots || []).flatMap(s => s.songs.filter(x => x.missing).map(x => `${s.label}「${waTitle(x.title)}」`));
    if (missing.length) out.push({ level: 'red', text: `⚠ 还没有谱：${missing.join('、')}。先到排单后台上传，再回排歌页换掉`, ...go('mass.html', '去排歌') });
    if (!slot('psalm')?.songs.length) out.push({ level: 'red', text: '答唱咏还没选', ...go('mass.html', '去选') });
    const empty = MUST_SONG.concat(MUST_ORD).filter(k => slot(k) && !slot(k).songs.length).map(k => LABEL[k]);
    if (empty.length) out.push({ level: 'wait', text: `还没选：${empty.join('、')}`, ...go('mass.html', '去选') });
    if (!m.setlistName) out.push({ level: 'wait', text: '歌排好了，但还没按「保存并更新乐谱」，团员的乐谱还看不到', ...go('mass.html', '去保存') });
  }
  const noDuty = NEEDED.filter(k => !du[k]).map(k => ROLES.find(r => r[0] === k)[1]);
  if (noDuty.length) out.push({ level: noDuty.includes('指挥') || noDuty.includes('答唱咏') ? 'red' : 'wait', text: `还没排：${noDuty.join('、')}`, ...go('duties.html', '去排') });
  if (!se) out.push({ level: 'wait', text: '座位还没排（进去会照上一次自动排好，看一下动一下就保存）', ...go('seating.html', '去排') });
  else {
    const noCape = seatedNames(d).concat(stageNames(d)).filter(n => members[n.toLowerCase()] && !capeOn(d, n));
    if (noCape.length) out.push({ level: 'info', text: `${noCape.length} 位还没有披肩号码：${noCape.join('、')}`, href: 'members.html', label: '去填' });
  }
  return out;
}
const statusOf = d => { const l = issues(d).map(i => i.level); return l.includes('red') ? 'red' : l.includes('wait') ? 'wait' : 'ok'; };

const seatedNames = d => Object.values(seatings[d]?.seats || {}).filter(Boolean);
const stageNames = d => STAGE.flatMap(k => splitNames(duties[d]?.[k]));

// ───────── 画面 ─────────
function render() {
  const isStaff = staff();
  $('btn-staff').classList.toggle('hidden', isStaff);
  renderDates(isStaff);
  renderHead();
  renderRsvp();
  renderSpecials(isStaff);
  renderPrayer();
  const only = onlySpecial(date);
  ['todo', 'songs', 'people', 'seats', 'photos'].forEach(id => $(id).classList.toggle('hidden', only));
  if (only) { renderNotices(isStaff); return; }
  renderTodo(isStaff);
  renderSongs(isStaff);
  renderPeople(isStaff);
  renderSeats(isStaff);
  renderPhotos();
  renderNotices(isStaff);
}

function renderDates(isStaff) {
  const dot = { red: '🔴', wait: '⏳', ok: '✅' };
  $('dates').innerHTML = dates().map(d => {
    const on = d === date;
    return `<button data-date="${d}" class="shrink-0 text-left rounded-xl border px-3 py-2 ${on ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 hover:border-indigo-300'} ${d < TODAY && !on ? 'opacity-60' : ''}">
      <div class="text-sm font-semibold whitespace-nowrap">${md(d)} <span class="font-normal text-xs ${on ? 'text-indigo-100' : 'text-slate-400'}">星期${week(d)}</span>${specials[d] && !onlySpecial(d) ? ' 💒' : ''}${isStaff && d >= TODAY && !onlySpecial(d) ? ` <span class="text-xs">${dot[statusOf(d)]}</span>` : ''}</div>
      <div class="text-[11px] max-w-[9rem] truncate ${on ? 'text-indigo-100' : 'text-slate-500'}">${esc(titleOf(d))}</div>
    </button>`;
  }).join('');
  $('dates').querySelector(`[data-date="${date}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest' });
}
$('dates').addEventListener('click', e => {
  const b = e.target.closest('[data-date]'); if (!b) return;
  date = b.dataset.date;
  history.replaceState(null, '', `?d=${date}`);
  render();
});

function renderHead() {
  const lit = litDay(date);
  const [y, mo, dd] = date.split('-').map(Number);
  const notes = [masses[date]?.note, duties[date]?.note].filter(Boolean);
  $('head').innerHTML = `
    <div class="text-sm text-slate-500">${y} 年 ${mo} 月 ${dd} 日　星期${week(date)}${date === TODAY ? '　<span class="text-indigo-600 font-semibold">今天</span>' : ''}</div>
    <div class="text-lg font-semibold mt-0.5">${onlySpecial(date) ? `💒 婚礼弥撒${specials[date].length > 1 ? ` × ${specials[date].length} 台` : ''}` : esc(titleOf(date))}</div>
    ${onlySpecial(date) ? '' : `<div class="text-xs text-slate-400 mt-0.5">${lit.cycle}年</div>`}
    ${notes.length ? `<div class="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">📌 ${notes.map(esc).join('<br>📌 ')}</div>` : ''}`;
}

function renderTodo(isStaff) {
  const box = $('todo');
  box.classList.toggle('hidden', !isStaff);
  if (!isStaff) return;
  const list = issues(date);
  const real = list.filter(i => i.level !== 'info');
  const icon = { red: '🔴', wait: '⏳', info: 'ℹ️' };
  box.className = `rounded-2xl border p-4 text-sm ${real.length ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`;
  box.innerHTML = `
    <div class="font-semibold ${real.length ? 'text-amber-900' : 'text-emerald-800'}">${real.length ? `还有 ${real.length} 件事要处理` : '✅ 这一台都准备好了'}</div>
    ${list.length ? `<div class="mt-2 space-y-1.5">${list.map(i => `
      <div class="flex items-start gap-2">
        <span class="shrink-0">${icon[i.level]}</span>
        <span class="flex-1 min-w-0 text-slate-700">${esc(i.text)}</span>
        <a href="${i.href}" class="shrink-0 text-indigo-600 hover:underline whitespace-nowrap">${i.label} →</a>
      </div>`).join('')}</div>` : ''}
    ${quickBar(date)}`;
}

// 后台：有那一页权限的人才看到「✏️ 改」，按了直接到那一页、同一天
const can = area => !!window.sicStaff?.can(area);
const EDIT_BTN = 'shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100';
const AREA_OF = { 'mass.html': 'mass', 'duties.html': 'duties', 'seating.html': 'seating' };
const editLink = (isStaff, page) => isStaff && can(AREA_OF[page]) ? `<a href="${page}?d=${date}" class="${EDIT_BTN}">✏️ 改</a>` : '';
// 这一台要改什么：排歌、职务、座位、点名、祈祷文、公告，一排按钮
function quickBar(d) {
  const sun = new Date(d + 'T00:00').getDay() === 0;
  const items = [
    ['mass', `mass.html?d=${d}`, '⛪ 排歌'],
    ['duties', `duties.html?d=${d}`, '🗓️ 职务'],
    ['seating', `seating.html?d=${d}`, '🪑 座位'],
    ['attendance', `attendance.html?d=${d}&k=${sun ? 'mass' : 'practice'}`, '📋 点名'],
    [null, `prayer.html?d=${d}`, '🙏 祈祷文'],
    ['notice', 'notices.html', '📢 公告'],
  ].filter(([a]) => !a || can(a));
  return `<div class="mt-3 pt-3 border-t border-black/5">
    <div class="text-xs text-slate-500 mb-1.5">🛠️ 这一台要改什么，直接按：</div>
    <div class="flex flex-wrap gap-1.5">${items.map(([, href, label]) => `<a href="${href}" class="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-indigo-400 hover:text-indigo-700 text-sm font-medium text-slate-700">${label}</a>`).join('')}</div>
  </div>`;
}
const card = (title, right) => `<div class="flex items-center justify-between mb-2"><h2 class="font-semibold">${title}</h2>${right || ''}</div>`;

function renderSongs(isStaff) {
  const m = masses[date];
  if (!m) {
    $('songs').innerHTML = card('🎵 唱的歌', editLink(isStaff, 'mass.html')) + '<div class="text-sm text-slate-400">还没排</div>';
    return;
  }
  const slots = m.slots || [];
  const sets = [...new Set(slots.filter(s => ORDINARY.includes(s.key)).flatMap(s => s.songs.map(x => massSetOf(x.title))).filter(Boolean))];
  const odd = s => ORDINARY.includes(s.key) && s.songs.some(x => !massSetOf(x.title));
  const show = slots.filter(s => (PROPER_KEYS.includes(s.key) || !LABEL[s.key] && !ORDINARY.includes(s.key) && !['pre', 'post', 'pater', 'doxology', 'welcome'].includes(s.key) || odd(s)) && s.songs.length);
  const song = x => x.missing
    ? `<span class="text-amber-600">⚠ ${esc(waTitle(x.title))}<span class="text-xs">（还没有谱）</span></span>`
    : `<a href="${esc(x.imageUrl)}" target="_blank" rel="noopener" class="text-slate-800 hover:text-indigo-600 underline decoration-slate-200 underline-offset-4" title="${esc(x.title)}">${esc(waTitle(x.title))}</a>`;
  $('songs').innerHTML = card('🎵 唱的歌', editLink(isStaff, 'mass.html')) + `
    ${m.setlistName ? '' : '<div class="text-xs text-amber-700 mb-2">还在排，可能会改</div>'}
    ${sets.length ? `<div class="text-sm mb-2"><span class="text-slate-500">弥撒曲：</span>${esc(sets.join('、'))}</div>` : ''}
    <div class="divide-y divide-slate-100">
      ${show.map(s => `
        <div class="flex gap-3 py-2 text-sm">
          <div class="w-20 shrink-0 text-slate-500">${esc(s.label)}</div>
          <div class="flex-1 min-w-0 space-y-0.5">${s.songs.map(x => `<div class="truncate">${song(x)}</div>${x.note ? `<div class="text-xs text-indigo-600">✎ ${esc(x.note)}</div>` : ''}`).join('')}</div>
        </div>`).join('')}
    </div>
    ${m.setlistName ? `<a href="/?setlist=${encodeURIComponent(m.setlistName)}" class="mt-3 block text-center rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2.5 text-sm">🎼 打开乐谱（翻页看）</a>` : ''}`;
}

function renderPeople(isStaff) {
  const du = duties[date] || {};
  $('people').innerHTML = card('👥 谁做什么', editLink(isStaff, 'duties.html')) + `
    <div class="grid grid-cols-3 gap-2">
      ${ROLES.filter(([k]) => du[k] || NEEDED.includes(k)).map(([k, l]) => `
        <div class="rounded-lg px-2.5 py-2 ${du[k] ? 'bg-slate-50' : 'border border-dashed border-slate-200'}">
          <div class="text-[11px] text-slate-400">${l}</div>
          <div class="text-sm truncate ${du[k] ? '' : 'text-slate-300'}">${esc(du[k] || '还没排')}</div>
        </div>`).join('')}
    </div>`;
}

// 披肩号码：座位表这一天改过的先算，不然照团员名单
// capes[名字] = 0 表示这场不穿
const memberCape = n => members[String(n).toLowerCase()]?.cape || null;
const capeOn = (d, n) => { const c = seatings[d]?.capes; return c && n in c ? (c[n] || null) : memberCape(n); };
const capeOf = n => capeOn(date, n);
function renderSeats(isStaff) {
  const s = seatings[date];
  if (!s) {
    $('seats').innerHTML = card('🪑 座位', editLink(isStaff, 'seating.html')) + '<div class="text-sm text-slate-400">还没排</div>';
    return;
  }
  const rows = Array.from({ length: s.nRows || 0 }, (_, r) => Array.from({ length: s.cols || 5 }, (_, c) => s.seats?.[`${r}-${c}`] || ''));
  const front = s.front || [];   // 台前那一排（指挥、乐手、领唱…）
  const seated = rows.flat().concat(front).filter(Boolean);
  const stage = STAGE.flatMap(k => splitNames(duties[date]?.[k]).map(n => ({ n, role: ROLES.find(r => r[0] === k)[1] })));
  const all = [...new Set(seated.concat(stage.map(p => p.n)))].sort((a, b) => a.localeCompare(b, 'zh'));
  const meKey = me.toLowerCase();
  let where = '';
  if (me) {
    const st = stage.find(p => p.n.toLowerCase() === meKey);
    const r = rows.findIndex(row => row.some(n => n.toLowerCase() === meKey));
    const f = front.findIndex(n => n.toLowerCase() === meKey);
    if (f >= 0) where = `你坐<b>台前</b>，从左边数第 <b>${f + 1}</b> 个${st ? `（${st.role}）` : ''}`;
    else if (st && r < 0) where = `你今天是<b>${st.role}</b>，不用坐歌咏团的位子`;
    else if (r >= 0) where = `你坐<b>第 ${r + 1} 排</b>，从左边数第 <b>${rows[r].findIndex(n => n.toLowerCase() === meKey) + 1}</b> 个`;
    else if ((s.absent || []).some(n => n.toLowerCase() === meKey)) where = '这天写你没来';
    else where = '这天还没有你的位子';
    if (capeOf(me)) where += `　·　披肩 <b>#${capeOf(me)}</b>`;
  }
  const withCape = seated.concat(stage.map(p => p.n)).filter(capeOf);
  // 这一场来一起唱的 guest（慕道班、主日学…）：座位下面写他是哪里来的
  const guestGroup = n => (s.guests || []).find(g => g.name === n)?.group || '';
  const guests = seated.filter(guestGroup);
  $('seats').innerHTML = card('🪑 座位', editLink(isStaff, 'seating.html')) + `
    <div class="flex flex-wrap items-center gap-2 mb-3 text-sm">
      <select id="me" class="border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-sm">
        <option value="">找我的位子…</option>
        ${all.map(n => `<option ${n.toLowerCase() === meKey ? 'selected' : ''}>${esc(n)}</option>`).join('')}
      </select>
      ${where ? `<span class="text-slate-700">${where}</span>` : ''}
      ${!window.sicStaff?.me() ? '<button id="btn-login" class="text-xs text-indigo-600 hover:underline">📱 用电话登录，自动找到我</button>' : ''}
    </div>
    ${seatGrid({
      rows, front,
      isMe: n => !!meKey && n.toLowerCase() === meKey,
      frontSub: n => stage.filter(p => p.n.toLowerCase() === n.toLowerCase()).map(p => p.role).join('·') || (capeOf(n) ? `#${capeOf(n)}` : ''),
      sub: n => capeOf(n) ? `#${capeOf(n)}` : guestGroup(n),
    })}
    ${guests.length ? `<div class="text-xs text-violet-700 mt-2">🙋 Guest：${guests.map(n => `${esc(n)}（${esc(guestGroup(n))}）`).join('、')}</div>` : ''}
    ${stage.length && !front.length ? `<div class="text-xs text-slate-500 mt-2">台前：${stage.map(p => `${p.role} ${esc(p.n)}`).join('　')}</div>` : ''}
    ${isStaff ? `<div class="text-xs text-slate-500 mt-1">要带 <b>${withCape.length}</b> 件披肩${(s.absent || []).length ? `　·　没来：${(s.absent || []).map(esc).join('、')}` : ''}</div>` : ''}`;
  $('btn-login')?.addEventListener('click', () => window.sicLogin?.open());
  $('me').addEventListener('change', e => {
    me = e.target.value;
    try { me ? localStorage.setItem('sicMyName', me) : localStorage.removeItem('sicMyName'); } catch { /* 没关系 */ }
    renderSeats(staff());
  });
}

// 💒 婚礼弥撒：唱什么、谁做什么、谁来唱；登录了的人有份就标出来
function renderSpecials(isStaff) {
  const list = specials[date] || [];
  const box = $('specials');
  box.classList.toggle('hidden', !list.length);
  const meM = me ? findMember(me, memberList) || { name: me } : null;
  const isMe0 = n => meM && findMember(n, [meM]) === meM;
  const sameName = n => meM && findMember(n, [meM], true) === meM;
  const song = x => `<a href="${esc(x.imageUrl)}" target="_blank" rel="noopener" class="text-slate-800 hover:text-indigo-600 underline decoration-slate-200 underline-offset-4" title="${esc(x.title)}">${esc(waTitle(x.title))}</a>`;
  box.innerHTML = list.map(w => {
    // 座位表加的 guest（Theresa Ng）不要因为第一个字一样就当成团员 Theresa 玉娥
    const guests = new Set((wseats[w.id]?.guests || []).map(g => String(g.name).toLowerCase()));
    const isMe = n => !guests.has(String(n).toLowerCase()) && isMe0(n);
    const roles = (w.roles || []).filter(r => r.name);
    const mine = roles.filter(r => isMe(r.name)).map(r => roleZh(r.role)).concat((w.singers || []).some(isMe) ? ['唱'] : []);
    return `<section class="bg-white rounded-2xl border border-rose-200 p-4">
      ${card(`💒 ${esc(timeText(w.time))}　${esc(w.title)}`, isStaff && (can('mass') || can('seating')) ? `<span class="shrink-0 flex gap-1.5">${can('mass') ? `<a href="mass.html?id=${encodeURIComponent(w.id)}" class="${EDIT_BTN}">✏️ 改歌</a>` : ''}${can('seating') ? `<a href="seating.html?e=${encodeURIComponent(w.id)}" class="${EDIT_BTN}">🪑 座位</a>` : ''}</span>` : '')}
      ${mine.length ? `<div class="mb-2 text-sm rounded-lg bg-rose-50 text-rose-800 px-3 py-2">🙋 你这台有份：<b>${esc(mine.join('、'))}</b></div>` : ''}
      ${w.note ? `<div class="mb-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">📌 ${esc(w.note)}</div>` : ''}
      <div class="divide-y divide-slate-100">
        ${(w.slots || []).filter(s => s.songs?.length).map(s => `
          <div class="flex gap-3 py-2 text-sm">
            <div class="w-20 shrink-0 text-slate-500">${esc(s.label)}</div>
            <div class="flex-1 min-w-0 space-y-0.5">${s.songs.map(x => `<div class="truncate">${song(x)}</div>`).join('')}</div>
          </div>`).join('')}
      </div>
      ${w.setlistName ? `<a href="/?setlist=${encodeURIComponent(w.setlistName)}" class="mt-2 mb-3 block text-center rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2.5 text-sm">🎼 打开乐谱（翻页看）</a>` : ''}
      ${roles.length ? `<div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">${roles.map(r => `
        <div class="rounded-lg px-2.5 py-2 ${isMe(r.name) ? 'bg-rose-100' : 'bg-slate-50'}">
          <div class="text-[11px] text-slate-400">${esc(roleZh(r.role))}</div>
          <div class="text-sm truncate">${esc(r.name)}</div>
        </div>`).join('')}</div>` : ''}
      ${(w.singers || []).length ? `<div class="mt-3 text-sm"><span class="text-slate-500">🎤 来唱（${w.singers.length}）：</span>${w.singers.map(n => isMe(n) ? `<b class="text-rose-700">${esc(n)}</b>` : esc(n)).join('、')}</div>` : ''}
      ${wedSeats(w, sameName)}
      ${photoBlock(w.id)}
    </section>`;
  }).join('');
}

// 座位格子（主日、婚礼共用）：▲ 前面 → 台前一排 → 第 1、2、3 排；自己的位子变紫色
function seatGrid({ rows, front = [], isMe, sub, frontSub }) {
  const box = (n, base, extra = '') => `<div class="flex-1 min-w-0 ${extra} h-11 rounded-lg border text-center px-0.5 flex flex-col justify-center ${!n ? 'border-dashed border-slate-100' : isMe(n) ? 'bg-indigo-600 border-indigo-600 text-white' : base}">
    ${n ? `<span class="block truncate text-[12px] tracking-tight leading-tight">${esc(n)}</span><span class="block truncate text-[10px] leading-tight ${isMe(n) ? 'text-indigo-100' : 'text-slate-400'}">${esc((n && (frontSub && extra ? frontSub(n) : sub(n))) || '')}</span>` : ''}
  </div>`;
  return `<div class="text-center text-xs text-slate-400 mb-1.5">▲ 前面（祭台／指挥）</div>
    <div class="space-y-1">
      ${front.some(Boolean) ? `
        <div class="flex justify-center gap-1 pb-1.5 mb-0.5 border-b border-dashed border-slate-200">
          <div class="w-6 shrink-0 text-[10px] text-slate-400 flex items-center justify-center">台前</div>
          ${front.map(n => box(n, 'bg-emerald-50 border-emerald-200', 'max-w-[5.5rem]')).join('')}
        </div>` : ''}
      ${rows.map((row, r) => `
        <div class="flex gap-1">
          <div class="w-6 shrink-0 text-[11px] text-slate-400 flex items-center justify-center">${r + 1}</div>
          ${row.map(n => box(n, 'bg-slate-50 border-slate-200')).join('')}
        </div>`).join('')}
    </div>`;
}

// 婚礼排了座位：跟主日一样的格子，自己的位子标出来；要穿披肩的话说一声
function wedSeats(w, isMe) {
  const s = wseats[w.id];
  if (!s?.seats) return '';
  const rows = Array.from({ length: s.nRows || 0 }, (_, r) => Array.from({ length: s.cols || 5 }, (_, c) => s.seats[`${r}-${c}`] || ''));
  const front = s.front || [];
  const r = rows.findIndex(row => row.some(n => n && isMe(n)));
  const f = front.findIndex(n => n && isMe(n));
  const roleOf = n => (w.roles || []).filter(x => x.name && x.name.toLowerCase() === n.toLowerCase()).map(x => roleZh(x.role)).join('·');
  const cape = n => {
    if (s.noCapes) return '';
    const o = s.capes?.[n];
    if (o === 0) return '';
    return o ? `#${o}` : memberCape(n) ? `#${memberCape(n)}` : '';
  };
  const where = f >= 0 ? `你坐<b>台前</b>，从左边数第 <b>${f + 1}</b> 个`
    : r >= 0 ? `你坐<b>第 ${r + 1} 排</b>，从左边数第 <b>${rows[r].findIndex(n => n && isMe(n)) + 1}</b> 个` : '';
  return `<div class="mt-3 rounded-xl border border-slate-200 p-3">
    <div class="text-sm text-slate-500 mb-2">🪑 座位${s.noCapes ? '（这台不穿披肩）' : '（👘 这台要穿披肩）'}${where ? `　<span class="text-slate-700">${where}</span>` : ''}</div>
    ${seatGrid({ rows, front, isMe: n => !!isMe(n), sub: n => cape(n) || roleOf(n), frontSub: n => roleOf(n) || cape(n) })}
  </div>`;
}

// 公告 + 要练的歌（还在显示的公告都放这里，不管选哪一天）
// 练习前祈祷文（主日才有）：星期四、星期六练习那天自动打开，其他时候按一下展开
const prayers = {};
async function renderPrayer() {
  const box = $('prayer'), d = date;
  const sun = new Date(d + 'T12:00').getDay() === 0;
  box.classList.toggle('hidden', !sun);
  if (!sun) return;
  const lit = litDay(d);
  prayers[lit.key] ??= await loadPrayer(lit.key);
  if (d !== date) return;   // 读的时候已经换了别天
  const p = prayers[lit.key];
  const ahead = Math.round((new Date(d + 'T12:00') - new Date(TODAY + 'T12:00')) / 864e5);
  const wasOpen = box.dataset.date === d ? box.open : [4, 6].includes(new Date().getDay()) && ahead >= 0 && ahead < 7;
  box.dataset.date = d;
  const para = (h, t, ref = '') => `<div><div class="text-sm font-semibold text-indigo-700 mb-1">${h}${ref ? `<span class="font-normal text-slate-400">（${esc(ref)}）</span>` : ''}</div><p class="leading-loose text-[15px]">${esc(t)}</p></div>`;
  box.innerHTML = `
    <summary class="flex items-center gap-2 cursor-pointer list-none">
      <span class="font-semibold">🙏 练习前祈祷文</span>
      <span class="flex-1 min-w-0 truncate text-xs text-slate-400">${esc(bookName(lit.key, lit.name))}</span>
      <span class="text-slate-400 text-sm group-open:rotate-90 transition-transform">›</span>
    </summary>
    <div class="mt-3 space-y-4">
      ${p?.entrance ? para('进堂咏', p.entrance, p.ref) : ''}
      ${p?.collect ? para('集祷经', '请大家祈祷：' + p.collect) : ''}
      ${p?.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="经书这一页" class="w-full rounded-xl border border-slate-200">` : ''}
      ${p ? '' : '<div class="text-sm text-amber-700 bg-amber-50 rounded-xl px-3 py-2">这个主日的进堂咏、集祷经还没有人输入。<a href="prayer.html?d=' + d + '" class="underline font-semibold">去输入（一次就好）</a></div>'}
      ${para('圣女则济利亚祷文', CECILIA)}
      <a href="prayer.html?d=${d}" class="block text-center text-xs text-indigo-600 hover:underline">打开祈祷文页（可以复制给 WhatsApp）→</a>
    </div>`;
  box.open = wasOpen;
}

function renderNotices(isStaff) {
  const box = $('notices');
  box.classList.toggle('hidden', !notices.length && !isStaff);
  box.innerHTML = card('📢 公告 · 要练的歌', `<a href="notices.html" class="text-xs text-indigo-600 hover:underline">${isStaff ? '发 / 改 →' : '全部 →'}</a>`) + (notices.length
    ? `<div class="divide-y divide-slate-100">${notices.map(n => `<div class="py-3 first:pt-0 last:pb-0">${noticeHtml(n, { titles: songTitles, compact: true })}</div>`).join('')}</div>
       ${notices.some(n => (n.songs || []).length) ? '<a href="songs.html?f=practice" class="mt-3 block text-center rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold py-2.5 text-sm">📚 在歌单目录看全部要练的歌</a>' : ''}`
    : '<div class="text-sm text-slate-400">现在没有公告</div>');
}

// ───────── 会不会来：团员在这里按（代替 WA 投票）─────────
// 规矩：这个礼拜或上个礼拜的星期四／六至少来一次练习，主日才排位子、拿披肩
const addDays = (d, n) => { const x = new Date(d + 'T12:00'); x.setDate(x.getDate() + n); return iso(x); };
const rsvpSlots = d => [[addDays(d, -3), 'practice', '星期四练歌'], [addDays(d, -1), 'practice', '星期六练歌'], [d, 'mass', '主日弥撒']]
  .map(([dt, kind, label]) => ({ id: `${dt}_${kind}`, date: dt, kind, label }));
function renderRsvp() {
  const box = $('rsvp');
  const show = new Date(date + 'T12:00').getDay() === 0 && date >= TODAY && !onlySpecial(date);
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const meM = window.sicStaff?.me();
  const isStaff = staff();
  const who = (v, want) => Object.entries(v.votes || {}).filter(([, x]) => x === want).map(([id]) => v.names?.[id] || memberList.find(m => m.id === id)?.name || '?');
  box.innerHTML = card('🗳️ 这个礼拜会来吗？', '') + `
    ${meM ? '' : '<div class="mb-2 text-sm"><button id="btn-login-vote" class="text-indigo-600 hover:underline">📱 用电话登录就可以按</button></div>'}
    <div class="divide-y divide-slate-100">
      ${rsvpSlots(date).map(x => {
        const v = rsvps[x.id] || {};
        const mine = meM ? v.votes?.[meM.id] : null;
        const yes = who(v, 'Y'), no = who(v, 'N');
        const past = x.date < TODAY;
        const btn = (k, txt, on) => `<button data-vote="${x.id}" data-v="${k}" class="px-3 py-1.5 rounded-lg border text-sm ${mine === k ? on : 'border-slate-200 text-slate-600 hover:bg-slate-50'}">${txt}</button>`;
        return `<div class="py-2.5 flex flex-wrap items-center gap-2">
          <div class="flex-1 min-w-[8rem]">
            <div class="text-sm font-semibold">${x.label} <span class="font-normal text-slate-400">${md(x.date)}</span></div>
            <div class="text-xs text-slate-500">🙋 ${yes.length} 会来　🙅 ${no.length} 不来</div>
            ${isStaff && yes.length + no.length ? `<div class="text-[11px] text-slate-400 mt-0.5">${yes.length ? `会来：${yes.map(esc).join('、')}` : ''}${no.length ? `${yes.length ? '<br>' : ''}不来：${no.map(esc).join('、')}` : ''}</div>` : ''}
          </div>
          ${meM && !past ? `<div class="flex gap-1.5">${btn('Y', '🙋 会来', 'bg-emerald-600 border-emerald-600 text-white')}${btn('N', '📝 请假（不来）', 'bg-slate-600 border-slate-600 text-white')}</div>`
            : past ? '<span class="text-xs text-slate-400">已经过了</span>' : ''}
        </div>`;
      }).join('')}
    </div>
    <div class="text-[11px] text-slate-400 mt-2">这个礼拜或上个礼拜的星期四／六至少来一次练习，主日才排位子、拿披肩。按「会来」的可以先排位子。</div>`;
  $('btn-login-vote')?.addEventListener('click', () => window.sicLogin?.open());
}
$('rsvp').addEventListener('click', async e => {
  const b = e.target.closest('[data-vote]'); if (!b) return;
  const meM = window.sicStaff?.me(); if (!meM) return;
  const id = b.dataset.vote, v = b.dataset.v;
  const x = rsvpSlots(date).find(s => s.id === id);
  const cur = rsvps[id] ||= { date: x.date, kind: x.kind, votes: {}, names: {} };
  cur.votes ||= {}; cur.names ||= {};
  const undo = cur.votes[meM.id] === v;   // 再按一次同一个 = 取消
  b.disabled = true;
  try {
    if (undo) {
      await updateDoc(doc(db, 'rsvp', id), { [`votes.${meM.id}`]: deleteField(), updatedAt: new Date().toISOString() });
      delete cur.votes[meM.id];
    } else {
      await setDoc(doc(db, 'rsvp', id), { date: x.date, kind: x.kind, votes: { [meM.id]: v }, names: { [meM.id]: meM.name }, updatedAt: new Date().toISOString() }, { merge: true });
      cur.votes[meM.id] = v; cur.names[meM.id] = meM.name;
    }
  } catch (err) { console.error(err); alert('没存到，检查一下网络。'); }
  renderRsvp();
});

// ───────── 合照：每一台一个相册；相片放 Cloudinary（乐谱也放那里），资料库只记连结 ─────────
// 有「合照」权限的人（密码管理里开）才能加、拿掉；大家都看得到
const canPhoto = () => !!window.sicStaff?.can('photos');
const thumb = url => url.replace('/upload/', '/upload/c_fill,w_300,h_300,q_auto,f_auto/');
const full = url => url.replace('/upload/', '/upload/q_auto,f_auto/');
// main = 主日那一张卡片（标题大一点）；婚礼卡片里面的小一点
function photoBlock(key, main = false) {
  const items = photos[key]?.items || [];
  const can = canPhoto();
  if (!items.length && !can) return '';
  const add = can ? `<label class="shrink-0 text-xs px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"><span>＋ 加照片</span><input type="file" accept="image/*" multiple data-photo-up="${esc(key)}" class="hidden"></label>` : '';
  const title = `📷 合照${items.length ? `（${items.length}）` : ''}`;
  return `<div class="${main ? '' : 'mt-3'}">
    ${main ? card(title, add) : `<div class="flex items-center justify-between mb-1.5"><div class="text-sm text-slate-500">${title}</div>${add}</div>`}
    ${items.length ? `<div class="grid grid-cols-3 gap-1.5">${items.map((p, i) => `
      <div class="relative">
        <a href="${esc(full(p.url))}" target="_blank" rel="noopener"><img src="${esc(thumb(p.url))}" loading="lazy" alt="" class="w-full aspect-square object-cover rounded-lg bg-slate-100"></a>
        ${can ? `<button data-photo-del="${esc(key)}" data-i="${i}" class="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/50 text-white text-xs" title="拿掉">✕</button>` : ''}
      </div>`).join('')}</div>` : '<div class="text-xs text-slate-400">还没有照片</div>'}
  </div>`;
}
function renderPhotos() {
  const html = onlySpecial(date) ? '' : photoBlock(date, true);
  $('photos').classList.toggle('hidden', !html);
  $('photos').innerHTML = html;
}
// 手机拍的照片很大：先在手机缩小到长边 1600、JPG，再上传（省流量也省 Cloudinary 的空间）
async function shrink(file) {
  try {
    const img = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(b => r(b || file), 'image/jpeg', 0.82));
  } catch { return file; }
}
document.addEventListener('change', async e => {
  const inp = e.target.closest?.('[data-photo-up]'); if (!inp || !inp.files.length) return;
  const key = inp.dataset.photoUp, files = [...inp.files];
  const txt = inp.closest('label').querySelector('span');
  const by = window.sicStaff?.me()?.name || '';
  const added = [];
  for (const [i, f] of files.entries()) {
    txt.textContent = `上传中 ${i + 1}/${files.length}…`;
    try {
      const fd = new FormData();
      fd.append('file', new File([await shrink(f)], `photo_${key}_${Date.now()}_${i}.jpg`, { type: 'image/jpeg' }));
      fd.append('upload_preset', 'ml_default');
      const r = await fetch('https://api.cloudinary.com/v1_1/dsfhilcgz/image/upload', { method: 'POST', body: fd }).then(x => x.json());
      if (!r.secure_url) throw new Error(r.error?.message || '上传失败');
      added.push({ url: r.secure_url, by, at: new Date().toISOString() });
    } catch (err) { console.error(err); alert(`第 ${i + 1} 张没上传到：${err.message}`); }
  }
  if (added.length) {
    try {
      await setDoc(doc(db, 'photos', key), { key, items: arrayUnion(...added), updatedAt: new Date().toISOString() }, { merge: true });
      (photos[key] ||= { items: [] }).items = [...(photos[key].items || []), ...added];
    } catch (err) { console.error(err); alert('照片上传了，但没记到资料库，检查一下网络。'); }
  }
  render();
});
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-photo-del]'); if (!b) return;
  if (!confirm('从 App 拿掉这张照片？')) return;
  const key = b.dataset.photoDel, items = [...(photos[key]?.items || [])];
  items.splice(Number(b.dataset.i), 1);
  try {
    await setDoc(doc(db, 'photos', key), { key, items, updatedAt: new Date().toISOString() }, { merge: true });
    photos[key].items = items;
    render();
  } catch (err) { console.error(err); alert('没拿掉，检查一下网络。'); }
});

// 电话登录好了 → 马上换成他的位子
document.addEventListener('sic-login', () => {
  try { me = localStorage.getItem('sicMyName') || ''; } catch { /* 没关系 */ }
  render();
});

$('btn-staff').addEventListener('click', async () => { if (await window.sicStaff?.unlock()) render(); });

load().catch(err => { console.error(err); $('loading').textContent = '读取失败：' + (err.code || err.message); });
