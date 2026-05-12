import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

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

// DOM Elements
let titleEl, imgEl, btnDraw, drawStatus, drawTools, colorBtns, btnEraser, btnClear, btnSync, canvas, ctx, slideContainer, setlistSelect;

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

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => console.error(err));
  }

  window.addEventListener('resize', resizeCanvas);
  
  if (btnDraw) btnDraw.addEventListener('click', toggleDrawMode);
  if (btnSync) btnSync.addEventListener('click', syncSelectedSetlist);
  
  document.getElementById('btn-prev').addEventListener('click', () => {
    if (currentIndex > 0) { currentIndex--; loadSong(currentIndex); }
  });
  document.getElementById('btn-next').addEventListener('click', () => {
    if (currentIndex < PLAYLIST.length - 1) { currentIndex++; loadSong(currentIndex); }
  });

  setupTools();
  setupSwipe();
  setupDrawing();
  setupZoomAndPan();

  // 启动时：1. 加载下拉菜单 2. 尝试从本地缓存恢复上次的排单
  await loadSetlistOptions();
  loadLocalPlaylist();
}

// --- 1. 加载云端排单列表到下拉菜单 ---
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

    // 按时间倒序
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

// --- 2. 同步选中的排单 (百毒不侵版) ---
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
    // 从 Firebase 获取选中的排单详情
    const docRef = doc(db, "setlists", selectedId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      PLAYLIST = docSnap.data().items;
      
      // 保存到本地 LocalStorage，以便离线时读取
      localStorage.setItem('offline_playlist', JSON.stringify(PLAYLIST));
      localStorage.setItem('offline_playlist_name', selectedId);

      // 缓存图片 (百毒不侵的逐个缓存法)
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
            console.warn('⚠️ 图片找不到，跳过缓存:', url);
            failCount++;
          }
        } catch (e) {
          console.warn('⚠️ 图片获取失败，跳过:', url);
          failCount++;
        }
      }));
      
      currentIndex = 0;
      loadSong(currentIndex);
      
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

// --- 3. 离线时加载本地排单 ---
function loadLocalPlaylist( ) {
  const savedPlaylist = localStorage.getItem('offline_playlist');
  const savedName = localStorage.getItem('offline_playlist_name');
  
  if (savedPlaylist) {
    PLAYLIST = JSON.parse(savedPlaylist);
    currentIndex = 0;
    loadSong(currentIndex);
    
    // 如果下拉菜单里有这个选项，就自动选中它
    if (savedName && setlistSelect.querySelector(`option[value="${savedName}"]`)) {
      setlistSelect.value = savedName;
    }
  } else {
    titleEl.textContent = "请选择排单并点击 Sync";
  }
}

// --- 以下是原有的画笔、缩放、翻页逻辑（保持不变） ---

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
  
  imgEl.onload = () => { restoreDrawing(song.id); };
  imgEl.src = song.imageUrl;
}

function toggleDrawMode() {
  isDrawingMode = !isDrawingMode;
  if (isDrawingMode) {
    btnDraw.classList.add('ring-2', 'ring-red-500', 'bg-slate-50');
    drawStatus.textContent = 'On';
    canvas.classList.remove('pointer-events-none');
    canvas.classList.add('pointer-events-auto');
    drawTools.classList.remove('hidden');
    drawTools.classList.add('flex');
  } else {
    btnDraw.classList.remove('ring-2', 'ring-red-500', 'bg-slate-50');
    drawStatus.textContent = 'Off';
    canvas.classList.remove('pointer-events-auto');
    canvas.classList.add('pointer-events-none');
    drawTools.classList.add('hidden');
    drawTools.classList.remove('flex');
  }
}

function resizeCanvas() {
  canvas.width = slideContainer.clientWidth;
  canvas.height = slideContainer.clientHeight;
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
  const rawX = e.clientX - rect.left;
  const rawY = e.clientY - rect.top;
  return {
    x: (rawX - translateX) / scale,
    y: (rawY - translateY) / scale
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
      ctx.drawImage(img, 0, 0);
    };
  }
}

function setupSwipe() {
  let touchStartX = 0;
  let touchEndX = 0;
  if (!slideContainer) return;

  slideContainer.addEventListener('touchstart', e => {
    if (isDrawingMode || scale > 1) return;
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  slideContainer.addEventListener('touchend', e => {
    if (isDrawingMode || scale > 1) return;
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
  }, { passive: true });

  function handleSwipe() {
    const swipeThreshold = 50;
    if (touchEndX < touchStartX - swipeThreshold) {
      if (currentIndex < PLAYLIST.length - 1) { currentIndex++; loadSong(currentIndex); }
    }
    if (touchEndX > touchStartX + swipeThreshold) {
      if (currentIndex > 0) { currentIndex--; loadSong(currentIndex); }
    }
  }
}

function setupZoomAndPan() {
  const container = document.getElementById('zoom-wrapper');
  
  // 🚨 救命代码：如果找不到缩放区域，就安全退出，绝对不报错！
  if (!container) return; 

  container.addEventListener('wheel', (e) => {
    if (isDrawingMode) return;
    e.preventDefault();
    const zoomSensitivity = 0.001;
    const delta = e.deltaY * -zoomSensitivity;
    const newScale = Math.min(Math.max(1, scale + delta), 5);
    
    if (newScale !== scale) {
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      translateX = mouseX - (mouseX - translateX) * (newScale / scale);
      translateY = mouseY - (mouseY - translateY) * (newScale / scale);
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
      const newScale = Math.min(Math.max(1, scale * delta), 5);
      
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const rect = container.getBoundingClientRect();
      const touchX = centerX - rect.left;
      const touchY = centerY - rect.top;

      translateX = touchX - (touchX - translateX) * (newScale / scale);
      translateY = touchY - (touchY - translateY) * (newScale / scale);
      scale = newScale;
      initialDistance = currentDistance;
      checkBounds();
      updateTransform();
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
  if (scale === 1) {
    translateX = 0; translateY = 0; return;
  }
  const rect = slideContainer.getBoundingClientRect();
  const maxTx = 0;
  const minTx = rect.width * (1 - scale);
  const maxTy = 0;
  const minTy = rect.height * (1 - scale);
  
  translateX = Math.max(minTx, Math.min(maxTx, translateX));
  translateY = Math.max(minTy, Math.min(maxTy, translateY));
}

function updateTransform() {
  const container = document.getElementById('zoom-wrapper');
  
  // 🚨 救命代码：如果找不到缩放区域，直接退出，绝对不报错！
  if (!container) return; 
  
  container.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  container.style.cursor = scale > 1 && !isDrawingMode ? 'grab' : 'default';
}


if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
