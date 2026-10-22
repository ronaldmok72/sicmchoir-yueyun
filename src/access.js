// 密码管理：每个密码开哪几页。存在 Firestore config/access { json: '[{ id, name, hash, areas, master }]' }
// 密码本身不存，只存 gate.js 打乱过的样子（hash）；读、存都经登录服务（/api/login），这页看不到打乱过的密码

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gate = window.sicStaff;
const AREAS = gate.AREAS;
const LABEL = Object.fromEntries(AREAS.map(a => [a.key, a.label]));

let keys = null;   // null = 还没设过（还在用 sic）

async function load() {
  $('status').textContent = '读取中…';
  // 打乱过的电话、PIN、密码表还在公开的地方的话，先搬去藏起来（搬过了就没事做）
  try { await gate.staffCall('migrate'); } catch (err) { console.warn('搬去藏起来', err); }
  const { status, j } = await gate.staffCall('keys');
  if (status !== 200) throw new Error(status === 401 ? '这部手机没有最高权限，重新输一次密码' : '读不到密码表 ' + status);
  keys = j.keys;
  $('status').textContent = '';
  render();
}

function render() {
  $('boot-box').classList.toggle('hidden', !!keys);
  $('add-box').classList.toggle('hidden', !keys);
  if (!keys) { $('list').innerHTML = ''; return; }
  const box = (k, a, on, dis) => `<label class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${on ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200'} ${dis ? 'opacity-60' : 'cursor-pointer'}">
      <input type="checkbox" ${k ? `data-key="${esc(k)}"` : ''} data-area="${a.key}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''} class="w-4 h-4">
      <span><span class="block">${esc(a.label)}</span><span class="block text-[11px] text-slate-400">${esc(a.sub)}</span></span>
    </label>`;
  $('list').innerHTML = keys.map(k => `
    <div class="bg-white rounded-2xl border ${k.master ? 'border-amber-300' : 'border-slate-200'} p-4 text-sm space-y-2.5">
      <div class="flex items-center gap-2">
        <div class="flex-1 min-w-0 font-semibold truncate">${k.master ? '👑 ' : '🔑 '}${esc(k.name)}</div>
        <button data-rename="${esc(k.id)}" class="px-2 py-1 text-xs text-slate-500 hover:text-indigo-600">改名字</button>
        <button data-repwd="${esc(k.id)}" class="px-2 py-1 text-xs rounded-md bg-slate-100 hover:bg-slate-200">换密码</button>
        ${k.master ? '' : `<button data-del="${esc(k.id)}" class="px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded-md">删除</button>`}
      </div>
      ${k.master
        ? '<div class="text-slate-500">全部页面 ＋ 密码管理（最高权限）</div>'
        : `<div class="grid sm:grid-cols-2 gap-1.5">${AREAS.map(a => box(k.id, a, (k.areas || []).includes(a.key))).join('')}</div>`}
    </div>`).join('');
  if (!$('add-areas').innerHTML) $('add-areas').innerHTML = AREAS.map(a => box('', a, false)).join('');
}

// 新的、换过的密码带 hash；其他的登录服务照旧。密码跟别人一样 → code dup
async function save(msg) {
  $('status').textContent = '保存中…';
  const { status, j } = await gate.staffCall('saveKeys', { list: keys });
  if (status === 409) { $('status').textContent = ''; throw Object.assign(new Error('这个密码已经有别人在用，换一个。'), { code: 'dup' }); }
  if (status !== 200) { $('status').textContent = ''; throw new Error(status === 401 ? '这部手机没有最高权限' : '没存到 ' + status); }
  keys = j.keys;
  $('status').textContent = `✓ ${msg || '已保存'} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
const failed = err => { console.error(err); alert(err.code === 'dup' ? err.message : '保存失败：' + (err.code || err.message)); };

// 新密码：至少 4 个字（跟别的密码一样的话，存的时候登录服务会挡）
async function checkNew(pwd) {
  if (!pwd || pwd.trim().length < 4) { alert('密码至少 4 个字。'); return null; }
  return gate.hash(pwd);
}
const newId = () => Math.random().toString(36).slice(2, 10);

// 第一次：从 sic 换成自己的最高权限密码
$('boot-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  if (f.p1.value !== f.p2.value) return alert('两次输的不一样。');
  const h = await checkNew(f.p1.value);
  if (!h) return;
  keys = [{ id: newId(), name: 'Ronald（最高权限）', hash: h, master: true }];
  try {
    await save('最高权限密码设好了');
    gate.forget();
    await gate.tryPassword(f.p1.value);   // 这部手机换成新密码
    f.reset();
    render();
  } catch (err) { keys = null; failed(err); }
});

$('add-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const name = f.name.value.trim();
  if (!name) return alert('写一下这个密码给谁用。');
  const areas = [...$('add-areas').querySelectorAll('input:checked')].map(i => i.dataset.area);
  if (!areas.length) return alert('至少勾一页。');
  const h = await checkNew(f.pwd.value);
  if (!h) return;
  const pwd = f.pwd.value.trim();
  keys.push({ id: newId(), name, hash: h, areas });
  try {
    await save('开好了');
    f.reset();
    $('add-areas').innerHTML = '';
    render();
    alert(`开好了 ✅\n\n${name}：${pwd}\n可以进：${areas.map(a => LABEL[a]).join('、')}\n\n这里之后看不到密码，现在记下来发给他们。`);
  } catch (err) { keys.pop(); failed(err); }
});

$('list').addEventListener('change', async e => {
  const i = e.target.closest('input[data-key]'); if (!i) return;
  const k = keys.find(k => k.id === i.dataset.key);
  const set = new Set(k.areas || []);
  i.checked ? set.add(i.dataset.area) : set.delete(i.dataset.area);
  k.areas = AREAS.map(a => a.key).filter(a => set.has(a));
  try { await save(); render(); } catch (err) { failed(err); load(); }
});

$('list').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const id = b.dataset.rename || b.dataset.repwd || b.dataset.del;
  const k = keys.find(k => k.id === id); if (!k) return;
  try {
    if (b.dataset.rename) {
      const v = prompt('给谁用？', k.name);
      if (!v || !v.trim()) return;
      k.name = v.trim();
      await save();
    } else if (b.dataset.repwd) {
      const v = prompt(`「${k.name}」的新密码（至少 4 个字）：\n换了之后，旧密码的手机都要重新输。`);
      if (v === null) return;
      const h = await checkNew(v);
      if (!h) return;
      k.hash = h;
      await save('密码换好了');
      if (k.master) { gate.forget(); await gate.tryPassword(v); }
      alert(`换好了 ✅\n\n${k.name}：${v.trim()}\n\n这里之后看不到密码，现在记下来。`);
    } else if (b.dataset.del) {
      if (!confirm(`删除「${k.name}」这个密码？用这个密码的手机就进不了后台了。`)) return;
      keys = keys.filter(x => x.id !== id);
      await save('删掉了');
    }
    render();
  } catch (err) { failed(err); load(); }
});

load().catch(err => { console.error(err); $('status').textContent = '读取失败：' + (err.code || err.message); });
