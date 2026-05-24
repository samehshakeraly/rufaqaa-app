# 🤖 Rufaqaa MCP Server — Tools Specification

## منصة رفقاء — MCP Tools للذكاء الاصطناعي

> **MCP (Model Context Protocol)**: بروتوكول من Anthropic يتيح لـ Claude AI التفاعل المباشر مع نظام رفقاء

---

## 🎯 الفكرة الجوهرية

```
المستخدم في WhatsApp / التطبيق:
  "كم يتيم كُفل هذا الشهر؟"
        ↓
Claude (عبر MCP) ← يصل لرفقاء API
        ↓
  "تم كفالة 47 يتيم هذا الشهر، 
   منهم 28 من فلسطين، 12 من مصر..."
```

---

## 📦 معمارية MCP Server

```
┌─────────────────────────────────────┐
│         Claude AI                   │
│     (Desktop / Mobile / Web)        │
└──────────────┬──────────────────────┘
               ↓ MCP Protocol
┌─────────────────────────────────────┐
│      Rufaqaa MCP Server             │
│      (Python + FastMCP)             │
│                                     │
│  Tools registered:                  │
│  - Orphans                          │
│  - Donors                           │
│  - Sponsorships                     │
│  - Payments                         │
│  - Reports                          │
│  - Notifications                    │
└──────────────┬──────────────────────┘
               ↓ REST API calls
┌─────────────────────────────────────┐
│      Rufaqaa REST API               │
│      (FastAPI)                      │
└─────────────────────────────────────┘
```

---

## 🔧 Tools المتاحة

### 1. أدوات الأيتام (Orphans Tools)

#### `list_orphans`
```python
@mcp.tool()
async def list_orphans(
    status: str = None,
    country: str = None,
    age_min: int = None,
    age_max: int = None,
    gender: str = None,
    search: str = None,
    limit: int = 20
) -> dict:
    """
    قائمة الأيتام مع فلترة متعددة
    
    Args:
        status: حالة الكفالة (available, sponsored, etc.)
        country: رمز الدولة (PS, EG, YE, ...)
        age_min: الحد الأدنى للعمر
        age_max: الحد الأقصى للعمر
        gender: الجنس (M, F)
        search: بحث نصي
        limit: عدد النتائج (max 100)
    
    Returns:
        قائمة الأيتام مع التفاصيل
    
    Example:
        "أعطني الأيتام في فلسطين بعمر 8-12 سنة"
        → list_orphans(country="PS", age_min=8, age_max=12)
    """
```

#### `get_orphan`
```python
@mcp.tool()
async def get_orphan(orphan_id: str) -> dict:
    """
    تفاصيل يتيم معين
    
    Args:
        orphan_id: ID اليتيم (ORF-XXXXX)
    
    Example:
        "أخبرني عن اليتيم ORF-00045"
        → get_orphan("ORF-00045")
    """
```

#### `add_orphan`
```python
@mcp.tool()
async def add_orphan(
    first_name: str,
    family_name: str,
    date_of_birth: str,
    gender: str,
    nationality: str,
    partner_organization_id: str,
    father_name: str = None,
    father_death_date: str = None
) -> dict:
    """
    تسجيل يتيم جديد
    
    Example:
        "أضف يتيم جديد: أحمد محمد من فلسطين، 10 سنوات"
        → add_orphan(first_name="أحمد", family_name="محمد", ...)
    """
```

#### `approve_orphan`
```python
@mcp.tool()
async def approve_orphan(orphan_id: str) -> dict:
    """اعتماد حالة يتيم"""
```

#### `assign_orphan_to_channel`
```python
@mcp.tool()
async def assign_orphan_to_channel(
    orphan_id: str,
    channel_id: str,
    duration_days: int = 30
) -> dict:
    """
    تخصيص يتيم لقناة تسويقية
    
    Example:
        "خصص اليتيم ORF-00045 لقناة التسويق الإلكتروني لمدة 30 يوم"
    """
```

#### `release_orphan`
```python
@mcp.tool()
async def release_orphan(orphan_id: str) -> dict:
    """إعادة يتيم للمتاحين"""
```

---

### 2. أدوات المتبرعين (Donors Tools)

