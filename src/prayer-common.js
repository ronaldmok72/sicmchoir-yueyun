// 练习前祈祷文：祈祷文页、这台弥撒都用这里
// 进堂咏、集祷经存 Firestore prayers/{礼仪 key}（OT29、ADV1、EASTER…）：输入一次，明年同一个主日自己出来
import { doc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, getDoc } from "./firebase.js";

export const CECILIA = '天主，求祢因殉道者圣女则济利亚的转求，仁慈地垂允我们的祈祷，使我们能效法她心灵的纯洁，堪以歌唱永远赞美祢。以上所求是靠祢的子，我们的主天主耶稣基督，祂和祢及圣神永生永王。阿们。';

// 已经有的（Ronald 2026-10-15 在群里发的经书照片）；Firestore 有的话用 Firestore 的
export const SEED = {
  OT29: {
    ref: '咏 16:6,8',
    entrance: '天主，我向祢呼求，祢必应允我，求祢侧耳俯听，俯听我的诉说。求祢保护我，有如眼中的瞳人，让我藏身在祢的翼荫下。',
    collect: '全能永生的天主，求祢使我们常能爽快地服从祢的旨意，为了祢的光荣，诚恳地奉献我们的崇敬。以上所求，是靠祢的子，我们的主、耶稣基督，祂和祢及圣神，惟一天主，永生永王。',
  },
};

// 经书的写法：常年期第二十九主日
const CN = '〇一二三四五六七八九';
const cnNum = n => n < 10 ? CN[n] : `${n >= 20 ? CN[Math.floor(n / 10)] : ''}十${n % 10 ? CN[n % 10] : ''}`;
export function bookName(key, name) {
  const m = key.match(/^(OT|ADV|LENT|EAS)(\d+)$/);
  if (!m || key === 'OT34') return name;
  return `${{ OT: '常年期', ADV: '将临期', LENT: '四旬期', EAS: '复活期' }[m[1]]}第${cnNum(+m[2])}主日`;
}

// 这个主日的经文（没有人输入过 = null）
export async function loadPrayer(key) {
  let snap = null;
  try { snap = await getDoc(doc(db, 'prayers', key)); } catch (err) { console.error(err); }
  return snap?.exists() ? snap.data() : SEED[key] || null;
}
