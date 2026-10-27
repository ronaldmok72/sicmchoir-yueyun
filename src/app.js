// 1. 引入新增了 updateDoc、onSnapshot、setDoc(改名功能要用)
import { collection, doc, setDoc, updateDoc, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { db, getDocs, getDoc } from "./firebase.js";   // 跟其他页同一个连接（读过的资料记在手机，读不到时先用）
import { freshTitles, queueRename, flushRenames, applyPending } from "./rename.js";
import { getDrawing, putDrawing, delDrawing, migrateDrawings } from "./drawings.js";


let PLAYLIST = [];
let currentIndex = 0;
let isDrawingMode = false;

// --- 新增：Live Sync 状态 ---
let isConductor = false;
let unsubscribeLiveSync = null;

// DOM Elements
let titleEl, imgEl, btnDraw, drawStatus, drawTools, colorBtns, btnEraser, btnClear, btnSync, canvas, ctx, slideContainer, setlistSelect, btnConductor, btnRenameSong;

// Drawing State
let isDrawing = false;
let lastX = 0, lastY = 0;
let currentColor = 'rgba(239, 68, 68, 0.8)';
let currentWidth = 4;
let isEraser = false;

// 缩放与拖拽状态
let scale = 1;
let isDragging = false;
let startX, startY, translateX = 0, translateY = 0;
let initialDistance = null;

async function init() {
  titleEl = document.getElementById('song-title');
  imgEl = document.getElementById('score-image');
  btnDraw = document.getElementById('btn-draw');
  drawStatus = document.getElementById('draw-status');
  drawTools = document.getElementById('draw-tools');
  colorBtns = document.querySelectorAll('.color-btn');
  btnEraser = document.getElementById('btn-eraser');
  btnClear = document.getElementById('btn-clear');
  btnSync = document.getElementById('btn-sync');
  canvas = document.getElementById('draw-canvas');
  ctx = canvas.getContext('2d', { willReadFrequently: true });
  slideContainer = document.getElementById('slide-container');
  setlistSelect = document.getElementById('setlist-select');
  setlistSelect.addEventListener('change', async () => {
    if (setlistSelect.value !== '__past') return;
    showPastSetlists = true;
    if (!allLoaded) await loadSetlistOptions(true);   // 以前的排单：要看才读
    renderSetlistOptions();
    setlistSelect.value = setlistSelect.querySelector('optgroup option')?.value || '';
  });
  const btnSongList = document.getElementById('btn-song-list');
  const btnCloseSongList = document.getElementById('btn-close-song-list');
  if (btnSongList) btnSongList.addEventListener('click', openSongList);
  if (btnCloseSongList) btnCloseSongList.addEventListener('click', closeSongList);

  // 🌟 新增：改名/备注按钮（风格·拍子·Key 用文字记录，不用画笔，省储存空间）
  // 默认隐藏，只有指挥模式开启后才显示，避免团员按错误改歌名
  btnRenameSong = document.getElementById('btn-rename-song');
  if (btnRenameSong) btnRenameSong.addEventListener('click', renameCurrentSong);


  // 绑定指挥按钮
  btnConductor = document.getElementById('btn-conductor');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => console.error(err));
  }

  window.addEventListener('resize', resizeCanvas);
  
  if (btnDraw) btnDraw.addEventListener('click', toggleDrawMode);
  if (btnSync) btnSync.addEventListener('click', syncSelectedSetlist);
  
  // --- 新增：指挥模式切换逻辑 ---
    if (btnConductor) {
    btnConductor.addEventListener('click', async () => {
      // 如果当前是关闭状态，准备开启，则需要验证密码
      // 这部手机已经输过指挥密码（菜单或指挥后台）就不用再问
      // 要有「乐谱指挥模式」那一区的密码（在密码管理设）
      if (!isConductor && !(await window.sicStaff?.unlock('conduct', '🔒 指挥模式，请输入密码：'))) return;

      // 密码正确（或准备关闭），切换状态
      isConductor = !isConductor;
      if (isConductor) {
        btnConductor.classList.replace('text-zinc-400', 'text-yellow-400');
        btnConductor.classList.add('ring-2', 'ring-yellow-500/50');
        // 🌟 改名功能只在指挥模式下才露出来，避免团员按错误改歌名
        if (btnRenameSong) { btnRenameSong.classList.remove('hidden'); btnRenameSong.classList.add('flex'); }
        alert("👨‍🏫 指挥模式已开启！\n现在你的翻页动作将实时同步给所有团员，也可以修改歌名/加备注了。");
        pushLiveSync();
      } else {
        btnConductor.classList.replace('text-yellow-400', 'text-zinc-400');
        btnConductor.classList.remove('ring-2', 'ring-yellow-500/50');
        if (btnRenameSong) { btnRenameSong.classList.add('hidden'); btnRenameSong.classList.remove('flex'); }
        alert("指挥模式已关闭。");
      }
    });
  }

  
  // --- 修改：翻页时，如果是指挥，则推送到云端 ---
  document.getElementById('btn-prev').addEventListener('click', () => {
    if (currentIndex > 0) { 
      currentIndex--; 
      loadSong(currentIndex); 
      if (isConductor) pushLiveSync();
    }
  });
  document.getElementById('btn-next').addEventListener('click', () => {
    if (currentIndex < PLAYLIST.length - 1) { 
      currentIndex++; 
      loadSong(currentIndex); 
      if (isConductor) pushLiveSync();
    }
  });

  setupTools();
  setupSwipe();
  setupDrawing();
  migrateDrawings().then(() => PLAYLIST.length && restoreDrawing(PLAYLIST[currentIndex].id)).catch(err => console.warn('标注搬家', err));
  setupZoomAndPan();

