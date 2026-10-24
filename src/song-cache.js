// 曲库云端那一份（custom_songs，两百多首）记在这部手机，省资料库读取次数：
// 每次打开只看一下「曲库版本」（custom_songs/_v，读 1 次）；有人上传／改名／删歌才整份重读，最多一天也整份重读一次
import { collection, doc, setDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getDocs, getDoc } from "./firebase.js";

const KEY = 'sicSongCache';
export const VERSION_ID = '_v';

export async function customSongs(db) {
  let c = null;
  try { c = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* 没关系 */ }
  const v = await getDoc(doc(db, 'custom_songs', VERSION_ID)).then(s => s.exists() ? s.data().at || 0 : 0).catch(() => null);
  if (c && (v === null || (c.v === v && Date.now() - c.at < 864e5))) return c.songs;   // 没网络就先用记着的
  const snap = await getDocs(collection(db, 'custom_songs'));
  const songs = snap.docs.filter(d => d.id !== VERSION_ID).map(d => d.data());
  try { localStorage.setItem(KEY, JSON.stringify({ v, at: Date.now(), songs })); } catch { /* 手机存满了：下次再整份读 */ }
  return songs;
}

// 曲库改了（上传、改名、删歌）之后叫一下：大家的手机下次打开就会重读
export const bumpSongs = db => setDoc(doc(db, 'custom_songs', VERSION_ID), { at: Date.now() }).catch(err => console.warn('曲库版本没更新', err));
