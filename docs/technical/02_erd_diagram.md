# 🗺️ Rufaqaa Entity Relationship Diagram (ERD)

## Database Structure — منصة رفقاء

```mermaid
erDiagram
    organizations ||--o{ users : "has"
    organizations ||--o{ partner_organizations : "has"
    organizations ||--o{ marketing_channels : "has"
    organizations ||--o{ orphans : "manages"
    organizations ||--o{ orphanages : "operates"
    organizations ||--o{ donors : "has"
    organizations ||--o{ sponsorships : "manages"
    organizations ||--o{ payments : "tracks"
    organizations ||--o{ business_rules : "configures"
    
    users ||--o| guardians : "is"
    users ||--o| donors : "is"
    users ||--o| orphans : "is (12+)"
    users ||--o{ user_sessions : "has"
    users ||--o{ notifications : "receives"
    users ||--o{ audit_log : "performs"
    
    families ||--o{ orphans : "contains"
    families ||--o{ guardians : "has"
    
    orphanages ||--o{ orphans : "houses"
    
    partner_organizations ||--o{ orphans : "manages"
    partner_organizations ||--o{ orphanages : "manages"
    partner_organizations ||--o{ bank_transfers : "receives"
    
    marketing_channels ||--o{ orphans : "promotes"
    marketing_channels ||--o{ donors : "acquires"
    marketing_channels ||--o{ sponsorships : "sources"
    
    orphans ||--o{ documents : "has"
    orphans ||--o{ orphan_reports : "has"
    orphans ||--o{ media : "has"
    orphans ||--o{ sponsorships : "receives"
    orphans ||--o{ payments : "credits to"
    
    donors ||--o{ sponsorships : "creates"
    donors ||--o{ payments : "makes"
    donors }o--|| donors : "referred_by"
    
    sponsorships ||--o{ payments : "tracks"
    sponsorships }o--|| donors : "by"
    sponsorships }o--|| orphans : "for"
    
    bank_transfers ||--o{ bank_transfer_items : "contains"
    bank_transfer_items }o--|| orphans : "credits"
    
    orphan_reports ||--o{ media : "includes"
    
    organizations {
        uuid id PK
        string code UK
        string name_ar
        string name_en
        string org_type
        string deployment_mode
        string country_code
        jsonb settings
        timestamp created_at
    }
    
    users {
        uuid id PK
        uuid organization_id FK
        string email UK
        string phone
        string password_hash
        boolean two_factor_enabled
        string role
        string status
        timestamp created_at
    }
    
    orphans {
        uuid id PK
        uuid organization_id FK
        uuid partner_organization_id FK
        uuid family_id FK
        uuid orphanage_id FK
        uuid user_id FK
        string code UK
        string first_name
        string family_name
        date date_of_birth
        char gender
        string case_status
        boolean is_sponsored
        decimal current_balance
    }
    
    donors {
        uuid id PK
        uuid organization_id FK
        uuid user_id FK
        string code UK
        string full_name
        string email
        int total_sponsorships
        decimal total_donated
        timestamp created_at
    }
    
    sponsorships {
        uuid id PK
        uuid organization_id FK
        uuid donor_id FK
        uuid orphan_id FK
        uuid marketing_channel_id FK
        string code UK
        decimal monthly_amount
        char currency
        date start_date
        date end_date
        string status
        decimal total_paid
    }
    
    payments {
        uuid id PK
        uuid organization_id FK
        uuid donor_id FK
        uuid sponsorship_id FK
        uuid orphan_id FK
        string code UK
        decimal amount
        char currency
        string payment_method
        string status
        timestamp completed_at
    }
    
    bank_transfers {
        uuid id PK
        uuid organization_id FK
        uuid partner_organization_id FK
        string code UK
        decimal amount
        char currency
        date period_start
        date period_end
        string status
    }
    
    families {
        uuid id PK
        uuid organization_id FK
        uuid partner_organization_id FK
        string code UK
        string family_name
        string deceased_father_name
        date father_death_date
        string country_code
    }
    
    orphanages {
        uuid id PK
        uuid organization_id FK
        uuid partner_organization_id FK
        string code UK
        string name_ar
        string name_en
        string country_code
        string status
    }
    
    guardians {
        uuid id PK
        uuid organization_id FK
        uuid family_id FK
        uuid user_id FK
        string full_name
        string relation
        string phone
        string literacy_level
    }
    
    partner_organizations {
        uuid id PK
        uuid organization_id FK
        string code UK
        string name_ar
        string country_code
        string license_number
        string approval_flow
        string status
    }
    
    marketing_channels {
        uuid id PK
        uuid organization_id FK
        string name_ar
        string channel_type
        uuid manager_id FK
        int annual_goal_count
        decimal annual_goal_amount
    }
    
    orphan_reports {
        uuid id PK
        uuid orphan_id FK
        string report_type
        date period_start
        date period_end
        jsonb educational_progress
        jsonb quran_progress
        jsonb health_status
        string status
    }
    
    documents {
        uuid id PK
        uuid orphan_id FK
        uuid guardian_id FK
        string document_type
        string file_url
        string verification_status
    }
    
    media {
        uuid id PK
        uuid orphan_id FK
        uuid report_id FK
        string media_type
        string file_url
        string moderation_status
        string visibility
    }
    
    messages {
        uuid id PK
        uuid from_user_id FK
        uuid to_user_id FK
        uuid related_orphan_id FK
        string content
        string moderation_status
    }
    
    notifications {
        uuid id PK
        uuid user_id FK
        string notification_type
        string title
        string body
        boolean is_read
    }
    
    audit_log {
        bigserial id PK
        uuid organization_id
        uuid user_id
        string action
        string entity_type
        uuid entity_id
        jsonb old_values
        jsonb new_values
    }
    
    business_rules {
        uuid id PK
        uuid organization_id FK
        int marketing_assignment_days
        int payment_auto_suspend_months
        int orphan_graduation_age
        jsonb custom_rules
    }
```

