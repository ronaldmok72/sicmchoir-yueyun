// 测验页面共用的 Firebase 连接（跟 app.js 同一个项目）
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD77WKlfYpUS1MJKu5J_xdV3adMZc5-c8U",
  authDomain: "sicmchoir-yueyun.firebaseapp.com",
  projectId: "sicmchoir-yueyun",
  storageBucket: "sicmchoir-yueyun.firebasestorage.app",
  messagingSenderId: "55940456186",
  appId: "1:55940456186:web:3a4a78dfb8c430f3963343"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const RESULTS = 'quiz_results';
