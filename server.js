// server.js — Debirun Pop (all-in-one server + static hosting)
// Run: npm i && npm start  (PORT is provided by platform or defaults to 3000)
const express    = require("express");
const path       = require("path");
const compression= require("compression");
const Database   = require("better-sqlite3");
const cors       = require("cors");

const app  = express();
const PORT = process.env.PORT || 3000;

// ===== Database (SQLite with file persistence) =====
// ใช้ตัวแปรแวดล้อม DB_PATH ได้ (เช่น /var/data/scores.db บน Render)
// ถ้าไม่ตั้ง จะใช้ไฟล์ scores.db ในโฟลเดอร์โปรเจกต์นี้
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "scores.db");
const db = new Database(DB_PATH);
console.log("SQLite DB:", DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    score INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_players_score ON players(score DESC);
`);

// ===== Middlewares =====
app.use(compression());
app.use(express.json());

// ถ้าโฮสต์ API คนละโดเมนกับหน้าเว็บ ให้ตั้ง CORS_ORIGIN เป็น origin ที่อนุญาต (คั่นด้วย , ได้)
if (process.env.CORS_ORIGIN) {
  const origins = process.env.CORS_ORIGIN.split(",").map(s => s.trim());
  app.use(cors({ origin: origins, credentials: false }));
}

// เสิร์ฟไฟล์หน้าเว็บจาก /public
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: "1h",
  etag: true
}));

// ===== Helpers =====
function sanitizeName(str) {
  return String(str || "")
    .replace(/[^\p{L}\p{N}_\- ]/gu, "") // เอาเฉพาะตัวอักษร/ตัวเลข/ขีด/ช่องว่าง
    .trim()
    .slice(0, 15);
}

// Burst limit เบาๆ สำหรับ /score (กันสแปม: ต่อ IP ต่อวินาที)
const rate = new Map();
function rateLimit(req, res, next) {
  if (req.path !== "/score") return next();
  const ip  = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
           || req.socket.remoteAddress || "ip";
  const now = Date.now();
  const win = 1000;
  const entry = rate.get(ip) || { ts: now, count: 0 };
  if (now - entry.ts > win) { entry.ts = now; entry.count = 0; }
  entry.count += 1;
  rate.set(ip, entry);
  if (entry.count > 40) {
    return res.status(429).json({ ok: false, message: "Too many requests" });
  }
  next();
}

// ===== API =====
// TOP 50
app.get("/leaderboard", (req, res) => {
  const rows = db.prepare(`
    SELECT name, score
    FROM players
    ORDER BY score DESC, updated_at ASC
    LIMIT 50
  `).all();
  res.json(rows);
});

// เพิ่มคะแนนแบบ delta
app.post("/score", rateLimit, (req, res) => {
  const { name, delta } = req.body || {};
  const clean = sanitizeName(name);
  const d = Math.min(Math.max(parseInt(delta, 10) || 0, 0), 500); // 0..500
  if (!clean || d <= 0) {
    return res.status(400).json({ ok: false, message: "Bad input" });
  }

  // upsert แล้วค่อยอัปเดตคะแนน
  db.prepare("INSERT INTO players (name, score) VALUES (?, 0) ON CONFLICT(name) DO NOTHING")
    .run(clean);
  db.prepare("UPDATE players SET score = score + ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?")
    .run(d, clean);

  res.json({ ok: true });
});

// health check (เผื่อแพลตฟอร์ม/ตัวเองเช็ก)
app.get("/healthz", (req, res) => res.json({ ok: true }));

// ===== Start =====
app.listen(PORT, () => {
  console.log(`Debirun Pop server listening on http://localhost:${PORT}`);
});