resizeCanvas();

  await loadSetlistOptions();
  loadLocalPlaylist();
  flushRenames(db).then(() => refreshLocalTitles());
  window.addEventListener('online', () => flushRenames(db));
  // 从「这台弥撒」总览点「打开乐谱」：?setlist=1018 常年29主日 → 直接下载那份排单
  const want = new URLSearchParams(location.search).get('setlist');
  if (want && !allSetlists.some(o => o.id === want)) await addSetlist(want);   // 以前的那一份：单独读
  if (want && allSetlists.some(o => o.id === want)) {
    if (!setlistSelect.querySelector(`option[value="${CSS.escape(want)}"]`)) { showPastSetlists = true; renderSetlistOptions(); }
    setlistSelect.value = want;
    history.replaceState(null, '', location.pathname);
    if (localStorage.getItem('offline_playlist_name') !== want) syncSelectedSetlist();
  }
}

// --- 新增：推送当前页码到 Firebase ---
async function pushLiveSync() {
  const selectedId = localStorage.getItem('offline_playlist_name') || setlistSelect.value;
  if (!selectedId) return;
  try {
    await updateDoc(doc(db, "setlists", selectedId), { 
      livePageIndex: currentIndex 
    });
  } catch (error) {
    console.error("推送翻页进度失败:", error);
  }
}

// --- 新增：监听 Firebase 的页码变化 ---
function startLiveSyncListener(selectedId) {
  if (unsubscribeLiveSync) unsubscribeLiveSync(); // 清除旧的监听
  
  unsubscribeLiveSync = onSnapshot(doc(db, "setlists", selectedId), (docSnap) => {
    if (docSnap.metadata.fromCache) return;   // 手机记着的旧页码不算，等资料库的
    if (docSnap.exists()) {
      const data = docSnap.data();
      // 如果云端有页码，且和本地不同，且当前不是指挥，就自动翻页！
      if (data.livePageIndex !== undefined && data.livePageIndex !== currentIndex && !isConductor) {
        currentIndex = data.livePageIndex;
        loadSong(currentIndex);
        
        // 翻页时给个微小的视觉提示（可选）
        titleEl.classList.add('text-emerald-400');
        setTimeout(() => titleEl.classList.remove('text-emerald-400'), 1000);
      }
    }
  });
}

