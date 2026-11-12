// 中英文切换：每个页面 <head> 最先载入（普通 <script>）。
// 选了 English → 载入 i18n-en.js（字典），把画面上的中文界面文字换成英文；歌名、名字、自己写的内容不在字典里，照原样不动。
// 选择存在这部手机（localStorage sicLang），在「我的资料」最下面切换。
(function () {
  const KEY = 'sicLang';
  let lang = 'zh';
  try { lang = localStorage.getItem(KEY) === 'en' ? 'en' : 'zh'; } catch { /* 没关系 */ }
  window.SIC_LANG = lang;
  window.sicSetLang = l => {
    try { localStorage.setItem(KEY, l === 'en' ? 'en' : 'zh'); } catch { /* 没关系 */ }
    location.reload();
  };
  window.sicT = s => s;                       // 中文版：原样
  if (lang !== 'en') return;

  document.documentElement.lang = 'en';
  document.documentElement.classList.add('sic-en-wait');
  document.write('<style>html.sic-en-wait body{opacity:0}</style><script src="/src/i18n-en.js?v=3409d120"><\/script>');

  const HAN = /[㐀-鿿]/;
  let P = null, T = [];
  const cache = new Map();

  function load() {
    if (P) return true;
    const D = window.SIC_EN;
    if (!D) return false;
    P = new Map(Object.entries(D.p || {}));
    // 带 {0} 的句子：拆成固定的字段，按顺序找（不用正则，长句也不会卡）；最长的中文字段当「快查」
    T = Object.entries(D.t || {}).map(([k, v]) => {
      const lits = k.split(/\{\d+\}/).map(l => l.trim()), ids = [...k.matchAll(/\{(\d+)\}/g)].map(m => +m[1]);
      const anchor = lits.filter(l => HAN.test(l)).sort((a, b) => b.length - a.length)[0] || '';
      return { lits, ids, v, anchor, n: lits.join('').length, wd: /星期\{\d+\}|日（\{\d+\}）/.test(k), cn: /第\{\d+\}/.test(k) };
    }).sort((a, b) => b.n - a.n);
    return true;
  }
  // 照顺序对：第一段在开头、最后一段在结尾、中间每段往后找；对上了回传中间填的东西
  function fit(n, lits) {
    const last = lits.length - 1, a = lits[0], z = lits[last];
    if (!n.startsWith(a) || !n.endsWith(z) || a.length + z.length > n.length) return null;
    const end = n.length - z.length, caps = [];
    let pos = a.length;
    for (let i = 1; i < last; i++) {
      const l = lits[i];
      const j = l ? n.indexOf(l, pos) : pos;
      if (j < 0 || j > end) return null;
      caps.push(n.slice(pos, j).trim());
      pos = j + l.length;
    }
    if (pos > end) return null;
    caps.push(n.slice(pos, end).trim());
    return caps;
  }

  // 整句查不到时：照常见的分隔号拆开，每一块都查得到才换（避免把自己写的内容翻一半）
  const WD = { 日: 'Sun', 一: 'Mon', 二: 'Tue', 三: 'Wed', 四: 'Thu', 五: 'Fri', 六: 'Sat' };
  // 中文数字 → 阿拉伯数字（三十三 → 33、廿九 → 29）
  const CN = /^[〇一二三四五六七八九十廿]+$/;
  function cn2n(x) {
    const D = '〇一二三四五六七八九';
    x = x.replace('廿', '二十');
    const i = x.indexOf('十');
    if (i < 0) return [...x].map(c => D.indexOf(c)).join('');
    return String((i ? D.indexOf(x[0]) : 1) * 10 + (x[i + 1] ? D.indexOf(x[i + 1]) : 0));
  }
  // 带日期的一行（排单、座位表的列表）：里面的礼仪名称、星期几、时间、状态一块一块换；只限有日期的行，歌名不会被动到
  const SEASON = { 常年期: 'Ordinary Time', 将临期: 'Advent', 四旬期: 'Lent', 复活期: 'Easter' };
  const SEASON_RE = /(常年期|将临期|四旬期|复活期)第\s*([0-9〇一二三四五六七八九十廿]+)\s*主日/g;
  const DATED = /\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2}/;
  function phrase(n) {
    if (!DATED.test(n)) return null;
    let x = n.replace(SEASON_RE, (_, a, k) => `${SEASON[a]} Sunday ${CN.test(k) ? cn2n(k) : k}`)
      .replace(/星期([日一二三四五六])/g, (_, d) => WD[d])
      .replace(/(早上|上午|中午|下午|晚上)\s*(\d{1,2}[:.]\d{2}(?:\s*[–-]\s*\d{1,2}[:.]\d{2})?)/g, (_, a, t) => `${t} ${/早|上午/.test(a) ? 'am' : 'pm'}`);
    x = x.split(/(\s+|（[^（）]*）)/).map(tok => {
      if (!HAN.test(tok)) return tok;
      const m = tok.match(/^(.*?)([~～。！!，,]*)$/);
      const y = P.get(m[1]);
      return y == null ? tok : y + m[2];
    }).join('');
    return x === n ? null : x;
  }
  const SEP = /(\s*[·｜|，、：；]\s*|\s+\/\s+)/;
  const SEP_EN = { '，': ', ', '、': ', ', '：': ': ', '；': '; ', '｜': ' | ' };

  function core(n) {
    let r = P.get(n);
    if (r != null) return r;
    for (const t of T) {
      if (t.anchor && !n.includes(t.anchor)) continue;
      const m = fit(n, t.lits);
      if (!m) continue;
      return t.v.replace(/\{(\d+)\}/g, (_, i) => {
        const pos = t.ids.indexOf(+i);
        const g = pos < 0 ? '' : (m[pos] || '');
        if (t.wd && WD[g]) return WD[g];          // 日期里的星期几
        if (t.cn && CN.test(g)) return cn2n(g);   // 第三十三 → 33
        return HAN.test(g) ? tr(g) : g;
      });
    }
    const ph = phrase(n);
    if (ph != null && !HAN.test(ph)) return ph;
    if (SEP.test(n)) {
      const parts = n.split(SEP);
      let all = true;
      const out = parts.map((p, i) => {
        if (i % 2) { const k = p.trim(); return SEP_EN[k] || p; }
        if (!p || !HAN.test(p)) return p;
        const x = core(p.trim());
        if (x == null) { all = false; return p; }
        return x;
      });
      if (all) return out.join('');
    }
    return ph;   // 换了一部分也好（剩下的多半是名字）
  }

  const done = new Set();   // 已经翻过的结果（里面可能还留着中文名字）不要再翻，免得来回改个不停
  function tr(s) {
    if (!s || !HAN.test(s) || !load()) return s;
    if (done.has(s)) return s;
    if (cache.has(s)) return cache.get(s);
    const lead = s.match(/^\s*/)[0], tail = s.match(/\s*$/)[0];
    const n = s.replace(/\s+/g, ' ').trim();
    let r = /\n/.test(s.trim()) ? null : core(n);
    // 多行（alert 里常见）：一行一行翻
    if (r == null && /\n/.test(s.trim())) {
      const lines = s.trim().split('\n');
      const out = lines.map(l => { const t = l.trim(); if (!t || !HAN.test(t)) return l; const x = core(t.replace(/\s+/g, ' ')); return x == null ? l : x; });
      r = out.join('\n');
      const res = lead + r + tail; cache.set(s, res); if (res !== s) done.add(res); return res;
    }
    const res = r == null ? s : lead + r + tail;
    if (cache.size > 20000) { cache.clear(); done.clear(); }
    cache.set(s, res);
    if (res !== s) done.add(res);
    return res;
  }
  window.sicT = tr;

  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT', 'CODE', 'PRE']);
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  const skipEl = el => {
    for (let e = el; e; e = e.parentElement) {
      if (SKIP.has(e.tagName) || e.isContentEditable || (e.hasAttribute && e.hasAttribute('data-no-i18n'))) return true;
    }
    return false;
  };

  function doText(node) {
    const v = node.data;
    if (!HAN.test(v) || skipEl(node.parentElement)) return;
    const x = tr(v);
    if (x !== v) node.data = x;
  }
  function doAttrs(el) {
    if (el.nodeType !== 1 || skipEl(el)) return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && HAN.test(v)) { const x = tr(v); if (x !== v) el.setAttribute(a, x); }
    }
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && HAN.test(el.value)) el.value = tr(el.value);
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (skipEl(root)) return; doAttrs(root); }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.nodeType === 1 && SKIP.has(n.tagName)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? doText(n) : doAttrs(n);
  }

  // 保险：一秒内改太多次（可能跟别的程式拉锯），就停手，画面最多留一些中文，不会卡死
  let burst = 0, burstAt = 0;
  const obs = new MutationObserver(list => {
    const now = Date.now();
    if (now - burstAt > 1000) { burstAt = now; burst = 0; }
    burst += list.length;
    if (burst > 20000) {
      obs.disconnect();
      window.__i18nStopped = list.slice(0, 5).map(m => (m.target.data || m.target.outerHTML || '').slice(0, 80));
      return;
    }
    for (const m of list) {
      if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doAttrs(m.target);
      else m.addedNodes.forEach(walk);
    }
  });

  function start() {
    load();
    if (document.title && HAN.test(document.title)) document.title = tr(document.title);
    walk(document.body);
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat('value') });
    document.documentElement.classList.remove('sic-en-wait');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  setTimeout(() => document.documentElement.classList.remove('sic-en-wait'), 1500);   // 万一出错，不要一直白屏

  // 弹出的提示也翻
  const A = window.alert.bind(window), C = window.confirm.bind(window), Pr = window.prompt.bind(window);
  window.alert = m => A(tr(String(m ?? '')));
  window.confirm = m => C(tr(String(m ?? '')));
  window.prompt = (m, d) => Pr(tr(String(m ?? '')), d);
})();
