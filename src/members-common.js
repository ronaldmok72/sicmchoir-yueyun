// 团员改名、合并：名字在很多地方是直接存字的（职务表、座位表、婚礼来唱的人），改名要一起改，不然对不上
// 团员名单「保存」、团员自己「修改资料」、合并重复的人都用这里
import { collection, getDocs, doc, getDoc, updateDoc, deleteDoc, deleteField, writeBatch } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
// 职务表的职务（跟 duties.js 的 DUTY_ROLES 一样）
const DUTY_KEYS = ['conductor', 'cantor', 'piano', 'organ', 'guitar', 'drums'];

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// 「Mok」→「Ronald Mok」：职务表、座位表、婚礼（来唱的人、谁做什么）里写「Mok」的全部换掉；回传改了几份
export async function renameEverywhere(db, from, to) {
  if (!from || !to || from === to) return 0;
  const [du, se, ma] = await Promise.all(['duties', 'seatings', 'masses'].map(c => getDocs(collection(db, c))));
  const writes = [];
  du.docs.forEach(d => {
    const x = d.data(), p = {};
    DUTY_KEYS.forEach(key => { if (same(x[key], from)) p[key] = to; });
    if (Object.keys(p).length) writes.push([d.ref, p]);
  });
  se.docs.forEach(d => {
    const x = d.data(), p = {};
    const seats = Object.fromEntries(Object.entries(x.seats || {}).map(([k, v]) => [k, same(v, from) ? to : v]));
    if (Object.entries(x.seats || {}).some(([, v]) => same(v, from))) p.seats = seats;
    if ((x.absent || []).some(v => same(v, from))) p.absent = x.absent.map(v => same(v, from) ? to : v);
    ['capes', 'voices'].forEach(f => {
      const k = Object.keys(x[f] || {}).find(k => same(k, from));
      if (k) { const o = { ...x[f] }; o[to] = o[k]; delete o[k]; p[f] = o; }
    });
    if (Object.keys(p).length) writes.push([d.ref, p]);
  });
  ma.docs.forEach(d => {
    const x = d.data(), p = {};
    if ((x.singers || []).some(v => same(v, from))) p.singers = x.singers.map(v => same(v, from) ? to : v);
    if ((x.roles || []).some(r => same(r.name, from))) p.roles = x.roles.map(r => same(r.name, from) ? { ...r, name: to } : r);
    if (Object.keys(p).length) writes.push([d.ref, p]);
  });
  for (let i = 0; i < writes.length; i += 400) {
    const b = writeBatch(db);
    writes.slice(i, i + 400).forEach(([ref, p]) => b.update(ref, p));
    await b.commit();
  }
  return writes.length;
}

// 同一个人有两笔（例如名单上本来有「Hans」，他注册时没点到，自己又建了「Hans Chew」）：
// 留旧的那一笔（披肩、职务、点名记录都在那边），把新的电话、声部搬过去，新的那笔删掉
// name：合并后叫什么（不给就用旧的名字）
export async function mergeMembers(db, keepId, dropId, name) {
  const [ks, ds] = await Promise.all([getDoc(doc(db, 'members', keepId)), getDoc(doc(db, 'members', dropId))]);
  if (!ks.exists() || !ds.exists()) throw new Error('找不到这位团员');
  const keep = ks.data(), drop = ds.data();
  const p = { updatedAt: new Date().toISOString(), selfJoined: false };
  ['phoneHash', 'phoneTail', 'registeredAt', 'pinHash'].forEach(k => { if (drop[k] && !keep[k]) p[k] = drop[k]; });
  if (drop.voiceSelf && !keep.voiceSelf) p.voiceSelf = drop.voiceSelf;
  if (drop.gender && (!keep.gender || keep.genderGuess)) { p.gender = drop.gender; p.genderGuess = false; }
  if (!keep.fullName && (drop.fullName || drop.name !== keep.name)) p.fullName = drop.fullName || drop.name;
  const newName = (name || keep.name).trim();
  if (newName !== keep.name) p.name = newName;
  // 先删新的那笔（电话不能同时在两个人身上），再搬过去
  await deleteDoc(doc(db, 'members', dropId));
  await updateDoc(doc(db, 'members', keepId), p);
  // 点名记录：新的那笔签到过的，也算到旧的那笔
  const at = await getDocs(collection(db, 'attendance'));
  const b = writeBatch(db);
  let n = 0;
  at.docs.forEach(d => {
    const x = d.data();
    if (!x.marks?.[dropId]) return;
    const q = { [`marks.${dropId}`]: deleteField(), [`names.${dropId}`]: deleteField() };
    if (!x.marks[keepId]) { q[`marks.${keepId}`] = x.marks[dropId]; q[`names.${keepId}`] = newName; }
    b.update(d.ref, q); n++;
  });
  if (n) await b.commit();
  // 两个旧名字（例如「Hans」「Hans Chew」）在职务表、座位表都换成合并后的名字
  await renameEverywhere(db, keep.name, newName);
  await renameEverywhere(db, drop.name, newName);
  return { id: keepId, ...keep, ...p };
}

// 名单上可能是同一个人：第一个字一样（Hans ↔ Hans Chew、Teresa ↔ Teresa Tan），或全名里有他的名字
export function lookAlikes(m, members) {
  const first = s => String(s || '').trim().split(/\s+/)[0].toLowerCase();
  const f = first(m.name);
  return members.filter(x => x.id !== m.id && x.active !== false && f.length >= 2 &&
    (first(x.name) === f || first(x.fullName) === f));
}

// 显示的名字建议：圣名＋姓（Ronald Mok）或 圣名＋中文名（Angela 美嫣）
export function suggestName(m) {
  const full = String(m.fullName || '').trim();
  const latin = full.replace(/[㐀-鿿]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const cn = (full.match(/[㐀-鿿]+/) || [''])[0];
  if (/\s/.test(m.name.trim())) return null;                 // 已经两个字了（Peter Siow、Angela 美嫣）
  if (latin.length >= 2 && latin[0].toLowerCase() === m.name.toLowerCase()) return `${latin[0]} ${latin[1]}`;
  if (/^[㐀-鿿]+$/.test(m.name) && latin.length) return `${latin[0]} ${m.name}`;   // 咏薇 → Agnes 咏薇
  if (latin.length >= 2) return `${latin[0]} ${latin[1]}`;
  if (latin.length === 1 && cn) return `${latin[0]} ${cn.length > 2 ? cn.slice(1) : cn}`;
  return null;
}
