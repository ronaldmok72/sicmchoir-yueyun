// 后台权限页里，只有最高权限才有的：团员的电话、清 PIN、👑 最高权限
// 电话、PIN、最高权限都经登录服务（/api/login）改，这页看不到打乱过的电话和 PIN
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gate = window.sicStaff;

export function masterPanel(m, masters) {
  const id = esc(m.id), on = masters.has(m.id), pin = m.hasPin || m.pinHash;
  return `<label class="flex items-center gap-2 mt-1.5 px-2.5 py-1.5 rounded-lg border ${on ? 'border-amber-300 bg-amber-50' : 'border-slate-200'} cursor-pointer">
      <input type="checkbox" data-master="${id}" ${on ? 'checked' : ''} class="w-5 h-5">
      <span><span class="block">👑 最高权限</span><span class="block text-[11px] text-slate-400">他用电话＋PIN 登录就全部都开，包括这一页。只给你自己</span></span>
    </label>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-slate-500">
      <button data-phone="${id}" class="px-2 py-1 rounded-lg ${m.phoneTail ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700'} hover:bg-slate-200">📱 ${m.phoneTail ? `…${esc(m.phoneTail)} 换电话` : '加电话'}</button>
      ${pin ? `PIN 已设 <button data-clearpin="${id}" class="text-red-500 hover:underline">清掉 PIN（他忘了的话）</button>` : '还没设 PIN（第一次登录后台时自己设）'}
    </div>`;
}

async function call(action, body, c, msg) {
  c.status('保存中…');
  const { status } = await gate.staffCall(action, body);
  if (status !== 200) { c.status(''); throw new Error(status === 401 ? '这部手机没有最高权限' : '没存到 ' + status); }
  c.status(`✓ ${msg} ${c.now()}`);
}
const failed = (err, c) => { console.error(err); alert('保存失败：' + (err.code || err.message)); c.reload(); };

export async function onMasterChange(e, c) {
  const x = e.target.closest('input[data-master]');
  if (!x) return;
  const m = c.members.find(y => y.id === x.dataset.master), on = x.checked;
  if (on && !confirm(`让 ${m.name} 用电话＋PIN 登录就有最高权限（什么都能改，包括这一页）？`)) { x.checked = false; return; }
  try {
    await call('setMaster', { id: m.id, on }, c, on ? `${m.name} 有最高权限了` : `${m.name} 的最高权限拿掉了`);
    on ? c.masters.add(m.id) : c.masters.delete(m.id);
    c.redraw(m);
  } catch (err) { failed(err, c); }
}

export async function onMasterClick(e, c) {
  const b = e.target.closest('button[data-phone], button[data-clearpin]');
  if (!b) return;
  const m = c.members.find(x => x.id === (b.dataset.phone || b.dataset.clearpin));
  if (!m) return;
  try {
    if (b.dataset.phone) {
      const v = prompt(`${m.name} 的电话号码${m.phoneTail ? `（现在是 …${m.phoneTail}，输新的就换掉；输 - 就拿掉）` : ''}：`);
      if (v === null || !v.trim()) return;
      if (v.trim() === '-') {
        await call('setPhone', { id: m.id, phoneHash: '' }, c, '电话拿掉了');
        delete m.phoneHash; delete m.phoneTail;
        return c.redraw(m);
      }
      const n = gate.normPhone(v);
      if (n.length < 10) return alert('电话号码好像不完整');
      const tail = n.slice(-4);
      c.status('保存中…');
      const { status, j } = await gate.staffCall('setPhone', { id: m.id, phoneHash: await gate.phoneHash(v), phoneTail: tail });
      if (status === 409) { c.status(''); return alert(`这个电话已经是 ${j.name || '别人'} 的了。`); }
      if (status !== 200) { c.status(''); throw new Error(status === 401 ? '这部手机没有最高权限' : '没存到 ' + status); }
      c.status(`✓ ${m.name} 的电话存好了 ${c.now()}`);
      m.phoneTail = tail;
    } else {
      if (!confirm(`清掉 ${m.name} 的 PIN？他下次登录会重新设一个。`)) return;
      await call('clearPin', { id: m.id }, c, 'PIN 清掉了');
      delete m.pinHash; delete m.hasPin;
    }
    c.redraw(m);
  } catch (err) { failed(err, c); }
}