---

## العلاقات الرئيسية الموضحة

### 1. Multi-Tenancy
```
organizations (1) ──── (∞) كل الجداول
   كل جدول له organization_id لعزل البيانات
```

### 2. The Core Triangle
```
donors ←─── sponsorships ───→ orphans
              │
              ↓
           payments
```

### 3. Family / Residence Structure
```
families (1) ──── (∞) orphans      (family home: orphans.orphanage_id IS NULL)
   └── (∞) guardians

orphanages (1) ──── (∞) orphans    (dar / institution: orphans.orphanage_id set)
```

### 4. Marketing Pipeline
```
marketing_channels (1) ──── (∞) orphans (assigned)
                       │
                       └─── (∞) donors (acquired)
                       │
                       └─── (∞) sponsorships (sourced)
```

### 5. Financial Flow
```
donors → payments → sponsorships → orphans (balance)
                                       │
                                       ↓
                              partner_organizations
                                       │
                                       ↓
                              bank_transfers → bank_transfer_items
```

### 6. Document & Media Hierarchy
```
orphans (1) ──── (∞) documents
   │
   └─── (∞) media (photos, videos)
   │
   └─── (∞) orphan_reports
              └─── (∞) media (linked to specific reports)
```

### 7. Communication
```
users ←─── messages ───→ users
              │
              └── related_orphan (context)
```

### 8. Audit & Security
```
users ──── (∞) audit_log (every action)
users ──── (∞) user_sessions (login tracking)
users ──── (∞) notifications (alerts)
```

---

## القواعد الجوهرية على مستوى DB

### قاعدة 1: عدم تكرار اليتيم
```sql
UNIQUE INDEX (
    organization_id,
    first_name,
    family_name,
    date_of_birth,
    father_name
) WHERE deleted_at IS NULL
```

### قاعدة 2: عدم تكرار الكفالة
```sql
UNIQUE INDEX (donor_id, orphan_id)
WHERE status IN ('active', 'paused', 'overdue')
```

### قاعدة 3: عزل المؤسسات (RLS)
```sql
كل جدول له:
CREATE POLICY org_isolation
USING (organization_id = current_setting('app.current_org_id'))
```

### قاعدة 4: Audit Log غير قابل للتعديل
```sql
CREATE RULE no_update_audit AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_audit AS ON DELETE TO audit_log DO INSTEAD NOTHING;
```

---

## ID Generation Pattern

| الكيان | البادئة | المثال |
|------|---------|--------|
| Organization | ORG- | ORG-00001 |
| Orphan | ORF- | ORF-00045 |
| Donor | DON- | DON-00123 |
| Sponsorship | KAF- | KAF-00089 |
| Payment | PAY- | PAY-01240 |
| Bank Transfer | TRF- | TRF-00033 |
| Partner | PTN- | PTN-00007 |
| Family | FAM- | FAM-00012 |
| Orphanage | DAR- | DAR-00003 |

---

## الحجم المتوقع

```
لمؤسسة كبيرة (5 سنوات):

orphans:              100,000 صف
guardians:             80,000 صف
families:              50,000 صف
donors:               500,000 صف
sponsorships:         600,000 صف
payments:           5,000,000 صف
documents:          1,000,000 صف
media:              5,000,000 صف
orphan_reports:     1,200,000 صف
notifications:     50,000,000 صف
audit_log:        100,000,000 صف

الحجم الإجمالي: ~ 500 GB
```

---

## التوصيات للأداء

```
✅ Partitioning للجداول الكبيرة:
   - payments by month
   - audit_log by month
   - notifications by month

✅ Read Replicas للقراءة الثقيلة

✅ Materialized Views للإحصاءات

✅ Indexes استراتيجية في كل جدول

✅ Cursor-based pagination

✅ Connection pooling (PgBouncer)
```
