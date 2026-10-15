// 团员名单：名字、声部、披肩号码、会做的职务、还有没有在来
// 之后的职务表、座位表都从这里拿人
import { collection, getDocs, doc, setDoc, addDoc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, RESULTS } from "./firebase.js";
import { SEED } from "./members-seed.js";
import { VOICES, VOICE_NAME, VOICE_SHORT, genderOf, genderFromVoice, normVoice } from "./people.js";
import { renameEverywhere, mergeMembers, lookAlikes, suggestName } from "./members-common.js";

const $ = id => document.getElementById(id);
const MEMBERS = 'members';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ROLES = ['指挥', '答唱咏', '钢琴', '风琴', '吉他', '鼓手'];
// 测验第 E 题的答案 → 声部
const QUIZ_VOICE = { '女高音 S': 'S', '女低音 A': 'A', '男高音 T': 'T', '男低音 B': 'B', '主旋律': '' };

let members = [];
let quiz = [];        // 每个人最新一份测验：{ name, nameKey, voice }
let editing = null;   // 正在改的那一位（新的是 {}）

// ───────── 读取 ─────────
async function load() {
  $('status').textContent = '读取中…';
  const [ms, qs] = await Promise.all([getDocs(collection(db, MEMBERS)), getDocs(collection(db, RESULTS)).catch(() => null)]);
  members = ms.docs.map(d => ({ id: d.id, ...d.data() }));
  const seen = new Set();
  quiz = (qs ? qs.docs.map(d => d.data()) : [])
    .map(r => ({ ...r, _t: r.createdAt?.toMillis?.() ?? (Date.parse(r.clientTime) || 0) }))
    .sort((a, b) => b._t - a._t)
    .filter(r => r.nameKey && !seen.has(r.nameKey) && seen.add(r.nameKey))
    .map(r => ({ name: r.name, nameKey: r.nameKey, voice: QUIZ_VOICE[r.intent?.E] ?? null, raw: r.intent?.E }));
  $('status').textContent = '';
  render();
}

// 测验填的名字对到哪一位团员：名字或全名里的任何一段对得上
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
function quizFor(m) {
  const keys = [m.name, m.fullName, ...(m.fullName || '').split(/\s+/)].map(norm).filter(k => k.length >= 2);
  return quiz.find(q => keys.some(k => q.nameKey === k || q.nameKey.split(' ').includes(k) || (/[一-鿿]/.test(k) && q.nameKey.includes(k))));
}

// ───────── 画面 ─────────
function render() {
  $('seed-box').classList.toggle('hidden', members.length > 0);
  $('seed-count').textContent = SEED.length;
  renderSummary();
  renderDupBox();
  renderNameBox();
  renderQuizBox();
  renderList();
}

function renderSummary() {
  const act = members.filter(m => m.active !== false);
  if (!members.length) { $('summary').classList.add('hidden'); return; }
  $('summary').classList.remove('hidden');
  const cnt = k => act.filter(m => normVoice(m.voice) === k).length;
  const guessed = act.filter(m => m.genderGuess);
  const capes = {};
  act.forEach(m => { if (m.cape) (capes[m.cape] ||= []).push(m.name); });
  const dup = Object.entries(capes).filter(([, n]) => n.length > 1);
  $('summary').innerHTML = `
    <div class="text-base"><b>${act.length}</b> 位还有在来${members.length > act.length ? `<span class="text-slate-400 text-sm">　另外 ${members.length - act.length} 位没在来</span>` : ''}</div>
    <div class="flex flex-wrap gap-1.5">
      ${['S', 'A', 'T', 'B', ''].map(k => `<span class="px-2 py-0.5 rounded-md bg-slate-100">${VOICE_NAME[k]} <b>${cnt(k)}</b></span>`).join('')}
    </div>
    <div class="text-slate-600">女声 <b>${act.filter(m => genderOf(m) === 'F').length}</b>　男声 <b>${act.filter(m => genderOf(m) === 'M').length}</b>${act.some(m => !genderOf(m)) ? `　<span class="text-amber-700">还不知道男女：${act.filter(m => !genderOf(m)).map(m => esc(m.name)).join('、')}</span>` : ''}</div>
    <div class="text-slate-600">📱 用电话注册了 <b>${act.filter(m => m.phoneHash).length}</b> / ${act.length} 位${act.some(m => !m.phoneHash) ? `　<span class="text-xs text-slate-400">（下面选「还没用电话注册的」看是谁）</span>` : ''}${act.some(m => m.selfJoined) ? `　<span class="text-indigo-700">🆕 自己注册的新团员：${act.filter(m => m.selfJoined).map(m => esc(m.name)).join('、')}</span>` : ''}</div>
    <div class="text-xs text-slate-400">每个人都会唱主旋律；上面 S A T B 是另外会唱声部的人${quiz.length ? '' : '（10/17 测验答完会自动出现建议）'}</div>
    ${guessed.length ? `<div class="text-amber-700">⏳ ${guessed.length} 位的男女是照名字猜的（名单上标「猜的」），看一下对不对：${guessed.map(m => esc(m.name)).join('、')}</div>` : ''}
    ${dup.length ? `<div class="text-red-600">🔴 披肩号码重复：${dup.map(([c, n]) => `#${c} ${n.map(esc).join('、')}`).join('；')}</div>` : ''}`;
}

