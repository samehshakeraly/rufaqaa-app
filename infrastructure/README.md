# 🏗️ Infrastructure — Rufaqaa

> Docker · Kubernetes · Terraform · CI/CD

---

## 📊 الحالة الحالية

**🟢 مرحلة 0 — البنية التحتية المحلية جاهزة**

---

## 📁 الهيكل

```
infrastructure/
├── docker/
│   └── postgres/
│       └── init.sql       # تفعيل PostgreSQL extensions
│
├── kubernetes/            # 🚧 لاحقاً للإنتاج
│   ├── base/
│   └── overlays/
│       ├── staging/
│       └── production/
│
└── terraform/             # 🚧 لاحقاً لتجهيز السحابة
    ├── modules/
    └── environments/
```

---

## 🐳 Docker (الحالي)

كل خدمات التطوير تعمل عبر `docker-compose.yml` في جذر المشروع:

| الخدمة | المنفذ | الواجهة |
|---|---|---|
| PostgreSQL + PostGIS | 5432 | عبر Adminer |
| Redis 7 | 6379 | CLI: `make redis-cli` |
| MinIO | 9000 / 9001 | http://localhost:9001 |
| Adminer | 8080 | http://localhost:8080 |
| MailHog | 1025 / 8025 | http://localhost:8025 |

### الأوامر الأساسية

```bash
make up           # تشغيل
make down         # إيقاف
make status       # الحالة
make logs         # السجلات
make psql         # PostgreSQL CLI
```

---

## ☸️ Kubernetes (المستقبل)

سيُستخدم Kubernetes للإنتاج عند الإطلاق الفعلي.

استراتيجية النشر المخطّطة:
- **Staging** على cluster صغير
- **Production** متعدد المناطق (Multi-AZ)
- استخدام Kustomize أو Helm

---

## 🌍 Terraform (المستقبل)

لإدارة:
- البنية السحابية (Cloud Infrastructure)
- DNS
- الشهادات (TLS)
- النسخ الاحتياطية
- المراقبة

---

## 📝 ملاحظات

- 🔒 لا تضع أي **secret** في هذا المجلد
- 🔒 استخدم Vault / SOPS / Sealed Secrets للأسرار في الإنتاج
- 📊 خطط للمراقبة منذ البداية (Prometheus + Grafana لاحقاً)
