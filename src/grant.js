// 后台权限：以前的「密码管理」和「分区授权」合在这一页
// 按人开通：每个后台一行，「自己能进」「帮别人开」并排勾。被 Ronald 指定的人（例如主席）只看到他能开的那几区
// 全部经登录服务（/api/login）改，资料库规则挡着手机直接改
// 勾选不乱跳的做法：一按就先改画面、排队一笔一笔存；存的时候不重画，名单也只在读进来时排一次序
import { masterPanel, onMasterClick, onMasterChange } from "./access-members.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gate = window.sicStaff;
const LABEL = Object.fromEntries(gate.AREAS.map(a => [a.key, a.label]));
const SUB = Object.fromEntries(gate.AREAS.map(a => [a.key, a.sub]));

let info = null, members = [];
let masters = new Set();
const open = new Set();
const status = t => { $('status').textContent = t; };
const now = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const own = m => (m.areas || []).filter(a => a !== 'grant' && a !== 'access' && LABEL[a]);

async function load() {
  status('读取中…');
  const [r, list] = await Promise.all([gate.staffCall('grantInfo'), gate.listMembers()]);
  if (r.status !== 200) {
    $('intro').textContent = r.status === 401 ? 'Ronald 还没指定你可以开哪几区，或者这部手机要重新输 PIN。' : '读不到，检查一下网络。';
    status('');
    return;
  }
  info = r.j;
  info.grants ||= {};
  masters = new Set(info.masters || []);
  // 只在这里排一次：有开后台的排前面。之后勾选，名单不会跳来跳去
  members = list.filter(m => info.master || m.active !== false)
    .sort((a, b) => (a.active === false) - (b.active === false) || own(b).length - own(a).length || a.name.localeCompare(b.name, 'zh'));
  $('tabs').classList.toggle('hidden', !info.master);
  $('intro').innerHTML = info.master
    ? '按名字打开来勾。<b>自己能进</b>：他可以用这个后台。<b>帮别人开</b>：他可以替别人开这个后台（例如主席）。一按就存好。'
    : `你可以帮团员开：<b>${info.areas.map(a => esc(LABEL[a])).join('、')}</b>。对方开通后，打开菜单按提示输 PIN 就进得去。一按就存好。`;
  $('m-count').textContent = info.master ? `有电话的 ${members.filter(m => m.phoneTail).length} / ${members.length} 人` : '';
  status('');
  render();
  renderLog();
}

function headInner(m) {
  const areas = own(m), isOpen = open.has(m.id);
  const flags = (masters.has(m.id) ? ' <span class="text-xs text-amber-700">👑 最高权限</span>' : '')
    + ((info.grants[m.id] || []).length ? ' <span class="text-xs text-amber-700">🗝️ 可帮别人开</span>' : '')
    + (m.phoneTail ? '' : ' <span class="text-xs text-amber-700">还没登记电话</span>');
  return `<div class="flex items-center gap-2">
      <div class="flex-1 min-w-0"><span class="font-semibold">${esc(m.name)}</span>${flags}</div>
      <button data-toggle="${esc(m.id)}" class="shrink-0 text-xs px-2 py-1 rounded-lg ${areas.length ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-500'}">${areas.length ? `${areas.length} 区` : '＋ 开后台'} ${isOpen ? '▴' : '▾'}</button>
    </div>
    ${areas.length && !isOpen ? `<div class="text-xs text-indigo-700 mt-1">${areas.map(a => esc(LABEL[a])).join('、')}</div>` : ''}`;
}

function panel(m) {
  const mine = own(m), given = info.grants[m.id] || [], id = esc(m.id);
  const cell = (attr, on) => `<label class="w-14 h-11 shrink-0 flex items-center justify-center cursor-pointer"><input type="checkbox" ${attr} ${on ? 'checked' : ''} class="w-5 h-5"></label>`;
  return `<div class="mt-2 border border-slate-200 rounded-xl overflow-hidden">
      <div class="flex items-center pl-2.5 py-1.5 bg-slate-50 text-[11px] text-slate-500">
        <div class="flex-1">后台</div><div class="w-14 text-center">${info.master ? '自己能进' : '开通'}</div>${info.master ? '<div class="w-14 text-center">帮别人开</div>' : ''}
      </div>
      ${info.areas.map(a => `<div data-row class="flex items-center pl-2.5 border-t border-slate-100 ${mine.includes(a) || given.includes(a) ? 'bg-indigo-50' : ''}">
        <div class="flex-1 min-w-0 py-1.5"><div>${esc(LABEL[a])}</div><div class="text-[11px] text-slate-400 truncate">${esc(SUB[a])}</div></div>
        ${cell(`data-m="${id}" data-area="${a}"`, mine.includes(a))}
        ${info.master ? cell(`data-g="${id}" data-area="${a}"`, given.includes(a)) : ''}
      </div>`).join('')}
    </div>
    ${info.master ? masterPanel(m, masters) : ''}`;
}

