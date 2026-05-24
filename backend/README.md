# 🐍 Backend — Rufaqaa API

> Python 3.12 · FastAPI · PostgreSQL 15 · Redis · Celery

---

## 📊 الحالة الحالية

**🚧 لم يبدأ التطوير بعد**

سيُبنى Backend في **المرحلة 2** من خطة المشروع.

---

## 📋 المخطّط

### المعمارية

```
backend/
├── app/
│   ├── api/              # REST endpoints
│   │   ├── v1/
│   │   │   ├── auth/
│   │   │   ├── orphans/
│   │   │   ├── donors/
│   │   │   ├── sponsorships/
│   │   │   └── ...
│   │   └── deps.py       # Dependencies (auth, db)
│   │
│   ├── core/             # Core utilities
│   │   ├── config.py     # Settings via pydantic-settings
│   │   ├── security.py   # JWT, password hashing, 2FA
│   │   ├── database.py   # SQLAlchemy + RLS middleware
│   │   └── exceptions.py
│   │
│   ├── models/           # SQLAlchemy ORM models
│   ├── schemas/          # Pydantic schemas (request/response)
│   ├── services/         # Business logic
│   ├── workers/          # Celery tasks
│   ├── utils/
│   └── main.py           # FastAPI app entry
│
├── migrations/           # Alembic migrations
│   └── versions/
│
├── tests/
│   ├── conftest.py
│   ├── unit/
│   └── integration/
│
├── pyproject.toml        # Dependencies + tool config
├── alembic.ini
└── README.md
```

### Stack المتوقّع

| المكتبة | الغرض |
|---|---|
| FastAPI | Web framework |
| SQLAlchemy 2.x + asyncpg | ORM (async) |
| Alembic | Database migrations |
| Pydantic v2 | Data validation |
| python-jose | JWT |
| passlib + bcrypt | Password hashing |
| pyotp | 2FA (TOTP) |
| Celery + Redis | Background tasks |
| boto3 | S3/MinIO client |
| pytest + pytest-asyncio | Testing |
| ruff | Linting + formatting |
| mypy | Type checking |

---

## 🚀 الإطلاق المتوقّع

```bash
# Setup
cd backend
python -m venv venv
source venv/bin/activate
pip install -e ".[dev]"

# Run migrations
alembic upgrade head

# Run dev server
make backend-dev
# → http://localhost:8000
# → http://localhost:8000/docs (OpenAPI)
```

---

📚 راجع [مواصفات API](../docs/technical/03_api_specification.yaml) للتفاصيل الكاملة.
