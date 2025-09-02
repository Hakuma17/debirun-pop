// ===================================================================
// DEBIRUN POP - EXPRESS SERVER (Final Version, Fixed)
// - รองรับให้คะแนน, ตารางคะแนน, คะแนนรวม, และดึงข้อมูลผู้เล่นรายบุคคล
// - รองรับฐานข้อมูล Firestore และ SQLite (better-sqlite3)
// - FIX: sanitizeName ใช้ Unicode RegEx และ limit ความยาวให้ตรงกับฝั่ง client
// - NEW (optional): FORCE_HTTPS=1 เพื่อบังคับใช้ HTTPS เมื่อต่อหลัง proxy
// ===================================================================

"use strict";

// --- 1. INITIALIZATION (การนำเข้า library ที่จำเป็น) ---
const express = require("express");
const path = require("path");
const compression = require("compression");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// [สำคัญ] ถ้าอยู่หลัง Proxy (เช่น Render/Fly/Railway/Cloudflare) → ได้ IP/Proto จริง
app.set("trust proxy", true);

// [ออปชัน] บังคับ HTTPS เมื่ออยู่หลัง proxy
if (process.env.FORCE_HTTPS === "1") {
  app.use((req, res, next) => {
    if (req.secure || req.headers["x-forwarded-proto"] === "https") return next();
    const host = req.get("host");
    return res.redirect(301, `https://${host}${req.originalUrl}`);
  });
}

// --- 2. DATABASE ABSTRACTION LAYER (การจัดการฐานข้อมูล) ---
// เขียนผ่าน service เดียวกัน ไม่ต้องสนใจว่าเบื้องหลังคือ Firestore หรือ SQLite
let dbService;

// ความยาวชื่อสูงสุด (ให้ตรงกับ client)
const MAX_NAME_LENGTH = 15;

/**
 * เริ่มต้นเชื่อมต่อฐานข้อมูลตาม Environment
 * FIREBASE_SERVICE_ACCOUNT (JSON string) → Firestore
 * ไม่ตั้งค่า → SQLite ในไฟล์ local
 */
function initializeDatabase() {
  const USE_FIREBASE = !!process.env.FIREBASE_SERVICE_ACCOUNT;

  if (USE_FIREBASE) {
    // ---------- Firestore ----------
    console.log("Initializing database connection: Firestore");
    const admin = require("firebase-admin");
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

    const db = admin.firestore();
    const fv = admin.firestore.FieldValue;

    return {
      getLeaderboard: async () => {
        const snapshot = await db
          .collection("players")
          .orderBy("score", "desc")
          .limit(50)
          .get();
        return snapshot.docs.map((doc) => ({
          name: doc.id,
          score: doc.data().score || 0,
        }));
      },
      addScore: (name, delta) => {
        const playerRef = db.collection("players").doc(name);
        const communityRef = db.collection("counters").doc("community");
        // ใช้ Transaction ให้ผู้เล่น/คะแนนรวมอัปเดตร่วมกัน
        return db.runTransaction(async (t) => {
          const playerDoc = await t.get(playerRef);
          const oldScore = playerDoc.exists ? playerDoc.data().score || 0 : 0;
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
      getPlayer: async (name) => {
        const docRef = db.collection("players").doc(name);
        const doc = await docRef.get();
        if (!doc.exists) return null;
        return { name: doc.id, score: doc.data().score || 0 };
      },
      getType: () => "firestore",
    };
  } else {
    // ---------- SQLite (local file) ----------
    console.log("Initializing database connection: Local SQLite");
    const Database = require("better-sqlite3");
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, "scores.db");
    const sqlite = new Database(DB_PATH);

    // ปรับ PRAGMA ให้เหมาะกับงานเขียน/อ่านเบา ๆ
    try {
      sqlite.pragma("journal_mode = WAL");
      sqlite.pragma("synchronous = NORMAL");
    } catch (_) {}

    // schema
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

    // คำสั่งเตรียมไว้ล่วงหน้า
    const getLeaderboardStmt = sqlite.prepare(
      "SELECT name, score FROM players ORDER BY score DESC, updated_at ASC LIMIT 50"
    );
    const getCommunityStmt = sqlite.prepare(
      "SELECT total FROM counters WHERE id = 1"
    );
    const getPlayerStmt = sqlite.prepare(
      "SELECT name, score FROM players WHERE name = ?"
    );
    const addScoreTransaction = sqlite.transaction((name, delta) => {
      sqlite
        .prepare(
          "INSERT INTO players (name, score) VALUES (?, 0) ON CONFLICT(name) DO NOTHING"
        )
        .run(name);
      sqlite
        .prepare(
          "UPDATE players SET score = score + ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?"
        )
        .run(delta, name);
      sqlite
        .prepare("UPDATE counters SET total = total + ? WHERE id = 1")
        .run(delta);
    });

    return {
      getLeaderboard: async () => getLeaderboardStmt.all(),
      addScore: async (name, delta) => addScoreTransaction(name, delta),
      getCommunityTotal: async () => getCommunityStmt.get() || { total: 0 },
      getPlayer: async (name) => getPlayerStmt.get(name) || null,
      getType: () => "sqlite",
    };
  }
}

// เริ่มต้นการเชื่อมต่อฐานข้อมูล
dbService = initializeDatabase();

// --- 3. MIDDLEWARES ---
app.use(compression()); // บีบอัด response

// จำกัดขนาด JSON และ parse body
app.use(express.json({ limit: "128kb" }));

// ตั้งค่า CORS โดยผ่าน env: CORS_ORIGIN="https://a.com,https://b.com"
if (process.env.CORS_ORIGIN) {
  const origins = process.env.CORS_ORIGIN.split(",").map((s) => s.trim());
  app.use(cors({ origin: origins }));
  app.options("*", cors({ origin: origins })); // preflight
}

// ให้บริการไฟล์ Static จากโฟลเดอร์ /public
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: "1h",
    // ใช้ ETag/Last-Modified ของ Express ตามปกติ
  })
);

