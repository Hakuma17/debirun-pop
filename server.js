// server.js — Debirun Pop (all‑in‑one server + static hosting)
// Run: npm i && npm start  (PORT is provided by platform or defaults to 3000)
const express = require("express");
const path = require("path");
const compression = require("compression");
const Database = require("better-sqlite3");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Database (SQLite with file persistence)
const db = new Database(path.join(__dirname, "scores.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    score INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_players_score ON players(score DESC);
`);

// Middlewares
app.use(compression());
app.use(express.json());

// If you host the API on a different domain than the static site, set CORS_ORIGIN to that origin (comma‑separated allowed)
if (process.env.CORS_ORIGIN) {
  const origins = process.env.CORS_ORIGIN.split(",").map(s => s.trim());
  app.use(cors({ origin: origins, credentials: false }));
}

// Static files (front‑end lives in /public)
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: "1h",
  etag: true
}));

// Helpers
function sanitizeName(str) {
  return String(str || "")
    .replace(/[^\p{L}\p{N}_\- ]/gu, "")
    .trim()
    .slice(0, 15);
}

// Simple burst limit for /score to avoid spam (per IP, per second)
const rate = new Map();
function rateLimit(req, res, next) {
  if (req.path !== "/score") return next();
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "ip";
  const now = Date.now();
  const win = 1000;
  const entry = rate.get(ip) || { ts: now, count: 0 };
  if (now - entry.ts > win) { entry.ts = now; entry.count = 0; }
  entry.count += 1;
  rate.set(ip, entry);
  if (entry.count > 40) return res.status(429).json({ ok: false, message: "Too many requests" });
  next();
}

// API: leaderboard (top 50)
app.get("/leaderboard", (req, res) => {
  const rows = db.prepare("SELECT name, score FROM players ORDER BY score DESC, updated_at ASC LIMIT 50").all();
  res.json(rows);
});

// API: add delta to player's score
app.post("/score", rateLimit, (req, res) => {
  const { name, delta } = req.body || {};
  const clean = sanitizeName(name);
  const d = Math.min(Math.max(parseInt(delta, 10) || 0, 0), 500); // clamp 0..500
  if (!clean || d <= 0) return res.status(400).json({ ok: false, message: "Bad input" });

  // Upsert then update with delta
  db.prepare("INSERT INTO players (name, score) VALUES (?, 0) ON CONFLICT(name) DO NOTHING").run(clean);
  db.prepare("UPDATE players SET score = score + ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?").run(d, clean);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Debirun Pop server listening on http://localhost:${PORT}`);
});
