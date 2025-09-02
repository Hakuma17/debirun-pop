// ===================================================================
// DEBIRUN POP - EXPRESS SERVER
// Handles scoring, leaderboard, and community data.
// Supports both Firestore and local SQLite databases.
// ===================================================================

// --- 1. INITIALIZATION ---
const express = require("express");
const path = require("path");
const compression = require("compression");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// --- 2. DATABASE ABSTRACTION LAYER ---
// สร้างชั้น Abstraction เพื่อให้ส่วน API เรียกใช้งานได้เหมือนกัน
// โดยไม่ต้องสนใจว่าเบื้องหลังเป็น Firestore หรือ SQLite
let dbService;

/**
 * Initializes the database service based on environment variables.
 * @returns {object} A database service object with standardized methods.
 */
function initializeDatabase() {
  const USE_FIREBASE = !!process.env.FIREBASE_SERVICE_ACCOUNT;

  if (USE_FIREBASE) {
    // ---------- Firestore (Firebase Admin) Implementation ----------
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
          t.set(playerRef, { score: oldScore + delta, updated_at: fv.serverTimestamp() }, { merge: true });
          t.set(communityRef, { total: fv.increment(delta) }, { merge: true });
        });
      },
      getCommunityTotal: async () => {
        const doc = await db.collection("counters").doc("community").get();
        return doc.exists ? { total: doc.data().total || 0 } : { total: 0 };
      },
      getType: () => 'firestore'
    };
  } else {
    // ---------- SQLite (better-sqlite3) Implementation ----------
    console.log("Initializing database connection: Local SQLite");
    const Database = require("better-sqlite3");
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, "scores.db");
    const sqlite = new Database(DB_PATH);

    // สร้าง Table หากยังไม่มี
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        score INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_players_score ON players(score DESC);
      CREATE TABLE IF NOT EXISTS counters (
        id INTEGER PRIMARY KEY CHECK(id=1),
        total INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO counters (id, total) VALUES (1, 0) ON CONFLICT(id) DO NOTHING;
    `);

    // Pre-compile statements for performance
    const getLeaderboardStmt = sqlite.prepare("SELECT name, score FROM players ORDER BY score DESC, updated_at ASC LIMIT 50");
    const getCommunityStmt = sqlite.prepare("SELECT total FROM counters WHERE id = 1");
    const addScoreTransaction = sqlite.transaction((name, delta) => {
      sqlite.prepare("INSERT INTO players (name, score) VALUES (?, 0) ON CONFLICT(name) DO NOTHING").run(name);
      sqlite.prepare("UPDATE players SET score = score + ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?").run(delta, name);
      sqlite.prepare("UPDATE counters SET total = total + ? WHERE id = 1").run(delta);
    });

    return {
      getLeaderboard: async () => getLeaderboardStmt.all(),
      addScore: async (name, delta) => addScoreTransaction(name, delta),
      getCommunityTotal: async () => getCommunityStmt.get() || { total: 0 },
      getType: () => 'sqlite'
    };
  }
}

dbService = initializeDatabase();


// --- 3. MIDDLEWARES ---
app.use(compression()); // บีบอัด Response เพื่อลดขนาด
app.use(express.json()); // แปลง Request body ที่เป็น JSON

// ตั้งค่า CORS หากมีการระบุ Origin
if (process.env.CORS_ORIGIN) {
  const origins = process.env.CORS_ORIGIN.split(",").map(s => s.trim());
  app.use(cors({ origin: origins }));
}

// ให้บริการไฟล์ Static จากโฟลเดอร์ public
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));


// --- 4. UTILS & RATE LIMITING ---
/**
 * ทำความสะอาดชื่อผู้ใช้: อนุญาตเฉพาะตัวอักษร, ตัวเลข, _, -, และเว้นวรรค
 * @param {string} str - The input string.
 * @returns {string} The sanitized string.
 */
function sanitizeName(str) {
  return String(str || "").replace(/[^\p{L}\p{N}_\- ]/gu, "").trim().slice(0, 15);
}

// Rate Limiting: ป้องกันการยิง Request ถี่เกินไป
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_REQUESTS = 40;

function rateLimiter(req, res, next) {
  // ใช้ Rate Limit เฉพาะ Endpoint ที่สำคัญ (/score)
  if (req.path !== "/score") return next();

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "anonymous";
  const now = Date.now();
  const entry = rateLimitStore.get(ip) || { count: 0, timestamp: now };

  // ถ้าเวลาผ่านไปเกิน window ที่กำหนด ให้รีเซ็ต
  if (now - entry.timestamp > RATE_LIMIT_WINDOW_MS) {
    entry.timestamp = now;
    entry.count = 0;
  }

  entry.count++;
  rateLimitStore.set(ip, entry);

  // ถ้าจำนวน request เกินกำหนด ให้ส่ง 429 Too Many Requests
  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({ ok: false, message: "Too many requests" });
  }

  next();
}

// ล้าง Rate Limit Store ทุกๆ 10 นาที เพื่อไม่ให้หน่วยความจำเต็ม
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitStore.entries()) {
        if (now - entry.timestamp > RATE_LIMIT_WINDOW_MS * 10) {
            rateLimitStore.delete(ip);
        }
    }
}, 10 * 60 * 1000);


// --- 5. API ROUTES ---
app.get("/leaderboard", async (_req, res) => {
  try {
    const data = await dbService.getLeaderboard();
    res.json(data);
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.status(500).json({ ok: false, message: "Internal Server Error" });
  }
});

app.post("/score", rateLimiter, async (req, res) => {
  try {
    const { name, delta } = req.body || {};
    const cleanName = sanitizeName(name);
    // ตรวจสอบและจำกัดค่า delta ที่ส่งมา
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


// --- 6. SERVER STARTUP ---
app.listen(PORT, () => {
  console.log(`Debirun Pop server listening on http://localhost:${PORT}`);
  console.log(`Database in use: ${dbService.getType()}`);
});
