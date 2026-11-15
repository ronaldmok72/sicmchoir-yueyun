// 曲库云端那一份（custom_songs，两百多首）记在这部手机，省资料库读取次数：
// 每次打开只看一下「曲库版本」（custom_songs/_v，读 1 次）
// 有人上传／改名 → 只读改过的那几首（每首歌存 at = 改的时间）；有人删歌（_v.full）→ 整份重读；最多 7 天也整份重读一次
// 以前一天整份重读一次：团员一多，光这个一天就上万次读取
import { collection, doc, setDoc, query, where } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getDocs, getDoc } from "./firebase.js";

const KEY = 'sicSongCache';
export const VERSION_ID = '_v';

// 手机上记着的那一份（不连网，马上有）；没记过 → []
export function cachedSongs() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null')?.songs || []; } catch { return []; }
}

const WEEK = 7 * 864e5;
const save = (v, at, songs) => { try { localStorage.setItem(KEY, JSON.stringify({ v, at, songs })); } catch { /* 手机存满了：下次再整份读 */ } };
export async function customSongs(db) {
  let c = null;
  try { c = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* 没关系 */ }
  const vd = await getDoc(doc(db, 'custom_songs', VERSION_ID)).then(s => s.exists() ? s.data() : {}).catch(() => null);
  if (c && vd === null) return c.songs;   // 没网络／额度用完：先用记着的
  const v = vd.at || 0;
  const fresh = c && Date.now() - c.at < WEEK && !((vd.full || 0) > (c.v || 0));
  if (fresh && c.v === v) return c.songs;
  if (fresh) {
    // 只读这次版本之后改过的歌（多看 1 小时，免得各人手机时间差一点漏掉）
    const snap = await getDocs(query(collection(db, 'custom_songs'), where('at', '>', (c.v || 0) - 3600e3))).catch(() => null);
    if (snap) {
      const byId = new Map(c.songs.map(s => [s.id, s]));
      snap.docs.filter(d => d.id !== VERSION_ID).forEach(d => byId.set(d.data().id || d.id, d.data()));
      const songs = [...byId.values()];
      save(v, c.at, songs);
      return songs;
    }
  }
  const snap = await getDocs(collection(db, 'custom_songs'));
  const songs = snap.docs.filter(d => d.id !== VERSION_ID).map(d => d.data());
  save(v, Date.now(), songs);
  return songs;
}

// 曲库改了（上传、改名、删歌）之后叫一下：大家的手机下次打开就会重读
export const bumpSongs = db => setDoc(doc(db, 'custom_songs', VERSION_ID), { at: Date.now() }, { merge: true }).catch(err => console.warn('曲库版本没更新', err));
