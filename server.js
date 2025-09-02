// server.js — Debirun Pop (Express + Firestore/SQLite)
// Run: npm i && npm start
const express     = require("express");
const path        = require("path");
const compression = require("compression");
const cors        = require("cors");

const app  = express();
const PORT = process.env.PORT || 3000;

// ===== เลือกฐานข้อมูลอัตโนมัติ =====
const USE_FIREBASE = !!process.env.FIREBASE_SERVICE_ACCOUNT;

// ให้ทั้งสองโหมดมีสัญญาใช้งานเหมือนกัน
let store = {
  leaderboard: async () => [],
  addScore:   async (_name,_delta)=>{},
  community:  async () => ({ total: 0 })
};

if (USE_FIREBASE) {
  // ---------- Firestore (Firebase Admin) ----------
  const admin = require("firebase-admin");
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  const db = admin.firestore();
  const fv = admin.firestore.FieldValue;
  console.log("Using Firestore");

  store.leaderboard = async () => {
    const snap = await db.collection("players")
      .orderBy("score", "desc")
      .limit(50)
      .get();
    return snap.docs.map(d => ({ name: d.id, score: d.data().score || 0 }));
  };

  store.addScore = async (name, delta) => {
    const pRef = db.collection("players").doc(name);
    const cRef = db.collection("counters").doc("community");
    await db.runTransaction(async t => {
      const pDoc = await t.get(pRef);
      const old  = pDoc.exists ? (pDoc.data().score || 0) : 0;
      t.set(pRef, {
        score: old + delta,
        updated_at: fv.serverTimestamp()
      }, { merge: true });
      t.set(cRef, { total: fv.increment(delta) }, { merge: true });
    });
  };

  store.community = async () => {
    const doc = await db.collection("counters").doc("community").get();
    return doc.exists ? { total: doc.data().total || 0 } : { total: 0 };
  };

} else {
  // ---------- SQLite (เดิม) ----------
  const Database = require("better-sqlite3");
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, "scores.db");
  const sqlite = new Database(DB_PATH);
  console.log("Using local SQLite:", DB_PATH);

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
    INSERT INTO counters (id,total) VALUES (1,0) ON CONFLICT(id) DO NOTHING;
  `);

  store.leaderboard = async () =>
    sqlite.prepare("SELECT name, score FROM players ORDER BY score DESC, updated_at ASC LIMIT 50").all();

  store.addScore = async (name, delta) => {
    sqlite.prepare("INSERT INTO players (name, score) VALUES (?, 0) ON CONFLICT(name) DO NOTHING").run(name);
    sqlite.prepare("UPDATE players SET score = score + ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?").run(delta, name);
    sqlite.prepare("UPDATE counters SET total = total + ? WHERE id = 1").run(delta);
  };

  store.community = async () =>
    sqlite.prepare("SELECT total FROM counters WHERE id = 1").get() || { total: 0 };
}

// ===== Middlewares =====
app.use(compression());
app.use(express.json());

// CORS (ถ้า front/API คนละโดเมน)
if (process.env.CORS_ORIGIN) {
  const origins = process.env.CORS_ORIGIN.split(",").map(s => s.trim());
  app.use(cors({ origin: origins, credentials: false }));
}

// Static files
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h", etag: true }));

// ===== Utils & Rate limit =====
function sanitizeName(str) {
  return String(str || "").replace(/[^\p{L}\p{N}_\- ]/gu, "").trim().slice(0, 15);
}
const rate = new Map();
function rateLimit(req, res, next) {
  if (req.path !== "/score") return next();
  const ip  = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "ip";
  const now = Date.now(), win = 1000;
  const e = rate.get(ip) || { ts: now, count: 0 };
  if (now - e.ts > win) { e.ts = now; e.count = 0; }
  if (++e.count > 40) return res.status(429).json({ ok:false, message:"Too many requests" });
  rate.set(ip, e); next();
}

// ===== API =====
app.get("/leaderboard", async (_req, res) => {
  res.json(await store.leaderboard());
});

app.post("/score", rateLimit, async (req, res) => {
  const { name, delta } = req.body || {};
  const clean = sanitizeName(name);
  const d = Math.min(Math.max(parseInt(delta, 10) || 0, 0), 500);
  if (!clean || d <= 0) return res.status(400).json({ ok:false, message:"Bad input" });
  await store.addScore(clean, d);
  res.json({ ok:true });
});

// Co-op meter
app.get("/community", async (_req, res) => {
  res.json(await store.community());
});

// health check
app.get("/healthz", (_req, res) => res.json({ ok: true, db: USE_FIREBASE ? "firestore" : "sqlite" }));

// ===== Start =====
app.listen(PORT, () => {
  console.log(`Debirun Pop server listening on http://localhost:${PORT}`);
});
