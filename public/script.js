// ===================================================================
// DEBIRUN POP - SCRIPT
// ===================================================================

// --- DOM ELEMENTS ---
// ส่วนที่เชื่อมต่อกับ HTML Elements
const elements = {
  loginContainer: document.getElementById('loginContainer'),
  gameContainer: document.getElementById('gameContainer'),
  startButton: document.getElementById('startButton'),
  nameInput: document.getElementById('nameInput'),
  debirunImage: document.getElementById('debirunImage'),
  scoreDisplay: document.getElementById('score'),
  playerNameDisplay: document.getElementById('playerName'),
  scoreboard: document.getElementById('scoreboard'),
  coopFill: document.getElementById('coopFill'),
  coopText: document.getElementById('coopText'),
};

// --- CONFIG & CONSTANTS ---
// ค่าคงที่และการตั้งค่าต่างๆ ของเกม
const config = {
  // API Endpoint
  API_URL: (() => {
    const fromQuery = new URLSearchParams(location.search).get('api');
    if (fromQuery) return fromQuery.replace(/\/$/, '');
    if (window.API_URL) return String(window.API_URL).replace(/\/$/, '');
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return 'http://localhost:3000';
    return location.origin;
  })(),

  // Image assets
  IMG_NORMAL: 'พื้นหลังใส-1.png',
  IMG_POPPED: 'พื้นหลังใส-2.png',

  // Local Storage key
  LOCAL_STORAGE_KEY: 'debirun_name',

  // Name validation
  MIN_NAME_LENGTH: 3,
  MAX_NAME_LENGTH: 15,

  // Co-op Mission
  COOP_GOAL_PER_LEVEL: 1000,

  // Score submission interval (ms)
  FLUSH_INTERVAL_MS: 1500,

  // Streak conditions
  STREAK_TARGET: 30,      // จำนวนคลิกที่ต้องการสำหรับสตรีค
  STREAK_RESET_MS: 1500, // เวลาที่เว้นว่างก่อนรีเซ็ตสตรีค

  // Idle sound timing (ms)
  IDLE_FIRST_WAIT_MS: 5000,
  IDLE_REPEAT_INTERVAL_MS: 10000,
};

// --- AUDIO ASSETS ---
// จัดการไฟล์เสียงและตั้งค่าเริ่มต้น
const sounds = {
  pop: new Audio('pop1.mp3'),
  rapidPop: new Audio('จิ้มรั่วๆ.mp3'),
  idle: new Audio('เชิญชวนจิ้มน่าจอ.mp3'),
  
  init() {
    this.pop.preload = 'auto';
    this.rapidPop.preload = 'auto';
    this.idle.preload = 'auto';
    this.rapidPop.volume = 0.6;
    this.idle.volume = 0.55;
    this.idle.addEventListener('ended', () => { gameState.isIdlePlaying = false; });
  }
};
sounds.init();

// --- GAME STATE ---
// รวบรวมสถานะของเกมที่เปลี่ยนแปลงตลอดเวลาไว้ใน Object เดียว
const gameState = {
  score: 0,
  username: '',
  lastLevel: 0,
  streakCount: 0,
  lastClickAt: 0,
  isPressed: false,
  isIdlePlaying: false,
  clickQueue: { pending: 0 },
  idleTimers: { first: null, repeat: null },
  gameTimers: { flush: null, community: null, leaderboard: null },
  leaderboardAbortController: new AbortController(),
};


// ===================================================================
// API & SERVER COMMUNICATION
// ===================================================================

/** ส่งคะแนนที่สะสมไว้ไปยัง Server */
async function flushScoreQueue() {
  if (!gameState.username || gameState.clickQueue.pending <= 0) return;

  const delta = gameState.clickQueue.pending;
  gameState.clickQueue.pending = 0; // Reset queue immediately

  try {
    await fetch(`${config.API_URL}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: gameState.username, delta })
    });
    // เมื่อส่งสำเร็จ ให้อัปเดตมิเตอร์รวมทันทีเพื่อการตอบสนองที่รวดเร็ว
    updateCommunityMeter();
  } catch (error) {
    console.error('Failed to flush score queue:', error);
    gameState.clickQueue.pending += delta; // Add score back if fetch failed
  }
}

/** ดึงข้อมูล Leaderboard จาก Server */
async function updateLeaderboard() {
  gameState.leaderboardAbortController.abort(); // Cancel previous fetch request
  gameState.leaderboardAbortController = new AbortController();

  try {
    const res = await fetch(`${config.API_URL}/leaderboard`, { signal: gameState.leaderboardAbortController.signal });
    const data = await res.json();
    
    if (!elements.scoreboard) return;
    elements.scoreboard.innerHTML = ''; // Clear old board
    
    data.forEach(player => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${player.name}</span> <span>${player.score}</span>`;
      if (player.name === gameState.username) {
        li.classList.add('me');
      }
      elements.scoreboard.appendChild(li);
    });
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('Leaderboard update failed:', error);
    }
  }
}

