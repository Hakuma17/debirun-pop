# Debirun Pop — Full‑stack (Express + SQLite)

## Run locally
```bash
npm i
npm start
# open http://localhost:3000
```

## Deploy (Render/Railway/Fly)
- Create a new Web Service from this folder.
- Start command: `node server.js`
- The platform sets `PORT` automatically.

If your front‑end and API are **separate domains**, add an env var on the server:
```
CORS_ORIGIN=https://your-frontend.example
```
and load the page with `?api=https://your-api.example` (or set `window.API_URL` before `script.js`).

Database is a local `scores.db` (SQLite). Backup is the file itself.