// 自己注册的新团员，名单上可能本来就有他（Hans Chew ↔ Hans）→ 一键合并
function renderDupBox() {
  const act = members.filter(m => m.active !== false);
  const pairs = act.filter(m => m.selfJoined).flatMap(n => lookAlikes(n, act).filter(o => !o.selfJoined).map(o => ({ n, o })));
  const box = $('dup-box');
  box.classList.toggle('hidden', !pairs.length);
  if (!pairs.length) return;
  const nameOf = ({ n, o }) => n.name.length > o.name.length ? n.name : o.name;
  box.innerHTML = `
    <div class="font-semibold text-amber-900">🆕 自己注册的，名单上可能本来就有他</div>
    <div class="text-xs text-amber-800">是同一个人就按合并：留名单上本来那一笔（披肩、职务、点名记录都在），把电话、声部搬过去。不是同一个人就不用理。</div>
    ${pairs.map((p, i) => `
      <div class="flex flex-wrap items-center gap-2">
        <span class="flex-1 min-w-0"><b>${esc(p.n.name)}</b> <span class="text-slate-500">（自己注册）</span> ↔ <b>${esc(p.o.name)}</b> <span class="text-slate-500">（名单上本来就有${p.o.phoneHash ? `，已经用 …${esc(p.o.phoneTail || '')} 登记` : ''}）</span></span>
        <button data-merge="${i}" class="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs">是同一个人，合并（叫 ${esc(nameOf(p))}）</button>
      </div>`).join('')}`;
  box.querySelectorAll('[data-merge]').forEach(b => b.addEventListener('click', async () => {
    const p = pairs[+b.dataset.merge];
    if (p.o.phoneHash && !confirm(`${p.o.name} 已经用另一个电话 …${p.o.phoneTail} 登记了。还是要合并？（会留旧的电话）`)) return;
    b.disabled = true; b.textContent = '合并中…';
    try { await mergeMembers(db, p.o.id, p.n.id, nameOf(p)); } catch (err) { console.error(err); alert('合并失败：' + (err.code || err.message)); }
    await load();
  }));
}

// 显示的名字至少要有圣名：Mok → Ronald Mok、咏薇 → Agnes 咏薇（照全名）；职务表、座位表一起改
function renderNameBox() {
  const act = members.filter(m => m.active !== false);
  const todo = act.map(m => ({ m, to: suggestName(m) })).filter(x => x.to && !members.some(o => o.id !== x.m.id && o.name.toLowerCase() === x.to.toLowerCase()));
  const bare = act.filter(m => !/\s/.test(m.name.trim()) && !suggestName(m));
  const box = $('name-box');
  box.classList.toggle('hidden', !todo.length && !bare.length);
  box.innerHTML = `
    ${todo.length ? `<div class="font-semibold text-sky-900">名字加上圣名／姓（照全名，${todo.length} 位）</div>
    <div class="text-slate-700">${todo.map(({ m, to }) => `${esc(m.name)} → <b>${esc(to)}</b>`).join('、')}</div>
    <button id="btn-names" class="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white">全部改</button>
    <span class="text-xs text-sky-800">职务表、座位表、婚礼名单上的名字也会一起改</span>` : ''}
    ${bare.length ? `<div class="text-xs text-slate-500">还只有一个名字、也没有全名的 ${bare.length} 位：${bare.map(m => esc(m.name)).join('、')}。他们登录后可以在「✏️ 我的资料」自己补，或者点他的名字帮他改。</div>` : ''}`;
  $('btn-names')?.addEventListener('click', async e => {
    e.target.disabled = true; e.target.textContent = '改名中…';
    try {
      for (const { m, to } of todo) {
        await setDoc(doc(db, MEMBERS, m.id), { name: to, updatedAt: new Date().toISOString() }, { merge: true });
        await renameEverywhere(db, m.name, to);
      }
    } catch (err) { console.error(err); alert('改名失败：' + (err.code || err.message)); }
    await load();
  });
}

