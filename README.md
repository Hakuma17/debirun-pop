
# Debirun Pop — ฟูลสแต็ก (Express + SQLite)

## รันบนเครื่อง (Local)

```bash
npm i
npm start
# เปิด http://localhost:3000
```

## ดีพลอย (Render/Railway/Fly)

* สร้าง **Web Service** ใหม่จากโฟลเดอร์นี้
* Start command: `node server.js`
* แพลตฟอร์มจะตั้งค่า `PORT` ให้โดยอัตโนมัติ

หากหน้าเว็บ (front-end) และ API อยู่ **คนละโดเมน**, ให้เพิ่มตัวแปรสภาพแวดล้อมบนเซิร์ฟเวอร์:

```
CORS_ORIGIN=https://your-frontend.example
```

แล้วโหลดหน้าเว็บด้วย `?api=https://your-api.example` (หรือกำหนด `window.API_URL` ก่อนโหลด `script.js`)

ฐานข้อมูลใช้ไฟล์ **`scores.db`** (SQLite) ภายในเซิร์ฟเวอร์เอง การสำรองข้อมูลคือสำรองไฟล์นี้โดยตรง.
