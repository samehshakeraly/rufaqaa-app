# 🤖 MCP Server — Rufaqaa AI Integration

> Model Context Protocol Server · Python · FastMCP · 30+ Tools for Claude AI

---

## 📊 الحالة الحالية

**🚧 لم يبدأ التطوير بعد**

سيُبنى MCP Server في **المرحلة 15**، بعد استقرار REST API.

---

## 🎯 الفكرة

MCP يتيح للمستخدمين التحدّث مع Claude AI بلغة طبيعية لإدارة عمليات رفقاء:

> "كم يتيم كُفل هذا الشهر؟"
> "أعطني المتبرعين المتأخرين أكثر من شهرين"
> "اربط المتبرع DON-00123 باليتيم ORF-00045 بـ 15 د.ك شهرياً"

---

## 📋 الأدوات (30+)

| الفئة | عدد الأدوات | أمثلة |
|---|---|---|
| 👶 Orphans | 7 | `list_orphans`, `add_orphan`, `approve_orphan` |
| 💝 Donors | 3 | `list_donors`, `get_donor_dashboard` |
| 🔗 Sponsorships | 5 | `link_sponsor_to_orphan`, `cancel_sponsorship` |
| 💰 Payments | 5 | `record_payment`, `list_overdue_donors` |
| 📊 Reports | 5 | `get_dashboard_stats`, `generate_monthly_report` |
| 📢 Notifications | 2 | `send_notification`, `send_bulk_reminder` |
| 🏦 Transfers | 2 | `create_transfer`, `list_pending_transfers` |
| 🔍 Smart Search | 2 | `smart_search`, `find_similar_orphans` |
| 🧠 AI-Powered | 3 | `suggest_donor_for_orphan`, `predict_donor_churn` |

---

## 🛠️ Stack المتوقّع

| المكتبة | الغرض |
|---|---|
| FastMCP | MCP server framework |
| httpx | عميل HTTP غير متزامن للـ REST API |
| pydantic v2 | Validation |
| python-jose | JWT للمصادقة |

---

## 📁 الهيكل المخطّط

```
mcp-server/
├── src/
│   ├── tools/
│   │   ├── orphans.py
│   │   ├── donors.py
│   │   ├── sponsorships.py
│   │   ├── payments.py
│   │   ├── reports.py
│   │   ├── notifications.py
│   │   ├── transfers.py
│   │   ├── search.py
│   │   └── ai.py
│   ├── client.py          # Rufaqaa REST API client
│   ├── auth.py            # المصادقة والصلاحيات
│   ├── permissions.py
│   └── server.py          # نقطة الدخول
├── tests/
├── pyproject.toml
└── README.md
```

---

## 🚀 الإطلاق المتوقّع

```bash
cd mcp-server
pip install -e ".[dev]"
python -m src.server
```

ثم ربطه بـ Claude Desktop عبر إعداد `~/.config/Claude/claude_desktop_config.json`.

---

📚 راجع [مواصفات MCP Tools](../docs/technical/04_mcp_tools.md) للتفاصيل الكاملة.
