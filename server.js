// ===================================================================
// DEBIRUN POP - EXPRESS SERVER (Final Version, Fixed)
// - รองรับการให้คะแนน, ตารางคะแนน, และคะแนนรวม
// - เพิ่ม Endpoint สำหรับดึงข้อมูลผู้เล่นรายบุคคล
// - รองรับฐานข้อมูล Firestore และ SQLite
// - FIX: แก้ไข Regular Expression ใน sanitizeName
// ===================================================================

"use strict";

// --- 1. INITIALIZATION (การนำเข้า library ที่จำเป็น) ---
const express = require("express");
const path = require("path");
const compression = require("compression");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// [เพิ่มใหม่] ถ้าอยู่หลัง Proxy (เช่น Render/Fly/Railway) จะได้ IP จริงของผู้ใช้
app.set("trust proxy", true);

// --- 2. DATABASE ABSTRACTION LAYER (การจัดการฐานข้อมูล) ---
// สร้างชั้น Abstraction เพื่อให้โค้ดส่วนอื่นเรียกใช้งานฐานข้อมูลได้ในรูปแบบเดียวกัน
// โดยไม่ต้องสนใจว่าเบื้องหลังเป็น Firestore หรือ SQLite
let dbService;

/**
 * ฟังก์ชันสำหรับเริ่มต้นการเชื่อมต่อฐานข้อมูลตาม Environment Variables
 * @returns {object} Object ที่มีเมธอดสำหรับจัดการฐานข้อมูล
 */
