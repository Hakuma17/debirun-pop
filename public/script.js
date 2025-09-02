// ===================================================================
// DEBIRUN POP - SCRIPT V3 (Final)
// - เพิ่มระบบ Modal (ตารางคะแนน, คู่มือ)
// - เพิ่มระบบโหลดคะแนนเดิมของผู้เล่น
// - ปรับปรุงโครงสร้างและเพิ่มคอมเมนต์อธิบายอย่างละเอียด
// ===================================================================

// --- 1. DOM ELEMENTS ---
// ส่วนที่เชื่อมต่อกับ HTML Elements ทั้งหมดที่ต้องใช้ในเกม
const elements = {
  // หน้าจอหลัก
  loginContainer: document.getElementById('loginContainer'),
  gameContainer: document.getElementById('gameContainer'),
  
  // ส่วนควบคุมหน้าเข้าเกม
  startButton: document.getElementById('startButton'),
  nameInput: document.getElementById('nameInput'),
  
  // ส่วนควบคุมในหน้าเกม
  debirunImage: document.getElementById('debirunImage'),
  scoreDisplay: document.getElementById('score'),
  playerNameDisplay: document.getElementById('playerName'),
  
  // ส่วนมิชชั่นรวม (Co-op)
  coopFill: document.getElementById('coopFill'),
  coopText: document.getElementById('coopText'),
  
  // ส่วนของ Modal (Pop-up)
  howToPlayButton: document.getElementById('howToPlayButton'),
  leaderboardButton: document.getElementById('leaderboardButton'),
  howToPlayModal: document.getElementById('howToPlayModal'),
  leaderboardModal: document.getElementById('leaderboardModal'),
  closeHowToPlay: document.getElementById('closeHowToPlay'),
  closeLeaderboard: document.getElementById('closeLeaderboard'),
  leaderboardList: document.getElementById('leaderboard-list'), // พื้นที่แสดงผลตารางคะแนน

  // --- NEW: Settings modal & controls ---
  settingsButton: document.getElementById('settingsButton'),
  settingsModal: document.getElementById('settingsModal'),
  closeSettings: document.getElementById('closeSettings'),
  toggleAll: document.getElementById('toggleAll'),
  togglePop: document.getElementById('togglePop'),
  toggleRapid: document.getElementById('toggleRapid'),
  toggleIdle: document.getElementById('toggleIdle'),
  volumeSlider: document.getElementById('volumeSlider'),
  volumeValue: document.getElementById('volumeValue'),
};

// --- 2. CONFIG & CONSTANTS ---
// ค่าคงที่และการตั้งค่าต่างๆ ของเกม ทำให้ง่ายต่อการปรับแก้ในอนาคต
const config = {
  // API Endpoint (ตรวจสอบจาก URL parameter หรือใช้ค่าเริ่มต้น)
  API_URL: (() => {
    const fromQuery = new URLSearchParams(location.search).get('api');
    if (fromQuery) return fromQuery.replace(/\/$/, '');
    if (window.API_URL) return String(window.API_URL).replace(/\/$/, '');
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return 'http://localhost:3000';
    return location.origin;
  })(),

  // ที่อยู่ไฟล์ภาพ
  IMG_NORMAL: 'พื้นหลังใส-1.png',
  IMG_POPPED: 'พื้นหลังใส-2.png',

  // Key สำหรับบันทึกชื่อใน Local Storage
  LOCAL_STORAGE_KEY: 'debirun_name',

  // NEW: Key จัดเก็บค่าตั้งค่าเสียง
  SOUND_PREFS_KEY: 'debirun_sound_prefs_v1',

  // การตรวจสอบความยาวชื่อ
  MIN_NAME_LENGTH: 3,
  MAX_NAME_LENGTH: 15,

  // ค่าพลังตั้งต้นต่อ 1 เลเวล (จะถูก override ด้วย data-attributes หากตั้งไว้ใน HTML)
  COOP_GOAL_PER_LEVEL: 1000,

  // ความถี่ในการส่งคะแนนไปเซิร์ฟเวอร์ (มิลลิวินาที)
  FLUSH_INTERVAL_MS: 1500,

  // เงื่อนไขสำหรับ Streak Bonus
  STREAK_TARGET: 75,      // จำนวนคลิกที่ต้องการ
  STREAK_RESET_MS: 1500,  // เวลาที่เว้นว่างก่อนรีเซ็ตสตรีค

  // เวลาสำหรับเสียง Idle (ตอนไม่กด)
  IDLE_FIRST_WAIT_MS: 5000,
  IDLE_REPEAT_INTERVAL_MS: 15000,
};

