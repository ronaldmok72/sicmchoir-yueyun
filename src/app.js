import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

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

let PLAYLIST = JSON.parse(localStorage.getItem('offline_playlist')) || [];
let currentIndex = 0;
let isDrawingMode = false;

let titleEl, imgEl, btnDraw, drawStatus, drawTools, colorBtns, btnEraser, btnClear, btnSync, canvas, ctx, slideContainer;
let isDrawing = false, lastX = 0, lastY = 0, currentColor = 'rgba(239, 68, 68, 0.8)', currentWidth = 4, isEraser = false;

function init() {
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

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => console.error(err));
  }

  window.addEventListener('resize', resizeCanvas);
  
  if (PLAYLIST.length > 0) {
    loadSong(currentIndex);
  } else {
    titleEl.textContent = "请点击右上角 Sync 获取本周排单";
  }
  
  if (btnDraw) btnDraw.addEventListener('click', toggleDrawMode);
  if (btnSync) btnSync.addEventListener('click', syncScores);
  
  document.getElementById('btn-prev').addEventListener('click', () => {
    if (currentIndex > 0) { currentIndex--; loadSong(currentIndex); }
  });
  document.getElementById('btn-next').addEventListener('click', () => {
    if (currentIndex < PLAYLIST.length - 1) { currentIndex++; loadSong(currentIndex); }
  });

  setupTools();
  setupSwipe();
  setupDrawing();
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

// 修复后的 loadSong (只保留这一个)
function loadSong(index) {
  if (PLAYLIST.length === 0) return;
  const song = PLAYLIST[index];
  titleEl.textContent = song.title;
  
  // 清空旧画布
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  imgEl.onload = () => {
    resizeCanvas(); // 图片加载完后，立刻让画板对齐图片尺寸
    restoreDrawing(song.id);
  };
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
    // 开启画笔时，锁定屏幕滑动，防止画画时页面乱跑
    slideContainer.style.overflow = 'hidden';
    slideContainer.style.touchAction = 'none';
  } else {
    btnDraw.classList.remove('ring-2', 'ring-red-500', 'bg-slate-50');
    drawStatus.textContent = 'Off';
    canvas.classList.remove('pointer-events-auto');
    canvas.classList.add('pointer-events-none');
    drawTools.classList.add('hidden');
    drawTools.classList.remove('flex');
    // 关闭画笔时，恢复页面的上下滑动和双指缩放
    slideContainer.style.overflow = 'auto';
    slideContainer.style.touchAction = 'auto';
  }
}

// 修复后的 resizeCanvas
function resizeCanvas() {
  if (imgEl && imgEl.clientWidth > 0) {
    canvas.width = imgEl.clientWidth;
    canvas.height = imgEl.clientHeight;
    if (PLAYLIST[currentIndex]) restoreDrawing(PLAYLIST[currentIndex].id);
  }
}

function setupDrawing() {
  if (!canvas) return;
  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('mouseout', stopDrawing);
  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); if (e.touches.length > 0) startDrawing(e.touches[0]); }, { passive: false });
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); if (e.touches.length > 0) draw(e.touches[0]); }, { passive: false });
  canvas.addEventListener('touchend', stopDrawing);
}

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  // 适配不同屏幕的缩放比例
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return { 
    x: (e.clientX - rect.left) * scaleX, 
    y: (e.clientY - rect.top) * scaleY 
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
    ctx.lineWidth = 30;
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentWidth;
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.stroke();
  lastX = pos.x; lastY = pos.y;
}

function stopDrawing() {
  if (!isDrawing) return;
  isDrawing = false;
  saveDrawing();
}

function saveDrawing() {
  if (PLAYLIST.length === 0) return;
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
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
  }
}

function setupSwipe() {
  let touchStartX = 0, touchEndX = 0;
  if (!slideContainer) return;
  slideContainer.addEventListener('touchstart', e => { if (!isDrawingMode) touchStartX = e.changedTouches[0].screenX; }, { passive: true });
  slideContainer.addEventListener('touchend', e => {
    if (!isDrawingMode) { touchEndX = e.changedTouches[0].screenX; handleSwipe(); }
  }, { passive: true });

  function handleSwipe() {
    const swipeThreshold = 50;
    if (touchEndX < touchStartX - swipeThreshold && currentIndex < PLAYLIST.length - 1) {
      currentIndex++; loadSong(currentIndex);
    }
    if (touchEndX > touchStartX + swipeThreshold && currentIndex > 0) {
      currentIndex--; loadSong(currentIndex);
    }
  }
}

async function syncScores() {
  btnSync.textContent = 'Syncing...';
  btnSync.disabled = true;
  try {
    const docRef = doc(db, "setlists", "latest");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      PLAYLIST = docSnap.data().items;
      localStorage.setItem('offline_playlist', JSON.stringify(PLAYLIST));
      
      const cache = await caches.open('score-cache-v1');
      const urls = PLAYLIST.map(song => song.imageUrl);
      
      // 【升级】：一张一张缓存，坏了一张不影响其他图片！
      await Promise.all(urls.map(async (url) => {
        try {
          const response = await fetch(url);
          if (response.ok) {
            await cache.put(url, response);
          } else {
            console.warn('这张图片链接失效，跳过缓存:', url);
          }
        } catch (e) {
          console.warn('网络错误，跳过缓存:', url);
        }
      }));
      
      currentIndex = 0;
      loadSong(currentIndex);
      alert('✅ 同步成功！最新排单已下载，可离线查看。');
    } else {
      alert('⚠️ 云端目前没有排单数据，请指挥先在后台发布。');
    }
  } catch (error) {
    console.error('Sync failed', error);
    alert('❌ 同步失败，请检查网络连接。');
  } finally {
    btnSync.innerHTML = `<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg> Sync`;
    btnSync.disabled = false;
  }
}


if (document.readyState === 'loading' ) {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