#### `list_donors`
```python
@mcp.tool()
async def list_donors(
    status: str = None,
    is_overdue: bool = None,
    channel_id: str = None,
    search: str = None
) -> dict:
    """
    قائمة المتبرعين
    
    Example:
        "أعطني المتبرعين المتأخرين"
        → list_donors(is_overdue=True)
    """
```

#### `get_donor`
```python
@mcp.tool()
async def get_donor(donor_id: str) -> dict:
    """تفاصيل متبرع"""
```

#### `get_donor_dashboard`
```python
@mcp.tool()
async def get_donor_dashboard(donor_id: str) -> dict:
    """
    لوحة معلومات المتبرع
    تشمل: أيتامه، مدفوعاته، الرصيد
    """
```

---

### 3. أدوات الكفالات (Sponsorships Tools)

#### `link_sponsor_to_orphan`
```python
@mcp.tool()
async def link_sponsor_to_orphan(
    donor_id: str,
    orphan_id: str,
    monthly_amount: float,
    currency: str,
    start_date: str,
    end_date: str = None,
    payment_frequency: str = "monthly"
) -> dict:
    """
    ربط متبرع بيتيم (إنشاء كفالة)
    
    Example:
        "اربط المتبرع DON-00123 باليتيم ORF-00045 بمبلغ 15 د.ك شهرياً"
    """
```

#### `list_sponsorships`
```python
@mcp.tool()
async def list_sponsorships(
    status: str = None,
    donor_id: str = None,
    orphan_id: str = None
) -> dict:
    """قائمة الكفالات"""
```

#### `get_sponsorship_status`
```python
@mcp.tool()
async def get_sponsorship_status(sponsorship_id: str) -> dict:
    """حالة كفالة (نشطة، متأخرة، إلخ)"""
```

#### `cancel_sponsorship`
```python
@mcp.tool()
async def cancel_sponsorship(
    sponsorship_id: str,
    reason: str
) -> dict:
    """إلغاء كفالة"""
```

#### `renew_sponsorship`
```python
@mcp.tool()
async def renew_sponsorship(
    sponsorship_id: str,
    duration_months: int = 12
) -> dict:
    """تجديد كفالة"""
```

---

### 4. أدوات المدفوعات (Payments Tools)

#### `record_payment`
```python
@mcp.tool()
async def record_payment(
    donor_id: str,
    amount: float,
    currency: str,
    payment_method: str,
    sponsorship_id: str = None,
    orphan_id: str = None
) -> dict:
    """تسجيل دفعة جديدة"""
```

#### `get_payment_history`
```python
@mcp.tool()
async def get_payment_history(
    donor_id: str = None,
    orphan_id: str = None,
    from_date: str = None,
    to_date: str = None
) -> dict:
    """
    سجل المدفوعات
    
    Example:
        "اعرض مدفوعات المتبرع DON-00123 في 2027"
    """
```

#### `list_pending_payments`
```python
@mcp.tool()
async def list_pending_payments() -> dict:
    """المدفوعات المعلّقة"""
```

#### `list_overdue_donors`
```python
@mcp.tool()
async def list_overdue_donors(months_overdue: int = 1) -> dict:
    """
    المتبرعون المتأخرون
    
    Example:
        "من المتبرعين المتأخرين أكثر من شهرين؟"
        → list_overdue_donors(months_overdue=2)
    """
```

#### `refund_payment`
```python
@mcp.tool()
async def refund_payment(
    payment_id: str,
    reason: str,
    partial_amount: float = None
) -> dict:
    """استرداد دفعة"""
```

---

### 5. أدوات التقارير (Reports Tools)

#### `get_dashboard_stats`
```python
@mcp.tool()
async def get_dashboard_stats() -> dict:
    """
    إحصاءات لوحة التحكم
    
    Returns:
        - إجمالي الأيتام
        - المكفولون
        - إجمالي المتبرعين
        - تبرعات الشهر
        - أهداف القنوات
    """
```

#### `generate_monthly_report`
```python
@mcp.tool()
async def generate_monthly_report(
    month: int,
    year: int,
    format: str = "pdf"
) -> dict:
    """
    توليد تقرير شهري شامل
    
    Example:
        "أعطني تقرير شهر مايو 2027"
    """
```

#### `get_channel_performance`
```python
@mcp.tool()
async def get_channel_performance(
    channel_id: str = None,
    period: str = "this_month"
) -> dict:
    """
    أداء القنوات التسويقية
    
    Example:
        "كيف أداء قناة التسويق الإلكتروني هذا الشهر؟"
    """
```

