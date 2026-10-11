// 指挥专用页面的密码（跟乐谱「指挥模式」同一个）。只是防团员误入，不是真正的保安。
// 普通 <script> 载入；加 data-require 的页面一打开就要密码，错了送回乐谱首页。
(function () {
  const PASSWORD = 'sic';
  const KEY = 'sicStaff';

  const isStaff = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
  const remember = () => { try { localStorage.setItem(KEY, '1'); } catch { /* 没关系 */ } };

  // 已经输过就不用再问（同一部手机记住）
  function unlock() {
    if (isStaff()) return true;
    const p = prompt('🔒 指挥专用，请输入密码：');
    if (p === null) return false;
    if (p.trim() !== PASSWORD) { alert('❌ 密码错误'); return false; }
    remember();
    return true;
  }

  window.sicStaff = { isStaff, unlock, remember, PASSWORD };

  const me = document.currentScript;
  if (me && me.hasAttribute('data-require') && !unlock()) {
    document.documentElement.style.display = 'none';
    location.replace('/');
  }
})();
