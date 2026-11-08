// 改动记录：谁在什么时候改了什么。一个月存成一份（changelog/2026-11），打开记录页只读一两次，不管里面有多少笔
// 记录写不到不挡正事；merge：同一个人 30 分钟内改同一样只记一笔（座位表每动一下就存，不合并会太多）
import { doc, setDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const KEY = 'sicLogSeen', GAP = 30 * 60 * 1000;
const pad = n => String(n).padStart(2, '0');
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const seenAll = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const seenSave = o => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* 没关系 */ } };

// { cat: 分类, item: 改了哪个, text: 一句话, merge, at, by, ...其他（改名要留旧名字，才改得回去）}
export async function logChange(db, { cat, item, text = '', merge = false, at, by, ...extra }) {
  const who = by || window.sicStaff?.me?.()?.name || '用后台密码的人';
  const k = `${who}|${cat}|${item}`, now = Date.now();
  if (merge) {
    const seen = seenAll();
    if (now - (seen[k] || 0) < GAP) return;
    seen[k] = now;
    Object.keys(seen).forEach(x => { if (now - seen[x] >= GAP) delete seen[x]; });
    seenSave(seen);
  }
  try {
    const t = at && !isNaN(new Date(at)) ? new Date(at) : new Date();
    const entry = { at: t.toISOString(), by: who, cat, item: String(item ?? '').slice(0, 120), text: String(text).slice(0, 400), ...extra };
    await setDoc(doc(db, 'changelog', monthKey(t)), { entries: arrayUnion(entry) }, { merge: true });
  } catch (err) {
    console.warn('改动记录没写到', err);
    if (merge) { const seen = seenAll(); delete seen[k]; seenSave(seen); }
  }
}
