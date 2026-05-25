# ⚛️ Frontend — Rufaqaa Web

> React 18 · TypeScript · Vite · TanStack Query · Zustand · Tailwind CSS

---

## 📊 الحالة الحالية

**🟢 Phase 2 — Foundation** (هيكل أوّلي قابل للتشغيل)

- ✅ Vite + React 18 + TypeScript (strict)
- ✅ Tailwind مع ألوان الهوية (snow / tranquil / sky / trust)
- ✅ React Router v6 مع `ProtectedRoute`
- ✅ TanStack Query (server state)
- ✅ Zustand + persist (auth tokens in localStorage)
- ✅ Axios client مع JWT interceptor و401 handler
- ✅ React Hook Form + Zod للتحقق
- ✅ صفحة تسجيل دخول عربية مع validation
- ✅ Dashboard يعرض `/auth/me`
- ✅ صفحة قائمة الأيتام تستهلك `GET /api/v1/orphans`
- ✅ RTL + خط Noto Sans Arabic افتراضياً
- ✅ Vitest + Testing Library
- ✅ ESLint flat config + typescript-eslint

التالي: i18n (ar/en)، forms للإضافة/التعديل، صفحات المتبرعين والكفالات، Storybook، theming.

---

## 🚀 التشغيل

### المتطلبات
- Node.js 20+
- Backend يعمل على `http://localhost:8000` (أو ضع `VITE_API_URL`)

### الأوامر

```bash
cd frontend
npm install
npm run dev          # → http://localhost:3000 (proxy على /api → backend:8000)
npm run build        # bundle للإنتاج في dist/
npm run preview      # تشغيل الـ bundle
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm test             # Vitest
npm run test:watch
```

من جذر المستودع: `make frontend-install`, `make frontend-dev`, `make frontend-build`, `make frontend-test`, `make frontend-lint`.

---

## 🔐 الدخول الافتراضي (بعد `python -m app.scripts.seed`)

| الحقل | القيمة |
|---|---|
| البريد | `admin@dev.rufaqaa.app` |
| كلمة المرور | `admin12345` |

---

## 🏗️ المعمارية الحالية

```
frontend/
├── src/
│   ├── components/
│   │   ├── ProtectedRoute.tsx
│   │   └── layout/AppLayout.tsx
│   ├── hooks/
│   │   └── useCurrentUser.ts
│   ├── lib/
│   │   ├── api.ts          # Axios client + interceptors
│   │   ├── auth.ts         # login(), fetchMe()
│   │   └── orphans.ts      # listOrphans()
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── DashboardPage.tsx
│   │   └── OrphansPage.tsx
│   ├── store/
│   │   └── auth.ts         # Zustand + persist
│   ├── styles/globals.css  # Tailwind + base components
│   ├── App.tsx             # Router
│   └── main.tsx
├── tests/
│   ├── setup.ts
│   ├── LoginPage.test.tsx
│   └── auth.test.ts
├── eslint.config.js
├── tailwind.config.js
├── tsconfig.json
├── vite.config.ts
└── package.json
```

---

## 🎨 الهوية البصرية

ألوان رفقاء مسجّلة في `tailwind.config.js`:

```css
bg-snow      /* #F7FBFC — خلفية الصفحات */
bg-tranquil  /* #D6E6F2 — البطاقات والـ hover */
border-sky   /* #B9D7EA — الحدود */
bg-trust     /* #769FCD — الأزرار الرئيسية */
```

استخدم classes الجاهزة من `globals.css`:

- `.btn-primary` — زر أساسي
- `.input` — حقل إدخال
- `.card` — بطاقة

---

## 📡 الـ API Client

كل المسارات تمر عبر `src/lib/api.ts`:

- يُضيف `Authorization: Bearer <token>` تلقائياً من Zustand
- على 401 يمسح الـ tokens (يعيد المستخدم لـ `/login`)
- في التطوير: `vite.config.ts` يعمل proxy لـ `/api` إلى `localhost:8000`
- في الإنتاج: ضع `VITE_API_URL` على رابط backend