/** ดึงข้อมูลคะแนนรวม (Co-op) จาก Server */
async function updateCommunityMeter() {
  if (!elements.coopFill || !elements.coopText) return;

  try {
    const res = await fetch(`${config.API_URL}/community`);
    const { total = 0 } = await res.json();
    
    const level = Math.floor(total / config.COOP_GOAL_PER_LEVEL) + 1;
    const scoreInLevel = total % config.COOP_GOAL_PER_LEVEL;
    const percentage = Math.min(100, (scoreInLevel / config.COOP_GOAL_PER_LEVEL) * 100);

    elements.coopFill.style.width = `${percentage}%`;
    elements.coopText.textContent = `${scoreInLevel.toLocaleString()} / ${config.COOP_GOAL_PER_LEVEL.toLocaleString()} • Lv.${level}`;

    if (level > gameState.lastLevel) {
      // ใช้เอฟเฟกต์ "Screen Shake" ที่เพิ่มใน CSS
      document.body.classList.add('level-up');
      setTimeout(() => document.body.classList.remove('level-up'), 700);
      gameState.lastLevel = level;
    }
  } catch (error) {
    // Fail silently to not disturb the player
  }
}


// ===================================================================
// GAME LOGIC & UI
// ===================================================================

/** จัดการเสียง Idle (เสียงเชิญชวนให้คลิก) */
function scheduleIdleSound() {
  clearTimeout(gameState.idleTimers.first);
  clearInterval(gameState.idleTimers.repeat);

  const playOnce = () => {
    if (document.hidden || gameState.isIdlePlaying) return;
    gameState.isIdlePlaying = true;
    sounds.idle.currentTime = 0;
    sounds.idle.play().catch(() => { gameState.isIdlePlaying = false; });
  };

  gameState.idleTimers.first = setTimeout(() => {
    playOnce();
    gameState.idleTimers.repeat = setInterval(playOnce, config.IDLE_REPEAT_INTERVAL_MS);
  }, config.IDLE_FIRST_WAIT_MS);
}

/** หยุดเสียง Idle */
function stopIdleSound(clearTimers = false) {
  sounds.idle.pause();
  gameState.isIdlePlaying = false;
  if (clearTimers) {
    clearTimeout(gameState.idleTimers.first);
    clearInterval(gameState.idleTimers.repeat);
  }
}

/** โหลดรูปภาพล่วงหน้าเพื่อลดการกระตุก */
async function preloadImages(...urls) {
  const tasks = urls.map(url => new Promise(resolve => {
    const img = new Image();
    img.src = url;
    img.onload = resolve;
    img.onerror = resolve; // Resolve even on error to not block the game
  }));
  await Promise.all(tasks);
}

/** ทำความสะอาดชื่อผู้ใช้ */
function sanitizeName(str) {
  // Regex to keep letters, numbers, underscore, hyphen, space
  const cleaned = String(str || "").replace(/[^\p{L}\p{N}_\- ]/gu, "").trim();
  return cleaned.slice(0, config.MAX_NAME_LENGTH);
}

/** เริ่มต้นการทำงานของ Timers ต่างๆ ในเกม */
function startGameTimers() {
  // Clear any existing timers before starting new ones
  Object.values(gameState.gameTimers).forEach(timer => clearInterval(timer));

  gameState.gameTimers.flush = setInterval(flushScoreQueue, config.FLUSH_INTERVAL_MS);
  gameState.gameTimers.community = setInterval(updateCommunityMeter, 3000);
  gameState.gameTimers.leaderboard = setInterval(updateLeaderboard, 5000);

  // Initial fetch
  updateCommunityMeter();
  updateLeaderboard();
}


