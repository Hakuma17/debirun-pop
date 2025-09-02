// --- Elements ---
const loginContainer = document.getElementById('loginContainer');
const gameContainer  = document.getElementById('gameContainer');
const startButton    = document.getElementById('startButton');
const nameInput      = document.getElementById('nameInput');

const debirunImage   = document.getElementById('debirunImage');
const scoreDisplay   = document.getElementById('score');
const playerNameDisplay = document.getElementById('playerName');
const scoreboard     = document.getElementById('scoreboard');

// ===== Co-op meter elements (ใหม่) =====
const coopFill = document.getElementById('coopFill');
const coopText = document.getElementById('coopText');
const GOAL = 1000;           // แต้มต่อ 1 เลเวลของพลังรวม (ปรับได้)
let lastLevel = 0;

// --- Assets ---
const IMG1 = 'พื้นหลังใส-1.png';
const IMG2 = 'พื้นหลังใส-2.png';
const popSound      = new Audio('pop1.mp3');       // คลิกปกติ
const rapidPopSound = new Audio('จิ้มรั่วๆ.mp3'); // เมื่อครบสตรีค
const idleSound     = new Audio('เชิญชวนจิ้มน่าจอ.mp3');

[popSound, rapidPopSound, idleSound].forEach(a => { a.preload = 'auto'; a.loop = false; });
idleSound.volume = 0.55;
rapidPopSound.volume = 0.6;

// --- Config ---
let score = 0;
let username = '';
const API_URL = (() => {
  const fromQuery = new URLSearchParams(location.search).get('api');
  if (fromQuery) return fromQuery.replace(/\/$/, '');
  if (window.API_URL) return String(window.API_URL).replace(/\/$/, '');
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return 'http://localhost:3000';
  return location.origin;
})();

// ส่งคะแนนเป็น delta ทุก ๆ FLUSH_MS
const clickQueue = { pending: 0 };
const FLUSH_MS = 1500;

// ---------- เงื่อนไข “กด 30 ครั้งติดกัน” ----------
const STREAK_TARGET   = 30;    // ครบ 30 ครั้งติดกัน
const STREAK_RESET_MS = 1500;  // เว้นเกินนี้ถือว่าขาดตอน
let streakCount = 0;
let lastClickAt = 0;
// ----------------------------------------------

// --- Idle prompt: ครั้งแรกหลัง 5 วิ แล้วซ้ำทุก 10 วิ ถ้าไม่กด ---
let idleFirstTimer, idleRepeatTimer;
const IDLE_FIRST_MS  = 5000;
const IDLE_REPEAT_MS = 10000;
let isIdlePlaying = false;

idleSound.addEventListener('ended', () => { isIdlePlaying = false; });

function playIdleOnce() {
  if (document.hidden || isIdlePlaying) return;
  isIdlePlaying = true;
  try {
    idleSound.currentTime = 0;
    idleSound.play().catch(() => { isIdlePlaying = false; });
  } catch { isIdlePlaying = false; }
}

function scheduleIdle() {
  clearTimeout(idleFirstTimer);
  clearInterval(idleRepeatTimer);
  idleFirstTimer = setTimeout(() => {
    playIdleOnce();
    idleRepeatTimer = setInterval(playIdleOnce, IDLE_REPEAT_MS);
  }, IDLE_FIRST_MS);
}

function stopIdleSound({ clearTimers = false } = {}) {
  try { idleSound.pause(); } catch {}
  isIdlePlaying = false;
  if (clearTimers) {
    clearTimeout(idleFirstTimer);
    clearInterval(idleRepeatTimer);
  }
}

// --- Preload images ---
async function preloadImages(...urls) {
  const tasks = urls.map(u => {
    const img = new Image();
    img.src = u;
    return new Promise(r => { img.onload = r; });
  });
  await Promise.allSettled(tasks);
}

// --- Leaderboard (กันซ้อน request) ---
let lbAbortController = new AbortController();