// --- 3. AUDIO ASSETS ---
// จัดการไฟล์เสียงและตั้งค่าเริ่มต้น
const sounds = {
  pop: new Audio('pop1.mp3'),
  rapidPop: new Audio('จิ้มรั่วๆ.mp3'),
  idle: new Audio('เชิญชวนจิ้มน่าจอ.mp3'),

  // NEW: เก็บ base volume แยกชนิดเสียง
  baseVol: { pop: 1.0, rapidPop: 0.6, idle: 0.55 },

  init() {
    this.pop.preload = 'auto';
    this.rapidPop.preload = 'auto';
    this.idle.preload = 'auto';
    this.idle.addEventListener('ended', () => { gameState.isIdlePlaying = false; });
  }
};
sounds.init();

// --- 4. GAME STATE ---
// รวบรวมสถานะของเกมที่เปลี่ยนแปลงตลอดเวลาไว้ใน Object เดียวเพื่อง่ายต่อการจัดการ
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
  gameTimers: { flush: null, community: null },
  leaderboardAbortController: new AbortController(),

  // NEW: สถานะเสียง
  sound: {
    enable: { pop: true, rapidPop: true, idle: true },
    volume: 1.0, // 0.0 - 1.0 (ระดับเสียงรวม)
  },
};


// ===================================================================
// API & SERVER COMMUNICATION (การสื่อสารกับเซิร์ฟเวอร์)
// ===================================================================

/**
 * [ฟังก์ชันใหม่] ดึงคะแนนล่าสุดของผู้เล่นจากเซิร์ฟเวอร์
 * @param {string} name - ชื่อของผู้เล่นที่ต้องการค้นหา
 * @returns {Promise<number>} - คะแนนของผู้เล่น (คืนค่า 0 หากไม่พบ)
 */
async function getPlayerScore(name) {
  try {
    const response = await fetch(`${config.API_URL}/player/${encodeURIComponent(name)}`);
    if (response.ok) {
      const data = await response.json();
      return data.score || 0;
    }
    return 0; // คืนค่า 0 หากไม่พบผู้เล่น (สถานะ 404)
  } catch (error) {
    console.error('Failed to get player score:', error);
    return 0; // คืนค่า 0 หากการเชื่อมต่อล้มเหลว
  }
}

/**
 * ส่งคะแนนที่สะสมไว้ใน clickQueue ไปยังเซิร์ฟเวอร์
 */
async function flushScoreQueue() {
  if (!gameState.username || gameState.clickQueue.pending <= 0) return;

  const delta = gameState.clickQueue.pending;
  gameState.clickQueue.pending = 0; // รีเซ็ตคิวทันที

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
    gameState.clickQueue.pending += delta; // คืนค่าคะแนนกลับเข้าคิว หากส่งไม่สำเร็จ
  }
}

/**
 * ดึงข้อมูลตารางคะแนน (Leaderboard) และแสดงผลใน Modal
 */
async function updateLeaderboard() {
  gameState.leaderboardAbortController.abort(); // ยกเลิก request เก่าที่อาจค้างอยู่
  gameState.leaderboardAbortController = new AbortController();
  
  elements.leaderboardList.innerHTML = '<li>Loading...</li>'; // แสดงสถานะกำลังโหลด

  try {
    const response = await fetch(`${config.API_URL}/leaderboard`, { signal: gameState.leaderboardAbortController.signal });
    const data = await response.json();
    
    elements.leaderboardList.innerHTML = ''; // ล้างข้อมูลเก่า
    
    if (!data || data.length === 0) {
      elements.leaderboardList.innerHTML = '<li>ยังไม่มีข้อมูล...</li>';
      return;
    }
    
    data.forEach((player, index) => {
      const li = document.createElement('li');
      // เพิ่มลำดับ, ชื่อ, และคะแนน
      li.innerHTML = `<span>#${index + 1} ${player.name}</span> <span>${player.score.toLocaleString()}</span>`;
      if (player.name === gameState.username) {
        li.classList.add('me'); // ไฮไลท์ชื่อผู้เล่นปัจจุบัน
      }
      elements.leaderboardList.appendChild(li);
    });
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('Leaderboard update failed:', error);
      elements.leaderboardList.innerHTML = '<li>เกิดข้อผิดพลาดในการโหลดข้อมูล</li>';
    }
  }
}

