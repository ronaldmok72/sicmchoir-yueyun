// 团员登录画面：输入电话号码 → 认出是谁；有开后台的再输 4 位数 PIN（第一次自己设）
// 电话还没登记 → 自己注册：在名单上选自己的名字（或新团员），选男女和声部（不知道就先唱主旋律）
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
      <div class="text-[11px] text-zinc-500 leading-relaxed">第一次用就打你的电话，会带你注册一次（不用一分钟）。Guest 可以看乐谱、歌单目录、公告。</div>`);
    box.querySelector('[data-f]').addEventListener('submit', async e => {
      e.preventDefault();
      const phone = e.target.phone.value;
      if (gate.normPhone(phone).length < 10) return err('电话号码好像不完整');
      const b = e.target.querySelector('button');
      busy(b, true, '找你中…');
      try {
        member = await gate.findByPhone(phone);
        if (!member) return stepFind(phone);
        gate.setMe(member);
        if ((member.areas || []).length) stepPin(); else done([]);
      } catch (x) { busy(b, false, '登录'); err('连不上，检查一下网络再试。'); console.error(x); }
    });
    box.querySelector('[data-guest]').addEventListener('click', () => {
      try { localStorage.setItem('sicGuest', '1'); } catch { /* 没关系 */ }
      close();
    });
  }

  // ①-b 第一次用：在名单上找自己
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
  const phoneText = p => { const n = gate.normPhone(p).replace(/^60/, '0'); return `${n.slice(0, 3)}-${n.slice(3)}`; };
  let roster = null;
  async function stepFind(phone) {
    shell(`
      <div class="text-white font-semibold text-base">第一次用？注册一次就好</div>
      <div class="text-zinc-400"><b class="text-zinc-200">${esc(phoneText(phone))}</b> 还没登记。先在团员名单上找你的名字：</div>
      <input data-q autocomplete="off" placeholder="打你的名字，例如 Agnes" class="${INPUT}">
      <div data-hits class="space-y-1.5"><div class="text-xs text-zinc-500">读取名单中…</div></div>
      <div data-err class="hidden text-amber-400 text-xs"></div>
      <button data-new class="${BTN} bg-white/5 hover:bg-white/10 text-zinc-300">名单上没有我（我是新来的）</button>
      <button data-back class="w-full text-xs text-zinc-500 hover:text-white">← 电话打错了</button>`);
    box.querySelector('[data-back]').addEventListener('click', stepPhone);
    box.querySelector('[data-new]').addEventListener('click', () => stepNew(phone));
    try { roster ||= (await gate.listMembers()).sort((a, b) => a.name.localeCompare(b.name)); }
    catch (x) { console.error(x); return err('连不上，检查一下网络再试。'); }
    if (!box) return;
    const q = box.querySelector('[data-q]'), hits = box.querySelector('[data-hits]');
    if (!q) return;
    const show = () => {
      const k = norm(q.value);
      if (!k) { hits.innerHTML = '<div class="text-xs text-zinc-500">打一两个字就会出来</div>'; return; }
      const list = roster.filter(m => norm(`${m.name} ${m.fullName || ''}`).includes(k)).slice(0, 6);
      hits.innerHTML = list.map(m => m.phoneHash
        ? `<div class="rounded-xl bg-white/5 px-4 py-2.5 text-zinc-500"><div>${esc(m.name)}</div><div class="text-[11px]">已经用 …${esc(m.phoneTail || '')} 登记了。换了电话请跟 Ronald 说</div></div>`
        : `<button data-pick="${esc(m.id)}" class="w-full text-left rounded-xl bg-white/5 hover:bg-indigo-600/30 px-4 py-2.5"><div class="text-white">${esc(m.name)}</div>${m.fullName ? `<div class="text-[11px] text-zinc-400">${esc(m.fullName)}</div>` : ''}</button>`).join('')
        || '<div class="text-xs text-zinc-500">找不到。换个写法试试，或者按下面「我是新来的」。</div>';
    };
    q.addEventListener('input', show);
    hits.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]'); if (!b) return;
      stepVoice({ phone, member: roster.find(m => m.id === b.dataset.pick) });
    });
    show();
  }
  // ①-c 新团员：名字
  function stepNew(phone) {
    shell(`
      <div class="text-white font-semibold text-base">欢迎加入 🙌</div>
      <form data-f class="space-y-3">
        <input name="name" maxlength="20" placeholder="团里大家怎么叫你，例如 Agnes" class="${INPUT}">
        <input name="full" maxlength="40" placeholder="全名（可以不填）" class="${INPUT}">
        <div data-err class="hidden text-amber-400 text-xs"></div>
        <button class="${BTN} bg-indigo-600 hover:bg-indigo-500 text-white">下一步</button>
      </form>
      <button data-back class="w-full text-xs text-zinc-500 hover:text-white">← 回去名单找</button>`);
    box.querySelector('[data-back]').addEventListener('click', () => stepFind(phone));
    box.querySelector('[data-f]').addEventListener('submit', e => {
      e.preventDefault();
      const name = e.target.name.value.trim(), fullName = e.target.full.value.trim();
      if (!name) return err('要填名字');
      const same = (roster || []).find(m => norm(m.name) === norm(name));
      if (same) return err(`名单上已经有「${same.name}」。是你的话，按「回去名单找」选他；不是的话，名字加点区别，例如「${name} Tan」。`);
      stepVoice({ phone, name, fullName });
    });
  }
  // ①-d 男女、声部（不知道就先唱主旋律，之后指挥会帮你安排）
  function stepVoice(ctx) {
    const m = ctx.member;
    let g = m && !m.genderGuess && (m.gender === 'F' || m.gender === 'M') ? m.gender : '';
    let v = '';
    const draw = () => {
      const chip = (on, label, attr) => `<button type="button" ${attr} class="flex-1 rounded-xl py-2.5 text-sm border ${on ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10'}">${label}</button>`;
      const parts = g === 'F' ? [['S', '女高音 S'], ['A', '女低音 A']] : g === 'M' ? [['T', '男高音 T'], ['B', '男低音 B']] : [];
      shell(`
        <div class="text-white font-semibold text-base">👋 ${esc(m ? m.name : ctx.name)}</div>
        <div class="space-y-1.5"><div class="text-zinc-400">你是</div>
          <div class="flex gap-2">${chip(g === 'F', '女声', 'data-g="F"')}${chip(g === 'M', '男声', 'data-g="M"')}</div></div>
        ${g ? `<div class="space-y-1.5"><div class="text-zinc-400">你唱哪个声部？</div>
          <div class="flex flex-col gap-2">${chip(v === '', '还不知道（先唱主旋律）', 'data-v=""')}<div class="flex gap-2">${parts.map(([k, l]) => chip(v === k, l, `data-v="${k}"`)).join('')}</div></div>
          <div class="text-[11px] text-zinc-500">不确定就选「还不知道」，之后指挥会帮你安排。</div></div>` : ''}
        <div data-err class="hidden text-amber-400 text-xs"></div>
        <button data-ok class="${BTN} bg-indigo-600 hover:bg-indigo-500 text-white ${g ? '' : 'opacity-40'}">完成注册</button>`);
      box.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => { if (g !== b.dataset.g) v = ''; g = b.dataset.g; draw(); }));
      box.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => { v = b.dataset.v; draw(); }));
      box.querySelector('[data-ok]').addEventListener('click', async e => {
        if (!g) return err('先选女声还是男声');
        busy(e.target, true, '注册中…');
        try {
          member = await gate.register(m, { phone: ctx.phone, name: ctx.name, fullName: ctx.fullName, gender: g, voiceSelf: v });
          roster = null;
          gate.setMe(member);
          if ((member.areas || []).length) stepPin(); else done([], true);
        } catch (x) {
          busy(e.target, false, '完成注册');
          if (x.code === 'name-taken') return err(`「${m.name}」刚刚已经用 …${x.tail || ''} 登记了。不是你的话请跟 Ronald 说。`);
          if (x.code === 'phone-taken') return err('这个电话已经登记了，回去直接登录就好。');
          console.error(x); err('连不上，检查一下网络再试。');
        }
      });
    };
    draw();
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
  function done(areas, fresh) {
    const names = areas.map(a => LABEL[a]).filter(Boolean);
    shell(`
      <div class="text-white font-semibold text-base">✅ ${fresh ? '注册好了' : '欢迎'}，${esc(member.name)}</div>${fresh ? '<div class="text-zinc-400 text-xs">这部手机会记得你，下次打开就直接进来。</div>' : ''}
      <div class="text-zinc-400">${names.length ? `你可以进后台：<span class="text-zinc-200">${esc(names.join('、'))}</span>` : '你可以看乐谱、这台弥撒（你坐哪里）、歌单目录、公告。'}</div>
      <a href="day.html" class="${BTN} block text-center bg-indigo-600 hover:bg-indigo-500 text-white">📅 看这个主日我坐哪里</a>
      <a href="scan.html" class="${BTN} block text-center bg-emerald-600 hover:bg-emerald-500 text-white">📷 扫描签到</a>
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