#### `get_orphans_by_country`
```python
@mcp.tool()
async def get_orphans_by_country() -> dict:
    """توزيع الأيتام جغرافياً"""
```

#### `get_financial_summary`
```python
@mcp.tool()
async def get_financial_summary(
    period: str = "this_month"
) -> dict:
    """
    الملخص المالي
    
    Returns:
        - الواردات
        - الصادرات
        - التحويلات للشركاء
        - الرصيد
    """
```

---

### 6. أدوات الإشعارات (Notifications Tools)

#### `send_notification`
```python
@mcp.tool()
async def send_notification(
    user_ids: list[str],
    title: str,
    body: str,
    channels: list[str] = ["in_app"],
    priority: str = "normal"
) -> dict:
    """
    إرسال إشعار
    
    Example:
        "أرسل تنبيه لكل المتبرعين المتأخرين"
    """
```

#### `send_bulk_reminder`
```python
@mcp.tool()
async def send_bulk_reminder(
    target: str  # "overdue_donors", "expiring_sponsorships", etc.
) -> dict:
    """إرسال تذكير جماعي"""
```

---

### 7. أدوات التحويلات (Transfers Tools)

#### `create_transfer`
```python
@mcp.tool()
async def create_transfer(
    partner_organization_id: str,
    amount: float,
    currency: str,
    period_start: str,
    period_end: str
) -> dict:
    """إنشاء تحويل بنكي لجهة شريكة"""
```

#### `list_pending_transfers`
```python
@mcp.tool()
async def list_pending_transfers() -> dict:
    """التحويلات المعلّقة بانتظار الاعتماد"""
```

---

### 8. أدوات البحث الذكي (Smart Search)

#### `smart_search`
```python
@mcp.tool()
async def smart_search(query: str) -> dict:
    """
    بحث ذكي عبر النظام كاملاً
    
    Examples:
        "أيتام يحبون كرة القدم"
        "متبرعون من الكويت يكفلون في فلسطين"
        "كفالات تنتهي خلال شهر"
    """
```

#### `find_similar_orphans`
```python
@mcp.tool()
async def find_similar_orphans(
    orphan_id: str,
    criteria: list[str] = ["country", "age", "background"]
) -> dict:
    """البحث عن أيتام مشابهين (لكشف التكرار)"""
```

---

### 9. أدوات الذكاء الاصطناعي المتقدمة

#### `suggest_donor_for_orphan`
```python
@mcp.tool()
async def suggest_donor_for_orphan(orphan_id: str) -> dict:
    """
    اقتراح متبرعين مناسبين ليتيم معين
    بناءً على تفضيلاتهم السابقة
    """
```

#### `predict_donor_churn`
```python
@mcp.tool()
async def predict_donor_churn() -> dict:
    """
    التنبؤ بالمتبرعين المعرّضين للترك
    """
```

#### `analyze_campaign_performance`
```python
@mcp.tool()
async def analyze_campaign_performance(
    campaign_id: str
) -> dict:
    """تحليل أداء حملة تسويقية"""
```

---

## 🔐 الأمان والصلاحيات

### كل tool يطبّق:

```python
@require_auth          # يتطلب مصادقة
@require_role(...)     # يتطلب دوراً معيناً
@audit_log()           # يُسجَّل في الـ Audit
@rate_limited()        # محدود المعدل

async def tool_name(...):
    # ...
```

### مستويات الوصول للـ MCP

```
Super Admin:    كل الأدوات
Org Admin:      كل الأدوات داخل مؤسسته
Finance:        أدوات المدفوعات والتحويلات
Marketing:      أدوات الأيتام والمتبرعين والحملات
Partner Staff:  أدوات الأيتام والتقارير
Donor:          أدوات بياناته الشخصية فقط
Guardian:       أدوات يتيمه فقط
```

---

## 💬 أمثلة محادثات

### مثال 1: مدير المؤسسة
```
المستخدم: "كيف أداء المنصة هذا الشهر؟"
        ↓
Claude يستدعي:
  - get_dashboard_stats()
  - get_financial_summary()
  - get_channel_performance()
        ↓
Claude يرد:
"هذا الشهر:
✅ 47 كفالة جديدة (من 83 المستهدفة)
💰 12,450 د.ك إجمالي التبرعات
📊 التسويق الإلكتروني تجاوز هدفه بـ 105%
⚠️ تنبيه: 5 متبرعين متأخرين أكثر من شهرين"
```