async function updateLeaderboard() {
  lbAbortController.abort();
  lbAbortController = new AbortController();
  try {
    const res = await fetch(`${API_URL}/leaderboard`, { signal: lbAbortController.signal });
    const data = await res.json();
    if (!scoreboard) return; // เผื่อหน้าไม่มี
    scoreboard.innerHTML = '';
    data.forEach(p => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${p.name}</span> <span>${p.score}</span>`;
      if (p.name === username) li.classList.add('me');
      scoreboard.appendChild(li);
    });
  } catch (e) {
    if (e.name !== 'AbortError') console.error('Leaderboard update failed:', e);
  }
}

// --- Utils ---
function sanitizeName(str) {
  const cleaned = str.replace(/[^\p{L}\p{N}_\- ]/gu, '').trim();
  return cleaned.slice(0, 15);
}

// ===== Co-op: อัปเดตพลังรวมของดัสเรี่ยน (ใหม่) =====
async function updateCommunity() {
  if (!coopFill || !coopText) return; // ถ้าไม่มี element ก็ข้าม
  try {
    const res = await fetch(`${API_URL}/community`);
    const { total = 0 } = await res.json();
    const level = Math.floor(total / GOAL) + 1;
    const inLevel = total % GOAL;
    const pct = Math.min(100, (inLevel / GOAL) * 100);

    coopFill.style.width = `${pct}%`;
    coopText.textContent = `${inLevel.toLocaleString()} / ${GOAL.toLocaleString()} • Lv.${level}`;

    if (level > lastLevel) {
      // เอฟเฟกต์เลเวลอัปเล็ก ๆ
      document.body.animate([{filter:'brightness(1)'},{filter:'brightness(1.25)'},{filter:'brightness(1)'}],
                            {duration:700, easing:'ease'});
      lastLevel = level;
    }
  } catch (e) {
    // เงียบไว้ ไม่ต้องรบกวนผู้เล่น
  }
}

// --- Score flusher ---
async function flushQueue() {
  if (!username || clickQueue.pending <= 0) return;
  const delta = clickQueue.pending;
  clickQueue.pending = 0;
  try {
    await fetch(`${API_URL}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: username, delta })
    });
    // อัปเดตมิเตอร์รวมทันทีหลังส่งสำเร็จ
    updateCommunity();
  } catch (e) {
    clickQueue.pending += delta; // เก็บแต้มคืนถ้าส่งไม่สำเร็จ
    console.error('flush failed', e);
  }
}

// --- Game flow ---
startButton.addEventListener('click', async () => {
  const clean = sanitizeName(nameInput.value);
  if (clean.length < 3) {
    alert('กรุณากรอกชื่อเอเจนท์ 3–15 ตัวอักษร');
    return;
  }
  username = clean;
  playerNameDisplay.textContent = username;
  localStorage.setItem('debirun_name', username);

  // ปลดล็อกเสียงบนมือถือ
  try { await popSound.play(); popSound.pause(); } catch {}

  await preloadImages(IMG1, IMG2);

  loginContainer.style.display = 'none';
  gameContainer.style.display  = 'flex';

  scheduleIdle();
  setInterval(flushQueue, FLUSH_MS);

  // อัปเดตทั้งมิเตอร์ Co-op และ (ถ้าต้อง) leaderboard
  setInterval(updateCommunity, 3000);
  updateCommunity();

  setInterval(updateLeaderboard, 5000);
  updateLeaderboard();
});

// เติมชื่อเดิมถ้าเคยเล่น
const saved = localStorage.getItem('debirun_name');
if (saved) nameInput.value = saved;

// --- Input (Pointer Events) ---
let pressed = false;

function onPress(e) {
  e.preventDefault();
  if (pressed) return;
  pressed = true;

  // reset idle
  stopIdleSound({ clearTimers: true });
  scheduleIdle();

  // อัปเดตคะแนน
  score++;
  clickQueue.pending++;
  scoreDisplay.textContent = score;

  // ภาพ & เอฟเฟกต์
  debirunImage.src = IMG2;
  debirunImage.classList.add('active');

  // ===== เงื่อนไขสตรีค 30 ครั้งติดกัน =====
  const now = performance.now();
  if (now - lastClickAt > STREAK_RESET_MS) {
    // เว้นช่วงนานไป → สตรีคขาดตอน
    streakCount = 0;
  }
  streakCount += 1;
  lastClickAt = now;

  // ครบ 30/60/90… ครั้งติดกัน → เล่นเสียงกำลังใจ
  const useRapid = (streakCount % STREAK_TARGET === 0);
  const s = useRapid ? rapidPopSound : popSound;

  try { s.currentTime = 0; s.play(); } catch {}
  // =======================================
}

function onRelease() {
  if (!pressed) return;
  pressed = false;
  debirunImage.src = IMG1;
  debirunImage.classList.remove('active');
}

debirunImage.addEventListener('pointerdown', onPress, { passive: false });
document.addEventListener('pointerup', onRelease);
document.addEventListener('pointercancel', onRelease);

// หยุด/เริ่ม idle เมื่อซ่อน/กลับมา
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopIdleSound({ clearTimers: true });
    // รีเซ็ตสตรีคเมื่อสลับแท็บ/ซ่อนหน้า
    streakCount = 0;
    lastClickAt = 0;
  } else if (username) {
    scheduleIdle();
  }
});

// กัน pinch-zoom/double-tap ในภาพ
debirunImage.style.touchAction = 'manipulation';
debirunImage.style.userSelect = 'none';