// 测验答的声部跟名单不一样（或名单还没填）→ 一键采用
function renderQuizBox() {
  // 自己注册时选的声部也算（比测验新的话用注册的）
  const self = m => normVoice(m.voiceSelf) && { name: '注册时自己选', voice: m.voiceSelf, self: true };
  const todo = members.filter(m => m.active !== false).map(m => ({ m, q: self(m) || quizFor(m) })).filter(({ m, q }) => q?.voice && q.voice !== normVoice(m.voice));
  const box = $('quiz-box');
  box.classList.toggle('hidden', !todo.length);
  if (!todo.length) return;
  box.innerHTML = `
    <div class="font-semibold text-emerald-900">团员自己填的声部（测验或注册时，${todo.length} 位跟名单不一样）</div>
    <div class="space-y-1">${todo.map(({ m, q }) => `
      <div class="flex items-center gap-2"><span class="flex-1 min-w-0 truncate">${esc(m.name)} <span class="text-slate-400">（${q.self ? '注册时自己选' : `测验写「${esc(q.name)}」`}）</span>：${normVoice(m.voice) ? `${esc(VOICE_NAME[m.voice])} → ` : ''}<b>${esc(VOICE_NAME[q.voice])}</b></span></div>`).join('')}
    </div>
    <button id="btn-quiz-apply" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white">全部采用</button>
    <span class="text-xs text-emerald-800">不对的话，采用后再点那个人改</span>`;
  $('btn-quiz-apply').addEventListener('click', async () => {
    const b = writeBatch(db);
    todo.forEach(({ m, q }) => b.set(doc(db, MEMBERS, m.id), { voice: q.voice }, { merge: true }));
    await b.commit();
    await load();
  });
}

function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const f = $('filter').value;
  let list = members.filter(m =>
    (f === 'all' || (f === 'inactive' ? m.active === false : m.active !== false && (f !== 'nogender' || !genderOf(m) || m.genderGuess) && (f !== 'nophone' || !m.phoneHash)))
    && (!q || `${m.name} ${m.fullName || ''} ${m.cape || ''}`.toLowerCase().includes(q)));
  const groups = ['S', 'A', 'T', 'B', ''].map(k => ({ k, items: list.filter(m => normVoice(m.voice) === k) })).filter(g => g.items.length);
  groups.forEach(g => g.items.sort((a, b) => (a.cape || 999) - (b.cape || 999) || a.name.localeCompare(b.name)));
  $('list').innerHTML = groups.map(g => `
    <div>
      <div class="text-xs font-semibold text-slate-500 mb-1.5">${esc(VOICE_NAME[g.k])}　${g.items.length} 位</div>
      <div class="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        ${g.items.map(m => `
          <button data-id="${esc(m.id)}" class="w-full text-left flex items-center gap-3 px-3 py-2.5 hover:bg-indigo-50">
            <span class="w-10 shrink-0 text-center text-xs ${m.cape ? 'text-slate-700 font-semibold' : 'text-slate-300'}">${m.cape ? `#${m.cape}` : '—'}</span>
            <span class="flex-1 min-w-0">
              <span class="block truncate text-sm ${m.active === false ? 'text-slate-400' : ''}">${esc(m.name)}${m.fullName ? `<span class="text-slate-400 text-xs">　${esc(m.fullName)}</span>` : ''}</span>
              ${subLine(m)}
              ${m.note ? `<span class="block truncate text-xs text-amber-600">${esc(m.note)}</span>` : ''}
            </span>
            <span class="shrink-0 flex flex-wrap justify-end gap-1 max-w-[45%]">${(m.roles || []).map(r => `<span class="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[11px]">${esc(r)}</span>`).join('')}</span>
          </button>`).join('')}
      </div>
    </div>`).join('') || `<div class="text-sm text-slate-400 text-center py-8">${members.length ? '没有符合的' : ''}</div>`;
}
// 第二行：也唱哪些声部；只唱主旋律的写男声／女声（猜的会标出来）
function subLine(m) {
  const bits = [];
  const v2 = (m.voices2 || []).filter(v => normVoice(v) && v !== normVoice(m.voice));
  if (v2.length) bits.push(`也唱 ${v2.map(v => VOICE_SHORT[v]).join('、')}`);
  const g = genderOf(m);
  if (m.selfJoined) bits.push('<span class="text-indigo-600">🆕 自己注册</span>');
  if (!m.phoneHash && m.active !== false) bits.push('<span class="text-slate-300">📱 还没注册</span>');
  if (!normVoice(m.voice) || m.genderGuess) bits.push(g ? `${g === 'F' ? '女声' : '男声'}${m.genderGuess ? '<span class="text-amber-600">（猜的）</span>' : ''}` : '<span class="text-amber-600">还不知道男女</span>');
  return bits.length ? `<span class="block truncate text-xs text-slate-400">${bits.join('　')}</span>` : '';
}
$('list').addEventListener('click', e => {
  const b = e.target.closest('button[data-id]');
  if (b) openEditor(members.find(m => m.id === b.dataset.id));
});
$('search').addEventListener('input', renderList);
$('filter').addEventListener('change', renderList);

