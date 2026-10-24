// 我的资料：团员自己改名字（至少有圣名）、全名、电话；名单上本来就有他的话，自己合并
// 改名字时，职务表、座位表、婚礼名单上的旧名字一起改（members-common.js）
import { collection, doc, updateDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, getDocs } from "./firebase.js";
import { renameEverywhere, mergeMembers, lookAlikes } from "./members-common.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gate = window.sicStaff;
const f = $('f');
let members = [], me = null;

const err = msg => { $('err').textContent = msg; $('err').classList.toggle('hidden', !msg); };
const ok = msg => { $('ok').textContent = msg; $('ok').classList.toggle('hidden', !msg); };

async function load() {
  const who = gate.me();
  $('status').classList.add('hidden');
  $('need-login').classList.toggle('hidden', !!who);
  $('body').classList.toggle('hidden', !who);
  if (!who) return;
  members = (await getDocs(collection(db, 'members'))).docs.map(d => ({ id: d.id, ...d.data() }));
  me = members.find(m => m.id === who.id);
  if (!me) { gate.logout(); return load(); }
  f.name.value = me.name;
  f.fullName.value = me.fullName || '';
  $('phone-now').textContent = me.phoneTail ? `…${me.phoneTail}` : '还没登记';
  nameTip();
  renderMerge();
}

// 只有一个字（Mok、Kevin）→ 提醒加姓
function nameTip() {
  const v = f.name.value.trim();
  const one = v && !/\s/.test(v);
  $('name-tip').textContent = one ? `只有「${v}」，团里可能有同名的。加上姓或中文名会比较清楚，例如「${v} Tan」。` : '';
  $('name-tip').classList.toggle('hidden', !one);
}
f.name.addEventListener('input', nameTip);

// 名单上本来就有你（自己注册时没点到）：还没登记电话、名字第一个字一样的
function renderMerge() {
  const cand = me.selfJoined && !me.pendingMerge ? lookAlikes(me, members).filter(o => !o.phoneTail && !o.selfJoined) : [];
  const box = $('merge-box');
  box.classList.toggle('hidden', !cand.length);
  if (!cand.length) return;
  box.innerHTML = `
    <div class="text-amber-200 font-semibold">名单上本来就有你吗？</div>
    <div class="text-xs text-amber-100/80">歌咏团名单上本来就有下面这位。是你的话按「是我」，你的披肩、职务、点名记录就会连起来（只留一个名字）。</div>
    ${cand.map(o => `<button data-merge="${esc(o.id)}" class="w-full text-left rounded-xl bg-white/5 hover:bg-amber-500/20 px-4 py-2.5">
      <span class="text-white">${esc(o.name)}</span>${o.fullName ? `<span class="text-xs text-zinc-400">　${esc(o.fullName)}</span>` : ''}
      <span class="float-right text-amber-300 text-xs">是我 ›</span></button>`).join('')}`;
  box.querySelectorAll('[data-merge]').forEach(b => b.addEventListener('click', async () => {
    const o = members.find(m => m.id === b.dataset.merge);
    const name = me.name.length > o.name.length ? me.name : o.name;
    if (!confirm(`「${o.name}」就是我，合并成一个（叫「${name}」）？`)) return;
    b.disabled = true;
    try {
      const m = await mergeMembers(db, o.id, me.id, name);
      gate.setMe(m);
      ok(`✅ 合并好了，现在是「${m.name}」`);
      await load();
    } catch (x) {
      // 团员改不到别人那一笔（资料库锁着）→ 先记下来，管理员打开团员名单时自动合并
      if (x.code !== 'permission-denied') { console.error(x); alert('合并失败：' + (x.code || x.message)); b.disabled = false; return; }
      try {
        await updateDoc(doc(db, 'members', me.id), { pendingMerge: { into: o.id, name }, updatedAt: new Date().toISOString() });
        ok(`✅ 收到了。管理员打开团员名单时会自动跟「${o.name}」连起来（之后要用电话再登录一次）。`);
        await load();
      } catch (y) { console.error(y); alert('没送出：' + (y.code || y.message)); b.disabled = false; }
    }
  }));
}

$('btn-phone').addEventListener('click', () => { $('phone-box').classList.toggle('hidden'); f.phone.focus(); });

f.addEventListener('submit', async e => {
  e.preventDefault();
  err(''); ok('');
  const name = f.name.value.trim(), fullName = f.fullName.value.trim(), phone = f.phone.value.trim();
  if (!name) return err('名字不能空');
  if (members.some(m => m.id !== me.id && m.name.trim().toLowerCase() === name.toLowerCase())) return err(`名单上已经有「${name}」了。加上姓或中文名区别一下。`);
  const p = { name, fullName, updatedAt: new Date().toISOString() };
  let ph = null;
  if (phone) {
    const n = gate.normPhone(phone);
    if (n.length < 10) return err('电话号码好像不完整');
    ph = { phoneHash: await gate.phoneHash(n), phoneTail: n.slice(-4) };
  }
  const b = $('btn-save');
  b.disabled = true; b.textContent = '保存中…';
  try {
    // 换电话：登录服务帮他换（要用现在的电话证明是他）
    if (ph) {
      const { status } = await gate.staffCall('setPhone', { id: me.id, ...ph });
      if (status === 409) { b.disabled = false; b.textContent = '保存'; return err('这个电话已经是别人登记的了。有问题请跟 Ronald 说。'); }
      if (status !== 200) throw new Error(status === 401 ? '要先用电话重新登录一次' : '电话没存到 ' + status);
      p.phoneHash = ph.phoneHash;
    }
    await gate.withAuth(() => updateDoc(doc(db, 'members', me.id), { name, fullName, updatedAt: p.updatedAt }));
    // 职务表、座位表里的名字也换掉；改不到（资料库锁着）→ 记下来，管理员打开团员名单时自动换
    if (name !== me.name) await renameEverywhere(db, me.name, name).catch(async x => {
      if (x.code !== 'permission-denied') throw x;
      await updateDoc(doc(db, 'members', me.id), { pendingRename: { from: me.pendingRename?.from || me.name, to: name } });
    });
    gate.setMe({ id: me.id, name, ...(p.phoneHash ? { phoneHash: p.phoneHash } : {}) });   // 换了电话 → 通行证也用新的
    f.phone.value = '';
    $('phone-box').classList.add('hidden');
    await load();
    ok('✅ 保存好了');
  } catch (x) { console.error(x); err('没存到，检查一下网络再试。'); }
  b.disabled = false; b.textContent = '保存';
});

$('btn-login').addEventListener('click', () => window.sicLogin?.open());
document.addEventListener('sic-login', () => { window.sicLogin?.close(); load(); });
$('btn-logout').addEventListener('click', () => {
  if (!confirm('登出？这部手机就不会记得你是谁，后台也会锁回去（PIN、后台密码都要重输）。')) return;
  gate.logout();
  location.href = '/';
});

load().catch(x => { console.error(x); $('status').textContent = '读取失败，检查一下网络。'; });
