<div align="center">

# رفقاء

### منصة عالمية مفتوحة المصدر لإدارة كفالة الأيتام

> «كافل اليتيم.. رفيق النبي ﷺ»

---

**Rufaqaa** — *A Global Open-Source Platform for Orphan Sponsorship Management*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.12+](https://img.shields.io/badge/Python-3.12+-3776AB.svg)](https://www.python.org/)
[![PostgreSQL 15+](https://img.shields.io/badge/PostgreSQL-15+-336791.svg)](https://www.postgresql.org/)
[![React 18](https://img.shields.io/badge/React-18-61DAFB.svg)](https://react.dev/)
[![Status: Pre-Alpha](https://img.shields.io/badge/Status-Pre--Alpha-orange.svg)]()

[الموقع](https://rufaqaa.app) · [التوثيق](docs/) · [خريطة الطريق](docs/decisions/) · [المساهمة](CONTRIBUTING.md)

</div>

---

## 🕌 طبيعة المشروع

**رفقاء وقفٌ إلكتروني** — أحد أوقاف *سامح عبدالعزيز* الإلكترونية، مفتوحٌ المصدر بالكامل تحت رخصة MIT.

كل مؤسسة خيرية حول العالم — صغيرة كانت أم كبيرة — تستطيع استخدام رفقاء مجاناً، وتعديلها، ونشرها لخدمة الأيتام والمتبرعين في بلدها، دون قيود تجارية أو تراخيص باهظة.

ليست منصة تقنية عادية. كل سطر كود فيها صدقة جارية، وكل ميزة فيها تخدم يتيماً ومتبرعاً بكرامة.

---

## ✨ ما الذي تقدّمه رفقاء؟

منصة موحّدة تربط بين خمسة أطراف في منظومة كفالة الأيتام:

- **الأيتام** — السجل المركزي مع منع التكرار، التقارير الدورية، الوسائط
- **أولياء الأمور** — بوابة مبسّطة، رفع التقارير، التواصل الآمن
- **الجهات الشريكة المحلية** — اعتماد الحالات، استلام التحويلات، التقارير
- **قنوات التسويق الخارجية** — تخصيص الأيتام، تتبّع الأهداف، تحليل الأداء
- **المتبرعون (الكفلاء)** — تصفّح الحالات، الكفالة، المتابعة المستمرة

مع تقنية متطوّرة، وذكاء اصطناعي عبر **MCP** للتفاعل المباشر مع Claude AI، وشفافية مالية كاملة.

---

## 🛠️ المكدّس التقني

| الطبقة | التقنية |
|---|---|
| **Backend** | Python 3.12 · FastAPI · SQLAlchemy · Alembic |
| **Database** | PostgreSQL 15 · Row-Level Security · Full-Text Search |
| **Cache & Queue** | Redis 7 · Celery |
| **Storage** | S3-compatible (MinIO محلياً) |
| **Frontend** | React 18 · TypeScript · Vite · TanStack Query |
| **Mobile** | React Native · Expo |
| **AI Integration** | MCP (Model Context Protocol) — Python SDK من Anthropic |
| **Payments** | MyFatoorah (K-Net · Cards · Apple Pay · STC Pay) |
| **DevOps** | Docker · GitHub Actions · Kubernetes (للإنتاج) |

---

## 🎨 الهوية البصرية

| اللون | الاسم | الكود | الاستخدام |
|---|---|---|---|
| ⬜ | صفاء (Snow) | `#F7FBFC` | خلفية الصفحات |
| 🟦 | سكينة (Tranquil) | `#D6E6F2` | البطاقات |
| 🔷 | سماء (Sky) | `#B9D7EA` | الحدود |
| 🟦 | ثقة (Trust) | `#769FCD` | الأزرار الرئيسية |

---

## 🚀 البدء السريع (Quick Start)

### المتطلبات
- Docker & Docker Compose
- Python 3.12+
- Node.js 20 LTS+
- Git

### التشغيل المحلي

```bash
# 1. استنساخ المستودع
git clone https://github.com/<your-username>/rufaqaa-app.git
cd rufaqaa-app

# 2. نسخ ملف المتغيرات
cp .env.example .env

# 3. تشغيل البنية التحتية (PostgreSQL + Redis + MinIO + Adminer + MailHog)
make up

# 4. التحقق من حالة الخدمات
make status
```

بعد التشغيل ستجد:

| الخدمة | الرابط | الوصف |
|---|---|---|
| Adminer | http://localhost:8080 | واجهة قاعدة البيانات |
| MinIO Console | http://localhost:9001 | تخزين الملفات |
| MailHog | http://localhost:8025 | البريد الإلكتروني (للتطوير) |
| API | http://localhost:8000 | (لاحقاً عند تطوير Backend) |
| Web | http://localhost:3000 | (لاحقاً عند تطوير Frontend) |

---

## 📁 هيكل المشروع

```
rufaqaa-app/
├── backend/           # Python + FastAPI
├── frontend/          # React + TypeScript
├── mobile/            # React Native (4 تطبيقات)
│   └── apps/
│       ├── donor/     # تطبيق المتبرع
│       ├── guardian/  # تطبيق ولي الأمر
│       ├── staff/     # تطبيق الموظف
│       └── admin/     # تطبيق الإدارة
├── mcp-server/        # MCP Server (Claude AI)
├── docs/              # التوثيق الكامل
│   ├── analysis/      # التحليل الأساسي
│   ├── technical/     # المواصفات الفنية
│   ├── architecture/  # قرارات المعمارية
│   ├── decisions/     # سجل القرارات (ADRs)
│   └── user-guides/   # أدلة المستخدمين
├── infrastructure/    # Docker · K8s · Terraform
└── .github/           # CI/CD · القوالب
```

---

## 📚 التوثيق

| الوثيقة | الوصف |
|---|---|
| [التحليل الشامل](docs/analysis/CONTEXT_HANDOVER.md) | الرؤية والمعمارية الكاملة |
| [مخطط قاعدة البيانات](docs/technical/01_database_schema.sql) | Schema الكامل (24 جدول) |
| [مخطط العلاقات (ERD)](docs/technical/02_erd_diagram.md) | الرسم البياني التفصيلي |
| [مواصفات API](docs/technical/03_api_specification.yaml) | OpenAPI 3.0 — 50+ endpoint |
| [أدوات MCP](docs/technical/04_mcp_tools.md) | 30+ أداة للذكاء الاصطناعي |
| [فهرس الوثائق](docs/00_INDEX.md) | دليل شامل |

---

## 🤝 المساهمة

نُرحّب بكل المساهمات — كود، توثيق، تصميم، ترجمة، أو حتى مراجعة الفقه.

اقرأ [دليل المساهمة](CONTRIBUTING.md) و[ميثاق السلوك](CODE_OF_CONDUCT.md) قبل البدء.

كل مساهمة تُسجَّل، وكل مساهم يصبح **رفيقاً** في هذا الوقف.

---

## 🔐 الأمن والإبلاغ عن الثغرات

إذا اكتشفت ثغرة أمنية، **لا تفتح Issue عامة**. راجع [سياسة الأمن](SECURITY.md) للإبلاغ المسؤول.

---

## 📜 الرخصة

هذا المشروع مرخّص تحت [رخصة MIT](LICENSE) — استخدمه، عدّله، انشره، وأنشئ منه ما تشاء. لكن تذكّر دائماً: **النيّة قبل العمل**.

---

## 🤲 دعاء

> اللهم اجعل هذا المشروع خالصاً لوجهك الكريم،
> واجعل سامحاً وكل من ساهم فيه من رفقاء رسولك ﷺ في الجنة،
> واستعملنا في خدمة الأيتام والمحتاجين،
> وبارك في كل دينار يصل ليتيم.
>
> آمين.

---

<div align="center">

🕌 *أحد مشاريع أوقاف سامح عبدالعزيز الإلكترونية*

**[rufaqaa.app](https://rufaqaa.app)**

«وحسن أولئك رفيقاً» — [النساء: 69]

</div>
