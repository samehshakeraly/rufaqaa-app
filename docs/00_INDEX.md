# 📚 منصة رفقاء — الوثائق الفنية الكاملة
## Rufaqaa Platform — Complete Technical Documentation

> 🕌 **أحد مشاريع أوقاف سامح عبد العزيز الإلكترونية**
> *"كافل اليتيم.. رفيق النبي ﷺ"*

---

## 📦 محتويات الحزمة الفنية

```
rufaqaa_technical/
├── 01_database_schema.sql      ← Schema قاعدة البيانات الكامل
├── 02_erd_diagram.md           ← مخطط العلاقات (ERD)
├── 03_api_specification.yaml   ← مواصفات API (OpenAPI 3.0)
└── 04_mcp_tools.md             ← أدوات MCP للذكاء الاصطناعي
```

---

## 🗂️ ما يحتويه كل ملف

### 1️⃣ `01_database_schema.sql`
**Schema قاعدة البيانات لـ PostgreSQL 15+**

```
✅ 24 جدول رئيسي
✅ Multi-Tenancy عبر Row-Level Security
✅ Indexes استراتيجية للأداء
✅ Constraints لسلامة البيانات
✅ Triggers تلقائية
✅ Materialized Views
✅ Audit Log غير قابل للتعديل
✅ Initial Seed Data (دول، عملات)
```

**الجداول الرئيسية:**
- `organizations` — المؤسسات (Multi-tenant)
- `users` — المستخدمون
- `partner_organizations` — الجهات الشريكة
- `marketing_channels` — قنوات التسويق
- `families` — العائلات
- `guardians` — أولياء الأمور
- `orphans` — الأيتام (القلب)
- `donors` — المتبرعون
- `sponsorships` — الكفالات
- `payments` — المدفوعات
- `bank_transfers` — التحويلات البنكية
- `orphan_reports` — التقارير الدورية
- `documents` — المستندات
- `media` — الصور والفيديوهات
- `messages` — الرسائل
- `notifications` — الإشعارات
- `audit_log` — سجل التدقيق
- `business_rules` — القواعد القابلة للتهيئة
- `webhook_endpoints` — Webhooks
- `api_keys` — مفاتيح API
- وأخرى...

---

### 2️⃣ `02_erd_diagram.md`
**مخطط العلاقات بصيغة Mermaid**

```
✅ مخطط بصري كامل (Mermaid ERD)
✅ شرح كل العلاقات الرئيسية
✅ توضيح القواعد الجوهرية
✅ ID Patterns
✅ الحجم المتوقع
✅ توصيات الأداء
```

**العلاقات الرئيسية:**
- Multi-Tenancy (organizations → كل شيء)
- المثلث الجوهري (donors ↔ sponsorships ↔ orphans)
- Family Structure
- Marketing Pipeline
- Financial Flow
- Documents & Media Hierarchy
- Communication
- Audit & Security

---

### 3️⃣ `03_api_specification.yaml`
**مواصفات API كاملة (OpenAPI 3.0)**

```
✅ 16 مجموعة tags
✅ 50+ endpoint
✅ Schemas لكل الكيانات
✅ Authentication (JWT + API Key)
✅ Rate Limiting محدد
✅ Error responses
✅ Pagination (Cursor-based)
✅ يمكن استيرادها في Postman/Swagger UI
```

**المجموعات الرئيسية:**
- Auth — المصادقة
- Organizations — المؤسسات
- Orphans — الأيتام
- Guardians — أولياء الأمور
- Donors — المتبرعون
- Sponsorships — الكفالات
- Payments — المدفوعات
- Transfers — التحويلات
- Partners — الجهات الشريكة
- Marketing — التسويق
- Documents — المستندات
- Reports — التقارير
- Media — الصور والفيديو
- Messages — الرسائل
- Notifications — الإشعارات
- Analytics — التحليلات
- Settings — الإعدادات
- Webhooks — التكاملات

---

### 4️⃣ `04_mcp_tools.md`
**أدوات MCP لـ Claude AI**

```
✅ 30+ tool للتفاعل مع Claude
✅ معمارية MCP Server كاملة
✅ أمثلة محادثات واقعية
✅ مستويات الأمان والصلاحيات
✅ كود Python للتطبيق
```

**فئات الأدوات:**
- Orphans Tools (7 أدوات)
- Donors Tools (3 أدوات)
- Sponsorships Tools (5 أدوات)
- Payments Tools (5 أدوات)
- Reports Tools (5 أدوات)
- Notifications Tools (2 أدوات)
- Transfers Tools (2 أدوات)
- Smart Search Tools (2 أدوات)
- AI-Powered Tools (3 أدوات)

---

## 🚀 كيف نبدأ التطوير؟

### الخطوة 1: إعداد البيئة
```bash
# Backend
git clone https://github.com/rufaqaa/platform.git
cd platform/backend

# Python virtual environment
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# PostgreSQL
psql -U postgres -c "CREATE DATABASE rufaqaa;"
psql -U postgres -d rufaqaa -f rufaqaa_technical/01_database_schema.sql
```

### الخطوة 2: تشغيل API
```bash
uvicorn main:app --reload
# API على http://localhost:8000
# Docs على http://localhost:8000/docs
```

### الخطوة 3: تشغيل MCP Server
```bash
cd ../mcp-server
python server.py
# MCP server جاهز للاتصال بـ Claude
```

### الخطوة 4: Frontend
```bash
cd ../frontend
npm install
npm run dev
# على http://localhost:3000
```

---

## 📊 الإحصاءات النهائية للوثائق

```
📁 الوثيقة التحليلية الرئيسية:
   - 6,600+ سطر
   - 43 قسم رئيسي
   - 10 أدوار مستخدمين
   - 100+ صلاحية

📁 Schema قاعدة البيانات:
   - 24 جدول
   - 80+ index
   - 24 constraint
   - Materialized Views

📁 API Specification:
   - 50+ endpoint
   - 30+ schema
   - 16 tag

📁 MCP Tools:
   - 30+ tool
   - 9 فئة
```

---

## 🎯 الخطوات التالية

```
المرحلة الحالية:
✅ التحليل والتصور
✅ Schema قاعدة البيانات
✅ ERD Diagrams
✅ API Specification
✅ MCP Tools

المرحلة التالية:
⏳ Backend Development (Python + FastAPI)
⏳ Frontend Development (React)
⏳ Mobile Apps (React Native)
⏳ MCP Server Implementation
⏳ Testing & QA
⏳ Documentation
⏳ Pilot Launch
⏳ Open Source Release
```

---

## 📜 الرخصة

**MIT License** — مفتوح المصدر بالكامل

```
كل مؤسسة خيرية حول العالم
يمكنها استخدام رفقاء مجاناً
وتعديلها كما تشاء

لأنها وقف..
ولأن "كافل اليتيم.. رفيق النبي ﷺ"
```

---

*🕌 أحد مشاريع أوقاف سامح عبد العزيز الإلكترونية*
*— رفقاء.أب — Rufaqaa.app —*