// 排单列表只显示今天和以后的（最近的排最前面），以前的收在最下面「看以前的排单」
let allSetlists = [];
let showPastSetlists = false;
// 排单的日期：排歌页存的 date；旧的从名称「1018 常年29主日」的月日 + 建立年份推算
function setlistDate(d) {
  if (d.date) return d.date;
  const m = String(d.name || '').match(/^(\d{2})(\d{2})(?!\d)/);
  if (!m) return null;
  const c = d.createdAt ? new Date(d.createdAt) : new Date();
  let y = c.getFullYear();
  if (Number(m[1]) < c.getMonth() + 1 - 6) y++;   // 12 月建 1 月的排单
  return `${y}-${m[1]}-${m[2]}`;
}
function renderSetlistOptions() {
  const keep = setlistSelect.value;
  const saved = localStorage.getItem('offline_playlist_name');
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  // 没有日期的：两星期内建的当作还要用
  const isPast = o => o.date ? o.date < today : (now - new Date(o.createdAt || 0)) > 14 * 864e5;
  const upcoming = allSetlists.filter(o => !isPast(o) || o.id === saved).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const past = allSetlists.filter(o => isPast(o) && o.id !== saved).sort((a, b) => (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || ''));
  const opt = (o) => `<option value="${o.id.replace(/"/g, '&quot;')}">${String(o.name || o.id).replace(/</g, '&lt;')}</option>`;
  let html = upcoming.map(opt).join('') || '<option value="">接下来还没有排单</option>';
  if (past.length || !allLoaded) html += showPastSetlists
    ? `<optgroup label="以前的排单">${past.map(opt).join('')}</optgroup>`
    : `<option value="__past">… 看以前的排单${allLoaded ? `（${past.length}）` : ''}</option>`;
  setlistSelect.innerHTML = html;
  if (keep && setlistSelect.querySelector(`option[value="${CSS.escape(keep)}"]`)) setlistSelect.value = keep;
}

// 平常只读最近两星期建的、或今天前两星期以后的排单（排单一直累积，以前每次开乐谱都整份读）；all = 连以前的也读
let allLoaded = false;
const listItem = (id, d) => ({ id, name: d.name, createdAt: d.createdAt, date: setlistDate(d) });
async function loadSetlistOptions(all) {
  try {
    const cut = new Date(Date.now() - 14 * 864e5);
    const cutDay = `${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, '0')}-${String(cut.getDate()).padStart(2, '0')}`;
    const col = collection(db, "setlists");
    const snaps = all ? [await getDocs(col)]
      : await Promise.all([getDocs(query(col, where('date', '>=', cutDay))), getDocs(query(col, where('createdAt', '>=', cut.toISOString())))]);
    const seen = new Map();
    snaps.forEach(q => q.forEach(d => seen.set(d.id, listItem(d.id, d.data()))));
    if (all) allLoaded = true;
    else allSetlists.filter(o => !seen.has(o.id)).forEach(o => seen.set(o.id, o));   // 之前单独读过的留着
    allSetlists = [...seen.values()];
    const saved = localStorage.getItem('offline_playlist_name');
    if (saved && !seen.has(saved)) allSetlists.push({ id: saved, name: saved, date: setlistDate({ name: saved }) });
    if (!allSetlists.length && allLoaded) { setlistSelect.innerHTML = '<option value="">暂无排单</option>'; return; }
    renderSetlistOptions();
  } catch (error) {
    console.error("获取排单列表失败:", error);
    setlistSelect.innerHTML = '<option value="">网络错误</option>';
  }
}
async function addSetlist(id) {
  const d = await getDoc(doc(db, "setlists", id)).catch(() => null);
  if (d?.exists()) { allSetlists.push(listItem(id, d.data())); renderSetlistOptions(); }
}

