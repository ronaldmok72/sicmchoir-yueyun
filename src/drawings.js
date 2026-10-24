// 乐谱上的标注：存在手机的 IndexedDB（大空间，几百 MB 起跳），不再塞 localStorage（只有约 5MB，标注多了就满）
// 以前存在 localStorage 的 drawing_{歌id} 第一次打开时自动搬过来，搬完就从 localStorage 拿掉，腾出空间
const DB = 'sicDrawings', STORE = 'd';
let dbP = null;
const open = () => dbP || (dbP = new Promise((ok, bad) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => ok(r.result);
  r.onerror = () => bad(r.error);
}));
const tx = async (mode, fn) => {
  const db = await open();
  return new Promise((ok, bad) => {
    const t = db.transaction(STORE, mode), q = fn(t.objectStore(STORE));
    t.oncomplete = () => ok(q?.result);
    t.onerror = t.onabort = () => bad(t.error);
  });
};

export const getDrawing = id => tx('readonly', s => s.get(id));       // Blob 或 dataURL 字串；没有 → undefined
export const putDrawing = (id, v) => tx('readwrite', s => s.put(v, id));
export const delDrawing = id => tx('readwrite', s => s.delete(id));

// 旧的标注搬家（每部手机做一次就好）；顺便请浏览器别随便清掉这些资料
export async function migrateDrawings() {
  try { navigator.storage?.persist?.(); } catch { /* 没关系 */ }
  const keys = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('drawing_')) keys.push(k); } } catch { return; }
  for (const k of keys) {
    const id = k.slice(8);
    if (!(await getDrawing(id))) await putDrawing(id, localStorage.getItem(k));
    localStorage.removeItem(k);
  }
}