/**
 * helper: อ่านพารามิเตอร์ความยากจาก HTML (data-goal-base, data-goal-growth)
 */
function readCoopDifficulty() {
  const el = document.getElementById('coop');
  const base = Number(el?.dataset.goalBase) || config.COOP_GOAL_PER_LEVEL;
  const growth = Number(el?.dataset.goalGrowth) || 1.25; // โตขึ้นต่อเลเวล
  return { base, growth };
}

/**
 * helper: แปลง total → level, goal ของเลเวลนั้น, และคะแนนภายในเลเวล
 * สูตร: Lv.1 = base, Lv.n = round(base * growth^(n-1))
 */
function computeLevelProgress(total) {
  const { base, growth } = readCoopDifficulty();
  let level = 1;
  let goal = Math.round(base);
  let remaining = Math.max(0, Number(total) || 0);

  // เดินหน้าไปทีละเลเวลจนกว่า remaining จะน้อยกว่า goal ของเลเวลปัจจุบัน
  // (มี safety cap เพื่อกันลูปผิดพลาด)
  for (let step = 0; step < 10000; step++) {
    if (remaining < goal) break;
    remaining -= goal;
    level += 1;
    goal = Math.round(base * Math.pow(growth, level - 1));
  }
  return { level, goal, scoreInLevel: remaining };
}

/**
 * ดึงข้อมูลคะแนนรวม (Co-op) และอัปเดตแถบพลัง
 */
async function updateCommunityMeter() {
  try {
    const response = await fetch(`${config.API_URL}/community`);
    const { total = 0 } = await response.json();

    // ใช้สเกลความยากแบบเติบโตตามเลเวล
    const { level, goal, scoreInLevel } = computeLevelProgress(total);
    const percentage = Math.min(100, (scoreInLevel / goal) * 100);

    elements.coopFill.style.width = `${percentage}%`;
    // NOTE: coopText เป็น <span> ไม่ได้มีลูกอีกชั้น จึงใช้ textContent ตรง ๆ
    elements.coopText.textContent = `${scoreInLevel.toLocaleString()} / ${goal.toLocaleString()} • Lv.${level}`;

    // เอฟเฟกต์เมื่อเลเวลอัป
    if (level > gameState.lastLevel && gameState.lastLevel !== 0) {
      document.body.classList.add('level-up');
      setTimeout(() => document.body.classList.remove('level-up'), 700);
    }
    gameState.lastLevel = level;
  } catch (error) {
    // ไม่ต้องแสดง error รบกวนผู้เล่น
  }
}


// ===================================================================
// GAME LOGIC & UI (ตรรกะของเกมและหน้าตา)
// ===================================================================

