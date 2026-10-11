// 把 Google Sheet 歌单里的一行（例如「进: 同心聚集在主前 C33」「答: 圣咏18 pg.9」）对到曲库里的谱
// 对不到的回传 { missing: true, title }，让排歌页标出来

const T2S = { 們: '们', 進: '进', 讚: '赞', 頌: '颂', 揚: '扬', 獻: '献', 愛: '爱', 聖: '圣', 詠: '咏', 禰: '你', 慶: '庆', 節: '节', 漢: '汉', 謝: '谢', 禮: '礼', 領: '领', 歸: '归', 於: '于', 榮: '荣', 耀: '耀', 恆: '恒', 萬: '万', 齊: '齐', 歡: '欢', 樂: '乐', 寶: '宝', 貴: '贵', 體: '体', 靈: '灵', 憐: '怜', 誰: '谁', 為: '为', 與: '与', 這: '这', 個: '个', 來: '来', 時: '时', 會: '会', 從: '从', 經: '经', 說: '说', 話: '话', 語: '语', 願: '愿', 請: '请', 驗: '验', 線: '线', 華: '华', 臨: '临', 復: '复', 蘇: '苏', 無: '无', 原: '原', 罪: '罪', 緬: '缅', 當: '当', 見: '见', 親: '亲', 誕: '诞', 師: '师', 傳: '传', 報: '报', 盡: '尽', 處: '处', 號: '号', 嗎: '吗', 麼: '么', 啟: '启', 祂: '他', 她: '他', 祢: '你' };
const norm = s => String(s || '').replace(/[^一-鿿A-Za-z0-9]/g, '').split('').map(c => T2S[c] || c).join('').toLowerCase();
const clean = t => String(t || '').replace(/^[a-z]\s+/, '');

// 「进: xxx」→ { key, text }
const PREFIX = [
  [/^(进|進)/, 'entrance'], [/^答/, 'psalm'], [/^奉/, 'offertory'],
  [/^(领|領)/, 'communion'], [/^(谢|謝)/, 'thanks'], [/^(礼|禮)/, 'recessional'],
];
export function splitLine(line) {
  const s = String(line || '').trim();
  for (const [re, key] of PREFIX) {
    if (re.test(s)) return { key, text: s.replace(re, '').replace(/^[\s:：]+/, '').replace(/^[:：\s]+/, '').trim() };
  }
  return null;
}

// 一行可能有两首：「1）though we are many 2)分享主晚餐 E5」
export function splitSongs(text) {
  const parts = String(text).split(/\s*(?:^|\s)\d[)）]\s*/).map(x => x.trim()).filter(Boolean);
  return parts.length ? parts : [String(text).trim()];
}

export function matchSong(text, library) {
  const raw = String(text).trim();
  if (!raw) return null;
  const lib = library.map(s => ({ s, t: clean(s.title), n: norm(clean(s.title)) }));
  const name = raw.replace(/[（(][^）)]*[）)]/g, ' ').replace(/\bpg\.?\s*\d+.*$/i, '').replace(/page\s*\d+.*$/i, '');
  // 好几首都对得上：看哪一首的歌名跟表上的字最像（圣咏连答句一起比，才分得出同一篇的不同答句）
  const best = (cands, text = name) => {
    if (cands.length <= 1) return cands[0]?.s || null;
    const nn = norm(text.replace(/\b[A-Z]\s?\d+\b/g, '').replace(/\d+/g, ''));
    let top = null, score = -1;
    cands.forEach(c => { const sc = [...nn].filter(ch => c.n.includes(ch)).length - c.n.length * 0.01; if (sc > score) { score = sc; top = c; } });
    return top.s;
  };

  // 圣咏 N
  const ps = raw.match(/(?:圣|聖)(?:咏|詠)?\s*(\d+)/);
  if (ps) {
    const re = new RegExp(`(圣|聖)(咏|詠)\\s*${ps[1]}(?!\\d)`);
    return best(lib.filter(c => re.test(c.t)), raw);
  }
  // 歌本编号 C33 / E100 / i 16
  const code = raw.match(/\b([A-Za-z])\s?(\d{1,3})\b/);
  if (code) {
    const re = new RegExp(`(^|[^A-Za-z])${code[1].toUpperCase()}${code[2]}(?!\\d)`);
    const c = lib.filter(x => re.test(x.t));
    if (c.length) return best(c);
  }
  // 三位数编号 285 / (369)
  const num = raw.match(/(?:^|[^\d])(\d{3})(?!\d)/);
  if (num) {
    const re = new RegExp(`(^|[^\\d])${num[1]}(?!\\d)`);
    const c = lib.filter(x => re.test(x.t));
    if (c.length) return best(c);
  }
  // 只有歌名
  const nn = norm(name.replace(/\b[A-Za-z]\s?\d+\b/g, '').replace(/\d+/g, ''));
  if (nn.length < 2) return null;
  const c = lib.filter(x => x.n.includes(nn) || (x.n.length >= 3 && nn.includes(x.n.replace(/[a-z]\d+$/, ''))));
  return best(c);
}

// 一整场：lines = ['进: …', '答: …', …] → { entrance: [song|missing], … }
export function matchBlock(lines, library) {
  const out = {};
  lines.forEach(l => {
    const p = splitLine(l);
    if (!p || !p.text) return;
    splitSongs(p.text).forEach(t => {
      const s = matchSong(t, library);
      const list = (out[p.key] ||= []);
      if (!s) return list.push({ id: null, title: t, imageUrl: '', missing: true });
      // 分好几页的谱（「圣咏23 …（1）」「（2）」）：后面几页一起带上
      const part = clean(s.title).match(/^(.*?)(?:\s+|[（(])([1-9])[）)]?$/);
      const pages = part && part[2] === '1'
        ? library.filter(x => { const m = clean(x.title).match(/^(.*?)(?:\s+|[（(])([1-9])[）)]?$/); return m && m[1] === part[1]; })
                 .sort((a, b) => clean(a.title).localeCompare(clean(b.title)))
        : [s];
      pages.forEach(x => list.push({ id: x.id, title: x.title, imageUrl: x.imageUrl }));
    });
  });
  return out;
}