// --- 4. UTILS & RATE LIMITING ---
/**
 * [FIXED] sanitizeName: อนุญาตตัวอักษรทุกภาษา \p{L}, ตัวเลข \p{N}, ขีดล่าง _, เว้นวรรค, และขีดกลาง -
 * วาง - ไว้ท้าย character class กันตีความเป็นช่วง
 */
function sanitizeName(str) {
  return String(str || "")
    .replace(/[^\p{L}\p{N}_ -]/gu, "")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

// Rate Limiter แบบเบา ๆ สำหรับ /score เท่านั้น (กันยิงรัวจากไอพีเดียว)
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_REQUESTS = 40;

function rateLimiter(req, res, next) {
  if (req.path !== "/score") return next();

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

// ล้าง store เป็นระยะ (กันกินแรม)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore.entries()) {
    if (now - entry.timestamp > RATE_LIMIT_WINDOW_MS * 60) {
      rateLimitStore.delete(ip);
    }
  }
}, 10 * 60 * 1000);

// --- 5. API ROUTES ---
// 5.1 ตารางคะแนน
app.get("/leaderboard", async (_req, res) => {
  try {
    const data = await dbService.getLeaderboard();
    res.json(data);
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.status(500).json({ ok: false, message: "Internal Server Error" });
  }
});

// 5.2 ข้อมูลผู้เล่นรายบุคคล
app.get("/player/:name", async (req, res) => {
  try {
    const name = sanitizeName(req.params.name);
    if (!name) {
      return res.status(400).json({ ok: false, message: "Invalid name" });
    }
    const data = await dbService.getPlayer(name);
    if (data) return res.json(data);
    return res.status(404).json({ ok: false, message: "Player not found" });
  } catch (error) {
    console.error(`Error fetching player ${req.params.name}:`, error);
    res.status(500).json({ ok: false, message: "Internal Server Error" });
  }
});

// 5.3 เพิ่ม/อัปเดตคะแนน
app.post("/score", rateLimiter, async (req, res) => {
  try {
    const { name, delta } = req.body || {};
    const cleanName = sanitizeName(name);
    // delta: integer 0..500 (กันยิงทีละเยอะเกิน)
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

// 5.4 คะแนนรวม (Community)
app.get("/community", async (_req, res) => {
  try {
    const data = await dbService.getCommunityTotal();
    res.json(data);
  } catch (error) {
    console.error("Error fetching community total:", error);
    res.status(500).json({ ok: false, message: "Internal Server Error" });
  }
});

// 5.5 Health Check
app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    database: dbService.getType(),
    timestamp: new Date().toISOString(),
  });
});

// --- 6. SERVER STARTUP ---
app.listen(PORT, () => {
  console.log(`Debirun Pop server listening on http://localhost:${PORT}`);
  console.log(`Database in use: ${dbService.getType()}`);
});