// ===================================================================
// EVENT HANDLERS
// ===================================================================

/** เมื่อผู้ใช้กดคลิก/แตะที่ตัวละคร */
function handlePress(event) {
  event.preventDefault();
  if (gameState.isPressed) return;
  gameState.isPressed = true;

  // รีเซ็ตเสียง Idle และเริ่มนับใหม่
  stopIdleSound(true);
  scheduleIdleSound();

  // อัปเดตคะแนน
  gameState.score++;
  gameState.clickQueue.pending++;
  elements.scoreDisplay.textContent = gameState.score.toLocaleString();

  // เปลี่ยนภาพและเพิ่มเอฟเฟกต์
  elements.debirunImage.src = config.IMG_POPPED;
  elements.debirunImage.classList.add('active');

  // ตรวจสอบเงื่อนไข Streak
  const now = performance.now();
  if (now - gameState.lastClickAt > config.STREAK_RESET_MS) {
    gameState.streakCount = 0; // Reset if the pause was too long
  }
  gameState.streakCount++;
  gameState.lastClickAt = now;

  // เล่นเสียงตามเงื่อนไข Streak
  const shouldUseRapidSound = (gameState.streakCount % config.STREAK_TARGET === 0);
  const soundToPlay = shouldUseRapidSound ? sounds.rapidPop : sounds.pop;
  
  soundToPlay.currentTime = 0;
  soundToPlay.play().catch(()=>{});
}

/** เมื่อผู้ใช้ปล่อยคลิก/แตะ */
function handleRelease() {
  if (!gameState.isPressed) return;
  gameState.isPressed = false;

  elements.debirunImage.src = config.IMG_NORMAL;
  elements.debirunImage.classList.remove('active');
}

/** เมื่อหน้าจอถูกซ่อนหรือกลับมาแสดง */
function handleVisibilityChange() {
  if (document.hidden) {
    stopIdleSound(true);
    // รีเซ็ตสตรีคเมื่อสลับแท็บ/ซ่อนหน้า
    gameState.streakCount = 0;
    gameState.lastClickAt = 0;
  } else if (gameState.username) {
    scheduleIdleSound();
  }
}

/** เมื่อกดปุ่มเริ่มเกม */
async function handleStartButtonClick() {
  const cleanName = sanitizeName(elements.nameInput.value);

  if (cleanName.length < config.MIN_NAME_LENGTH) {
    alert(`กรุณากรอกชื่อเอเจนท์ ${config.MIN_NAME_LENGTH}–${config.MAX_NAME_LENGTH} ตัวอักษร`);
    return;
  }
  
  gameState.username = cleanName;
  elements.playerNameDisplay.textContent = gameState.username;
  localStorage.setItem(config.LOCAL_STORAGE_KEY, gameState.username);

  // ปลดล็อกเสียงบนมือถือ (ต้องเกิดจาก User Interaction)
  try {
    await sounds.pop.play();
    sounds.pop.pause();
    sounds.pop.currentTime = 0;
  } catch {}
  
  // แสดงหน้าโหลด หรือ Spinner (ถ้ามี)
  await preloadImages(config.IMG_NORMAL, config.IMG_POPPED);

  // สลับหน้าจอ
  elements.loginContainer.style.display = 'none';
  elements.gameContainer.style.display = 'flex';

  // เริ่มต้น Logic ของเกม
  scheduleIdleSound();
  startGameTimers();
}


// ===================================================================
// INITIALIZATION
// ===================================================================

/** ฟังก์ชันหลักในการเริ่มต้นทุกอย่าง */
function main() {
  // ดึงชื่อเดิมที่เคยเล่นจาก Local Storage
  const savedName = localStorage.getItem(config.LOCAL_STORAGE_KEY);
  if (savedName) {
    elements.nameInput.value = savedName;
  }

  // ป้องกันการซูมด้วยนิ้วบนมือถือ
  elements.debirunImage.style.touchAction = 'manipulation';
  elements.debirunImage.style.userSelect = 'none';

  // ตั้งค่า Event Listeners
  elements.startButton.addEventListener('click', handleStartButtonClick);
  elements.debirunImage.addEventListener('pointerdown', handlePress, { passive: false });
  document.addEventListener('pointerup', handleRelease);
  document.addEventListener('pointercancel', handleRelease);
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

// เริ่มการทำงานของสคริปต์
main();