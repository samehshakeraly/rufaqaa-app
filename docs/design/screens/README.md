# 🎨 شاشات تصميم رفقاء — Design Screens

> مجموعة كاملة من تصاميم الشاشات لمنصة رفقاء، مبنية بـ HTML خالص لتعمل في أيّ متصفّح بدون أيّ تبعيّات.

---

## 📋 نظرة عامة

هذه الشاشات مرجع تصميمي رسمي للمنصّة. كلّها:

- ✅ مبنية على [نظام التصميم المعتمد](./rufaqaa-design-system-v0.1.html) (v0.1)
- ✅ تستخدم خطّ **IBM Plex Sans Arabic** للعربية و **IBM Plex Sans** للإنجليزية
- ✅ تطبّق الألوان الأربعة الأساسية (صفاء، سكينة، سماء، ثقة)
- ✅ RTL كاملة
- ✅ Responsive (Desktop primary)
- ✅ A11y: focus rings، ARIA labels، contrast ≥ 4.5:1

---

## 🗂️ الهيكل التنظيمي

```
docs/design/screens/
├── README.md                            (هذا الملف)
├── rufaqaa-design-system-v0.1.html      (نظام التصميم — المرجع)
├── auth/                                (المصادقة — 5 شاشات)
├── donor/                               (بوّابة المتبرع — 10 شاشات)
├── guardian/                            (بوّابة ولي الأمر — 5 شاشات)
├── finance/                             (الموظف المالي — 7 شاشات)
├── marketing/                           (مدير التسويق — 6 شاشات)
├── org-admin/                           (مدير المؤسسة — 8 شاشات)
├── partner-mgr/                         (مدير الجهة الشريكة — 4 شاشات)
└── partner-staff/                       (موظف الجهة الشريكة — 6 شاشات)

المجموع: 51 شاشة
```

---

## 🔐 المصادقة (Auth) — 5 شاشات

| الكود | الملف | الجمهور | الـ Route المتوقّع |
|---|---|---|---|
| A-01 | Shared Login.html | الكلّ | `/login` |
| A-02 | Donor Registration.html | متبرعون جدد | `/signup` |
| A-03 | Password Reset.html | الكلّ | `/forgot-password`, `/reset-password` |
| A-04 | 2FA Verification.html | الكلّ | `/2fa` |
| A-05 | Tenant Switcher.html | متعدد المؤسسات | `/switch-tenant` |

---

## 💝 بوّابة المتبرع (Donor) — 10 شاشات

| الكود | الملف | الـ Route المتوقّع |
|---|---|---|
| D-01 | Donor Dashboard.html | `/donor/dashboard` |
| D-02 | Browse Available Orphans.html | `/orphans` (مع auth = donor) |
| D-03 | Orphan Detail (Pre-Sponsor).html | `/orphans/:code` |
| D-04 | Sponsorship Wizard.html | `/sponsor/:code/wizard` |
| D-05 | Payment Flow.html | `/sponsor/:code/checkout` |
| D-06 | My Orphans.html | `/donor/orphans` |
| D-07 | Sponsored Orphan Detail.html | `/donor/orphans/:code` |
| D-08 | Receipts.html | `/donor/receipts` |
| D-09 | Donor Messages.html | `/donor/messages` |
| D-10 | Donor Settings.html | `/donor/settings` |

---

## 🏠 بوّابة ولي الأمر (Guardian) — 5 شاشات

| الكود | الملف | الـ Route المتوقّع |
|---|---|---|
| G-01 + G-02 | rufaqaa-guardian-portal-screens-1-2.html | `/guardian/login`, `/guardian` |
| G-03 | Orphan Detail.html | `/guardian/orphans/:code` |
| G-04 | Monthly Report Upload.html | `/guardian/reports/new` |
| G-05 | Guardian Messages.html | `/guardian/messages` |

