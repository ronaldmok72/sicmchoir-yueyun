// 公告：存在 Firestore announcements/{自动id}
// { title, body, event: 'YYYY-MM-DD' | '', until: 'YYYY-MM-DD', songs: [{ id, title }], createdAt, updatedAt }
// until 那天过了就算「以前的公告」；公告页、这台弥撒、歌单目录都用这里
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { waTitle } from "./mass-common.js";

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const TODAY = iso(new Date());
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = date => `${Number(date.slice(8))}/${Number(date.slice(5, 7))}`;
const week = date => '日一二三四五六'[new Date(date + 'T12:00').getDay()];

export const isActive = n => (n.until || '9999-12-31') >= TODAY;

// 还在显示的排前面：有活动日期的照日期，没有的照发出时间（新的先）
export async function loadNotices(db) {
  const snap = await getDocs(collection(db, 'announcements'));
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const byEvent = (a, b) => (a.event || '9999').localeCompare(b.event || '9999') || (b.createdAt || 0) - (a.createdAt || 0);
  return {
    active: all.filter(isActive).sort(byEvent),
    past: all.filter(n => !isActive(n)).sort((a, b) => (b.until || '').localeCompare(a.until || '')),
  };
}

// 歌名照曲库最新的（改过名也跟着变）；titles = { 歌id: 歌名 }
export function noticeHtml(n, { titles = {}, compact = false, edit = '' } = {}) {
  const songs = (n.songs || []).map(s => ({ ...s, title: titles[s.id] || s.title }));
  const body = String(n.body || '').trim();
  return `
    <div class="flex items-start gap-2">
      <div class="flex-1 min-w-0">
        <div class="font-semibold">${esc(n.title || '公告')}</div>
        ${n.event ? `<div class="text-xs text-indigo-600 mt-0.5">📅 ${Number(n.event.slice(0, 4)) !== new Date().getFullYear() ? n.event.slice(0, 4) + ' 年 ' : ''}${Number(n.event.slice(5, 7))} 月 ${Number(n.event.slice(8))} 日 星期${week(n.event)}</div>` : ''}
      </div>
      ${edit}
    </div>
    ${body ? `<div class="mt-1.5 text-sm text-slate-700 whitespace-pre-wrap ${compact ? 'line-clamp-3' : ''}">${esc(body)}</div>` : ''}
    ${compact && (body.split(/\n/).length > 3 || body.length > 90) ? `<button type="button" onclick="const b=this.previousElementSibling;b.classList.toggle('line-clamp-3');this.textContent=b.classList.contains('line-clamp-3')?'看全部 ▾':'收起 ▴'" class="mt-1 text-xs font-semibold text-indigo-600 hover:underline">看全部 ▾</button>` : ''}
    ${songs.length ? `
      <div class="mt-2.5 text-xs text-slate-500">🎵 要练的歌（点一下看谱）</div>
      <div class="mt-1 flex flex-wrap gap-1.5">
        ${songs.map((s, i) => `<a href="songs.html#${encodeURIComponent(s.id)}" class="max-w-full truncate px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-sm">${i + 1}. ${esc(waTitle(s.title))}</a>`).join('')}
      </div>` : ''}
    ${!compact && n.until && n.until < '9999' ? `<div class="mt-2 text-[11px] text-slate-400">显示到 ${md(n.until)}</div>` : ''}`;
}