// --- NEW: จัดการค่าตั้งค่าเสียง (โหลด/บันทึก/ประยุกต์) ---
function loadSoundPrefs() {
  try {
    const raw = localStorage.getItem(config.SOUND_PREFS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (typeof obj.volume === 'number') gameState.sound.volume = Math.min(1, Math.max(0, obj.volume));
    if (obj.enable) {
      gameState.sound.enable.pop = obj.enable.pop ?? true;
      gameState.sound.enable.rapidPop = obj.enable.rapidPop ?? true;
      gameState.sound.enable.idle = obj.enable.idle ?? true;
    }
  } catch {}
}

function saveSoundPrefs() {
  const toSave = {
    volume: gameState.sound.volume,
    enable: {
      pop: !!gameState.sound.enable.pop,
      rapidPop: !!gameState.sound.enable.rapidPop,
      idle: !!gameState.sound.enable.idle,
    }
  };
  localStorage.setItem(config.SOUND_PREFS_KEY, JSON.stringify(toSave));
}

function applySoundPrefs() {
  const v = gameState.sound.volume;
  sounds.pop.volume = (gameState.sound.enable.pop ? sounds.baseVol.pop * v : 0);
  sounds.rapidPop.volume = (gameState.sound.enable.rapidPop ? sounds.baseVol.rapidPop * v : 0);
  sounds.idle.volume = (gameState.sound.enable.idle ? sounds.baseVol.idle * v : 0);
}

/** START: โค้ดใหม่สำหรับอัปเดตแถบสี Volume Slider */
function updateVolumeProgress(slider) {
  const value = slider.value;
  const min = slider.min || 0;
  const max = slider.max || 100;
  const progress = ((value - min) / (max - min)) * 100;
  slider.style.setProperty('--progress', `${progress}%`);
}
/** END: โค้ดใหม่สำหรับอัปเดตแถบสี Volume Slider */

// ฟังก์ชันสำหรับจัดการเสียง Idle (เหมือนเดิม)
function scheduleIdleSound() { /* โค้ดส่วนนี้ทำงานเหมือนเดิม */
  // NEW: ไม่ต้องตั้งค่ายิงเสียงถ้าถูกปิดไว้
  if (!gameState.sound.enable.idle) return;

  // NEW: ตั้งตัวจับเวลาเล่นเสียงชวนกดครั้งแรก/ซ้ำ ๆ
  clearTimeout(gameState.idleTimers.first);
  clearInterval(gameState.idleTimers.repeat);

  const playOnce = () => {
    if (document.hidden || gameState.isIdlePlaying || !gameState.sound.enable.idle) return;
    gameState.isIdlePlaying = true;
    try {
      sounds.idle.currentTime = 0;
      sounds.idle.play().catch(() => { gameState.isIdlePlaying = false; });
    } catch { gameState.isIdlePlaying = false; }
  };

  gameState.idleTimers.first = setTimeout(() => {
    playOnce();
    gameState.idleTimers.repeat = setInterval(playOnce, config.IDLE_REPEAT_INTERVAL_MS);
  }, config.IDLE_FIRST_WAIT_MS);
}

// ฟังก์ชันหยุดเสียง Idle (เหมือนเดิม)
function stopIdleSound(clearTimers = false) { /* โค้ดส่วนนี้ทำงานเหมือนเดิม */
  try { sounds.idle.pause(); } catch {}
  gameState.isIdlePlaying = false;
  if (clearTimers) {
    clearTimeout(gameState.idleTimers.first);
    clearInterval(gameState.idleTimers.repeat);
  }
}

// ฟังก์ชันโหลดรูปภาพล่วงหน้า (เหมือนเดิม)
async function preloadImages(...urls) { /* โค้ดส่วนนี้ทำงานเหมือนเดิม */
  const tasks = urls.map(url => new Promise(resolve => {
    const img = new Image();
    img.onload = resolve;
    img.onerror = resolve;
    img.src = url;
  }));
  await Promise.all(tasks);
}

// ฟังก์ชันทำความสะอาดชื่อ (เหมือนเดิม)
function sanitizeName(str) {
  const cleaned = String(str || "").replace(/[^\p{L}\p{N}_\- ]/gu, "").trim();
  return cleaned.slice(0, config.MAX_NAME_LENGTH);
}

/**
 * เริ่มต้นการทำงานของ Timers ต่างๆ ในเกม (ส่งคะแนน, อัปเดตมิเตอร์รวม)
 */
function startGameTimers() {
  Object.values(gameState.gameTimers).forEach(timer => clearInterval(timer));
  gameState.gameTimers.flush = setInterval(flushScoreQueue, config.FLUSH_INTERVAL_MS);
  gameState.gameTimers.community = setInterval(updateCommunityMeter, 3000);
  updateCommunityMeter(); // โหลดข้อมูลครั้งแรกทันที
}


// ===================================================================
// EVENT HANDLERS (ฟังก์ชันจัดการเหตุการณ์)
// ===================================================================

/**
 * เมื่อผู้ใช้กดคลิก/แตะที่ตัวละคร
 */
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
    gameState.streakCount = 0; // รีเซ็ตถ้าเว้นช่วงนานไป
  }
  gameState.streakCount++;
  gameState.lastClickAt = now;

  // เล่นเสียงตามเงื่อนไข Streak (เคารพค่าปิด/เปิด)
  const isBonus = (gameState.streakCount > 0 && gameState.streakCount % config.STREAK_TARGET === 0);
  const audio = isBonus ? sounds.rapidPop : sounds.pop;
  const allowed = isBonus ? gameState.sound.enable.rapidPop : gameState.sound.enable.pop;

  if (allowed && audio.volume > 0) {
    audio.currentTime = 0;
    audio.play().catch(()=>{});
  }
}

