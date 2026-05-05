# 📚 مكتبة حشايشي — نظام نقطة البيع (سطح المكتب)

## 🗂️ هيكل المشروع

```
pos-desktop/
├── main.js                   ← العملية الرئيسية (Electron)
├── preload.js                ← جسر IPC الآمن
├── package.json
│
├── renderer/
│   └── index.html            ← واجهة React (تعمل أيضاً على GitHub Pages)
│
├── database/
│   ├── schema.sql            ← تعريف جداول SQLite
│   └── db.js                 ← طبقة CRUD المحلية
│
├── sync/
│   ├── syncEngine.js         ← محرك المزامنة مع Supabase
│   └── backup.js             ← نسخ احتياطي تلقائي
│
└── .github/workflows/
    └── build.yml             ← بناء تلقائي لـ Windows 32-bit
```

---

## 🚀 تشغيل للتطوير

```bash
npm install
npm start
```

## 📦 بناء المثبّت

```bash
npm run build:win32    # Windows 32-bit (.exe)
```

---

## ⚙️ كيف يعمل الـ DB Router

```javascript
// نفس الكود يعمل في كلا البيئتين:
const data = await db.getAll('products');

// على الكمبيوتر  → SQLite (بدون إنترنت)
// على الهاتف     → Supabase (مباشرة)
```

---

## 🔄 محرك المزامنة

| الميزة | التفاصيل |
|--------|----------|
| Offline-First | يكتب محلياً أولاً دائماً |
| Exponential Backoff | 1s → 5s → 60s → 300s → 900s |
| Delta Sync | يجلب التغييرات فقط (لا كامل البيانات) |
| Bootstrap Pagination | 500 سجل/دفعة مع استئناف عند الانقطاع |
| Negative Stock | يحمي من الرصيد السالب مع تنبيه |

---

## 💾 النسخ الاحتياطي

- **يومي**: عند إغلاق التطبيق + كل 24 ساعة
- **أسبوعي**: كل يوم أحد
- **USB**: تلقائي عند الإغلاق إذا كان مفتاح USB موصولاً
- **الاحتفاظ**: آخر 7 نسخ يومية + آخر 4 أسبوعية

---

## 📱 GitHub Pages (نسخة الهاتف)

يُرفع `renderer/index.html` مباشرة على GitHub Pages — تتصل بـ Supabase دون أي تغيير.