// ───────── 编辑 ─────────
const form = $('edit-form');
let pickVoice = '', pickRoles = new Set(), pickVoices2 = new Set(), pickGender = '';
function openEditor(m) {
  editing = m || {};
  $('edit-title').textContent = m ? `改：${m.name}` : '加团员';
  form.name.value = editing.name || '';
  form.fullName.value = editing.fullName || '';
  form.cape.value = editing.cape || '';
  form.active.checked = editing.active !== false;
  form.note.value = editing.note || '';
  pickVoice = normVoice(editing.voice);
  pickRoles = new Set(editing.roles || []);
  pickVoices2 = new Set(editing.voices2 || []);
  pickGender = editing.gender || genderOf(editing) || '';
  const q = m && quizFor(m);
  $('quiz-hint').textContent = [q ? `测验（${q.name}）写：${q.raw || '没答'}` : '', m?.registeredAt ? `注册时自己选：${normVoice(m.voiceSelf) ? VOICE_NAME[m.voiceSelf] : '还不知道'}` : ''].filter(Boolean).join('　');
  // 电话只存打乱过的样子，这里只看得到最后 4 码
  const ph = $('phone-hint');
  ph.className = `text-xs rounded-lg px-3 py-2 ${m?.phoneHash ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-500'}`;
  ph.innerHTML = !m ? '📱 加好之后，他打开 App 用电话注册时，在名单上选自己的名字就会连起来。'
    : m.phoneHash ? `📱 电话已登记：…${esc(m.phoneTail || '')}${m.registeredAt ? `（${new Date(m.registeredAt).toLocaleDateString('en-GB')} 自己注册）` : ''}　<span class="text-slate-400">完整号码不会存，换号码到「🔑 密码管理」</span>`
    : '📱 还没登记电话。叫他打开 App，用自己的电话注册一次就好（或在「🔑 密码管理」帮他加）。';
  $('edit-delete').classList.toggle('hidden', !m);
  renderChips();
  capeWarn();
  $('editor').classList.remove('hidden');
  setTimeout(() => (m ? null : form.name.focus()), 50);
}
function renderChips() {
  const chip = (on, label, attr) => `<button type="button" ${attr} class="px-2.5 py-1.5 rounded-lg border text-sm ${on ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:border-indigo-300'}">${esc(label)}</button>`;
  $('voice-btns').innerHTML = VOICES.map(v => chip(pickVoice === v.key, v.label, `data-voice="${v.key}"`)).join('');
  $('role-btns').innerHTML = ROLES.map(r => chip(pickRoles.has(r), r, `data-role="${r}"`)).join('');
  // 只唱主旋律的不用选「也可以唱」
  $('voice2-box').classList.toggle('hidden', !pickVoice);
  $('voice2-btns').innerHTML = VOICES.filter(v => v.key && v.key !== pickVoice).map(v => chip(pickVoices2.has(v.key), v.label, `data-voice2="${v.key}"`)).join('');
  // 每个人都要有男女（大家都唱主旋律，排座位靠这个）
  $('gender-btns').innerHTML = [['F', '女声'], ['M', '男声']].map(([k, l]) => chip(pickGender === k, l, `data-gender="${k}"`)).join('')
    + (editing?.genderGuess ? '<span class="text-xs text-amber-600 self-center">之前照名字猜的，确认后按保存</span>' : '');
}
$('voice-btns').addEventListener('click', e => {
  const b = e.target.closest('[data-voice]'); if (!b) return;
  pickVoice = b.dataset.voice;
  pickVoices2.delete(pickVoice);
  if (genderFromVoice(pickVoice)) pickGender = genderFromVoice(pickVoice);   // 选了 S A 就是女声、T B 就是男声
  renderChips();
});
$('voice2-btns').addEventListener('click', e => {
  const b = e.target.closest('[data-voice2]'); if (!b) return;
  pickVoices2.has(b.dataset.voice2) ? pickVoices2.delete(b.dataset.voice2) : pickVoices2.add(b.dataset.voice2);
  renderChips();
});
$('gender-btns').addEventListener('click', e => { const b = e.target.closest('[data-gender]'); if (!b) return; pickGender = b.dataset.gender; renderChips(); });
$('role-btns').addEventListener('click', e => {
  const b = e.target.closest('[data-role]'); if (!b) return;
  pickRoles.has(b.dataset.role) ? pickRoles.delete(b.dataset.role) : pickRoles.add(b.dataset.role);
  renderChips();
});
function capeWarn() {
  const c = Number(form.cape.value);
  const other = c && members.find(m => m.id !== editing?.id && m.cape === c && m.active !== false);
  $('cape-warn').textContent = other ? `⚠ ${other.name} 也是 #${c}` : '';
}
form.cape.addEventListener('input', capeWarn);
function closeEditor() { $('editor').classList.add('hidden'); editing = null; }
$('edit-close').addEventListener('click', closeEditor);
$('editor').addEventListener('click', e => { if (e.target === $('editor')) closeEditor(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeEditor(); });
$('btn-add').addEventListener('click', () => openEditor(null));

form.addEventListener('submit', async e => {
  e.preventDefault();
  const name = form.name.value.trim();
  if (!name) return;
  if (members.some(m => m.id !== editing.id && m.name.toLowerCase() === name.toLowerCase()) && !confirm(`已经有一位叫「${name}」，还是要存？（同名的话，建议在名字后面加姓）`)) return;
  const data = {
    name, fullName: form.fullName.value.trim(), voice: pickVoice,
    voices2: pickVoice ? VOICES.map(v => v.key).filter(k => k && k !== pickVoice && pickVoices2.has(k)) : [],
    gender: pickGender || genderFromVoice(pickVoice), genderGuess: false,
    cape: Number(form.cape.value) || null, roles: ROLES.filter(r => pickRoles.has(r)),
    active: form.active.checked, note: form.note.value.trim(), selfJoined: false, updatedAt: new Date().toISOString(),   // 改过一次 = 看过了，不再标「🆕 自己注册」
  };
  try {
    if (editing.id) {
      await setDoc(doc(db, MEMBERS, editing.id), data, { merge: true });
      // 改了名字：职务表、座位表、婚礼名单上的旧名字一起改
      if (editing.name && editing.name !== name) await renameEverywhere(db, editing.name, name);
    } else await addDoc(collection(db, MEMBERS), { ...data, createdAt: data.updatedAt });
    closeEditor();
    await load();
  } catch (err) {
    console.error(err);
    alert('保存失败：' + (err.code || err.message));
  }
});
$('edit-delete').addEventListener('click', async () => {
  if (!editing?.id) return;
  if (!confirm(`从名单删掉「${editing.name}」？\n（只是没在来的话，建议把「还有在来」关掉就好，以前的记录才对得上）`)) return;
  await deleteDoc(doc(db, MEMBERS, editing.id));
  closeEditor();
  await load();
});

// ───────── 第一次导入 ─────────
$('btn-seed').addEventListener('click', async () => {
  if (members.length) return;
  $('btn-seed').disabled = true;
  $('btn-seed').textContent = '导入中…';
  const now = new Date().toISOString();
  const b = writeBatch(db);
  SEED.forEach(s => b.set(doc(collection(db, MEMBERS)), {
    name: s.name, fullName: s.fullName || '', voice: s.voice || '', cape: s.cape || null,
    roles: s.roles || [], active: s.active !== false, note: s.note || '', createdAt: now, updatedAt: now,
  }));
  try { await b.commit(); } catch (err) { console.error(err); alert('导入失败：' + (err.code || err.message)); }
  await load();
});

load().catch(err => { console.error(err); $('status').textContent = '读取失败：' + (err.code || err.message); });