function initializeDatabase() {
  const USE_FIREBASE = !!process.env.FIREBASE_SERVICE_ACCOUNT;

  if (USE_FIREBASE) {
    // ---------- ส่วนของการทำงานกับ Firestore ----------
    console.log("Initializing database connection: Firestore");
    const admin = require("firebase-admin");
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    
    const db = admin.firestore();
    const fv = admin.firestore.FieldValue;

    return {
      getLeaderboard: async () => {
        const snapshot = await db.collection("players").orderBy("score", "desc").limit(50).get();
        return snapshot.docs.map(doc => ({ name: doc.id, score: doc.data().score || 0 }));
      },
      addScore: (name, delta) => {
        const playerRef = db.collection("players").doc(name);
        const communityRef = db.collection("counters").doc("community");
        // ใช้ Transaction เพื่อให้แน่ใจว่าการอัปเดตคะแนนผู้เล่นและคะแนนรวมสำเร็จไปพร้อมกัน
        return db.runTransaction(async t => {
          const playerDoc = await t.get(playerRef);
          const oldScore = playerDoc.exists ? (playerDoc.data().score || 0) : 0;
          t.set(
            playerRef,
            { score: oldScore + delta, updated_at: fv.serverTimestamp() },
            { merge: true }
          );
          t.set(communityRef, { total: fv.increment(delta) }, { merge: true });
        });
      },
      getCommunityTotal: async () => {
        const doc = await db.collection("counters").doc("community").get();
        return doc.exists ? { total: doc.data().total || 0 } : { total: 0 };
      },
      // [ฟังก์ชันใหม่] ดึงข้อมูลผู้เล่นจากชื่อ
      getPlayer: async (name) => {
        const docRef = db.collection("players").doc(name);
        const doc = await docRef.get();
        if (!doc.exists) {
          return null; // คืนค่า null หากไม่พบผู้เล่น
        }
        return { name: doc.id, score: doc.data().score || 0 };
      },
      getType: () => 'firestore'
    };
  } else {
    // ---------- ส่วนของการทำงานกับ SQLite ----------
    console.log("Initializing database connection: Local SQLite");
    const Database = require("better-sqlite3");
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, "scores.db");
    const sqlite = new Database(DB_PATH);

    // [เพิ่มใหม่] ปรับแต่ง PRAGMA ให้เหมาะกับงานเขียนอ่านเบาๆ และไฟล์เดี่ยว
    try {
      sqlite.pragma("journal_mode = WAL");
      sqlite.pragma("synchronous = NORMAL");
    } catch (_) {}

    // สร้าง Table หากยังไม่มี
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        score INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_players_score ON players(score DESC);
      CREATE TABLE IF NOT EXISTS counters (
        id INTEGER PRIMARY KEY,
        total INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO counters (id, total) VALUES (1, 0) ON CONFLICT(id) DO NOTHING;
    `);

    // เตรียม Statement ไว้ล่วงหน้าเพื่อประสิทธิภาพที่ดีกว่า
    const getLeaderboardStmt = sqlite.prepare(
      "SELECT name, score FROM players ORDER BY score DESC, updated_at ASC LIMIT 50"
    );
    const getCommunityStmt = sqlite.prepare(
      "SELECT total FROM counters WHERE id = 1"
    );
    const getPlayerStmt = sqlite.prepare(
      "SELECT name, score FROM players WHERE name = ?"
    ); // [Statement ใหม่]
    const addScoreTransaction = sqlite.transaction((name, delta) => {
      sqlite.prepare(
        "INSERT INTO players (name, score) VALUES (?, 0) ON CONFLICT(name) DO NOTHING"
      ).run(name);
      sqlite.prepare(
        "UPDATE players SET score = score + ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?"
      ).run(delta, name);
      sqlite.prepare("UPDATE counters SET total = total + ? WHERE id = 1").run(delta);
    });

    return {
      getLeaderboard: async () => getLeaderboardStmt.all(),
      addScore: async (name, delta) => addScoreTransaction(name, delta),
      getCommunityTotal: async () => getCommunityStmt.get() || { total: 0 },
      // [ฟังก์ชันใหม่] ดึงข้อมูลผู้เล่นจากชื่อ
      getPlayer: async (name) => getPlayerStmt.get(name) || null,
      getType: () => 'sqlite'
    };
  }
}

// เริ่มต้นการเชื่อมต่อฐานข้อมูล
dbService = initializeDatabase();


// --- 3. MIDDLEWARES (ซอฟต์แวร์ตัวกลาง) ---
app.use(compression()); // บีบอัด Response เพื่อลดขนาดและเพิ่มความเร็ว

// [ปรับปรุง] จำกัดขนาด JSON เพื่อกันสแปม/ผิดพลาด และ parse JSON body
app.use(express.json({ limit: "128kb" })); // แปลง Request body ที่เป็น JSON ให้อ่านได้

// ตั้งค่า CORS หากมีการเรียก API จากโดเมนอื่น
if (process.env.CORS_ORIGIN) {
  const origins = process.env.CORS_ORIGIN.split(",").map(s => s.trim());
  app.use(cors({ origin: origins }));
  // [เพิ่มใหม่] รองรับ preflight สำหรับทุกเส้นทาง (เช่น POST /score)
  app.options("*", cors({ origin: origins }));
}

// ให้บริการไฟล์ Static (เช่น index.html, style.css) จากโฟลเดอร์ public
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));


// --- 4. UTILS & RATE LIMITING (ฟังก์ชันเสริมและระบบป้องกัน) ---
/**
 * [FIXED] ทำความสะอาดชื่อผู้ใช้: แก้ไข Regular Expression ที่ผิดพลาด
 * @param {string} str - ชื่อที่รับเข้ามา
 * @returns {string} - ชื่อที่ทำความสะอาดแล้ว
 */
function sanitizeName(str) {
  // แก้ไขโดยย้าย - (hyphen) ไปไว้ท้ายสุดของ character class เพื่อให้ไม่ถูกตีความว่าเป็น "range"
  // และลบ \\ ที่ซ้ำซ้อนออก
  return String(str || "").replace(/[^\p{L}\p{N}_ -]/gu, "").trim().slice(0, 15);
}

// Rate Limiting: ป้องกันการยิง Request ถี่เกินไปจาก IP เดียว
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_REQUESTS = 40;

function rateLimiter(req, res, next) {
  if (req.path !== "/score") return next(); // ใช้ Rate Limit เฉพาะ Endpoint ที่สำคัญ

  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "anonymous";
  const now = Date.now();
  const entry = rateLimitStore.get(ip) || { count: 0, timestamp: now };

  if (now - entry.timestamp > RATE_LIMIT_WINDOW_MS) {
    entry.timestamp = now;
    entry.count = 0;
  }

  entry.count++;
  rateLimitStore.set(ip, entry);

  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({ ok: false, message: "Too many requests" });
  }

  next();
}

// ล้าง Rate Limit Store เป็นระยะเพื่อไม่ให้หน่วยความจำเต็ม
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore.entries()) {
    if (now - entry.timestamp > RATE_LIMIT_WINDOW_MS * 60) {
      // ล้าง IP ที่ไม่ active เกิน 1 นาที
      rateLimitStore.delete(ip);
    }
  }
}, 10 * 60 * 1000);


// --- 5. API ROUTES (เส้นทาง API) ---
// ดึงข้อมูลตารางคะแนน
app.get("/leaderboard", async (_req, res) => {
  try {
    const data = await dbService.getLeaderboard();
    res.json(data);
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.status(500).json({ ok: false, message: "Internal Server Error" });
  }
});

// [ENDPOINT ใหม่] ดึงข้อมูลผู้เล่นรายคน
app.get("/player/:name", async (req, res) => {
  try {
    const name = sanitizeName(req.params.name);
    if (!name) {
      return res.status(400).json({ ok: false, message: "Invalid name" });
    }
    const data = await dbService.getPlayer(name);
    if (data) {
      res.json(data);
    } else {
      // ส่ง 404 Not Found เมื่อไม่พบผู้เล่น
      res.status(404).json({ ok: false, message: "Player not found" });
    }
  } catch (error) {
    console.error(`Error fetching player ${req.params.name}:`, error);
    res.status(500).json({ ok: false, message: "Internal Server Error" });
  }
});

// เพิ่ม/อัปเดตคะแนน
app.post("/score", rateLimiter, async (req, res) => {
  try {
    const { name, delta } = req.body || {};
    const cleanName = sanitizeName(name);
    const validatedDelta = Math.min(Math.max(parseInt(delta, 10) || 0, 0), 500);

    if (!cleanName || validatedDelta <= 0) {
      return res.status(400).json({ ok: false, message: "Bad input" });
    }

    await dbService.addScore(cleanName, validatedDelta);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Error adding score:", error);
    res.status(500).json({ ok: false, message: "Internal Server Error" });
  }
});

// ดึงข้อมูลคะแนนรวม
app.get("/community", async (_req, res) => {
  try {
    const data = await dbService.getCommunityTotal();
    res.json(data);
  } catch (error) {
    console.error("Error fetching community total:", error);
    res.status(500).json({ ok: false, message: "Internal Server Error" });
  }
});

// Health Check Endpoint: สำหรับตรวจสอบว่า Server ทำงานอยู่หรือไม่
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, database: dbService.getType(), timestamp: new Date().toISOString() });
});


// --- 6. SERVER STARTUP (การเริ่มเซิร์ฟเวอร์) ---
app.listen(PORT, () => {
  console.log(`Debirun Pop server listening on http://localhost:${PORT}`);
  console.log(`Database in use: ${dbService.getType()}`);
});