// 团员名单：名字、声部、披肩号码、会做的职务、还有没有在来
// 之后的职务表、座位表都从这里拿人
import { collection, getDocs, doc, setDoc, addDoc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, RESULTS } from "./firebase.js";
import { SEED } from "./members-seed.js";

const $ = id => document.getElementById(id);
const MEMBERS = 'members';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const VOICES = [
  { key: 'S', label: '女高音 S' }, { key: 'A', label: '女低音 A' },
  { key: 'T', label: '男高音 T' }, { key: 'B', label: '男低音 B' },
  { key: 'M', label: '主旋律' }, { key: '', label: '还不知道' },
];
const VOICE_NAME = Object.fromEntries(VOICES.map(v => [v.key, v.label]));
const ROLES = ['指挥', '答唱咏', '钢琴', '风琴', '吉他', '鼓手'];
// 测验第 E 题的答案 → 声部
const QUIZ_VOICE = { '女高音 S': 'S', '女低音 A': 'A', '男高音 T': 'T', '男低音 B': 'B', '主旋律': 'M' };

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
  renderQuizBox();
  renderList();
}

function renderSummary() {
  const act = members.filter(m => m.active !== false);
  if (!members.length) { $('summary').classList.add('hidden'); return; }
  $('summary').classList.remove('hidden');
  const cnt = k => act.filter(m => (m.voice || '') === k).length;
  const noVoice = cnt('');
  const capes = {};
  act.forEach(m => { if (m.cape) (capes[m.cape] ||= []).push(m.name); });
  const dup = Object.entries(capes).filter(([, n]) => n.length > 1);
  $('summary').innerHTML = `
    <div class="text-base"><b>${act.length}</b> 位还有在来${members.length > act.length ? `<span class="text-slate-400 text-sm">　另外 ${members.length - act.length} 位没在来</span>` : ''}</div>
    <div class="flex flex-wrap gap-1.5">
      ${['S', 'A', 'T', 'B', 'M'].map(k => `<span class="px-2 py-0.5 rounded-md bg-slate-100">${VOICE_NAME[k]} <b>${cnt(k)}</b></span>`).join('')}
    </div>
    ${noVoice ? `<div class="text-amber-700">⏳ ${noVoice} 位还没填声部${quiz.length ? '' : '（10/17 测验答完会自动出现建议）'}</div>` : '<div class="text-emerald-700">✅ 每一位都有声部</div>'}
    ${dup.length ? `<div class="text-red-600">🔴 披肩号码重复：${dup.map(([c, n]) => `#${c} ${n.map(esc).join('、')}`).join('；')}</div>` : ''}`;
}

// 测验答的声部跟名单不一样（或名单还没填）→ 一键采用
function renderQuizBox() {
  const todo = members.map(m => ({ m, q: quizFor(m) })).filter(({ m, q }) => q?.voice && q.voice !== (m.voice || ''));
  const box = $('quiz-box');
  box.classList.toggle('hidden', !todo.length);
  if (!todo.length) return;
  box.innerHTML = `
    <div class="font-semibold text-emerald-900">测验里填的声部（${todo.length} 位跟名单不一样）</div>
    <div class="space-y-1">${todo.map(({ m, q }) => `
      <div class="flex items-center gap-2"><span class="flex-1 min-w-0 truncate">${esc(m.name)} <span class="text-slate-400">（测验写「${esc(q.name)}」）</span>：${m.voice ? `${esc(VOICE_NAME[m.voice])} → ` : ''}<b>${esc(VOICE_NAME[q.voice])}</b></span></div>`).join('')}
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
    (f === 'all' || (f === 'inactive' ? m.active === false : m.active !== false && (f !== 'novoice' || !m.voice)))
    && (!q || `${m.name} ${m.fullName || ''} ${m.cape || ''}`.toLowerCase().includes(q)));
  const groups = ['S', 'A', 'T', 'B', 'M', ''].map(k => ({ k, items: list.filter(m => (m.voice || '') === k) })).filter(g => g.items.length);
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
              ${m.note ? `<span class="block truncate text-xs text-amber-600">${esc(m.note)}</span>` : ''}
            </span>
            <span class="shrink-0 flex flex-wrap justify-end gap-1 max-w-[45%]">${(m.roles || []).map(r => `<span class="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[11px]">${esc(r)}</span>`).join('')}</span>
          </button>`).join('')}
      </div>
    </div>`).join('') || `<div class="text-sm text-slate-400 text-center py-8">${members.length ? '没有符合的' : ''}</div>`;
}
$('list').addEventListener('click', e => {
  const b = e.target.closest('button[data-id]');
  if (b) openEditor(members.find(m => m.id === b.dataset.id));
});
$('search').addEventListener('input', renderList);
$('filter').addEventListener('change', renderList);

// ───────── 编辑 ─────────
const form = $('edit-form');
let pickVoice = '', pickRoles = new Set();
function openEditor(m) {
  editing = m || {};
  $('edit-title').textContent = m ? `改：${m.name}` : '加团员';
  form.name.value = editing.name || '';
  form.fullName.value = editing.fullName || '';
  form.cape.value = editing.cape || '';
  form.active.checked = editing.active !== false;
  form.note.value = editing.note || '';
  pickVoice = editing.voice || '';
  pickRoles = new Set(editing.roles || []);
  const q = m && quizFor(m);
  $('quiz-hint').textContent = q ? `测验（${q.name}）写：${q.raw || '没答'}` : '';
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
}
$('voice-btns').addEventListener('click', e => { const b = e.target.closest('[data-voice]'); if (!b) return; pickVoice = b.dataset.voice; renderChips(); });
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
    cape: Number(form.cape.value) || null, roles: ROLES.filter(r => pickRoles.has(r)),
    active: form.active.checked, note: form.note.value.trim(), updatedAt: new Date().toISOString(),
  };
  try {
    if (editing.id) await setDoc(doc(db, MEMBERS, editing.id), data, { merge: true });
    else await addDoc(collection(db, MEMBERS), { ...data, createdAt: data.updatedAt });
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
