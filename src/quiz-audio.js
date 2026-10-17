// 听拍子小测：用 WebAudio 自己合成钢琴声，拍子由电脑算准。
// 所有时间都用 AudioContext 的时钟（秒），按键时也读同一个时钟，比较才准。

let ctx = null;
let master = null;

export function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
  }
  return ctx;
}

// iPhone 常会把声音"暂停"（锁屏、来电、切出去、或第二次播放），
// 所以每次按按钮都要叫一次，而且一定要在按下去的那一刻叫。
export async function unlock() {
  // iOS 17+：就算侧边静音键打开，也照样出声
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  if (ctx && ctx.state === 'closed') ctx = null;
  let c = getCtx();
  // 在按下去的当下放一下无声，iPhone 才肯开喇叭
  try {
    const s = c.createBufferSource();
    s.buffer = c.createBuffer(1, 1, 22050);
    s.connect(c.destination);
    s.start(0);
  } catch (e) {}
  if (c.state !== 'running') { try { await c.resume(); } catch (e) {} }
  // 还是不动（iPhone 的 interrupted 状态）→ 整个重开一个
  if (c.state !== 'running') {
    try { await c.close(); } catch (e) {}
    ctx = null;
    c = getCtx();
    try { await c.resume(); } catch (e) {}
  }
  return c;
}
export const isRunning = () => !!ctx && ctx.state === 'running';

export const now = () => getCtx().currentTime;

const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

// 简单的"钢琴"：几个泛音 + 快起音 + 指数衰减
function note(midi, t, dur = 1.2, vel = 0.5) {
  const c = getCtx();
  const f = midiHz(midi);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel, t + 0.008);
  g.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(master);
  [[1, 1], [2, 0.35], [3, 0.12]].forEach(([h, a]) => {
    const o = c.createOscillator();
    o.type = h === 1 ? 'triangle' : 'sine';
    o.frequency.value = f * h;
    const og = c.createGain();
    og.gain.value = a;
    o.connect(og).connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
  });
}

// 校正用的"哒"
export function click(t, accent = false) {
  const c = getCtx();
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.value = accent ? 1500 : 1000;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.8, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 0.08);
}

// 和弦进行（C 大调）：I – vi – IV – V
const PROG = [
  { bass: 48, chord: [60, 64, 67] }, // C
  { bass: 45, chord: [57, 60, 64] }, // Am
  { bass: 41, chord: [57, 60, 65] }, // F
  { bass: 43, chord: [55, 59, 62] }, // G
];
const MELODY4 = [72, 71, 69, 67]; // 每小节第一拍上面加一个旋律音，让"第一拍"更明显

// 排一段伴奏：beatsPerBar 拍一小节，bars 小节，从 t0 开始。返回每一拍的时间。
export function playBars({ t0, bpm, beatsPerBar, bars, style = 'normal' }) {
  const spb = 60 / bpm;
  const beats = [];
  for (let b = 0; b < bars; b++) {
    const ch = PROG[b % PROG.length];
    for (let k = 0; k < beatsPerBar; k++) {
      const t = t0 + (b * beatsPerBar + k) * spb;
      beats.push(t);
      if (style === 'slow') {
        // 慢歌：第一拍低音＋整个和弦，第三拍再弹一次和弦（琶音一点点）
        if (k === 0) {
          note(ch.bass, t, spb * beatsPerBar, 0.55);
          ch.chord.forEach((m, i) => note(m, t + i * 0.03, spb * 2.2, 0.28));
          note(MELODY4[b % 4], t, spb * 2, 0.3);
        } else if (k === 2) {
          ch.chord.forEach((m, i) => note(m, t + i * 0.03, spb * 1.8, 0.2));
        }
      } else if (k === 0) {
        note(ch.bass, t, spb * 1.5, 0.6);
        note(MELODY4[b % 4], t, spb * 1.2, 0.32);
      } else {
        // 4 拍：第 3 拍低音再来一次（"咚 恰 咚 恰"）；3 拍：咚 恰 恰
        if (beatsPerBar === 4 && k === 2) note(ch.bass + 7, t, spb * 1.2, 0.4);
        ch.chord.forEach(m => note(m, t, spb * 0.9, 0.2));
      }
    }
  }
  return beats;
}
