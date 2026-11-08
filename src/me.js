// 我的资料：团员自己改名字（至少有圣名）、全名、电话；名单上本来就有他的话，自己合并
// 改名字时，职务表、座位表、婚礼名单上的旧名字一起改（members-common.js）
import { collection, doc, updateDoc, query, where, documentId } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, getDocs, getDoc, RESULTS } from "./firebase.js";
import { renameEverywhere, mergeMembers, lookAlikes } from "./members-common.js";
import { markOf, scoreOf, fmtPts } from "./checkin-common.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gate = window.sicStaff;
const f = $('f');
let members = [], me = null;
const pad = n => String(n).padStart(2, '0');
const MDAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
f.bm.innerHTML = '<option value="">月</option>' + MDAYS.map((_, i) => `<option value="${pad(i + 1)}">${i + 1} 月</option>`).join('');
f.bd.innerHTML = '<option value="">日</option>' + Array.from({ length: 31 }, (_, i) => `<option value="${pad(i + 1)}">${i + 1} 日</option>`).join('');

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
  // 中文名：还没填的，先从全名里的中文字带出来
  f.cname.value = me.cname || (String(me.fullName || '').match(/[\u4e00-\u9fff]{2,5}/) || [''])[0];
  f.noCname.checked = !!me.noCname;
  cnameState();
  [f.bm.value, f.bd.value] = me.birthday ? me.birthday.split('-') : ['', ''];
  const miss = [!me.cname && !me.noCname && '中文全名', !me.birthday && '生日'].filter(Boolean);
  $('need-box').classList.toggle('hidden', !miss.length);
  $('need-box').textContent = miss.length ? `👉 还差：${miss.join('、')}。在下面填好按「保存」就可以。` : '';
  $('phone-now').textContent = me.phoneTail ? `…${me.phoneTail}` : '还没登记';
  nameTip();
  renderMerge();
  renderAttendance().catch(x => { console.error(x); $('my-att-list').textContent = '读不到出席记录。'; });
  renderQuiz().catch(x => console.error(x));
}

