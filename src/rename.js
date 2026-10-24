// 改歌名：乐谱（指挥模式）和排单后台共用
// 歌名以曲库 custom_songs 为准（靠 id 认歌）；排单里只改那一首，不会把整份排单盖回去
// 每次改名都记在 song_renames，密码管理旁边的「改名记录」看得到、改得回去
import { doc, setDoc, addDoc, collection, runTransaction } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { bumpSongs, customSongs } from "./song-cache.js";

// r = { id, imageUrl, oldTitle, newTitle, where, setlistId, at }
// 谁改的：用电话登录的就记他的名字；只输了后台密码的记「用后台密码的人」
export async function renameSong(db, r) {
  await setDoc(doc(db, 'custom_songs', r.id), { id: r.id, title: r.newTitle, imageUrl: r.imageUrl }, { merge: true });
  bumpSongs(db);
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
    by: r.by || window.sicStaff?.me?.()?.name || '用后台密码的人',
  });
}

// 一份排单里的歌，换成曲库最新的歌名（别的手机改过的也会跟上）
// 用手机记着的曲库（song-cache.js，平常只读 1 次「曲库版本」）；以前是每首歌各读一次
export async function freshTitles(db, items) {
  const songs = await customSongs(db).catch(() => []);
  const title = Object.fromEntries(songs.filter(x => x?.id).map(x => [x.id, x.title]));
  return items.map(x => title[x.id] && title[x.id] !== x.title ? { ...x, title: title[x.id] } : x);
}

// 手机上还没送出去的改名（没网络、送到一半关掉…）：先存起来，有网络再补
const KEY = 'pending_renames';
export const pending = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const savePending = l => { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* 没关系 */ } };
export function queueRename(r) { savePending(pending().concat({ ...r, at: r.at || new Date().toISOString(), by: r.by || window.sicStaff?.me?.()?.name || '' })); }
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
