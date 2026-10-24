// 密码管理页下半部：团员权限（电话登录）
// members/{id}：phoneTail（电话最后 4 码，有 = 登记了电话）、areas（开哪几区）、hasPin（他设了 4 位数 PIN）
// 电话、清 PIN 经登录服务（/api/login）改，这页看不到打乱过的电话和 PIN
// 「👑 最高权限」：他的 PIN 也开全部（含密码管理）；这个藏在 secrets，经登录服务改
import { collection, doc, setDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, getDocs } from "./firebase.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gate = window.sicStaff;
const AREAS = gate.AREAS;
const LABEL = Object.fromEntries(AREAS.map(a => [a.key, a.label]));

let members = [];
let masters = new Set();  // PIN 也开最高权限的团员 id
const open = new Set();   // 展开勾选的人

async function load() {
  const [snap, k] = await Promise.all([getDocs(collection(db, 'members')), gate.staffCall('keys').catch(() => null)]);
  masters = new Set(k?.j?.masters || []);
  members = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.active === false) - (b.active === false) || (b.areas?.length || 0) - (a.areas?.length || 0) || a.name.localeCompare(b.name, 'zh'));
  render();
}

function render() {
  const q = $('m-q').value.trim().toLowerCase();
  const list = members.filter(m => !q || `${m.name} ${m.fullName || ''}`.toLowerCase().includes(q));
  const withPhone = members.filter(m => m.phoneTail).length;
  $('m-list').innerHTML = `<div class="px-3.5 py-2 text-xs text-slate-500 bg-slate-50 rounded-t-2xl">有电话的 ${withPhone} / ${members.length} 人</div>` + list.map(m => {
    const areas = (m.areas || []).filter(a => LABEL[a]);
    const isOpen = open.has(m.id);
    return `<div class="px-3.5 py-2.5 ${m.active === false ? 'opacity-50' : ''}">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div class="flex-1 min-w-[7rem]">
          <span class="font-semibold">${esc(m.name)}</span>${masters.has(m.id) ? ' <span class="text-xs text-amber-700">👑 最高权限</span>' : ''}
          ${m.fullName && m.fullName !== m.name ? `<span class="text-xs text-slate-400">${esc(m.fullName)}</span>` : ''}
        </div>
        <button data-phone="${m.id}" class="text-xs px-2 py-1 rounded-lg ${m.phoneTail ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700'} hover:bg-slate-200">📱 ${m.phoneTail ? `…${esc(m.phoneTail || '')}` : '还没电话'}</button>
        <button data-toggle="${m.id}" class="text-xs px-2 py-1 rounded-lg ${areas.length ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-500'} hover:bg-indigo-100">${areas.length ? `🔓 ${areas.length} 区` : '＋ 开后台'} ${isOpen ? '▴' : '▾'}</button>
      </div>
      ${areas.length && !isOpen ? `<div class="text-xs text-indigo-700 mt-1">${esc(areas.map(a => LABEL[a]).join('、'))}　<span class="text-slate-400">${m.hasPin || m.pinHash ? 'PIN 已设' : '还没登录设 PIN'}</span></div>` : ''}
      ${isOpen ? `
        <div class="grid sm:grid-cols-2 gap-1.5 mt-2">
          ${AREAS.map(a => `<label class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${areas.includes(a.key) ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200'} cursor-pointer">
            <input type="checkbox" data-m="${m.id}" data-area="${a.key}" ${areas.includes(a.key) ? 'checked' : ''} class="w-4 h-4">
            <span><span class="block">${esc(a.label)}</span><span class="block text-[11px] text-slate-400">${esc(a.sub)}</span></span>
          </label>`).join('')}
        </div>
        <label class="flex items-center gap-2 mt-1.5 px-2.5 py-1.5 rounded-lg border ${masters.has(m.id) ? 'border-amber-300 bg-amber-50' : 'border-slate-200'} cursor-pointer">
          <input type="checkbox" data-master="${m.id}" ${masters.has(m.id) ? 'checked' : ''} class="w-4 h-4">
          <span><span class="block">👑 最高权限</span><span class="block text-[11px] text-slate-400">他用电话＋PIN 登录就全部都开，包括这一页（密码管理）。只给你自己</span></span>
        </label>
        <div class="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-500">
          ${m.hasPin || m.pinHash ? `PIN 已设 <button data-clearpin="${m.id}" class="text-red-500 hover:underline">清掉 PIN（他忘了的话）</button>` : '还没设 PIN（他有开后台的话，第一次登录会自己设）'}
          ${!m.phoneTail && areas.length ? '<span class="text-amber-700">⚠ 还没电话，他登录不了</span>' : ''}
        </div>` : ''}
    </div>`;
  }).join('');
}