### مثال 2: المتبرع في WhatsApp
```
المتبرع: "كم باقي على نهاية كفالتي لأحمد؟"
        ↓
Claude يستدعي:
  - list_sponsorships(donor_id="DON-00123")
        ↓
Claude يرد:
"كفالتك لأحمد (ORF-00045) تنتهي بعد 4 أشهر و 12 يوم
آخر دفعة: 15 د.ك في 1 مايو
الدفعة القادمة: 1 يونيو
هل تود تجديد الكفالة الآن؟"
```

### مثال 3: مدير القناة التسويقية
```
المستخدم: "أرسل تنبيه لكل المتبرعين المتأخرين شهرين"
        ↓
Claude يستدعي:
  - list_overdue_donors(months_overdue=2)
  - send_bulk_reminder(target="overdue_donors_2_months")
        ↓
Claude يرد:
"تم إرسال تنبيه ودي إلى 12 متبرع متأخر
سيصلهم عبر WhatsApp + Email
المتوقع رد من 30-40% منهم خلال أسبوع"
```

### مثال 4: موظف الجهة الشريكة
```
الموظف: "أضف يتيم جديد: محمد علي من غزة، عمره 8 سنوات، أبوه استشهد"
        ↓
Claude يستدعي:
  - find_similar_orphans()  # للتأكد من عدم التكرار
  - add_orphan(first_name="محمد", family_name="علي", ...)
        ↓
Claude يرد:
"✅ تم تسجيل اليتيم محمد علي (ORF-00892)
📋 الحالة: قيد المراجعة
📥 يرجى رفع المستندات المطلوبة:
- شهادة ميلاد محمد
- شهادة وفاة الأب
- كشف حساب ولي الأمر"
```

---

## 🚀 البنية التقنية للـ MCP Server

```python
# server.py
from mcp.server.fastmcp import FastMCP
from rufaqaa.api import RufaqaaClient

mcp = FastMCP("Rufaqaa Server")
client = RufaqaaClient()

# Register all tools
from .tools import (
    orphans_tools,
    donors_tools,
    sponsorships_tools,
    payments_tools,
    reports_tools,
    notifications_tools,
    transfers_tools,
    search_tools,
    ai_tools
)

orphans_tools.register(mcp)
donors_tools.register(mcp)
# ... etc

if __name__ == "__main__":
    mcp.run()
```

```python
# tools/orphans_tools.py
from mcp.types import TextContent

def register(mcp):
    @mcp.tool()
    async def list_orphans(...) -> dict:
        result = await client.orphans.list(...)
        return result
    
    @mcp.tool()
    async def get_orphan(orphan_id: str) -> dict:
        result = await client.orphans.get(orphan_id)
        return result
    
    # ... etc
```

---

## 📝 ملاحظات مهمة

### الأمان
```
🔐 كل tool يحقق من الصلاحيات
🔐 لا tool يتجاوز قواعد النظام
🔐 كل عملية مُدوَّنة في Audit Log
🔐 معدّل الاستخدام محدود لكل user
```

### الأخلاقيات
```
⚠️ Claude لا يتخذ قرارات حساسة بمفرده
⚠️ كل عملية مالية تحتاج تأكيد المستخدم
⚠️ التحويلات الكبيرة تحتاج موافقة إضافية
⚠️ لا تواصل مباشر بين Claude واليتامى
```

### الخصوصية
```
🛡️ Claude لا يحفظ بيانات حساسة
🛡️ كل request مستقل
🛡️ بيانات الأطفال محمية بإجراءات إضافية
🛡️ Multi-tenancy محفوظ (لا تسرّب بين المؤسسات)
```

---

## 🎯 النتيجة

```
نظام رفقاء + MCP = تجربة لا تشبه أي منصة أخرى

✅ المستخدم يتحدث مع Claude بلغة طبيعية
✅ Claude يقوم بالعمل في النظام
✅ لا حاجة لتعلم واجهات معقدة
✅ ذكاء اصطناعي يخدم العمل الخيري
✅ تطور مستقبلي مفتوح بلا حدود
```
