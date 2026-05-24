# 🐍 Backend — Rufaqaa API

> Python 3.12 · FastAPI · PostgreSQL 15 · SQLAlchemy 2 · Alembic

---

## 📊 الحالة الحالية

**🟢 Phase 1 — Foundation** (هيكل أوّلي قابل للتشغيل)

- ✅ FastAPI app skeleton + lifespan + CORS
- ✅ Pydantic settings (`app/core/config.py`)
- ✅ Async SQLAlchemy 2.x + RLS session context (`app/core/database.py`)
- ✅ JWT + bcrypt (`app/core/security.py`)
- ✅ Alembic with initial migration that applies `docs/technical/01_database_schema.sql`
- ✅ `organizations` + `users` ORM models
- ✅ `/auth/login`, `/auth/refresh`, `/auth/me` endpoints
- ✅ `/health` + `/health/db` endpoints
- ✅ Dockerfile + integration into `docker-compose.yml`
- ✅ Unit tests for health + security primitives

التالي: روابط ORM للجداول الباقية، endpoints الأيتام/المتبرعين/الكفالات، Celery workers، MyFatoorah integration.

---

## 🚀 التشغيل

### عبر Docker (الأبسط)

```bash
# من جذر المستودع
cp .env.example .env
make up
```

API على http://localhost:8000 — التوثيق التفاعلي على http://localhost:8000/docs

### محلياً (Python venv)

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# يجب أن تكون postgres + redis قيد التشغيل (make up من الجذر)
alembic upgrade head
uvicorn app.main:app --reload
```

---

## 🧪 الاختبار والفحص

```bash
pytest                  # تشغيل كل الاختبارات
ruff check app tests    # فحص الكود
ruff format app tests   # تنسيق
mypy app                # فحص الأنواع
```

من الجذر: `make backend-test` · `make backend-lint` · `make backend-format`.

---

## 🗃️ الهجرات (Migrations)

الـ migration الأولى (`0001_initial_schema.py`) تُحمّل ملف SQL الأصلي
(`docs/technical/01_database_schema.sql`) مرة واحدة. الـ migrations اللاحقة
ستُولَّد تلقائياً من نماذج SQLAlchemy.

```bash
alembic upgrade head                       # تطبيق الكل
alembic revision -m "add new column"       # migration يدوي
alembic revision --autogenerate -m "..."   # توليد تلقائي من النماذج
alembic downgrade -1                       # تراجع خطوة
```

---

## 🏗️ المعمارية الحالية

```
backend/
├── app/
│   ├── api/
│   │   ├── deps.py              # FastAPI dependencies (auth, db, RLS)
│   │   └── v1/
│   │       ├── __init__.py      # api_router
│   │       ├── auth.py          # login / refresh / me
│   │       └── health.py        # /health, /health/db
│   ├── core/
│   │   ├── config.py            # Pydantic settings
│   │   ├── database.py          # Async engine + RLS session_scope
│   │   ├── security.py          # JWT + bcrypt
│   │   └── exceptions.py
│   ├── models/                  # SQLAlchemy ORM
│   │   ├── organization.py
│   │   └── user.py
│   ├── schemas/                 # Pydantic v2 DTOs
│   │   └── auth.py
│   └── main.py
├── migrations/                  # Alembic
│   ├── env.py
│   └── versions/
│       └── 0001_initial_schema.py
├── tests/
│   ├── conftest.py
│   └── unit/
├── Dockerfile
├── alembic.ini
└── pyproject.toml
```

---

## 🔐 ملاحظات Multi-Tenancy

- العزل بين المؤسسات يتم على مستوى PostgreSQL عبر **Row Level Security**.
- في كل طلب موثّق نضع `app.current_org_id` كـ GUC داخل المعاملة
  (`app/api/deps.py::get_current_user` + `app/core/database.py::session_scope`).
- لا تستعلم عن أي جدول مرتبط بـ `organization_id` خارج هذا السياق.

---

📚 راجع [مواصفات API الكاملة](../docs/technical/03_api_specification.yaml) (OpenAPI 3.0 — 50+ endpoint).