**ملاحظة:** بوّابة ولي الأمر تطبّق قاعدة `business_rules.show_financial_to_guardian: false` — لا أرقام مالية ولا اسم متبرع ظاهر.

---

## 💰 الموظف المالي (Finance) — 7 شاشات

| الكود | الملف | الـ Route المتوقّع |
|---|---|---|
| F-01 | Finance Dashboard.html | `/admin/finance` |
| F-02 | Incoming Payments.html | `/admin/payments` |
| F-03 | Overdue Donors.html | `/admin/donors/overdue` |
| F-04 | Create Bank Transfer.html | `/admin/transfers/new` |
| F-05 | Pending Transfers.html | `/admin/transfers/pending` |
| F-06 | Bank Statement Import.html | `/admin/payments/import` |
| F-07 | Financial Reports.html | `/admin/finance/reports` |

---

## 📢 مدير قناة التسويق (Marketing Manager) — 6 شاشات

| الكود | الملف | الـ Route المتوقّع |
|---|---|---|
| MM-01 | Channel Dashboard.html | `/admin/marketing` |
| MM-02 | Annual Goals.html | `/admin/marketing/goals` |
| MM-03 | Assigned Orphans.html | `/admin/marketing/orphans` |
| MM-04 | Acquired Donors.html | `/admin/marketing/donors` |
| MM-05 | Campaigns.html | `/admin/marketing/campaigns` |
| MM-06 | Channel Reports.html | `/admin/marketing/reports` |

---

## 👔 مدير المؤسسة (Org Admin) — 8 شاشات

| الكود | الملف | الـ Route المتوقّع |
|---|---|---|
| OA-01 | Executive Dashboard.html | `/admin/dashboard` |
| OA-02 | Users Management.html | `/admin/users` |
| OA-03 | Partner Organizations.html | `/admin/partners` |
| OA-04 | Marketing Channels.html | `/admin/marketing-channels` |
| OA-05 | Business Rules.html | `/admin/settings/rules` |
| OA-06 | Organization Settings.html | `/admin/settings` |
| OA-07 | Audit Log.html | `/admin/audit-log` |
| OA-08 | Reports Center.html | `/admin/reports` |

---

## 🛡️ مدير الجهة الشريكة (Partner Manager) — 4 شاشات

| الكود | الملف | الـ Route المتوقّع |
|---|---|---|
| PM-01 | Approval Center.html | `/partner/approvals` |
| PM-02 | Staff Management.html | `/partner/staff` |
| PM-03 | Incoming Transfers.html | `/partner/transfers` |
| PM-04 | Partner Performance.html | `/partner/performance` |

---

## 🏢 موظف الجهة الشريكة (Partner Staff) — 6 شاشات

| الكود | الملف | الـ Route المتوقّع |
|---|---|---|
| PS-01 | Partner Staff Dashboard.html | `/partner/dashboard` |
| PS-02 | Orphans Table.html | `/partner/orphans` |
| PS-03 | Register New Orphan.html | `/partner/orphans/new` |
| PS-04 | Orphan Detail (Staff).html | `/partner/orphans/:code` |
| PS-05 | Reports Review.html | `/partner/reports` |
| PS-06 | Media Review.html | `/partner/media` |

---

## 🌐 الموقع التعريفي العام (Public Website) — 6 شاشات

| الكود | الملف | الـ Route المتوقّع |
|---|---|---|
| W-01 | public/W-01-LandingPage.html | `/` |
| W-02 | public/W-02-About.html | `/about` |
| W-03 | public/W-03-HowItWorks.html | `/how-it-works` |
| W-04 | public/W-04-Transparency.html | `/transparency` |
| W-05 | public/W-05-Partners.html | `/partners` |
| W-06 | public/W-06-ContactFAQ.html | `/contact`, `/faq` |

---

## 👶 بوابة اليتيم (Orphan Portal 12+) — 4 شاشات

