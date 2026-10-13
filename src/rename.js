// 改歌名：乐谱（指挥模式）和排单后台共用
// 歌名以曲库 custom_songs 为准（靠 id 认歌）；排单里只改那一首，不会把整份排单盖回去
// 每次改名都记在 song_renames，密码管理旁边的「改名记录」看得到、改得回去
import { doc, getDoc, setDoc, addDoc, collection, runTransaction } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// r = { id, imageUrl, oldTitle, newTitle, where, setlistId, at }
export async function renameSong(db, r) {
  await setDoc(doc(db, 'custom_songs', r.id), { id: r.id, title: r.newTitle, imageUrl: r.imageUrl }, { merge: true });
  if (r.setlistId) {
    const ref = doc(db, 'setlists', r.setlistId);
    await runTransaction(db, async t => {
      const s = await t.get(ref);
      if (!s.exists()) return;
      const items = (s.data().items || []).map(x => x.id === r.id ? { ...x, title: r.newTitle } : x);
      t.update(ref, { items });
    });
  }
  await addDoc(collection(db, 'song_renames'), {
    songId: r.id, oldTitle: r.oldTitle, newTitle: r.newTitle, imageUrl: r.imageUrl || '',
    where: r.where || '', setlist: r.setlistId || '', at: r.at || new Date().toISOString(),
  });
}

// 一份排单里的歌，换成曲库最新的歌名（别的手机改过的也会跟上）
export async function freshTitles(db, items) {
  const docs = await Promise.all([...new Set(items.map(x => x.id).filter(Boolean))].map(id => getDoc(doc(db, 'custom_songs', id)).catch(() => null)));
  const title = Object.fromEntries(docs.filter(d => d?.exists()).map(d => [d.id, d.data().title]));
  return items.map(x => title[x.id] && title[x.id] !== x.title ? { ...x, title: title[x.id] } : x);
}

// 手机上还没送出去的改名（没网络、送到一半关掉…）：先存起来，有网络再补
const KEY = 'pending_renames';
export const pending = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const savePending = l => { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* 没关系 */ } };
export function queueRename(r) { savePending(pending().concat({ ...r, at: r.at || new Date().toISOString() })); }
const same = (a, b) => a.id === b.id && a.at === b.at && a.newTitle === b.newTitle;
let running = null;   // 一次只送一轮，免得同一个改名送两次
export async function flushRenames(db) {
  while (running) await running.catch(() => {});
  running = (async () => {
    for (const r of pending()) {
      try { await renameSong(db, r); savePending(pending().filter(x => !same(x, r))); }
      catch (err) { console.error('改名还没送出去', err); break; }
    }
  })();
  try { await running; } finally { running = null; }
  return pending().length;
}
// 把还没送出去的改名也套上（Sync 拿回来的是云端的，手机上改的不能被盖掉）
export const applyPending = items => {
  const p = pending();
  return items.map(x => { const r = p.filter(r => r.id === x.id).at(-1); return r ? { ...x, title: r.newTitle } : x; });
};