const rowInner = m => `<div data-head>${headInner(m)}</div>${open.has(m.id) ? panel(m) : ''}`;
function render() {
  const q = $('m-q').value.trim().toLowerCase();
  $('m-list').innerHTML = members
    .filter(m => !q || `${m.name} ${m.fullName || ''} ${m.cname || ''}`.toLowerCase().includes(q))
    .map(m => `<div data-member="${esc(m.id)}" class="px-3.5 py-2.5 ${m.active === false ? 'opacity-50' : ''}">${rowInner(m)}</div>`).join('');
}
function redraw(m) {
  const el = [...$('m-list').children].find(x => x.dataset.member === m.id);
  if (el) el.innerHTML = rowInner(m);
}

function renderLog() {
  const when = s => new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  $('log').innerHTML = info.log.length
    ? info.log.map(x => `<div>${esc(when(x.at))}　<b>${esc(x.by || '?')}</b> ${x.on ? '开了' : '关了'} ${esc(x.who)} 的「${esc(LABEL[x.area] || x.area)}」</div>`).join('')
    : '还没有记录。';
}

// 排队存：一笔做完才做下一笔（同时存会互相盖掉）。全部存完才说好；有一笔失败，就重读一次，画面换回真正的样子
let tail = Promise.resolve(), pending = 0, failed = null;
function enqueue(job) {
  pending++;
  status(pending > 1 ? `保存中…（还有 ${pending} 项）` : '保存中…');
  tail = tail.then(job).catch(err => { console.error(err); failed ||= err; }).finally(() => {
    pending--;
    if (pending) return status(pending > 1 ? `保存中…（还有 ${pending} 项）` : '保存中…');
    if (!failed) { renderLog(); return status(`✓ 都存好了 ${now()}`); }
    const err = failed;
    failed = null;
    status('');
    alert(`有一项没存到：${err.message}\n现在换回真正存好的样子，请再看一下。`);
    load().catch(x => { console.error(x); status('读取失败'); });
  });
}
window.addEventListener('beforeunload', e => { if (pending) { e.preventDefault(); e.returnValue = ''; } });

function toggleArea(m, area, on) {
  const set = new Set(m.areas || []);
  on ? set.add(area) : set.delete(area);
  m.areas = [...set];
  const by = gate.me()?.name || '';
  enqueue(async () => {
    const { status: st, j } = await gate.staffCall('grantArea', { id: m.id, area, on });
    if (st !== 200) throw new Error(j?.error || (st === 401 ? '你没有开这一区的权限，或要重新输 PIN' : '没存到 ' + st));
    info.log.unshift({ at: new Date().toISOString(), by, who: m.name, area, on });
  });
}
function toggleGrant(m, area, on) {
  const set = new Set(info.grants[m.id] || []);
  on ? set.add(area) : set.delete(area);
  info.grants[m.id] = info.areas.filter(a => set.has(a));
  const mine = new Set(m.areas || []);
  info.grants[m.id].length ? mine.add('grant') : mine.delete('grant');
  m.areas = [...mine];
  enqueue(async () => {
    const { status: st } = await gate.staffCall('setGrant', { id: m.id, areas: info.grants[m.id] });
    if (st !== 200) throw new Error(st === 401 ? '这部手机没有最高权限' : '没存到 ' + st);
  });
}

const ctx = () => ({ members, masters, status, now, redraw, reload: () => load().catch(x => { console.error(x); status('读取失败'); }) });

$('m-q').addEventListener('input', () => info && render());
$('m-list').addEventListener('click', e => {
  const id = e.target.closest('[data-toggle]')?.dataset.toggle;
  if (id) {
    open.has(id) ? open.delete(id) : open.add(id);
    return redraw(members.find(m => m.id === id));
  }
  onMasterClick(e, ctx());
});
$('m-list').addEventListener('change', e => {
  const i = e.target.closest('input[data-m], input[data-g]');
  if (!i) return onMasterChange(e, ctx());
  const m = members.find(x => x.id === (i.dataset.m || i.dataset.g)), area = i.dataset.area;
  (i.dataset.m ? toggleArea : toggleGrant)(m, area, i.checked);
  // 只换这一行的底色和名字那一行，勾选框本身不动
  i.closest('[data-row]').classList.toggle('bg-indigo-50', own(m).includes(area) || (info.grants[m.id] || []).includes(area));
  i.closest('[data-member]').querySelector('[data-head]').innerHTML = headInner(m);
});

// 共用密码分页：要用才载入（只有最高权限）
let keysReady = false;
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-pane]');
  if (!b) return;
  const keys = b.dataset.pane === 'keys';
  $('pane-people').classList.toggle('hidden', keys);
  $('pane-keys').classList.toggle('hidden', !keys);
  $('tabs').querySelectorAll('button').forEach(x => {
    const on = x === b;
    x.classList.toggle('bg-indigo-600', on);
    x.classList.toggle('text-white', on);
    x.classList.toggle('bg-white', !on);
    x.classList.toggle('border', !on);
    x.classList.toggle('border-slate-200', !on);
    x.classList.toggle('text-slate-600', !on);
  });
  if (keys && !keysReady) {
    keysReady = true;
    import('./access.js').catch(err => { console.error(err); keysReady = false; $('k-status').textContent = '读取失败，检查一下网络。'; });
  }
});

load().catch(err => { console.error(err); status('读取失败：' + (err.code || err.message)); });