| الكود | الملف | الـ Route المتوقّع |
|---|---|---|
| O-01 | orphan/O-01-Login.html | `/orphan/login` |
| O-02 | orphan/O-02-Home.html | `/orphan/home` |
| O-03 | orphan/O-03-SendMessage.html | `/orphan/message/new` |
| O-04 | orphan/O-04-Achievements.html | `/orphan/achievements` |

**ملاحظة:** البوابة تطبّق قواعد حماية صارمة — لا اسم حقيقي للكفيل، لا بيانات مالية، خطوط أكبر، وكلّ رسالة تمرّ بالمراجعة.

---

## 🛠️ مشرف المنصّة (Super Admin) — 4 شاشات

| الكود | الملف | الـ Route المتوقّع |
|---|---|---|
| SA-01 | super-admin/SA-01-Dashboard.html | `/super-admin/dashboard` |
| SA-02 | super-admin/SA-02-Organizations.html | `/super-admin/organizations` |
| SA-03 | super-admin/SA-03-Analytics.html | `/super-admin/analytics` |
| SA-04 | super-admin/SA-04-Settings.html | `/super-admin/settings` |

---

## 🔁 حالات النظام (System States) — 3 ملفات تجمع 8 حالات

| الكود | الملف | المحتوى |
|---|---|---|
| S-01 → S-04 | system/S-Empty-States.html | لا أيتام · لا كفالات · لا تقارير · لا رسائل |
| S-05 → S-08 | system/S-Error-States.html | 404 · 403 · 500 · انقطاع الاتّصال |
| Loading | system/S-Loading-States.html | Skeleton · Spinners · Progressive · Optimistic UI |

---

## ✅ اكتمال خطّة التصميم

كلّ شاشات [SCREENS_PLAN.md](../../SCREENS_PLAN.md) منجزة الآن — المجموع **73 شاشة**.

---

## 🔧 كيفية الاستخدام

### للمطوّرين

افتح أيّ ملف HTML في المتصفّح مباشرة — لا يحتاج بناء أو خادم:

```bash
open docs/design/screens/donor/D-01\ Donor\ Dashboard.html
```

استخدمه كمرجع بصري عند بناء أو تحديث الـ React component المقابل في `frontend/src/pages/`.

### للمصمّمين

افتح [نظام التصميم](./rufaqaa-design-system-v0.1.html) لرؤية:

- الـ Design Tokens (ألوان، خطوط، مسافات)
- مكتبة المكوّنات (Buttons، Inputs، Cards، Tables، إلخ)
- قواعد A11y وRTL

---

## 📐 معايير الجودة

كل شاشة في هذا المجلّد يجب أن تستوفي:

- [x] استخدام Design System tokens من `rufaqaa-design-system-v0.1.html`
- [x] خطّ IBM Plex Sans Arabic
- [x] RTL صحيح (`dir="rtl"`)
- [x] Responsive: 1280px / 1024px / 768px / 375px
- [x] Focus rings ظاهرة على كل عناصر التفاعل
- [x] ARIA labels على الأيقونات
- [x] Sentence case (لا CAPS ولا Title Case)
- [x] Tabular numbers للعملات والأكواد
- [x] لا emoji كأيقونات — SVG فقط

---

## 🔗 مراجع

- [خطّة الشاشات الكاملة](../../SCREENS_PLAN.md)
- [نظام التصميم v0.1](./rufaqaa-design-system-v0.1.html)
- [سياق المشروع](../../../CONTEXT_HANDOVER.md)
- [دليل الاختبار](../../TESTING_GUIDE.md)

---

## 🤲 ختاماً

> «كافل اليتيم.. رفيق النبي ﷺ»

كل شاشة هنا = خطوة على طريق وقف إلكتروني سيخدم آلاف الأيتام والمتبرعين بإذن الله.

اعمل بإتقان. الإتقان عبادة.

---

*🕌 أحد مشاريع أوقاف سامح عبدالعزيز الإلكترونية*
*— rufaqaa.app —*