async function save(m, data, msg) {
  $('status').textContent = '保存中…';
  await setDoc(doc(db, 'members', m.id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
  done(msg);
}
const done = msg => { $('status').textContent = `✓ ${msg || '已保存'} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`; };
// 电话、PIN 交给登录服务改（要最高权限）
async function staff(action, body, msg) {
  $('status').textContent = '保存中…';
  const { status } = await gate.staffCall(action, body);
  if (status !== 200) { $('status').textContent = ''; throw new Error(status === 401 ? '这部手机没有最高权限' : '没存到 ' + status); }
  done(msg);
}

$('m-q').addEventListener('input', render);
$('m-list').addEventListener('change', async e => {
  const x = e.target.closest('input[data-master]');
  if (x) {
    const m = members.find(y => y.id === x.dataset.master);
    if (x.checked && !confirm(`让 ${m.name} 用电话＋PIN 登录就有最高权限（什么都能改，包括密码管理）？`)) { x.checked = false; return; }
    try {
      await staff('setMaster', { id: m.id, on: x.checked }, x.checked ? `${m.name} 有最高权限了` : `${m.name} 的最高权限拿掉了`);
      x.checked ? masters.add(m.id) : masters.delete(m.id);
      render();
    } catch (err) { console.error(err); alert('保存失败：' + (err.code || err.message)); load(); }
    return;
  }
  const i = e.target.closest('input[data-m]'); if (!i) return;
  const m = members.find(x => x.id === i.dataset.m);
  const set = new Set(m.areas || []);
  i.checked ? set.add(i.dataset.area) : set.delete(i.dataset.area);
  const areas = AREAS.map(a => a.key).filter(a => set.has(a));
  try { await save(m, { areas }, `${m.name} 的权限改好了`); m.areas = areas; render(); }
  catch (err) { console.error(err); alert('保存失败：' + (err.code || err.message)); load(); }
});
$('m-list').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.toggle) { open.has(b.dataset.toggle) ? open.delete(b.dataset.toggle) : open.add(b.dataset.toggle); render(); return; }
  const m = members.find(x => x.id === (b.dataset.phone || b.dataset.clearpin)); if (!m) return;
  try {
    if (b.dataset.phone) {
      const v = prompt(`${m.name} 的电话号码${m.phoneTail ? `（现在是 …${m.phoneTail}，输新的就换掉；输 - 就拿掉）` : ''}：`);
      if (v === null || !v.trim()) return;
      if (v.trim() === '-') {
        await staff('setPhone', { id: m.id, phoneHash: '' }, '电话拿掉了');
        delete m.phoneHash; delete m.phoneTail; render(); return;
      }
      const n = gate.normPhone(v);
      if (n.length < 10) return alert('电话号码好像不完整');
      const tail = n.slice(-4);
      const { status, j } = await gate.staffCall('setPhone', { id: m.id, phoneHash: await gate.phoneHash(v), phoneTail: tail });
      if (status === 409) return alert(`这个电话已经是 ${j.name || '别人'} 的了。`);
      if (status !== 200) throw new Error(status === 401 ? '这部手机没有最高权限' : '没存到 ' + status);
      done(`${m.name} 的电话存好了`);
      m.phoneTail = tail;
    } else if (b.dataset.clearpin) {
      if (!confirm(`清掉 ${m.name} 的 PIN？他下次登录会重新设一个。`)) return;
      await staff('clearPin', { id: m.id }, 'PIN 清掉了');
      delete m.pinHash; delete m.hasPin;
    }
    render();
  } catch (err) { console.error(err); alert('保存失败：' + (err.code || err.message)); load(); }
});

load().catch(err => { console.error(err); $('m-list').innerHTML = `<div class="p-4 text-slate-400">读取失败：${esc(err.code || err.message)}</div>`; });
