// 这台弥撒：一天的所有东西放在一页——唱什么歌、谁指挥／答唱咏／弹琴、谁坐哪里、要带哪件披肩
// 团员打开就看得到；指挥（输过密码）还会看到「还要处理的」，点一下跳去那一页改
// 资料都是排歌页、职务表、座位表存的（masses / duties / seatings / members），这里只读
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { litDay } from "./liturgy.js";
import { waTitle, ORDINARY, massSetOf, PROPER_KEYS } from "./mass-common.js";
import { loadNotices, noticeHtml } from "./notices-common.js";
import { timeText, findMember } from "./weddings-common.js";

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
let date = null;
let me = '';
try { me = localStorage.getItem('sicMyName') || ''; } catch { /* 没关系 */ }

async function load() {
  const [ma, du, se, mb, cs] = await Promise.all(['masses', 'duties', 'seatings', 'members', 'custom_songs'].map(c => getDocs(collection(db, c))));
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
const titleOf = d => onlySpecial(d) ? specials[d].map(w => `💒 ${timeText(w.time)}`).join(' ') : masses[d]?.title || duties[d]?.title || litDay(d).name;

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
  $('staff-links').classList.toggle('hidden', !isStaff);
  $('btn-staff').classList.toggle('hidden', isStaff);
  document.querySelectorAll('#staff-links a').forEach(a => { a.href = `${a.getAttribute('href').split('?')[0]}?d=${date}`; });
  renderDates(isStaff);
  renderHead();
  renderSpecials(isStaff);
  const only = onlySpecial(date);
  ['todo', 'songs', 'people', 'seats'].forEach(id => $(id).classList.toggle('hidden', only));
  if (only) { renderNotices(isStaff); return; }
  renderTodo(isStaff);
  renderSongs(isStaff);
  renderPeople(isStaff);
  renderSeats(isStaff);
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
      </div>`).join('')}</div>` : ''}`;
}

const editLink = (isStaff, page) => isStaff ? `<a href="${page}?d=${date}" class="text-xs text-indigo-600 hover:underline">改 →</a>` : '';
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
const capeOn = (d, n) => seatings[d]?.capes?.[n] || members[String(n).toLowerCase()]?.cape || null;
const capeOf = n => capeOn(date, n);
function renderSeats(isStaff) {
  const s = seatings[date];
  if (!s) {
    $('seats').innerHTML = card('🪑 座位', editLink(isStaff, 'seating.html')) + '<div class="text-sm text-slate-400">还没排</div>';
    return;
  }
  const rows = Array.from({ length: s.nRows || 0 }, (_, r) => Array.from({ length: s.cols || 5 }, (_, c) => s.seats?.[`${r}-${c}`] || ''));
  const seated = rows.flat().filter(Boolean);
  const stage = STAGE.flatMap(k => splitNames(duties[date]?.[k]).map(n => ({ n, role: ROLES.find(r => r[0] === k)[1] })));
  const all = [...new Set(seated.concat(stage.map(p => p.n)))].sort((a, b) => a.localeCompare(b, 'zh'));
  const meKey = me.toLowerCase();
  let where = '';
  if (me) {
    const st = stage.find(p => p.n.toLowerCase() === meKey);
    const r = rows.findIndex(row => row.some(n => n.toLowerCase() === meKey));
    if (st) where = `你今天是<b>${st.role}</b>，不用坐歌咏团的位子`;
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
    <div class="text-center text-xs text-slate-400 mb-1.5">▲ 前面（祭台／指挥）</div>
    <div class="space-y-1">
      ${rows.map((row, r) => `
        <div class="flex gap-1">
          <div class="w-4 shrink-0 text-[11px] text-slate-400 flex items-center justify-center">${r + 1}</div>
          ${row.map(n => `<div class="flex-1 min-w-0 h-11 rounded-lg border text-center px-0.5 flex flex-col justify-center ${!n ? 'border-dashed border-slate-100' : n.toLowerCase() === meKey ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-slate-50 border-slate-200'}">
            ${n ? `<span class="block truncate text-[12px] tracking-tight leading-tight">${esc(n)}</span><span class="block truncate text-[10px] leading-tight ${n.toLowerCase() === meKey ? 'text-indigo-100' : 'text-slate-400'}">${capeOf(n) ? `#${capeOf(n)}` : esc(guestGroup(n))}</span>` : ''}
          </div>`).join('')}
        </div>`).join('')}
    </div>
    ${guests.length ? `<div class="text-xs text-violet-700 mt-2">🙋 Guest：${guests.map(n => `${esc(n)}（${esc(guestGroup(n))}）`).join('、')}</div>` : ''}
    ${stage.length ? `<div class="text-xs text-slate-500 mt-2">台前：${stage.map(p => `${p.role} ${esc(p.n)}`).join('　')}</div>` : ''}
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
  const isMe = n => meM && findMember(n, [meM]) === meM;
  const song = x => `<a href="${esc(x.imageUrl)}" target="_blank" rel="noopener" class="text-slate-800 hover:text-indigo-600 underline decoration-slate-200 underline-offset-4" title="${esc(x.title)}">${esc(waTitle(x.title))}</a>`;
  box.innerHTML = list.map(w => {
    const roles = (w.roles || []).filter(r => r.name);
    const mine = roles.filter(r => isMe(r.name)).map(r => r.role).concat((w.singers || []).some(isMe) ? ['唱'] : []);
    return `<section class="bg-white rounded-2xl border border-rose-200 p-4">
      ${card(`💒 ${esc(timeText(w.time))}　${esc(w.title)}`, isStaff ? `<span class="shrink-0 text-xs space-x-2"><a href="mass.html?id=${encodeURIComponent(w.id)}" class="text-indigo-600 hover:underline">改歌 →</a><a href="seating.html?e=${encodeURIComponent(w.id)}" class="text-indigo-600 hover:underline">座位 →</a></span>` : '')}
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
          <div class="text-[11px] text-slate-400">${esc(r.role)}</div>
          <div class="text-sm truncate">${esc(r.name)}</div>
        </div>`).join('')}</div>` : ''}
      ${(w.singers || []).length ? `<div class="mt-3 text-sm"><span class="text-slate-500">🎤 来唱（${w.singers.length}）：</span>${w.singers.map(n => isMe(n) ? `<b class="text-rose-700">${esc(n)}</b>` : esc(n)).join('、')}</div>` : ''}
      ${wedSeats(w, isMe)}
    </section>`;
  }).join('');
}

// 婚礼排了座位：一排一排列出来，自己的位子标出来；要穿披肩的话说一声
function wedSeats(w, isMe) {
  const s = wseats[w.id];
  if (!s?.seats) return '';
  const rows = Array.from({ length: s.nRows || 0 }, (_, r) => Array.from({ length: s.cols || 5 }, (_, c) => s.seats[`${r}-${c}`]).filter(Boolean));
  const mine = rows.findIndex(row => row.some(isMe));
  return `<div class="mt-3 text-sm rounded-lg bg-slate-50 px-3 py-2 space-y-0.5">
    <div class="text-slate-500">🪑 座位${s.noCapes ? '（这台不穿披肩）' : '（👘 这台要穿披肩）'}${mine >= 0 ? `　<b class="text-rose-700">你坐第 ${mine + 1} 排</b>` : ''}</div>
    ${rows.map((row, r) => row.length ? `<div><span class="text-slate-400">第${r + 1}排：</span>${row.map(n => isMe(n) ? `<b class="text-rose-700">${esc(n)}</b>` : esc(n)).join('、')}</div>` : '').join('')}
  </div>`;
}

// 公告 + 要练的歌（还在显示的公告都放这里，不管选哪一天）
function renderNotices(isStaff) {
  const box = $('notices');
  box.classList.toggle('hidden', !notices.length && !isStaff);
  box.innerHTML = card('📢 公告 · 要练的歌', `<a href="notices.html" class="text-xs text-indigo-600 hover:underline">${isStaff ? '发 / 改 →' : '全部 →'}</a>`) + (notices.length
    ? `<div class="divide-y divide-slate-100">${notices.map(n => `<div class="py-3 first:pt-0 last:pb-0">${noticeHtml(n, { titles: songTitles, compact: true })}</div>`).join('')}</div>
       ${notices.some(n => (n.songs || []).length) ? '<a href="songs.html?f=practice" class="mt-3 block text-center rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold py-2.5 text-sm">📚 在歌单目录看全部要练的歌</a>' : ''}`
    : '<div class="text-sm text-slate-400">现在没有公告</div>');
}

// 电话登录好了 → 马上换成他的位子
document.addEventListener('sic-login', () => {
  try { me = localStorage.getItem('sicMyName') || ''; } catch { /* 没关系 */ }
  render();
});

$('btn-staff').addEventListener('click', async () => { if (await window.sicStaff?.unlock()) render(); });

load().catch(err => { console.error(err); $('loading').textContent = '读取失败：' + (err.code || err.message); });