async function syncSelectedSetlist() {
  const selectedId = setlistSelect.value;
  if (!selectedId) {
    alert("请先选择一个排单！");
    return;
  }

  const label = btnSync.innerHTML;
  btnSync.textContent = '载入中…';
  btnSync.disabled = true;

  try {
    await flushRenames(db);
    const docRef = doc(db, "setlists", selectedId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      PLAYLIST = applyPending(await freshTitles(db, docSnap.data().items || []));
      
      localStorage.setItem('offline_playlist', JSON.stringify(PLAYLIST));
      localStorage.setItem('offline_playlist_name', selectedId);

      const cache = await caches.open('score-cache-v1');
      const urls = PLAYLIST.map(song => song.imageUrl);
      
      let successCount = 0;
      let failCount = 0;

      await Promise.all(urls.map(async (url) => {
        try {
          const response = await fetch(url);
          if (response.ok) {
            await cache.put(url, response);
            successCount++;
          } else {
            failCount++;
          }
        } catch (e) {
          failCount++;
        }
      }));
      
      currentIndex = 0;
      loadSong(currentIndex);
      
      // --- 新增：同步完成后，开启监听 ---
      startLiveSyncListener(selectedId);
      
      if (failCount > 0) {
        alert(`✅ 同步完成！\n成功: ${successCount} 首\n失败: ${failCount} 首 (云端无图片)\n现在可以离线查看了。`);
      } else {
        alert(`✅ 成功同步排单：【${selectedId}】！\n现在可以离线查看了。`);
      }
      
    } else {
      alert('⚠️ 找不到该排单数据。');
    }
  } catch (error) {
    console.error('Sync failed', error);
    alert('❌ 同步失败，请检查网络连接。');
  } finally {
    btnSync.innerHTML = label;
    btnSync.disabled = false;
    document.getElementById('tool-panel')?.classList.add('hidden');
  }
}

// 本地存着的排单：歌名跟曲库对一下（别的手机改过名，这里也跟上）
async function refreshLocalTitles() {
  if (!PLAYLIST?.length) return;
  try {
    const next = applyPending(await freshTitles(db, PLAYLIST));
    if (next.every((x, i) => x.title === PLAYLIST[i].title)) return;
    PLAYLIST = next;
    localStorage.setItem('offline_playlist', JSON.stringify(PLAYLIST));
    loadSong(currentIndex);
  } catch (err) { console.error('对歌名失败', err); }
}

function loadLocalPlaylist( ) {
  const savedPlaylist = localStorage.getItem('offline_playlist');
  const savedName = localStorage.getItem('offline_playlist_name');
  
  if (savedPlaylist) {
    PLAYLIST = JSON.parse(savedPlaylist);
    currentIndex = 0;
    loadSong(currentIndex);
    
    if (savedName && setlistSelect.querySelector(`option[value="${savedName}"]`)) {
      setlistSelect.value = savedName;
      // --- 新增：加载本地排单后，也开启监听 ---
      startLiveSyncListener(savedName);
    }
  } else {
    titleEl.textContent = "按右下角「排单」选一份";
  }
}

function setupTools() {
  if (colorBtns) {
    colorBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        isEraser = false;
        currentColor = btn.dataset.color;
        // 如果是高亮笔，强制用粗笔；否则保持当前选择的粗细
        if (btn.dataset.width === "20") {
          currentWidth = 20;
        } else {
          // 恢复之前选择的粗细
          const activeSizeBtn = document.querySelector('.size-btn.ring-zinc-400');
          if (activeSizeBtn) currentWidth = parseInt(activeSizeBtn.dataset.size, 10);
        }
        
        colorBtns.forEach(b => b.classList.replace('ring-white', 'ring-transparent'));
        colorBtns.forEach(b => b.classList.replace('ring-zinc-600', 'ring-transparent'));
        btn.classList.replace('ring-transparent', btn.classList.contains('bg-zinc-900') ? 'ring-zinc-600' : 'ring-white');
        if (btnEraser) btnEraser.classList.replace('ring-zinc-400', 'ring-transparent');
      });
    });
  }

  // 🌟 新增：绑定尺寸选择按钮
  const sizeBtns = document.querySelectorAll('.size-btn');
  if (sizeBtns) {
    sizeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        currentWidth = parseInt(btn.dataset.size, 10);
        sizeBtns.forEach(b => b.classList.replace('ring-zinc-400', 'ring-transparent'));
        btn.classList.replace('ring-transparent', 'ring-zinc-400');
      });
    });
  }

  if (btnEraser) {
    btnEraser.addEventListener('click', () => {
      isEraser = true;
      colorBtns.forEach(b => b.classList.replace('ring-white', 'ring-transparent'));
      colorBtns.forEach(b => b.classList.replace('ring-zinc-600', 'ring-transparent'));
      btnEraser.classList.replace('ring-transparent', 'ring-zinc-400');
    });
  }
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      if(confirm('确定要清空当前页面的所有标注吗？')) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        saveDrawing(true);
      }
    });
  }
}