/**
 * เมื่อผู้ใช้ปล่อยคลิก/แตะ
 */
function handleRelease() {
  if (!gameState.isPressed) return;
  gameState.isPressed = false;
  elements.debirunImage.src = config.IMG_NORMAL;
  elements.debirunImage.classList.remove('active');
}

/**
 * เมื่อหน้าจอถูกซ่อนหรือกลับมาแสดง
 */
function handleVisibilityChange() {
  if (document.hidden) {
    stopIdleSound(true);
    gameState.streakCount = 0;
    gameState.lastClickAt = 0;
  } else if (gameState.username) {
    scheduleIdleSound();
  }
}

/**
 * เมื่อกดปุ่มเริ่มเกม
 */
async function handleStartButtonClick() {
  const cleanName = sanitizeName(elements.nameInput.value);

  if (cleanName.length < config.MIN_NAME_LENGTH) {
    alert(`กรุณากรอกชื่อ ${config.MIN_NAME_LENGTH}–${config.MAX_NAME_LENGTH} ตัวอักษร`);
    return;
  }
  
  // --- ส่วนสำคัญ: โหลดคะแนนเดิมของผู้เล่น ---
  const existingScore = await getPlayerScore(cleanName);
  gameState.score = existingScore;
  elements.scoreDisplay.textContent = gameState.score.toLocaleString();
  // ----------------------------------------

  gameState.username = cleanName;
  elements.playerNameDisplay.textContent = gameState.username;
  localStorage.setItem(config.LOCAL_STORAGE_KEY, gameState.username);

  // ปลดล็อกเสียงบนมือถือ (ต้องเกิดจาก User Interaction)
  try { await sounds.pop.play(); sounds.pop.pause(); sounds.pop.currentTime = 0; } catch {}
  
  await preloadImages(config.IMG_NORMAL, config.IMG_POPPED);

  // สลับหน้าจอ
  elements.loginContainer.style.display = 'none';
  elements.gameContainer.style.display = 'flex';

  // เริ่มต้น Logic ของเกม
  scheduleIdleSound();
  startGameTimers();
}


// ===================================================================
// INITIALIZATION (ฟังก์ชันเริ่มต้น)
// ===================================================================

/**
 * ฟังก์ชันหลักในการเริ่มต้นทุกอย่างเมื่อหน้าเว็บโหลดเสร็จ
 */
