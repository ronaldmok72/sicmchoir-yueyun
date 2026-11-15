// 执委团：大家都看得到的现任执委、什么事找谁、历届执委（只能看）
// 历届执委是执委在「执委专区 → 历届执委」整理的；那边一改，登录服务就抄一份公开版到 config/committee（只有届、岗位、名字，没有备注）
// 「什么事找谁」照团员名单上开了哪个后台（members.areas）
import { collection, doc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, getDocs, getDoc } from "./firebase.js";
import { termStatus } from "./liturgy.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ORDER = ['神师', '主席', '副主席', '秘书', '副秘书', '财政', '查帐', '总务'];
const FIRST_YEAR = 1988;   // 想补到成立那一年（第 6 次执委会议）

const lines = t => String(t || '').split('\n').map(s => s.trim()).filter(Boolean);
const splitPeople = s => s.split(/[、,，;；]/).map(x => x.trim()).filter(Boolean);
const roles = text => lines(text).map(l => {
  const m = l.match(/^([^：:]+)[：:](.*)$/);
  return m ? { role: m[1].trim(), people: splitPeople(m[2]) } : { role: '其他', people: splitPeople(l) };
}).sort((a, b) => (ORDER.indexOf(a.role) + 1 || 99) - (ORDER.indexOf(b.role) + 1 || 99));
const termEnd = t => Number((String(t.term).match(/\d{4}/g) || []).pop() || t.start);

const rows = text => roles(text).map(({ role, people }) => `
  <div class="py-1.5 flex gap-3">
    <div class="w-20 shrink-0 text-xs text-slate-400 pt-0.5">${esc(role)}</div>
    <div class="flex-1 text-sm text-slate-800">${people.map(p => `<div>${esc(p)}</div>`).join('') || '<span class="text-slate-300">待补</span>'}</div>
  </div>`).join('') || '<div class="py-2 text-sm text-slate-400">还没有人名，待补。</div>';

// 团员名单：手机记着的（这台弥撒页记的，6 小时内）先用，省读取次数
async function memberList() {
  try {
    const c = JSON.parse(localStorage.getItem('sicMembersCache') || 'null');
    if (c && Date.now() - c.at < 6 * 3600e3 && c.list?.length) return c.list;
  } catch { /* 没关系 */ }
  return (await getDocs(collection(db, 'members'))).docs.map(d => d.data());
}

// 什么事找谁：开了那个后台的人（停团的不算）
const DUTY = [
  ['seating', '🪑 座位、披肩'], ['duties', '🗓️ 职务表（谁指挥、答唱咏、弹琴）'], ['mass', '⛪ 弥撒排歌'],
  ['notice', '📣 公告、上载歌谱'], ['photos', '📸 合照'], ['attendance', '📋 点名、请假'], ['members', '👥 团员资料'],
];
async function renderWho() {
  const list = (await memberList()).filter(m => m.active !== false && Array.isArray(m.areas) && m.areas.length);
  const out = DUTY.map(([k, label]) => ({ label, names: list.filter(m => m.areas.includes(k)).map(m => m.name).filter(Boolean).sort() }))
    .filter(x => x.names.length);
  if (!out.length) return;
  $('who').innerHTML = `<div class="font-semibold">什么事找谁</div>
    <div class="text-xs text-slate-500 mt-0.5">这些人在 App 里改得到那一样，有问题可以直接找他们。</div>
    <div class="mt-2 divide-y divide-slate-100">${out.map(x => `
      <div class="py-2"><div class="text-sm text-slate-700">${esc(x.label)}</div><div class="text-sm text-slate-900 font-medium mt-0.5">${x.names.map(esc).join('、')}</div></div>`).join('')}</div>`;
  $('who').classList.remove('hidden');
}

async function load() {
  const s = await getDoc(doc(db, 'config', 'committee'));
  const terms = s.exists() ? (s.data().terms || []) : [];
  const st = t => termStatus(t.start, termEnd(t));
  if (!terms.length) {
    $('now').innerHTML = '<div class="text-sm text-slate-500">执委名单还没放上来。执委打开「执委专区」时会自动更新。</div>';
  } else {
    // 换届在将临期第一主日（新的礼仪年开始）
    const cur = terms.find(t => st(t) === 'now') || terms.filter(t => st(t) === 'past').at(-1) || terms.at(-1);
    $('now').innerHTML = `<div class="flex items-center gap-2"><div class="font-bold">${esc(cur.term)} 届</div><span class="text-[11px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">现任</span></div>
      <div class="mt-2 divide-y divide-slate-100">${rows(cur.text)}</div>`;
    const past = terms.filter(t => t !== cur).reverse();
    $('past').innerHTML = past.map(t => `
      <details class="bg-white rounded-xl border border-slate-200 px-4 py-2.5">
        <summary class="cursor-pointer select-none text-sm"><span class="font-semibold">${esc(t.term)} 届</span>${st(t) === 'next' ? '<span class="ml-2 text-[11px] text-emerald-700">下一届（将临期第一主日上任）</span>' : ''}
          <span class="text-xs text-slate-400">　${esc(roles(t.text).find(r => r.role === '主席')?.people.join('、') ? '主席：' + roles(t.text).find(r => r.role === '主席').people.join('、') : '')}</span></summary>
        <div class="mt-1 divide-y divide-slate-100">${rows(t.text)}</div>
      </details>`).join('') || '<div class="text-sm text-slate-400 px-1">还没有以前的名单。</div>';
    const first = Math.min(...terms.map(t => t.start).filter(Boolean));
    $('missing').textContent = first > FIRST_YEAR
      ? `${FIRST_YEAR} 到 ${first - 1} 年的执委名单还没找到。有旧照片、旧会议记录，或记得是谁的，请告诉 Ronald 或任何一位执委。`
      : '名单有写错或漏掉的，请告诉 Ronald 或任何一位执委。';
  }
  $('loading').classList.add('hidden');
  $('body').classList.remove('hidden');
  renderWho().catch(err => console.warn('什么事找谁', err));
}

load().catch(err => { console.error(err); $('loading').textContent = '读取失败：' + (err.code || err.message); });
