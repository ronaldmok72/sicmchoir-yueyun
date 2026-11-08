// 所有日期格统一显示 日/月/年。
// 手机日期格的显示跟系统语言走（会变成 月/日/年），程式管不到。所以盖一层：
// 看到的是这里写的字，真正的日期格透明放在上面，点它照样弹日历。
// 存的资料还是 2026-11-07 这个格式，读写日期格的程式都不用改。
(() => {
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const done = new WeakSet();
  const text = v => /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v.slice(8)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : '选日期';

  function enhance(el) {
    if (done.has(el)) return;
    done.add(el);
    const box = document.createElement('span');
    // 外框照日期格原本的样子；r- 开头的是程式用来找格子的记号，不能抄给外框
    box.className = [...el.classList].filter(c => !/^r-/.test(c)).join(' ');
    box.style.cssText = 'position:relative;display:inline-block;min-width:7.5em;text-align:left;background-color:#fff';
    const show = document.createElement('span');
    const sync = () => {
      const t = text(nativeValue.get.call(el));
      show.textContent = t;
      show.style.color = t === '选日期' ? '#94a3b8' : '';
    };
    el.parentNode.insertBefore(box, el);
    box.append(show, el);
    el.style.cssText += ';position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;opacity:0;cursor:pointer';
    // 程式直接改日期（例如换一场弥撒）时，字也要跟着变
    Object.defineProperty(el, 'value', {
      configurable: true,
      get() { return nativeValue.get.call(this); },
      set(v) { nativeValue.set.call(this, v); sync(); },
    });
    el.addEventListener('input', sync);
    el.addEventListener('change', sync);
    el.addEventListener('click', () => { try { el.showPicker(); } catch {} });   // 电脑上点格子中间也弹日历
    sync();
  }

  const scan = root => {
    if (root.matches?.('input[type="date"]')) enhance(root);
    root.querySelectorAll?.('input[type="date"]').forEach(enhance);
  };
  scan(document);
  // 有些日期格是之后才画出来的（待办、会议、财政表格）
  new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });
})();
