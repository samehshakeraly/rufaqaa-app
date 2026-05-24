# ⚛️ Frontend — Rufaqaa Web

> React 18 · TypeScript · Vite · TanStack Query · Zustand · Tailwind CSS

---

## 📊 الحالة الحالية

**🚧 لم يبدأ التطوير بعد**

سيُبنى Frontend في **المرحلة 10** من خطة المشروع، بعد اكتمال Backend الأساسي.

---

## 📋 المخطّط

### المعمارية

```
frontend/
├── src/
│   ├── components/        # المكونات القابلة لإعادة الاستخدام
│   │   ├── ui/            # المكونات الأساسية (Button, Input, ...)
│   │   ├── forms/         # نماذج معقّدة
│   │   └── layout/        # Header, Sidebar, Footer
│   │
│   ├── pages/             # صفحات حسب الدور
│   │   ├── admin/
│   │   ├── partner/
│   │   ├── marketing/
│   │   ├── donor/
│   │   └── guardian/
│   │
│   ├── hooks/             # Custom hooks
│   ├── services/          # API clients
│   ├── store/             # Zustand stores
│   ├── lib/               # Utilities
│   ├── locales/           # i18n (ar, en)
│   ├── styles/            # Tailwind config + globals
│   ├── App.tsx
│   └── main.tsx
│
├── public/
├── tests/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.ts
```

### Stack المتوقّع

| المكتبة | الغرض |
|---|---|
| React 18 | UI library |
| TypeScript 5 | Type safety |
| Vite | Build tool |
| React Router 6 | Routing |
| TanStack Query | Server state |
| Zustand | Client state |
| React Hook Form + Zod | Forms + validation |
| Tailwind CSS | Styling |
| Radix UI | Accessible primitives |
| i18next | i18n (ar/en + RTL) |
| date-fns + date-fns-hijri | Dates (Gregorian + Hijri) |
| Vitest + Testing Library | Testing |

---

## 🎨 الهوية البصرية

استخدم الـ Design Tokens من ملفات التصميم — لا ألوان مباشرة في الكود.

ألوان رفقاء:
- `snow` — `#F7FBFC`
- `tranquil` — `#D6E6F2`
- `sky` — `#B9D7EA`
- `trust` — `#769FCD`

---

## 🚀 الإطلاق المتوقّع

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```
