// App 里的「📷 扫描签到」：开相机扫现场的 QR → 去 checkin.html 签到／签退
// 只认我们自己的签到 QR（网址里有 checkin.html?e=…&k=…），别的 QR 不会跳去别的网站
const $ = id => document.getElementById(id);
let scanner = null;

function ourCheckin(text) {
  try {
    const u = new URL(text, location.href);
    if (!u.pathname.endsWith('/checkin.html') || !u.searchParams.get('e') || !u.searchParams.get('k')) return null;
    return `checkin.html?e=${encodeURIComponent(u.searchParams.get('e'))}&k=${encodeURIComponent(u.searchParams.get('k'))}`;
  } catch { return null; }
}

async function start() {
  $('retry').classList.add('hidden');
  $('msg').textContent = '开相机中…';
  // 还没登录：先登录，不然扫了也不知道是谁
  if (!window.sicStaff?.me()) {
    $('msg').textContent = '先用电话登录，再扫。';
    window.sicLogin?.open();
    return;
  }
  try {
    scanner ||= new Html5Qrcode('reader');
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.75); return { width: s, height: s }; } }, async text => {
      const go = ourCheckin(text);
      if (!go) { $('msg').textContent = '这不是签到的 QR，请对准现场屏幕上的那个。'; return; }
      $('msg').textContent = '✅ 扫到了，签到中…';
      try { await scanner.stop(); } catch { /* 没关系 */ }
      location.href = go;
    });
    $('msg').textContent = '对准 QR，扫到会自己跳过去';
  } catch (err) {
    console.error(err);
    $('msg').innerHTML = '开不到相机。<br>请在手机设定里允许这个网站用相机，再按「再试一次」。<br>也可以直接用手机相机扫现场的 QR。';
    $('retry').classList.remove('hidden');
  }
}

$('retry').addEventListener('click', start);
document.addEventListener('sic-login', () => { window.sicLogin?.close(); start(); });
start();
