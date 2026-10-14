// 团员登录画面：输入电话号码 → 认出是谁；有开后台的再输 4 位数 PIN（第一次自己设）
// 也可以按「Guest 进入」先看看（短期来的人）。登入一次，这部手机就记住
// 普通 <script> 载入，要在 gate.js 后面；<script src="src/login.js" data-auto> = 这部手机还没登入也没选 Guest 就自动跳出来
(function () {
  const gate = window.sicStaff;
  if (!gate) return;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LABEL = Object.fromEntries(gate.AREAS.map(a => [a.key, a.label]));
  const isGuest = () => { try { return localStorage.getItem('sicGuest') === '1'; } catch { return false; } };

  let box = null, member = null;
  const BTN = 'w-full rounded-xl py-3 font-semibold text-sm transition-colors';
  const INPUT = 'w-full rounded-xl bg-zinc-800 border border-white/10 px-4 py-3 text-white text-center text-lg tracking-wider placeholder:text-zinc-500 placeholder:text-base placeholder:tracking-normal focus:outline-none focus:border-indigo-400';

  function shell(inner) {
    if (!box) {
      box = document.createElement('div');
      box.className = 'fixed inset-0 z-[200] bg-zinc-950/95 backdrop-blur-sm flex items-center justify-center p-4';
      document.body.appendChild(box);
    }
    box.innerHTML = `<div class="w-full max-w-sm bg-zinc-900 border border-white/10 rounded-2xl p-6 text-zinc-200 text-sm space-y-4">
      <div class="flex items-center gap-3">
        <img src="https://res.cloudinary.com/dsfhilcgz/image/upload/v1778688168/sicmchoir_yueyun_logo.jpg" alt="" class="w-11 h-11 rounded-xl object-cover">
        <div><div class="text-white font-bold text-lg leading-tight">乐韵歌咏团</div><div class="text-xs text-zinc-500">SIC 圣依纳爵堂</div></div>
      </div>
      ${inner}
    </div>`;
    box.querySelector('input')?.focus();
  }
  const err = msg => { const e = box.querySelector('[data-err]'); if (e) { e.textContent = msg; e.classList.remove('hidden'); } };
  const busy = (b, on, txt) => { b.disabled = on; if (txt) b.textContent = txt; b.classList.toggle('opacity-60', on); };
  function close() { box?.remove(); box = null; member = null; }

  // ① 电话
  function stepPhone() {
    shell(`
      <div class="text-zinc-400">用你的电话号码登录，就会看到你坐哪里、可以进哪些地方。</div>
      <form data-f class="space-y-3">
        <input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="电话号码，例如 012-345 6789" class="${INPUT}">
        <div data-err class="hidden text-amber-400 text-xs"></div>
        <button class="${BTN} bg-indigo-600 hover:bg-indigo-500 text-white">登录</button>
      </form>
      <button data-guest class="${BTN} bg-white/5 hover:bg-white/10 text-zinc-300">🙋 Guest 进入（先看看）</button>
      <div class="text-[11px] text-zinc-500 leading-relaxed">登录不了？电话要先由 Ronald 加进团员名单。Guest 可以看乐谱、歌单目录、公告。</div>`);
    box.querySelector('[data-f]').addEventListener('submit', async e => {
      e.preventDefault();
      const phone = e.target.phone.value;
      if (gate.normPhone(phone).length < 10) return err('电话号码好像不完整');
      const b = e.target.querySelector('button');
      busy(b, true, '找你中…');
      try {
        member = await gate.findByPhone(phone);
        if (!member) { busy(b, false, '登录'); return err('这个电话还没在团员名单里。请跟 Ronald 说一声，或者先用 Guest 进入。'); }
        gate.setMe(member);
        if ((member.areas || []).length) stepPin(); else done([]);
      } catch (x) { busy(b, false, '登录'); err('连不上，检查一下网络再试。'); console.error(x); }
    });
    box.querySelector('[data-guest]').addEventListener('click', () => {
      try { localStorage.setItem('sicGuest', '1'); } catch { /* 没关系 */ }
      close();
    });
  }

  // ② 有开后台的：输 PIN（第一次设 PIN）
  function stepPin() {
    const first = !member.pinHash;
    const areas = member.areas.map(a => LABEL[a]).filter(Boolean);
    shell(`
      <div class="text-white font-semibold text-base">👋 ${esc(member.name)}</div>
      <div class="text-zinc-400">你有开后台：<span class="text-zinc-200">${esc(areas.join('、'))}</span>。${first ? '第一次要<b class="text-white">自己设一个 4 位数 PIN</b>，以后进后台用。' : '输入你的 4 位数 PIN。'}</div>
      <form data-f class="space-y-3">
        <input name="pin" type="password" inputmode="numeric" maxlength="4" placeholder="${first ? '设 4 位数 PIN' : '4 位数 PIN'}" class="${INPUT}">
        ${first ? `<input name="pin2" type="password" inputmode="numeric" maxlength="4" placeholder="再输一次" class="${INPUT}">` : ''}
        <div data-err class="hidden text-amber-400 text-xs"></div>
        <button class="${BTN} bg-indigo-600 hover:bg-indigo-500 text-white">${first ? '设好了' : '进去'}</button>
      </form>
      <button data-skip class="${BTN} bg-white/5 hover:bg-white/10 text-zinc-300">先不用后台，直接进</button>
      ${first ? '' : '<div class="text-[11px] text-zinc-500">忘了 PIN？请 Ronald 在「🔑 密码管理」帮你清掉，再登录一次重新设。</div>'}`);
    box.querySelector('[data-f]').addEventListener('submit', async e => {
      e.preventDefault();
      const pin = e.target.pin.value.trim();
      if (!/^\d{4}$/.test(pin)) return err('PIN 要 4 位数字');
      if (first && pin !== e.target.pin2.value.trim()) return err('两次不一样，再输一次');
      const b = e.target.querySelector('button');
      busy(b, true, '…');
      try {
        const got = first ? await gate.memberSetPin(member, pin) : await gate.memberUnlock(member, pin);
        if (!got) { busy(b, false, '进去'); e.target.pin.value = ''; return err('PIN 不对'); }
        done(got);
      } catch (x) { busy(b, false, first ? '设好了' : '进去'); err('连不上，检查一下网络再试。'); console.error(x); }
    });
    box.querySelector('[data-skip]').addEventListener('click', () => done([]));
  }

  // ③ 进来了
  function done(areas) {
    const names = areas.map(a => LABEL[a]).filter(Boolean);
    shell(`
      <div class="text-white font-semibold text-base">✅ 欢迎，${esc(member.name)}</div>
      <div class="text-zinc-400">${names.length ? `你可以进后台：<span class="text-zinc-200">${esc(names.join('、'))}</span>` : '你可以看乐谱、这台弥撒（你坐哪里）、歌单目录、公告。'}</div>
      <a href="day.html" class="${BTN} block text-center bg-indigo-600 hover:bg-indigo-500 text-white">📅 看这个主日我坐哪里</a>
      <button data-close class="${BTN} bg-white/5 hover:bg-white/10 text-zinc-300">🎼 去乐谱</button>`);
    box.querySelector('[data-close]').addEventListener('click', close);
    document.dispatchEvent(new CustomEvent('sic-login'));
  }

  window.sicLogin = { open: stepPhone, close, isGuest };
  const auto = document.currentScript?.hasAttribute('data-auto');
  if (auto && !gate.me() && !isGuest()) {
    if (document.body) stepPhone(); else document.addEventListener('DOMContentLoaded', stepPhone);
  }
})();
