// 1. 引入新增了 updateDoc 和 onSnapshot
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD77WKlfYpUS1MJKu5J_xdV3adMZc5-c8U",
  authDomain: "sicmchoir-yueyun.firebaseapp.com",
  projectId: "sicmchoir-yueyun",
  storageBucket: "sicmchoir-yueyun.firebasestorage.app",
  messagingSenderId: "55940456186",
  appId: "1:55940456186:web:3a4a78dfb8c430f3963343"
};

const app = initializeApp(firebaseConfig );
const db = getFirestore(app);

let PLAYLIST = [];
let currentIndex = 0;
let isDrawingMode = false;

// --- 新增：Live Sync 状态 ---
let isConductor = false;
let unsubscribeLiveSync = null;

// DOM Elements
let titleEl, imgEl, btnDraw, drawStatus, drawTools, colorBtns, btnEraser, btnClear, btnSync, canvas, ctx, slideContainer, setlistSelect, btnConductor;

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
  const btnSongList = document.getElementById('btn-song-list');
  const btnCloseSongList = document.getElementById('btn-close-song-list');
  if (btnSongList) btnSongList.addEventListener('click', openSongList);
  if (btnCloseSongList) btnCloseSongList.addEventListener('click', closeSongList);

  
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
    btnConductor.addEventListener('click', () => {
      // 如果当前是关闭状态，准备开启，则需要验证密码
      if (!isConductor) {
        const pwd = prompt("🔒 请输入指挥专属密码：");
        
        // 如果点击了取消，或者密码不是 1234，就拒绝开启
        if (pwd !== "sic") {
          if (pwd !== null) alert("❌ 密码错误，无法开启指挥模式！");
          return; // 直接退出，不执行后面的开启逻辑
        }
      }

      // 密码正确（或准备关闭），切换状态
      isConductor = !isConductor;
      if (isConductor) {
        btnConductor.classList.replace('text-zinc-400', 'text-yellow-400');
        btnConductor.classList.add('ring-2', 'ring-yellow-500/50');
        alert("👨‍🏫 指挥模式已开启！\n现在你的翻页动作将实时同步给所有团员。");
        pushLiveSync(); 
      } else {
        btnConductor.classList.replace('text-yellow-400', 'text-zinc-400');
        btnConductor.classList.remove('ring-2', 'ring-yellow-500/50');
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
  setupZoomAndPan();

resizeCanvas();

  await loadSetlistOptions();
  loadLocalPlaylist();
}

// --- 新增：推送当前页码到 Firebase ---
async function pushLiveSync() {
  const selectedId = setlistSelect.value || localStorage.getItem('offline_playlist_name');
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

async function loadSetlistOptions() {
  try {
    const querySnapshot = await getDocs(collection(db, "setlists"));
    setlistSelect.innerHTML = '';
    
    if (querySnapshot.empty) {
      setlistSelect.innerHTML = '<option value="">暂无排单</option>';
      return;
    }

    let options = [];
    querySnapshot.forEach((doc) => {
      options.push({ id: doc.id, name: doc.data().name, createdAt: doc.data().createdAt });
    });

    options.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    options.forEach(opt => {
      const optionEl = document.createElement('option');
      optionEl.value = opt.id;
      optionEl.textContent = opt.name;
      setlistSelect.appendChild(optionEl);
    });

  } catch (error) {
    console.error("获取排单列表失败:", error);
    setlistSelect.innerHTML = '<option value="">网络错误</option>';
  }
}

async function syncSelectedSetlist() {
  const selectedId = setlistSelect.value;
  if (!selectedId) {
    alert("请先选择一个排单！");
    return;
  }

  const icon = btnSync.querySelector('svg');
  if (icon) icon.style.opacity = '0.5';
  btnSync.textContent = 'Syncing...';
  btnSync.disabled = true;

  try {
    const docRef = doc(db, "setlists", selectedId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      PLAYLIST = docSnap.data().items;
      
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
    if (icon) icon.style.opacity = '1';
    btnSync.innerHTML = `<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg> Sync`;
    btnSync.disabled = false;
  }
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
    titleEl.textContent = "请选择排单并点击 Sync";
  }
}

function setupTools() {
  if (colorBtns) {
    colorBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        isEraser = false;
        currentColor = btn.dataset.color;
        currentWidth = parseInt(btn.dataset.width, 10);
        colorBtns.forEach(b => b.classList.replace('ring-slate-800', 'ring-transparent'));
        btn.classList.replace('ring-transparent', 'ring-slate-800');
        if (btnEraser) btnEraser.classList.replace('ring-slate-800', 'ring-transparent');
      });
    });
  }
  if (btnEraser) {
    btnEraser.addEventListener('click', () => {
      isEraser = true;
      if (colorBtns) colorBtns.forEach(b => b.classList.replace('ring-slate-800', 'ring-transparent'));
      btnEraser.classList.replace('ring-transparent', 'ring-slate-800');
    });
  }
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      if(confirm('确定要清空当前页面的所有标注吗？')) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        saveDrawing();
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
  
  // 🌟 核心修复：图片加载完成后，强制同步画板尺寸
  imgEl.onload = () => { 
    resizeCanvas(); 
  };
  imgEl.src = song.imageUrl;

  if(window.showToast) window.showToast(index, song.title);
}


// --- 控制左下角提示框的动画 ---
let toastTimeout = null;
window.showToast = function(index, title) {
  const toast = document.getElementById('toast-notification');
  const toastNum = document.getElementById('toast-number');
  const toastTitle = document.getElementById('toast-title');
  if (!toast) return;

  toastNum.textContent = `TRACK ${index + 1} / ${PLAYLIST.length}`;
  toastTitle.textContent = title;

  // 弹出动画
  toast.classList.remove('translate-y-4', 'opacity-0');
  
  // 2.5秒后自动淡出
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.add('translate-y-4', 'opacity-0');
  }, 2500);
};



function toggleDrawMode() {
  isDrawingMode = !isDrawingMode;
  if (isDrawingMode) {
    resizeCanvas(); // 每次开启时重新获取尺寸
    
    btnDraw.classList.add('ring-2', 'ring-red-500', 'bg-slate-50');
    if (drawStatus) drawStatus.textContent = 'On';
    
    canvas.classList.remove('pointer-events-none');
    canvas.classList.add('pointer-events-auto');
    drawTools.classList.remove('hidden');
    drawTools.classList.add('flex');
  } else {
    btnDraw.classList.remove('ring-2', 'ring-red-500', 'bg-slate-50');
    if (drawStatus) drawStatus.textContent = 'Off';
    
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
    ctx.lineWidth = 30 / scale;
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentWidth / scale;
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

function saveDrawing() {
  if (!PLAYLIST || PLAYLIST.length === 0) return;
  const song = PLAYLIST[currentIndex];
  const dataURL = canvas.toDataURL('image/png');
  localStorage.setItem(`drawing_${song.id}`, dataURL);
}

function restoreDrawing(songId) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const dataURL = localStorage.getItem(`drawing_${songId}`);
  if (dataURL) {
    const img = new Image();
    img.src = dataURL;
    img.onload = () => {
      ctx.globalCompositeOperation = 'source-over';
      // 🌟 核心修复：强制让保存的笔迹拉伸贴合当前的画板尺寸，绝对不再走位！
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
  }
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
