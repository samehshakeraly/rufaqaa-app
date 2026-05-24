# 📱 Mobile Apps — Rufaqaa

> React Native · Expo · 4 تطبيقات منفصلة

---

## 📊 الحالة الحالية

**🚧 لم يبدأ التطوير بعد**

سيُبنى أول تطبيق (المتبرع) في **المرحلة 14**، بعد استقرار Backend و Frontend.

---

## 📋 التطبيقات الأربعة

| التطبيق | الجمهور | الأولوية |
|---|---|---|
| 💝 **Donor** | المتبرعون / الكفلاء | 🔴 الأهم — يُبنى أولاً |
| 🤲 **Guardian** | أولياء الأمور | 🟠 ثانياً |
| 👨‍💼 **Staff** | موظفو المؤسسات والجهات الشريكة | 🟡 ثالثاً |
| 🛡️ **Admin** | المديرون | 🟢 رابعاً |

---

## 📁 الهيكل المخطّط

```
mobile/
├── apps/
│   ├── donor/             # تطبيق المتبرع
│   │   ├── src/
│   │   ├── app.json
│   │   └── package.json
│   ├── guardian/          # تطبيق ولي الأمر
│   ├── staff/             # تطبيق الموظف
│   └── admin/             # تطبيق الإدارة
│
├── packages/              # حزم مشتركة
│   ├── shared/            # مكونات مشتركة
│   ├── api-client/        # عميل API الموحّد
│   ├── design-system/     # Design tokens + UI primitives
│   ├── i18n/              # الترجمات المشتركة
│   └── types/             # TypeScript types مشتركة
│
├── package.json           # Monorepo root (npm/pnpm workspaces)
└── README.md
```

---

## 🛠️ Stack المتوقّع

| المكتبة | الغرض |
|---|---|
| React Native (via Expo) | Framework |
| Expo Router | File-based routing |
| TanStack Query | API state |
| Zustand | Client state |
| React Native Reanimated | Animations |
| Expo Notifications | Push notifications |
| MMKV | Storage |
| Tamagui | UI components |

---

## 🚀 الإطلاق المتوقّع

```bash
cd mobile
pnpm install

# تطبيق المتبرع
pnpm --filter donor dev

# لاحقاً
pnpm --filter guardian dev
pnpm --filter staff dev
pnpm --filter admin dev
```
