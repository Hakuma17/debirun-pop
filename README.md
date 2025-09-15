
# 🌟 Debirun Pop — Dustarian Mission

![Debirun Pop Game](https://github.com/user-attachments/assets/9a471c78-d55f-4d2e-b0d9-749ca29a28b1)

**Debirun Pop** เป็นเกมเว็บแบบ clicking/idle game ที่มีธีมอวกาศ พร้อมตัวละครสุดน่ารัก "เดบิรุน" ที่ผู้เล่นสามารถคลิกเพื่อส่งมอบพลังและปลดล็อกเลเวลต่างๆ ได้! 🚀

## ✨ คุณสมบัติหลัก

- 🎮 **เกมคลิกแบบ Real-time** - คลิกเดบิรุนเพื่อรับคะแนนและปลดล็อกเลเวลใหม่
- 🏆 **ระบบจัดอันดับ** - แข่งขันกับผู้เล่นคนอื่นๆ ในตารางคะแนน
- 🔊 **เสียงประกอบ** - เสียงเอฟเฟกต์และเพลงประกอบสุดน่ารัก
- 📱 **Responsive Design** - เล่นได้ทั้งบนมือถือและคอมพิวเตอร์
- 🌌 **ธีมอวกาศสุดสวย** - กราฟิกพื้นหลังและเอฟเฟกต์ดาวตกสุดงาม
- 💾 **ระบบฐานข้อมูล** - รองรับทั้ง SQLite และ Firestore

![Game Interface](https://github.com/user-attachments/assets/15e93073-f6a4-42a7-b4df-c95a1301518f)

## 🎯 วิธีการเล่น

1. **ลงทะเบียน** - ใส่ชื่อ Agent ของคุณ (สูงสุด 15 ตัวอักษร)
2. **คลิกเดบิรุน** - คลิกที่ตัวละครเพื่อรับคะแนน POWER
3. **ปลดล็อกเลเวล** - รวบรวม POWER เพื่อเพิ่มเลเวลและปลดล็อกฟีเจอร์ใหม่
4. **แข่งขัน** - ดูคะแนนของคุณในตารางอันดับ
5. **สนุกไปกับเสียงและเอฟเฟกต์** - เพลิดเพลินกับเสียงประกอบจาก Debirun Ch.

## 🚀 การติดตั้งและรัน

### รันบนเครื่อง (Local Development)

```bash
# 1. Clone repository
git clone https://github.com/Hakuma17/debirun-pop.git
cd debirun-pop

# 2. ติดตั้ง dependencies
npm install

# 3. เริ่มเซิร์ฟเวอร์
npm start

# 4. เปิดเบราว์เซอร์ไปที่
# http://localhost:3000
```

### 📋 ข้อกำหนดระบบ

- **Node.js** เวอร์ชัน 16+ 
- **npm** สำหรับจัดการ packages
- เบราว์เซอร์ที่รองรับ HTML5 และ Web Audio API

## 🌐 การ Deploy

### ⚡ Quick Deploy บน Cloud Platforms

รองรับการ deploy บนแพลตฟอร์มต่างๆ เช่น:

- **Render** 🟢
- **Railway** 🚂  
- **Fly.io** ✈️
- **Heroku** 💜

#### ขั้นตอนการ Deploy:

1. สร้าง **Web Service** ใหม่จากโปรเจกต์นี้
2. ตั้งค่า Start Command: `node server.js`
3. แพลตฟอร์มจะตั้งค่า `PORT` ให้อัตโนมัติ

### ⚙️ ตัวแปรสภาพแวดล้อม (Environment Variables)

```bash
# [ออปชัน] CORS สำหรับ Cross-Domain
CORS_ORIGIN=https://your-frontend.example

# [ออปชัน] บังคับใช้ HTTPS
FORCE_HTTPS=1

# [ออปชัน] ใช้ Firestore แทน SQLite
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}

# [ออปชัน] ตำแหน่งไฟล์ฐานข้อมูล SQLite
DB_PATH=/path/to/scores.db
```

## 🗄️ ระบบฐานข้อมูล

โปรเจกต์รองรับฐานข้อมูล 2 แบบ:

### 📁 SQLite (ค่าเริ่มต้น)
- ไฟล์: `scores.db` 
- เหมาะสำหรับ development และ small deployments
- การสำรองข้อมูล: สำรองไฟล์ `scores.db` โดยตรง

### ☁️ Firebase Firestore  
- เหมาะสำหรับ production และ scalability
- ตั้งค่าผ่าน `FIREBASE_SERVICE_ACCOUNT` environment variable

## 🛠️ เทคโนโลยีที่ใช้

### Backend
- **Express.js** - Web framework สำหรับ Node.js
- **better-sqlite3** - SQLite database interface  
- **firebase-admin** - Firestore support
- **cors** - Cross-Origin Resource Sharing
- **compression** - Response compression

### Frontend  
- **Vanilla JavaScript** - ไม่ต้องพึ่ง framework ใหญ่ๆ
- **CSS3** - Animations และ responsive design
- **Web Audio API** - เสียงประกอบ
- **Canvas/CSS Effects** - เอฟเฟกต์ดาวตกและอวกาศ

## 📊 API Endpoints

```bash
GET  /leaderboard     # ตารางคะแนนอันดับต้นๆ (50 อันดับ)
GET  /player/:name    # ข้อมูลผู้เล่นรายบุคคล  
POST /score           # เพิ่มคะแนนให้ผู้เล่น
GET  /community       # คะแนนรวมของชุมชน
GET  /healthz         # ตรวจสุขภาพระบบ
```

## 🎨 เครดิต

- **ตัวละครเดบิรุน**: [Debirun Ch. Pixela-World-End](https://youtube.com/@debirunworldend)
- **ภาพประกอบ**: [@6nnae6](https://twitter.com/6nnae6)  
- **เสียงประกอบ**: Debirun Ch. Pixela-World-End
- **พื้นหลังอวกาศ**: [Unsplash • Greg Rakozy](https://unsplash.com/photos/Q1p7bh3SHj8)

## 🔗 ติดตามเดบิรุน

- 📺 [YouTube](https://youtube.com/@debirunworldend?si=CWReY3AJ_qvl6nfs)
- 🐦 [Twitter/X](https://twitter.com/DebirunWorldEnd)  
- 📘 [Facebook](https://facebook.com/DebirunWorldEnd)
- 🎵 [TikTok](https://tiktok.com/@debirunworldend)

## 📜 ลิขสิทธิ์

โปรเจกต์นี้สร้างขึ้นเพื่อเป็นส่วนหนึ่งของชุมชนแฟนๆ Debirun และเปิดให้ใช้งานสำหรับการเรียนรู้และความบันเทิง

---

**สนุกกับการส่งมอบพลังให้เดบิรุน! 🌟✨**
