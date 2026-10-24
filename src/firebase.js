// 全部页面共用的 Firebase 连接（乐谱页 app.js 也用这一个）
// 读过的资料记在手机（IndexedDB）：资料库连不上、或今天的免费读取额度用完了，就先显示手机上次记着的，不会整页空白
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  getDocs as serverDocs, getDoc as serverDoc, getDocsFromCache, getDocFromCache,
  collection, query, where, documentId,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD77WKlfYpUS1MJKu5J_xdV3adMZc5-c8U",
  authDomain: "sicmchoir-yueyun.firebaseapp.com",
  projectId: "sicmchoir-yueyun",
  storageBucket: "sicmchoir-yueyun.firebasestorage.app",
  messagingSenderId: "55940456186",
  appId: "1:55940456186:web:3a4a78dfb8c430f3963343"
};

export const app = initializeApp(firebaseConfig);
let store;
try { store = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch { store = getFirestore(app); }   // 手机不给存（例如无痕模式）：照旧每次读
export const db = store;
export const RESULTS = 'quiz_results';

// ───────── 读不到最新的 → 先用手机记着的 ─────────
// 额度用完／连不上：资料库回 resource-exhausted、unavailable，或者 SDK 自己先拿手机记着的（fromCache）
const SOFT = ['resource-exhausted', 'unavailable', 'deadline-exceeded'];
let warned = false;
function staleBanner(why) {
  if (warned) return;
  warned = true;
  const show = () => {
    const bar = document.createElement('div');
    bar.style.cssText = 'position:relative;z-index:60;background:#f59e0b;color:#1c1917;padding:10px 16px;font-size:13px;line-height:1.6;display:flex;gap:10px;align-items:flex-start';
    bar.innerHTML = `<div style="flex:1">⚠️ <b>${why === 'resource-exhausted' ? '资料库今天的免费读取额度用完了' : '现在读不到资料库'}</b>（没网络，或今天的免费额度用完了，下午 3 点恢复）。` +
      '这一页显示的是这部手机上次记着的资料，可能不是最新的；签到、改资料要等恢复了才行。</div>' +
      '<button style="flex-shrink:0;background:none;border:0;font:inherit;text-decoration:underline;cursor:pointer;color:inherit">知道了</button>';
    bar.querySelector('button').onclick = () => bar.remove();
    document.body.prepend(bar);
  };
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
}
const soft = err => SOFT.includes(err?.code);

// 跟 Firestore 的 getDocs / getDoc 一样用；读不到最新的就回手机记着的（有的话），顶上出一条黄色提醒
export async function getDocs(q) {
  try {
    const s = await serverDocs(q);
    if (s.metadata.fromCache) staleBanner('offline');
    return s;
  } catch (err) {
    if (!soft(err)) throw err;
    const s = await getDocsFromCache(q).catch(() => null);
    if (!s || s.empty) throw err;
    staleBanner(err.code);
    return s;
  }
}
export async function getDoc(ref) {
  try {
    const s = await serverDoc(ref);
    if (s.metadata.fromCache) staleBanner('offline');
    return s;
  } catch (err) {
    if (!soft(err)) throw err;
    const s = await getDocFromCache(ref).catch(() => null);
    if (!s) throw err;
    staleBanner(err.code);
    return s;
  }
}

// ───────── 一直累积的资料（排歌、职务、座位、点名、会来请假…）：旧的用手机记着的 ─────────
// 每一份的 id 都是日期开头。最近 days 天的每次读最新；更早的用手机记着的（旧资料几乎不会再改）
// 每 7 天整份重读一次（顺便跟上有人改了／删了旧资料）
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const FULL_EVERY = 7 * 864e5;
export async function historyDocs(coll, days = 45) {
  const key = 'sicHist_' + coll;
  let h = null;
  try { h = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* 没关系 */ }
  const cut = new Date(); cut.setDate(cut.getDate() - days);
  const from = iso(cut);
  const full = async () => {
    const s = await getDocs(collection(db, coll));
    if (!s.metadata.fromCache) try { localStorage.setItem(key, JSON.stringify({ at: Date.now() })); } catch { /* 没关系 */ }
    return s.docs;
  };
  if (!h || Date.now() - h.at > FULL_EVERY) return full();
  const [old, recent] = await Promise.all([
    getDocsFromCache(query(collection(db, coll), where(documentId(), '<', from))).catch(() => null),
    getDocs(query(collection(db, coll), where(documentId(), '>=', from))),
  ]);
  if (!old) return full();   // 手机没记着（换了手机、清过资料）：整份读
  return old.docs.concat(recent.docs);
}
// 跟 getDocs 回来的一样用（.docs / .forEach / .empty）
export async function history(coll, days) {
  const docs = await historyDocs(coll, days);
  return { docs, empty: !docs.length, size: docs.length, forEach: fn => docs.forEach(fn) };
}
