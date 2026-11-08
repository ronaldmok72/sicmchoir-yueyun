// 分区授权：被 Ronald 指定的人（例如主席）帮团员开后台，只能开 Ronald 准的那几区
// Ronald（最高权限）在这里还可以指定「谁可以帮别人开、开哪几区」。全部经登录服务（/api/login）改，资料库规则挡着手机直接改
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gate = window.sicStaff;
const LABEL = Object.fromEntries(gate.AREAS.map(a => [a.key, a.label]));
const SUB = Object.fromEntries(gate.AREAS.map(a => [a.key, a.sub]));

let info = null, members = [];
const open = new Set();
const status = t => { $('status').textContent = t; };
const now = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

async function load() {
  status('读取中…');
  const [r, list] = await Promise.all([gate.staffCall('grantInfo'), gate.listMembers()]);
  if (r.status !== 200) {
    $('intro').textContent = r.status === 401 ? 'Ronald 还没指定你可以开哪几区，或者这部手机要重新输 PIN。' : '读不到，检查一下网络。';
    status('');
    return;
  }
  info = r.j;
  members = list.filter(m => m.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  $('intro').innerHTML = info.master
    ? '帮团员开后台，或者在每个人下面指定「他也可以帮别人开哪几区」（例如主席）。被指定的人只能开你勾的那几区，碰不到密码管理。'
    : `你可以帮团员开：<b>${info.areas.map(a => esc(LABEL[a])).join('、')}</b>。对方开通后，打开菜单按提示输 PIN 就进得去。`;
  status('');
  render();
  renderLog();
}

const box = (attr, on, a) => `<label class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${on ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200'} cursor-pointer">
  <input type="checkbox" ${attr} ${on ? 'checked' : ''} class="w-4 h-4">
  <span><span class="block">${esc(LABEL[a])}</span><span class="block text-[11px] text-slate-400">${esc(SUB[a])}</span></span></label>`;

function render() {
  const q = $('q').value.trim().toLowerCase();
  const list = members.filter(m => !q || `${m.name} ${m.fullName || ''} ${m.cname || ''}`.toLowerCase().includes(q))
    .sort((a, b) => (b.areas?.length || 0) - (a.areas?.length || 0));
  $('list').innerHTML = list.map(m => {
    const areas = (m.areas || []).filter(a => a !== 'grant' && LABEL[a]);
    const given = info.grants?.[m.id] || [];
    const isOpen = open.has(m.id);
    return `<div class="px-3.5 py-2.5">
      <div class="flex items-center gap-2">
        <div class="flex-1 min-w-0"><span class="font-semibold">${esc(m.name)}</span>${given.length ? ' <span class="text-xs text-amber-700">🗝️ 可帮别人开</span>' : ''}${m.phoneTail ? '' : ' <span class="text-xs text-amber-700">还没登记电话</span>'}</div>
        <button data-toggle="${esc(m.id)}" class="text-xs px-2 py-1 rounded-lg ${areas.length ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-500'}">${areas.length ? `${areas.length} 区` : '＋ 开后台'} ${isOpen ? '▴' : '▾'}</button>
      </div>
      ${areas.length && !isOpen ? `<div class="text-xs text-indigo-700 mt-1">${areas.map(a => esc(LABEL[a])).join('、')}</div>` : ''}
      ${isOpen ? `<div class="grid sm:grid-cols-2 gap-1.5 mt-2">${info.areas.map(a => box(`data-m="${esc(m.id)}" data-area="${a}"`, areas.includes(a), a)).join('')}</div>
        ${info.master ? `<div class="mt-3 text-xs font-semibold text-amber-800">🗝️ 让 ${esc(m.name)} 也可以帮别人开这几区：</div>
        <div class="grid sm:grid-cols-2 gap-1.5 mt-1">${info.areas.map(a => box(`data-g="${esc(m.id)}" data-area="${a}"`, given.includes(a), a)).join('')}</div>` : ''}` : ''}
    </div>`;
  }).join('');
}

function renderLog() {
  const when = s => new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  $('log').innerHTML = info.log.length
    ? info.log.map(x => `<div>${esc(when(x.at))}　<b>${esc(x.by || '?')}</b> ${x.on ? '开了' : '关了'} ${esc(x.who)} 的「${esc(LABEL[x.area] || x.area)}」</div>`).join('')
    : '还没有记录。';
}

$('q').addEventListener('input', () => info && render());
$('list').addEventListener('click', e => {
  const id = e.target.closest('[data-toggle]')?.dataset.toggle;
  if (!id) return;
  open.has(id) ? open.delete(id) : open.add(id);
  render();
});
$('list').addEventListener('change', async e => {
  const i = e.target.closest('input[type=checkbox]');
  if (!i) return;
  const m = members.find(x => x.id === (i.dataset.m || i.dataset.g));
  try {
    status('保存中…');
    if (i.dataset.m) {
      const { status: st, j } = await gate.staffCall('grantArea', { id: m.id, area: i.dataset.area, on: i.checked });
      if (st !== 200) throw new Error(j?.error || (st === 401 ? '你没有开这一区的权限，或要重新输 PIN' : '没存到 ' + st));
      m.areas = j.areas;
    } else {
      const set = new Set(info.grants[m.id] || []);
      i.checked ? set.add(i.dataset.area) : set.delete(i.dataset.area);
      const { status: st, j } = await gate.staffCall('setGrant', { id: m.id, areas: info.areas.filter(a => set.has(a)) });
      if (st !== 200) throw new Error(st === 401 ? '这部手机没有最高权限' : '没存到 ' + st);
      info.grants[m.id] = j.grant;
      const a = new Set(m.areas || []);
      j.grant.length ? a.add('grant') : a.delete('grant');
      m.areas = [...a];
    }
    status(`✓ ${m.name} 改好了 ${now()}`);
    render();
  } catch (err) { console.error(err); status(''); alert('保存失败：' + err.message); load(); }
});

load().catch(err => { console.error(err); status('读取失败：' + (err.code || err.message)); });
