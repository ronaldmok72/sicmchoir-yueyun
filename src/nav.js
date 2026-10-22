// 菜单：每一页都有同一个「☰ 菜单」，可以去到任何一页（🔒 的要后台密码或电话登录开的权限）
// 普通 <script src="src/nav.js" defer> 载入，要在 gate.js 后面。
// 页面上任何 [data-nav-open] 按钮都打开它；页面没有的话右上角浮一个。
// 页面有设 window.sicNavDate = () => '2026-10-18' 的话，去这台弥撒／排歌／职务表／座位表／祈祷文会带着那个日期
(function () {
  // 测验：Ronald 在「测验结果」页开关；关着的时候团员菜单看不到，后台看得到
  let quizOpen = window.sicQuiz?.cached() ?? false;
  const PAGES = [
    { group: '团员' },
    { href: 'day.html', icon: '📅', title: '这台弥撒（首页）', sub: '这个主日唱什么、谁指挥、我坐哪里、祈祷文' },
    { href: '/?score=1', icon: '🎼', title: '乐谱', sub: '指挥翻到哪里，你就跟到哪里' },
    { href: 'scan.html', icon: '📷', title: '扫描签到', sub: '练歌到了扫一次，回家前再扫一次' },
    { href: 'prayer.html', icon: '🙏', title: '练习前祈祷文', sub: '进堂咏、集祷经、圣女则济利亚祷文' },
    { href: 'songs.html', icon: '📚', title: '歌单目录', sub: '全部的歌都在这里，随时看谱学歌' },
    { href: 'notices.html', icon: '📢', title: '公告', sub: '最近的活动、要练哪几首歌' },
    { href: 'quiz.html', icon: '📝', title: '团员小测验', sub: '自我了解用，不影响职位', quiz: true },
    { group: '后台区 🔒' },
    { href: 'mass.html', icon: '⛪', title: '弥撒排歌', sub: '按位置选歌，保存就更新乐谱；婚礼也在这里', staff: 'mass' },
    { href: 'duties.html', icon: '🗓️', title: '职务表', sub: '每场谁指挥、答唱咏、弹琴', staff: 'duties' },
    { href: 'seating.html', icon: '🪑', title: '座位表', sub: '谁坐哪里、今天要拿哪些披肩', staff: 'seating' },
    { href: 'members.html', icon: '👥', title: '团员名单', sub: '声部、披肩号码、会做的职务', staff: 'members' },
    { href: 'attendance.html', icon: '📋', title: '点名／出席率', sub: '每次谁有来、出席了几次', staff: 'attendance' },
    { href: 'admin.html', icon: '🗂️', title: '排单后台', sub: '曲库、改图、排单历史', staff: 'admin' },
    { href: 'quiz-admin.html', icon: '📊', title: '测验结果', sub: '全团水平、谁想当领唱／指挥', staff: 'quiz' },
    { href: 'access.html', icon: '🔑', title: '密码管理', sub: '谁的密码可以进哪几页', staff: 'access', masterOnly: true },
    { href: 'renames.html', icon: '📝', title: '改名记录', sub: '谁改了哪首歌的名字，可以改回去', staff: 'access', masterOnly: true },
  ];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DATED = ['day.html', 'mass.html', 'duties.html', 'seating.html', 'prayer.html'];
  const link = href => {
    const d = window.sicNavDate?.();
    return DATED.includes(href) && /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? `${href}?d=${d}` : href;
  };
  const here = href => {
    const p = location.pathname.replace(/\/index\.html$/, '/');
    return href.startsWith('/?') ? p === '/' : p.endsWith('/' + href);
  };

  let modal = null;
  function build() {
    modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/70 z-[150] hidden items-end md:items-center justify-center backdrop-blur-sm';
    modal.innerHTML = `
      <div class="bg-zinc-900 w-full md:w-96 max-h-[85dvh] rounded-t-2xl md:rounded-2xl flex flex-col overflow-hidden border border-white/10 font-sans">
        <div class="p-4 border-b border-white/10 flex justify-between items-center bg-zinc-800/50">
          <div class="flex items-center gap-3">
            <img src="https://res.cloudinary.com/dsfhilcgz/image/upload/v1778688168/sicmchoir_yueyun_logo.jpg" alt="" class="w-9 h-9 rounded-lg object-cover">
            <span class="text-white font-bold text-lg">乐韵歌咏团</span>
          </div>
          <button data-close class="w-9 h-9 text-zinc-400 hover:text-white hover:bg-white/10 rounded-full text-lg" aria-label="关掉">✕</button>
        </div>
        <div data-list class="flex-1 overflow-y-auto p-3 space-y-1"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => {
      if (e.target === modal || e.target.closest('[data-close]')) return close();
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'login') { close(); if (window.sicLogin) window.sicLogin.open(); else location.href = 'me.html'; return; }
      if (act === 'logout') { if (confirm('登出？这部手机就不会记得你是谁，后台也会锁回去（PIN、后台密码都要重输）。')) { window.sicStaff?.logout(); render(); } return; }
      const a = e.target.closest('a[data-staff]');
      if (!a) return;
      if (a.dataset.here) { e.preventDefault(); close(); return; }
      if (a.dataset.staff && !window.sicStaff?.can(a.dataset.staff)) {
        e.preventDefault();
        window.sicStaff?.unlock(a.dataset.staff).then(ok => { if (ok) location.href = a.getAttribute('href'); });
      }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  function render() {
    const gate = window.sicStaff, staff = gate?.isStaff();
    const who = gate?.me();
    // 最上面：现在是谁（电话登录）＋ 修改资料、登出；还没登录就请他登录
    const head = who
      ? `<div class="flex items-center gap-2 px-3 py-2.5 mb-1 rounded-xl bg-white/5 text-sm"><span class="flex-1 min-w-0 truncate text-white">👋 ${esc(who.name)}</span><a href="me.html" class="text-xs text-indigo-300 hover:text-white">✏️ 修改资料</a><span class="text-zinc-700">|</span><button data-act="logout" class="text-xs text-zinc-500 hover:text-white">登出</button></div>`
      : `<button data-act="login" class="w-full flex items-center gap-2 px-3 py-2.5 mb-1 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-sm text-indigo-200"><span class="flex-1 text-left">📱 用电话号码登录</span><span class="text-xs text-indigo-300">看我坐哪里 ›</span></button>`;
    // 通行证（锁资料库用）：登录了的人看得到这部手机领到了没有
    let pass = null; try { pass = JSON.parse(localStorage.getItem('sicAuthSig') || 'null'); } catch { /* 没关系 */ }
    const passLine = who || staff ? `<div class="px-3 pb-1 text-[11px] ${pass ? 'text-emerald-400/80' : 'text-zinc-500'}">${pass ? `🔐 通行证 ✅${pass.areas?.length ? `（后台 ${pass.areas.length} 区）` : ''}` : '🔐 通行证还没领到'}</div>` : '';
    modal.querySelector('[data-list]').innerHTML = head + passLine + PAGES.filter(p => (!p.quiz || quizOpen || staff) && (!p.masterOnly || gate?.isMaster())).map(p => p.group
      ? `<div class="px-2 pt-3 pb-1 text-[11px] tracking-widest text-zinc-500">${p.group}${p.group.includes('🔒') && staff ? '　已解锁' : ''}</div>`
      : `<a href="${link(p.href)}" data-staff="${p.staff || ''}" ${here(p.href) ? 'data-here="1"' : ''} class="flex items-center gap-3 px-3 py-3 rounded-xl ${here(p.href) ? 'bg-indigo-600/20' : 'hover:bg-white/10'} transition-colors no-underline">
          <span class="text-xl w-7 text-center">${p.icon}</span>
          <span class="flex-1 min-w-0">
            <span class="block text-white font-semibold text-sm">${p.title}${here(p.href) ? ' <span class="text-[11px] font-normal text-indigo-300">你在这里</span>' : ''}</span>
            <span class="block text-zinc-500 text-xs truncate">${p.quiz && !quizOpen ? '现在关着，团员看不到' : p.sub}</span>
          </span>
          ${p.staff && !gate?.can(p.staff) ? '<span class="text-zinc-600 text-sm">🔒</span>' : '<span class="text-zinc-600">›</span>'}
        </a>`).join('');
  }
  function open() { if (!modal) build(); render(); modal.classList.remove('hidden'); modal.classList.add('flex'); }
  function close() { modal?.classList.add('hidden'); modal?.classList.remove('flex'); }
  window.sicNav = { open, close, PAGES };
  window.sicQuiz?.load().then(v => { quizOpen = v; if (modal && !modal.classList.contains('hidden')) render(); });

  // 页面上没有菜单按钮（不应该）→ 右上角浮一个
  function mount() {
    if (document.querySelector('[data-nav-open]')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.navOpen = '';
    b.className = 'fixed top-3 right-3 z-[90] px-3 py-1.5 rounded-lg text-sm font-medium bg-zinc-900/80 text-white border border-white/10';
    b.textContent = '☰ 菜单';
    document.body.appendChild(b);
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-nav-open]')) open(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