function loadSong(index) {
  if (!PLAYLIST || PLAYLIST.length === 0) return;
  const song = PLAYLIST[index];
  titleEl.textContent = `${index + 1}/${PLAYLIST.length} : ${song.title}`;
  
  scale = 1; translateX = 0; translateY = 0;
  updateTransform();
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  imgEl.onload = () => { 
    resizeCanvas(); 
  };
  imgEl.src = song.imageUrl;

  // 👇 确保有这一行，每次翻页都会把新歌名写进左下角！
  if(window.showToast) window.showToast(index, song.title);
}


// --- 🌟 新增：改名/加备注（风格·拍子·Key·页码），取代画笔标注，几乎不占储存空间 ---
// 靠 song.id 认歌，不是靠标题——改名只会更新同一首歌的记录，不会变成第二首歌。
async function renameCurrentSong() {
  // 🌟 防呆：按钮平时是隐藏的，但多一层判断，避免任何情况下被误触发
  if (!isConductor) {
    alert('🔒 请先开启「指挥模式」才能修改歌名/备注，避免大家不小心按到改坏。');
    return;
  }
  if (!PLAYLIST || PLAYLIST.length === 0) return;
  const song = PLAYLIST[currentIndex];

  const newTitle = prompt('✏️ 修改歌名／加备注（风格、拍子、Key、页码都可以直接写在这）：', song.title);
  if (newTitle === null) return; // 按了取消
  const trimmed = newTitle.trim();
  if (!trimmed || trimmed === song.title) return;

  // 🌟 二次确认，防手滑
  if (!confirm(`确定要把歌名改成：\n\n「${trimmed}」\n\n吗？`)) return;

  const oldTitle = song.title;
  song.title = trimmed; // 本地立刻生效

  titleEl.textContent = `${currentIndex + 1}/${PLAYLIST.length} : ${song.title}`;
  if (window.showToast) window.showToast(currentIndex, song.title);

  // 更新离线缓存，就算不联网/直接refresh，改的名字也不会丢
  localStorage.setItem('offline_playlist', JSON.stringify(PLAYLIST));

  // 先记在这部手机「还没送出去」，送成功才拿掉——没网络、按 Sync、关掉 app 都不会丢
  // 只改手上这份排单里的这一首（不是下拉框选着的那份，也不会把整份排单盖回去）
  queueRename({
    id: song.id, imageUrl: song.imageUrl, oldTitle, newTitle: trimmed,
    where: '乐谱指挥模式', setlistId: localStorage.getItem('offline_playlist_name') || '',
  });
  const left = await flushRenames(db);
  if (left) alert(`⚠️ 这部手机已经改好了，但还没送到云端（网络不好）。\n有网络时会自动补送，不用重改。\n(${oldTitle} → ${song.title})`);
}


// --- 控制左下角提示框的内容更新 ---
window.showToast = function(index, title) {
  const toastNum = document.getElementById('toast-number');
  const toastTitle = document.getElementById('toast-title');
  if (!toastNum || !toastTitle) return;

  // 只负责更新文字，显示/隐藏完全交给 index.html 里的点击事件控制
  toastNum.textContent = `TRACK ${index + 1} / ${PLAYLIST.length}`;
  toastTitle.textContent = title;
};


