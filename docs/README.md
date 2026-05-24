# 📚 توثيق رفقاء

> *Documentation Hub for Rufaqaa Platform*

---

## 🗺️ خريطة التوثيق

| المجلد | المحتوى | للمن؟ |
|---|---|---|
| 📖 [`analysis/`](analysis/) | التحليل الشامل والرؤية الأصلية | الجميع |
| 🛠️ [`technical/`](technical/) | المواصفات الفنية (DB · API · MCP) | المطورون |
| 🏛️ [`architecture/`](architecture/) | قرارات المعمارية الكبرى | المطورون · المعماريون |
| 📝 [`decisions/`](decisions/) | سجل القرارات (ADRs) | الجميع |
| 👤 [`user-guides/`](user-guides/) | أدلة المستخدمين | المستخدمون |

---

## 🌟 ابدأ من هنا

### للجدد على المشروع
1. اقرأ [README الرئيسي](../README.md) أولاً
2. ثم [التحليل الشامل](analysis/CONTEXT_HANDOVER.md) للفهم العميق
3. ثم [الفهرس](00_INDEX.md) للملاحة الشاملة

### للمطورين
1. [مخطط قاعدة البيانات](technical/01_database_schema.sql)
2. [مخطط العلاقات (ERD)](technical/02_erd_diagram.md)
3. [مواصفات API](technical/03_api_specification.yaml)
4. [أدوات MCP](technical/04_mcp_tools.md)

### للمساهمين
1. [دليل المساهمة](../CONTRIBUTING.md)
2. [ميثاق السلوك](../CODE_OF_CONDUCT.md)
3. [سياسة الأمن](../SECURITY.md)

---

## 📋 الوثائق الحالية

### ✅ مكتملة

- `analysis/CONTEXT_HANDOVER.md` — نقل السياق والرؤية الكاملة
- `00_INDEX.md` — الفهرس الشامل
- `technical/01_database_schema.sql` — Schema قاعدة البيانات (24 جدول)
- `technical/02_erd_diagram.md` — Entity Relationship Diagram
- `technical/03_api_specification.yaml` — OpenAPI 3.0 (50+ endpoint)
- `technical/04_mcp_tools.md` — مواصفات أدوات MCP

### 🚧 ستُضاف لاحقاً

- `architecture/` — قرارات المعمارية (مثل: لماذا PostgreSQL؟ لماذا FastAPI؟)
- `decisions/` — Architecture Decision Records (ADRs)
- `user-guides/` — أدلة المستخدمين بالأدوار العشرة

---

## 🤲 ملاحظة

التوثيق ليس مجرّد ملفات — بل ذاكرة المشروع المؤسسية.

كل قرار يُؤرَّخ، كل تغيير يُوثَّق، وكل من بعدنا يستطيع فهم *لماذا* اخترنا ما اخترنا.
