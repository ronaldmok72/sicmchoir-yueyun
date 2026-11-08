// 菜单：每一页都有同一个「☰ 菜单」。只列这个人用得到的页：后台区要开通了才看得到，没开的完全不出现
// 普通 <script src="src/nav.js" defer> 载入，要在 gate.js 后面。
// 页面上任何 [data-nav-open] 按钮都打开它；页面没有的话右上角浮一个。
// 页面有设 window.sicNavDate = () => '2026-10-18' 的话，去这台弥撒／排歌／职务表／座位表／祈祷文会带着那个日期
(function () {
  // 测验：Ronald 在「测验结果」页开关（关掉／指定团员／全团）；没开给他的看不到，做过或做到一半的照样看得到
  let quizOpen = window.sicQuiz?.cached() ?? false;
  const PAGES = [
    { group: '🎵 主日要用', tone: 'indigo' },
    { href: 'day.html', icon: '📅', title: '这台弥撒（首页）', sub: '这个主日唱什么、谁指挥、我坐哪里' },
    { href: '/?score=1', icon: '🎼', title: '乐谱', sub: '指挥翻到哪里，你就跟到哪里' },
    { href: 'scan.html', icon: '📷', title: '扫描签到', sub: '练歌到了扫一次，回家前再扫一次' },
    { href: 'prayer.html', icon: '🙏', title: '练习前祈祷文', sub: '进堂咏、集祷经、圣女则济利亚祷文' },
    { group: '📚 找歌', tone: 'teal' },
    { href: 'songs.html', icon: '🎶', title: '歌单目录', sub: '全部的歌都在这里，随时看谱学歌' },
    { href: 'years.html', icon: '📖', title: '历年排歌', sub: '每一年哪一天唱什么，找回以前的歌' },
    { group: '📢 团里的事', tone: 'amber' },
    { href: 'notices.html', icon: '📣', title: '公告', sub: '最近的活动、要练哪几首歌' },
    { href: 'quiz.html', icon: '📝', title: '团员小测验', sub: '自我了解用，不影响职位', quiz: true },
    { group: '🗂️ 排单', tone: 'sky', back: true },
    { href: 'mass.html', icon: '⛪', title: '弥撒排歌', sub: '按位置选歌，保存就更新乐谱；婚礼也在这里', staff: 'mass' },
    { href: 'duties.html', icon: '🗓️', title: '职务表', sub: '每场谁指挥、答唱咏、弹琴', staff: 'duties' },
    { href: 'seating.html', icon: '🪑', title: '座位表', sub: '谁坐哪里、今天要拿哪些披肩', staff: 'seating' },
    { href: 'admin.html', icon: '🗃️', title: '排单后台', sub: '曲库、改图、排单历史', staff: 'admin' },
    { group: '👥 团员管理', tone: 'emerald', back: true },
    { href: 'members.html', icon: '👥', title: '团员名单', sub: '声部、披肩号码、会做的职务', staff: 'members' },
    { href: 'attendance.html', icon: '📋', title: '点名／出席率', sub: '每次谁有来、出席了几次', staff: 'attendance' },
    { href: 'quiz-admin.html', icon: '📊', title: '测验结果', sub: '全团水平、谁想当领唱／指挥', staff: 'quiz' },
    { group: '🏛️ 执委', tone: 'rose', back: true },
    { href: 'committee.html', icon: '🏛️', title: '执委专区', sub: '会议记录、待办、团室物品、财政记录', staff: 'committee' },
    { group: '🔑 权限', tone: 'violet', back: true },
    { href: 'grant.html', icon: '🔑', title: '后台权限', sub: '谁可以进哪个后台、谁可以帮别人开', staff: 'grant' },
    { href: 'renames.html', icon: '✏️', title: '改名记录', sub: '谁改了哪首歌的名字，可以改回去', staff: 'access', masterOnly: true },
  ];
  // 每一块一个颜色：[整块的底和边, 标题字, 图示底]（要写完整的字，Tailwind 才认得）
  const TONE = {
    indigo: ['bg-indigo-500/10 border-indigo-400/25', 'text-indigo-300', 'bg-indigo-500/25'],
    teal: ['bg-teal-500/10 border-teal-400/25', 'text-teal-300', 'bg-teal-500/25'],
    amber: ['bg-amber-500/10 border-amber-400/25', 'text-amber-300', 'bg-amber-500/25'],
    sky: ['bg-sky-500/10 border-sky-400/25', 'text-sky-300', 'bg-sky-500/25'],
    emerald: ['bg-emerald-500/10 border-emerald-400/25', 'text-emerald-300', 'bg-emerald-500/25'],
    rose: ['bg-rose-500/10 border-rose-400/25', 'text-rose-300', 'bg-rose-500/25'],
    violet: ['bg-violet-500/10 border-violet-400/25', 'text-violet-300', 'bg-violet-500/25'],
  };
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
      if (act === 'pin') { close(); if (window.sicLogin?.pin) window.sicLogin.pin(); else location.href = 'me.html'; return; }
      if (act === 'pw') { close(); enterPassword(); return; }
      if (act === 'logout') { if (confirm('登出？这部手机就不会记得你是谁，后台也会锁回去（PIN、后台密码都要重输）。')) { window.sicStaff?.logout(); render(); } return; }
      const a = e.target.closest('a[data-staff]');
      if (!a) return;
      if (a.dataset.here) { e.preventDefault(); close(); }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  // 拿到后台密码的人：从菜单最下面那行输入，对了整页重开，开通的页就出现
  async function enterPassword() {
    const gate = window.sicStaff;
    if (!gate?.loggedIn()) return gate?.askLogin();
    const p = prompt('请输入后台密码：');
    if (p === null) return;
    try {
      if (await gate.tryPassword(p)) location.reload(); else alert('❌ 密码错误');
    } catch (err) {
      if (err.code === 'login') gate.askLogin(); else alert('连不上，检查一下网络再试。');
    }
  }
  // 这部手机有做过／做到一半的测验
  const quizDraft = () => { try { return !!localStorage.getItem('sicQuizDraft'); } catch { return false; } };
  const quizDone = () => { try { return !!localStorage.getItem('sicQuizDone'); } catch { return false; } };
  // 团员名单上开了后台、这部手机还没输 PIN
  const pendingPin = gate => { try { return JSON.parse(localStorage.getItem('sicMyAreas') || '[]').some(a => !gate.can(a)); } catch { return false; } };

  function render() {
    const gate = window.sicStaff, staff = gate?.isStaff();
    const who = gate?.me();
    // 最上面：我的资料（整块按下去就看得到）；还没登录就请他登录
    const head = who
      ? `<div class="flex items-center gap-1 mb-1">
          <a href="me.html" class="flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 rounded-2xl bg-white/10 hover:bg-white/15 no-underline">
            <span class="w-9 h-9 shrink-0 rounded-full bg-indigo-500/30 flex items-center justify-center text-lg">👤</span>
            <span class="flex-1 min-w-0"><span class="block text-white font-semibold text-sm truncate">${esc(who.name)}</span><span class="block text-xs text-indigo-300 truncate">我的资料、出席和分数、测验成绩</span></span>
            <span class="text-zinc-500">›</span>
          </a>
          <button data-act="logout" class="shrink-0 px-2 py-2 text-xs text-zinc-500 hover:text-white">登出</button>
        </div>`
      : `<button data-act="login" class="w-full flex items-center gap-2 px-3 py-3 mb-1 rounded-2xl bg-indigo-600/20 hover:bg-indigo-600/30 text-sm text-indigo-200"><span class="flex-1 text-left">📱 用电话号码登录</span><span class="text-xs text-indigo-300">看我坐哪里、我的资料 ›</span></button>`;
    // 通行证（锁资料库用）：登录了的人看得到这部手机领到了没有
    let pass = null; try { pass = JSON.parse(localStorage.getItem('sicAuthSig') || 'null'); } catch { /* 没关系 */ }
    const passLine = staff || (who && !pass) ? `<div class="px-3 pb-1 text-[11px] ${pass ? 'text-emerald-400/80' : 'text-zinc-500'}">${pass ? `通行证 ✅${pass.areas?.length ? `（后台 ${pass.areas.length} 区）` : ''}` : '通行证还没领到'}</div>` : '';
    const pinLine = who && pendingPin(gate) ? '<button data-act="pin" class="w-full text-left px-3 py-2.5 mb-1 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-sm text-amber-200">🔑 你的后台开通了，按这里输 PIN ›</button>' : '';
    const quizTest = gate?.can('quiz');
    const allowed = p => p.group || ((!p.quiz || quizOpen || quizTest || quizDone() || quizDraft()) && (!p.staff || gate?.can(p.staff)) && (!p.masterOnly || gate?.isMaster()));
    const vis = PAGES.filter(allowed).filter((p, i, a) => !p.group || (a[i + 1] && !a[i + 1].group));   // 下面没有页的分组，标题也不要
    const quizSub = quizDraft() ? '上次做到一半，按这里接着做' : quizDone() ? '✅ 做完了，按这里看我的结果' : quizOpen ? '' : '现在没开给团员，只有你看得到';
    // 一块一块：每块一个颜色；后台的前面隔一条线
    let backLine = false, sec = null;
    const blocks = [];
    vis.forEach(p => { if (p.group) blocks.push(sec = { ...p, items: [] }); else sec.items.push(p); });
    const row = (p, t) => `<a href="${link(p.href)}" data-staff="${p.staff || ''}" ${here(p.href) ? 'data-here="1"' : ''} class="flex items-center gap-3 px-2.5 py-2 rounded-xl ${here(p.href) ? 'bg-white/10' : 'hover:bg-white/10'} transition-colors no-underline">
        <span class="w-9 h-9 shrink-0 rounded-lg ${t[2]} flex items-center justify-center text-lg">${p.icon}</span>
        <span class="flex-1 min-w-0">
          <span class="block text-white font-semibold text-sm">${p.title}${here(p.href) ? ' <span class="text-[11px] font-normal text-zinc-300">你在这里</span>' : ''}</span>
          <span class="block text-zinc-400 text-xs truncate">${p.quiz && quizSub || p.sub}</span>
        </span>
        <span class="text-zinc-600">›</span>
      </a>`;
    const body = blocks.map(b => {
      const t = TONE[b.tone];
      const line = b.back && !backLine ? (backLine = true, '<div class="flex items-center gap-2 pt-3 pb-0.5 text-[11px] text-zinc-500"><span class="h-px flex-1 bg-white/10"></span>后台（开通了才看得到）<span class="h-px flex-1 bg-white/10"></span></div>') : '';
      return `${line}<section class="mt-2 p-1 rounded-2xl border ${t[0]}"><div class="px-2.5 pt-1.5 pb-0.5 text-xs font-semibold ${t[1]}">${b.group}</div>${b.items.map(p => row(p, t)).join('')}</section>`;
    }).join('');
    modal.querySelector('[data-list]').innerHTML = head + passLine + pinLine + body + '<button data-act="pw" class="w-full text-center text-[11px] text-zinc-600 hover:text-zinc-300 pt-3 pb-1">有后台密码？按这里输入</button>';
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