function toggleDrawMode() {
  isDrawingMode = !isDrawingMode;
  if (isDrawingMode) {
    resizeCanvas(); // 每次开启时重新获取尺寸

    btnDraw.classList.replace('bg-zinc-800/90', 'bg-red-600');
    if (drawStatus) drawStatus.textContent = '画好了';

    canvas.classList.remove('pointer-events-none');
    canvas.classList.add('pointer-events-auto');
    drawTools.classList.remove('hidden');
    drawTools.classList.add('flex');

    // 🌟 修复：开始标注时，把左下角的曲名提示收起来，避免挡住画板
    const toast = document.getElementById('toast-notification');
    if (toast) toast.classList.add('translate-y-4', 'opacity-0');
  } else {
    btnDraw.classList.replace('bg-red-600', 'bg-zinc-800/90');
    if (drawStatus) drawStatus.textContent = '标注';
    
    canvas.classList.remove('pointer-events-auto');
    canvas.classList.add('pointer-events-none');
    drawTools.classList.add('hidden');
    drawTools.classList.remove('flex');
  }
}


function resizeCanvas() {
  // 🌟 核心修复：画板的物理分辨率永远等于图片的真实分辨率
  if (imgEl && imgEl.naturalWidth) {
    canvas.width = imgEl.naturalWidth;
    canvas.height = imgEl.naturalHeight;
  } else {
    canvas.width = slideContainer.clientWidth;
    canvas.height = slideContainer.clientHeight;
  }
  
  if (PLAYLIST.length > 0) {
    restoreDrawing(PLAYLIST[currentIndex].id);
  }
}


function setupDrawing() {
  if (!canvas) return;
  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('mouseout', stopDrawing);

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      e.preventDefault();
      startDrawing(e.touches[0]);
    }
  }, { passive: false });
  
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) {
      e.preventDefault();
      draw(e.touches[0]);
    }
  }, { passive: false });
  
  canvas.addEventListener('touchend', stopDrawing);
}

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  // 🌟 终极数学公式：无论怎么全屏、怎么双指放大，这个公式都能算出绝对精准的笔迹坐标！
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height)
  };
}



function startDrawing(e) {
  if (!isDrawingMode) return;
  isDrawing = true;
  const pos = getPos(e);
  lastX = pos.x; lastY = pos.y;
}

function draw(e) {
  if (!isDrawing || !isDrawingMode) return;
  const pos = getPos(e);
  
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(pos.x, pos.y);
  
  if (isEraser) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    // 🌟 修复：去掉 / scale，让橡皮擦大小保持绝对物理尺寸
    ctx.lineWidth = 40; 
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = currentColor;
    // 🌟 核心修复：去掉 / scale！
    // 这样你在放大时写字，画笔在画布上依然是粗的，缩小后字迹清晰可见！
    ctx.lineWidth = currentWidth; 
  }
  
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  
  lastX = pos.x; lastY = pos.y;
}




function stopDrawing() {
  if (!isDrawing) return;
  isDrawing = false;
  saveDrawing();
}

// 标注存在 IndexedDB（drawings.js）：空间大很多，不会再「储存空间已满」
// 每一笔画完存一次；同一首歌连续画，只存最后那一版（免得慢的那次盖掉新的）
const saveSeq = {};
function saveDrawing(cleared) {
  if (!PLAYLIST || PLAYLIST.length === 0) return;
  const id = PLAYLIST[currentIndex].id;
  const n = saveSeq[id] = (saveSeq[id] || 0) + 1;
  const fail = error => {
    console.error('保存标注失败:', error);
    alert('⚠️ 刚才这笔标注没能保存下来。\n再画一笔试试；还是不行就跟 Ronald 说。');
  };
  if (cleared) return delDrawing(id).catch(fail);
  // 标注不需要跟原图一样的超高分辨率：最长边压到 1400px 再存
  const MAX_SAVE_DIM = 1400;
  let sourceCanvas = canvas;
  if (canvas.width > MAX_SAVE_DIM || canvas.height > MAX_SAVE_DIM) {
    const ratio = Math.min(MAX_SAVE_DIM / canvas.width, MAX_SAVE_DIM / canvas.height);
    const scaled = document.createElement('canvas');
    scaled.width = Math.round(canvas.width * ratio);
    scaled.height = Math.round(canvas.height * ratio);
    scaled.getContext('2d').drawImage(canvas, 0, 0, scaled.width, scaled.height);
    sourceCanvas = scaled;
  }
  sourceCanvas.toBlob(blob => {
    if (saveSeq[id] !== n) return;
    if (!blob) return fail(new Error('转不成图片'));
    putDrawing(id, blob).catch(fail);
  }, 'image/png');
}