// 我的出席：今年，再按季看；跟点名页同一套算法
async function renderAttendance() {
  const now = new Date(), y = now.getFullYear(), today = `${y}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const since = c => getDocs(query(collection(db, c), where(documentId(), '>=', `${y}-01-01`))).catch(() => ({ docs: [] }));
  const [at, rv, cfg] = await Promise.all([since('attendance'), since('rsvp'), getDoc(doc(db, 'config', 'attendance')).catch(() => null)]);
  const votes = Object.fromEntries(rv.docs.map(d => [d.id, d.data().votes || {}]));
  const evs = at.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.date && e.date <= today);
  const need = cfg?.data?.()?.need || 7;
  const line = (label, list, want) => {
    const c = { P: 0, T: 0, L: 0, A: 0 };
    let score = 0;
    list.forEach(e => { const v = votes[e.id]?.[me.id], k = markOf(e, me.id, v); c[k || 'A']++; score += scoreOf(e, me.id, v); });
    const came = c.P + c.T;
    return `<div class="py-2">
      <div class="flex items-baseline justify-between gap-2"><span class="text-zinc-200">${esc(label)}</span><span class="text-white font-semibold">${fmtPts(score)}<span class="text-xs font-normal text-zinc-500"> / ${want} 分</span></span></div>
      <div class="text-xs text-zinc-500 mt-0.5">出席 ${came} / ${list.length} 次（${Math.round(came / list.length * 100)}%）${c.T ? ` · 迟到或早退 ${c.T}` : ''} · 请假 ${c.L} · 缺席 ${c.A}</div>
    </div>`;
  };
  if (!evs.length) { $('my-att-list').textContent = '今年还没有点名记录。'; return; }
  const quarters = [4, 3, 2, 1].map(n => ({ n, list: evs.filter(e => Math.floor((+e.date.slice(5, 7) - 1) / 3) + 1 === n) })).filter(q => q.list.length);
  $('my-att-list').innerHTML = line(`今年 ${y}`, evs, need * 4) + quarters.map(q => line(`第 ${q.n} 季（${(q.n - 1) * 3 + 1}–${q.n * 3} 月）`, q.list, need)).join('');
}

// 我的测验：交过的看成绩（换手机也找得到），做到一半的接着做，有开给他的去做
async function renderQuiz() {
  const find = async (k, v) => (await getDocs(query(collection(db, RESULTS), where(k, '==', v)))).docs.map(d => d.data());
  let list = await find('memberId', me.id);
  if (!list.length) list = (await find('nameKey', me.name.trim().toLowerCase())).filter(r => !r.memberId);
  const at = r => r.createdAt?.toMillis?.() ?? (Date.parse(r.clientTime) || 0);
  const r = list.sort((a, b) => at(b) - at(a))[0];
  let halfway = false;
  try { halfway = !!localStorage.getItem('sicQuizDraft'); } catch { /* 没关系 */ }
  const open = await window.sicQuiz?.load();
  const box = $('my-quiz');
  const link = (t, h) => `<a href="${h}" class="block text-indigo-300 hover:text-white">${t} ›</a>`;
  if (r) box.innerHTML = `<div class="text-white font-semibold">📝 我的测验成绩</div><div class="text-zinc-300">40 题答对 <b class="text-white">${r.totalCorrect}</b> 题</div>`.replace('40', r.totalQuestions) + link('看详细成绩', 'quiz.html');
  else if (halfway) box.innerHTML = '<div class="text-white font-semibold">📝 测验</div>' + link('上次做到一半，接着做', 'quiz.html');
  else if (open) box.innerHTML = '<div class="text-white font-semibold">📝 测验</div>' + link('去做测验', 'quiz.html');
  box.classList.toggle('hidden', !r && !halfway && !open);
}

// 打勾「没有中文名」→ 中文名那格不用填
const cnameState = () => { f.cname.disabled = f.noCname.checked; if (f.noCname.checked) f.cname.value = ''; };
f.noCname.addEventListener('change', cnameState);

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
  const cname = f.cname.value.replace(/\s+/g, ''), noCname = f.noCname.checked;
  if (!name) return err('名字不能空');
  if (!cname && !noCname) return err('请填中文全名；真的没有中文名的话，打勾「我没有中文名」。');
  if (members.some(m => m.id !== me.id && m.name.trim().toLowerCase() === name.toLowerCase())) return err(`名单上已经有「${name}」了。加上姓或中文名区别一下。`);
  const bm = f.bm.value, bd = f.bd.value;
  if (!bm !== !bd) return err('生日要月和日都选；不想填就两个都留空。');
  if (bm && +bd > MDAYS[+bm - 1]) return err(`${+bm} 月没有 ${+bd} 日，再看一下。`);
  const birthday = bm ? `${bm}-${bd}` : '';
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
    await gate.withAuth(() => updateDoc(doc(db, 'members', me.id), { name, fullName, cname: noCname ? '' : cname, noCname, updatedAt: p.updatedAt }));
    // 生日分开存：万一没存到，名字那些还是存好了
    let bdayFail = false;
    if (birthday !== (me.birthday || '')) await gate.withAuth(() => updateDoc(doc(db, 'members', me.id), { birthday, updatedAt: p.updatedAt })).catch(x => { console.error(x); bdayFail = true; });
    try { localStorage.removeItem('sicMembersCache'); } catch { /* 没关系 */ }   // 首页的寿星、提醒马上换新的
    // 职务表、座位表里的名字也换掉；改不到（资料库锁着）→ 记下来，管理员打开团员名单时自动换
    if (name !== me.name) await renameEverywhere(db, me.name, name).catch(async x => {
      if (x.code !== 'permission-denied') throw x;
      await updateDoc(doc(db, 'members', me.id), { pendingRename: { from: me.pendingRename?.from || me.name, to: name } });
    });
    gate.setMe({ id: me.id, name, ...(p.phoneHash ? { phoneHash: p.phoneHash } : {}) });   // 换了电话 → 通行证也用新的
    f.phone.value = '';
    $('phone-box').classList.add('hidden');
    await load();
    if (bdayFail) err('名字存好了，生日没存到，过一会儿再试一次。'); else ok('✅ 保存好了');
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