function main() {
  // ดึงชื่อเดิมที่เคยเล่นจาก Local Storage มาใส่ในช่องกรอกชื่อ
  const savedName = localStorage.getItem(config.LOCAL_STORAGE_KEY);
  if (savedName) {
    elements.nameInput.value = savedName;
  }

  // โหลดค่าตั้งค่าเสียง แล้วประยุกต์ใช้งาน
  loadSoundPrefs();
  applySoundPrefs();

  // START: แก้ไข - อัปเดต UI ของ slider ให้ตรงกับค่าที่โหลดมา
  elements.volumeSlider.value = Math.round(gameState.sound.volume * 100);
  elements.volumeValue.textContent = `${elements.volumeSlider.value}%`;
  updateVolumeProgress(elements.volumeSlider);
  // END: แก้ไข

  // ป้องกันการซูมด้วยนิ้วบนมือถือ
  elements.debirunImage.style.touchAction = 'manipulation';
  elements.debirunImage.style.userSelect = 'none';

  // --- ตั้งค่า Event Listeners ทั้งหมดของเกม ---
  elements.startButton.addEventListener('click', handleStartButtonClick);
  elements.debirunImage.addEventListener('pointerdown', handlePress, { passive: false });
  document.addEventListener('pointerup', handleRelease);
  document.addEventListener('pointercancel', handleRelease);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // --- ตั้งค่า Event Listeners สำหรับ Modals ---
  elements.howToPlayButton.addEventListener('click', () => {
    elements.howToPlayModal.style.display = 'flex';
  });
  elements.leaderboardButton.addEventListener('click', () => {
    updateLeaderboard(); // อัปเดตข้อมูลทุกครั้งที่เปิด
    elements.leaderboardModal.style.display = 'flex';
  });
  elements.closeHowToPlay.addEventListener('click', () => {
    elements.howToPlayModal.style.display = 'none';
  });
  elements.closeLeaderboard.addEventListener('click', () => {
    elements.leaderboardModal.style.display = 'none';
  });

  // --- NEW: Settings Modal bindings ---
  const openSettings = () => {
    // sync UI -> จากสถานะปัจจุบัน
    elements.togglePop.checked   = !!gameState.sound.enable.pop;
    elements.toggleRapid.checked = !!gameState.sound.enable.rapidPop;
    elements.toggleIdle.checked  = !!gameState.sound.enable.idle;
    const allOn = elements.togglePop.checked && elements.toggleRapid.checked && elements.toggleIdle.checked;
    elements.toggleAll.checked = allOn;
    elements.volumeSlider.value = Math.round(gameState.sound.volume * 100);
    elements.volumeValue.textContent = `${elements.volumeSlider.value}%`;
    updateVolumeProgress(elements.volumeSlider); // อัปเดตแถบสีตอนเปิด
    elements.settingsModal.style.display = 'flex';
  };
  const closeSettings = () => elements.settingsModal.style.display = 'none';

  elements.settingsButton.addEventListener('click', openSettings);
  elements.closeSettings.addEventListener('click', closeSettings);

  // ปิด Modal เมื่อคลิกนอกกล่อง
  [elements.howToPlayModal, elements.leaderboardModal, elements.settingsModal].forEach(modal=>{
    modal.addEventListener('click', (e)=>{ if (e.target === modal) modal.style.display='none'; });
  });

  // ปิด Modal ด้วย Esc
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      elements.howToPlayModal.style.display = 'none';
      elements.leaderboardModal.style.display = 'none';
      elements.settingsModal.style.display = 'none';
    }
  });

  // Settings: toggle/volume handlers
  elements.toggleAll.addEventListener('change', (e)=>{
    const on = e.target.checked;
    elements.togglePop.checked = on;
    elements.toggleRapid.checked = on;
    elements.toggleIdle.checked = on;
    gameState.sound.enable.pop = on;
    gameState.sound.enable.rapidPop = on;
    gameState.sound.enable.idle = on;
    applySoundPrefs(); saveSoundPrefs();
    // ถ้าปิด idle ก็หยุดเสียงทันที
    if (!on) stopIdleSound(true); else scheduleIdleSound();
  });

  elements.togglePop.addEventListener('change', (e)=>{
    gameState.sound.enable.pop = e.target.checked;
    applySoundPrefs(); saveSoundPrefs();
    elements.toggleAll.checked = elements.togglePop.checked && elements.toggleRapid.checked && elements.toggleIdle.checked;
  });

  elements.toggleRapid.addEventListener('change', (e)=>{
    gameState.sound.enable.rapidPop = e.target.checked;
    applySoundPrefs(); saveSoundPrefs();
    elements.toggleAll.checked = elements.togglePop.checked && elements.toggleRapid.checked && elements.toggleIdle.checked;
  });

  elements.toggleIdle.addEventListener('change', (e)=>{
    gameState.sound.enable.idle = e.target.checked;
    applySoundPrefs(); saveSoundPrefs();
    elements.toggleAll.checked = elements.togglePop.checked && elements.toggleRapid.checked && elements.toggleIdle.checked;
    if (!e.target.checked) stopIdleSound(true); else scheduleIdleSound();
  });

  elements.volumeSlider.addEventListener('input', (e)=>{
    const v = Math.round(Number(e.target.value));
    elements.volumeValue.textContent = `${v}%`;
    gameState.sound.volume = Math.min(1, Math.max(0, v/100));
    updateVolumeProgress(e.target); // START: แก้ไข - เรียกใช้ฟังก์ชันอัปเดตแถบสี
    applySoundPrefs();
  });
  
  // START: แก้ไข - เปลี่ยนจาก 'input' เป็น 'change' สำหรับการ save
  // เพื่อให้บันทึกค่าเฉพาะตอนปล่อยเมาส์ ลดภาระการเขียน LocalStorage
  elements.volumeSlider.addEventListener('change', ()=>{
      saveSoundPrefs();
  });
  // END: แก้ไข
}

// เริ่มการทำงานของสคริปต์ทั้งหมด
main();