// 读回来：旧的是 dataURL 字串，新的是 Blob；读回来时已经换歌了就不画
async function restoreDrawing(songId) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  let v;
  try { v = await getDrawing(songId); } catch (err) { console.warn('读不到标注', err); return; }
  if (!v || PLAYLIST[currentIndex]?.id !== songId) return;
  const url = typeof v === 'string' ? v : URL.createObjectURL(v);
  const img = new Image();
  img.onload = () => {
    if (typeof v !== 'string') URL.revokeObjectURL(url);
    if (PLAYLIST[currentIndex]?.id !== songId) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    // 保存的笔迹拉伸贴合当前的画板尺寸，不走位
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };
  img.src = url;
}


function setupSwipe() {
  let touchStartX = 0;
  let touchEndX = 0;
  let isMultiTouch = false;
  let isValidSwipeStart = false;

  if (!slideContainer) return;

  slideContainer.addEventListener('touchstart', e => {
    if (isDrawingMode) return;
    // 🌟 如果是双指(缩放)，立刻标记为多指操作，禁止翻页
    if (e.touches.length > 1) {
      isMultiTouch = true;
      isValidSwipeStart = false;
      return;
    }
    // 只有在未放大时才允许翻页
    if (scale > 1) return; 
    
    isMultiTouch = false;
    isValidSwipeStart = true;
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  slideContainer.addEventListener('touchmove', e => {
    // 滑动过程中如果加入了第二根手指，立刻取消翻页资格
    if (e.touches.length > 1) {
      isMultiTouch = true;
      isValidSwipeStart = false;
    }
  }, { passive: true });

  slideContainer.addEventListener('touchend', e => {
    // 如果是画画模式、放大状态、或者是多指缩放刚结束，绝对不触发翻页！
    if (isDrawingMode || scale > 1 || isMultiTouch || !isValidSwipeStart) {
      isMultiTouch = false; 
      return;
    }
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
  }, { passive: true });

  function handleSwipe() {
    const swipeThreshold = 80; // 🌟 调大了滑动阈值，必须明确滑动才会翻页
    if (touchEndX < touchStartX - swipeThreshold) {
      if (currentIndex < PLAYLIST.length - 1) { 
        currentIndex++; 
        loadSong(currentIndex); 
        if (isConductor) pushLiveSync(); 
      }
    }
    if (touchEndX > touchStartX + swipeThreshold) {
      if (currentIndex > 0) { 
        currentIndex--; 
        loadSong(currentIndex); 
        if (isConductor) pushLiveSync(); 
      }
    }
  }
}


function setupZoomAndPan() {
  const container = document.getElementById('zoom-wrapper');
  if (!container) return; 

  // 电脑端鼠标滚轮缩放
  container.addEventListener('wheel', (e) => {
    if (isDrawingMode) return;
    e.preventDefault();
    const zoomSensitivity = 0.001;
    const delta = e.deltaY * -zoomSensitivity;
    // 🌟 允许缩小到 0.6 倍
    const newScale = Math.min(Math.max(0.6, scale + delta), 5);
    
    if (newScale !== scale) {
      const rect = slideContainer.getBoundingClientRect();
      const offsetX = e.clientX - (rect.left + rect.width / 2);
      const offsetY = e.clientY - (rect.top + rect.height / 2);
      const ratio = newScale / scale;
      
      translateX -= offsetX * (ratio - 1);
      translateY -= offsetY * (ratio - 1);
      scale = newScale;
      checkBounds();
      updateTransform();
    }
  }, { passive: false });

  container.addEventListener('mousedown', (e) => {
    if (isDrawingMode || scale === 1) return;
    isDragging = true;
    startX = e.clientX - translateX;
    startY = e.clientY - translateY;
    container.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    translateX = e.clientX - startX;
    translateY = e.clientY - startY;
    checkBounds();
    updateTransform();
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    if(container) container.style.cursor = scale > 1 ? 'grab' : 'default';
  });

  // 手机端双指缩放与单指拖拽
  container.addEventListener('touchstart', (e) => {
    if (isDrawingMode) return;
    if (e.touches.length === 2) {
      e.preventDefault();
      initialDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    } else if (e.touches.length === 1 && scale > 1) {
      isDragging = true;
      startX = e.touches[0].clientX - translateX;
      startY = e.touches[0].clientY - translateY;
    }
  }, { passive: false });

  container.addEventListener('touchmove', (e) => {
    if (isDrawingMode) return;
    if (e.touches.length === 2 && initialDistance) {
      e.preventDefault();
      const currentDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const delta = currentDistance / initialDistance;
      // 🌟 允许缩小到 0.6 倍
      const newScale = Math.min(Math.max(0.6, scale * delta), 5);
      
      if (newScale !== scale) {
        const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect = slideContainer.getBoundingClientRect();
        const offsetX = centerX - (rect.left + rect.width / 2);
        const offsetY = centerY - (rect.top + rect.height / 2);
        const ratio = newScale / scale;

        translateX -= offsetX * (ratio - 1);
        translateY -= offsetY * (ratio - 1);
        scale = newScale;
        initialDistance = currentDistance;
        checkBounds();
        updateTransform();
      }
    } else if (e.touches.length === 1 && isDragging) {
      e.preventDefault();
      translateX = e.touches[0].clientX - startX;
      translateY = e.touches[0].clientY - startY;
      checkBounds();
      updateTransform();
    }
  }, { passive: false });

  container.addEventListener('touchend', () => {
    initialDistance = null;
    isDragging = false;
  });
}

function checkBounds() {
  const rect = slideContainer.getBoundingClientRect();
  let boundX = 0;
  let boundY = 0;
  
  // 🌟 核心修复：只有当放大(scale > 1)时，才允许拖拽偏移
  // 如果是缩小(scale <= 1)，boundX 和 boundY 强制为 0，图片会自动吸附到正中心！
  if (scale > 1) {
    boundX = (rect.width * (scale - 1)) / 2;
    boundY = (rect.height * (scale - 1)) / 2;
  }
  
  translateX = Math.max(-boundX, Math.min(boundX, translateX));
  translateY = Math.max(-boundY, Math.min(boundY, translateY));
}



function updateTransform() {
  const container = document.getElementById('zoom-wrapper');
  if (!container) return; 
  container.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  container.style.cursor = scale > 1 && !isDrawingMode ? 'grab' : 'default';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
function openSongList() {
  if (!PLAYLIST || PLAYLIST.length === 0) return;
  const container = document.getElementById('song-list-container');
  container.innerHTML = '';
  PLAYLIST.forEach((song, idx) => {
    const div = document.createElement('div');
    div.className = `p-3 rounded-xl text-sm font-medium flex items-center gap-3 transition-colors cursor-pointer ${idx === currentIndex ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-300 hover:bg-zinc-800'}`;
    div.innerHTML = `<span class="w-6 text-center opacity-70">${idx + 1}</span> <span class="flex-1 truncate">${song.title}</span>`;
    div.onclick = () => {
      currentIndex = idx;
      loadSong(currentIndex);
      if (isConductor) pushLiveSync();
      closeSongList();
    };
    container.appendChild(div);
  });
  
  const modal = document.getElementById('song-list-modal');
  const content = document.getElementById('song-list-content');
  modal.classList.remove('hidden');
  void modal.offsetWidth; // 触发重绘
  modal.classList.remove('opacity-0');
  content.classList.remove('translate-y-full', 'md:scale-95');
}

function closeSongList() {
  const modal = document.getElementById('song-list-modal');
  const content = document.getElementById('song-list-content');
  modal.classList.add('opacity-0');
  content.classList.add('translate-y-full', 'md:scale-95');
  setTimeout(() => modal.classList.add('hidden'), 300);
}
