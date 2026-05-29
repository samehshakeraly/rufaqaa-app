-- ═══════════════════════════════════════════════════════════════
-- منصة رفقاء — Rufaqaa Database Schema
-- PostgreSQL 15+ Schema
-- Version: 1.0
-- License: MIT
-- ═══════════════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For fuzzy search
CREATE EXTENSION IF NOT EXISTS "postgis";  -- For geo queries
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ═══════════════════════════════════════════════════════════════
-- 1. CORE MULTI-TENANCY: ORGANIZATIONS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,  -- e.g., 'NJT', 'ORM'
    name_ar VARCHAR(255) NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    
    -- Type & Mode
    org_type VARCHAR(50) NOT NULL CHECK (org_type IN (
        'standalone',         -- Pattern A
        'external_marketer',  -- Pattern B/C
        'local_partner',      -- Pattern B/D
        'hybrid',             -- Pattern F
        'federated'           -- Pattern G
    )),
    deployment_mode VARCHAR(20) NOT NULL DEFAULT 'self_hosted' CHECK (
        deployment_mode IN ('self_hosted', 'saas_cloud')
    ),
    
    -- Contact & Location
    country_code VARCHAR(2) NOT NULL,
    timezone VARCHAR(50) DEFAULT 'Asia/Kuwait',
    default_language VARCHAR(5) DEFAULT 'ar',
    default_currency VARCHAR(3) DEFAULT 'KWD',
    
    -- Branding
    logo_url VARCHAR(500),
    primary_color VARCHAR(7) DEFAULT '#769FCD',
    
    -- Status & Subscription (for SaaS)
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (
        status IN ('active', 'suspended', 'archived', 'pending_approval')
    ),
    subscription_plan VARCHAR(20) DEFAULT 'free',
    subscription_expires_at TIMESTAMPTZ,
    
    -- Settings (JSONB for flexibility)
    settings JSONB DEFAULT '{}'::jsonb,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    
    CONSTRAINT valid_color CHECK (primary_color ~* '^#[0-9A-F]{6}$')
);

CREATE INDEX idx_organizations_status ON organizations(status);
CREATE INDEX idx_organizations_type ON organizations(org_type);

-- ═══════════════════════════════════════════════════════════════
-- 2. USERS & AUTHENTICATION
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    
    -- Auth
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(30) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    
    -- 2FA
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    two_factor_secret VARCHAR(255),
    backup_codes TEXT[],
    
    -- Profile
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    avatar_url VARCHAR(500),
    language VARCHAR(5) DEFAULT 'ar',
    timezone VARCHAR(50),
    
    -- Role & Permissions
    role VARCHAR(50) NOT NULL CHECK (role IN (
        'super_admin',
        'org_admin',
        'partner_manager',
        'partner_staff',
        'marketing_manager',
        'finance',
        'donor',
        'guardian',
        'orphan',
        'viewer'
    )),
    custom_permissions JSONB DEFAULT '[]'::jsonb,
    
    -- Status
    status VARCHAR(20) DEFAULT 'active' CHECK (
        status IN ('active', 'inactive', 'suspended', 'pending_verification')
    ),
    email_verified_at TIMESTAMPTZ,
    phone_verified_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    last_login_ip INET,
    failed_login_attempts INT DEFAULT 0,
    locked_until TIMESTAMPTZ,
    
    -- Preferences
    notification_preferences JSONB DEFAULT '{}'::jsonb,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_users_org ON users(organization_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(organization_id, role);
CREATE INDEX idx_users_status ON users(organization_id, status);

-- Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_org_isolation ON users
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- ═══════════════════════════════════════════════════════════════
-- 3. SESSIONS & TOKENS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    device_info JSONB,
    ip_address INET,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_token ON user_sessions(token_hash);

-- ═══════════════════════════════════════════════════════════════
-- 4. COUNTRIES & CURRENCIES (Public Data)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE countries (
    id SERIAL PRIMARY KEY,
    code_alpha2 CHAR(2) UNIQUE NOT NULL,
    code_alpha3 CHAR(3) UNIQUE NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100) NOT NULL,
    flag_emoji VARCHAR(10),
    phone_code VARCHAR(10),
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE currencies (
    code CHAR(3) PRIMARY KEY,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100) NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    decimal_places INT DEFAULT 2,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE exchange_rates (
    id SERIAL PRIMARY KEY,
    from_currency CHAR(3) NOT NULL REFERENCES currencies(code),
    to_currency CHAR(3) NOT NULL REFERENCES currencies(code),
    rate DECIMAL(15, 6) NOT NULL,
    effective_date DATE NOT NULL,
    source VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (from_currency, to_currency, effective_date)
);

CREATE INDEX idx_exchange_rates_date ON exchange_rates(effective_date DESC);

-- ═══════════════════════════════════════════════════════════════
-- 5. PARTNER ORGANIZATIONS (Local Charities)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE partner_organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(20) UNIQUE NOT NULL,  -- PTN-XXXXX
    
    name_ar VARCHAR(255) NOT NULL,
    name_en VARCHAR(255),
    
    country_code CHAR(2) NOT NULL REFERENCES countries(code_alpha2),
    address TEXT,
    contact_email VARCHAR(255),
    contact_phone VARCHAR(30),
    contact_person VARCHAR(255),
    
    -- License & Trust
    license_number VARCHAR(100),
    license_country CHAR(2) REFERENCES countries(code_alpha2),
    license_expiry DATE,
    is_verified BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    
    -- Approval workflow setting
    approval_flow VARCHAR(20) DEFAULT 'single' CHECK (
        approval_flow IN ('single', 'double')
    ),
    
    -- Financial
    bank_account_info JSONB,  -- Encrypted
    
    status VARCHAR(20) DEFAULT 'active' CHECK (
        status IN ('active', 'suspended', 'archived')
    ),
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_partners_org ON partner_organizations(organization_id);
CREATE INDEX idx_partners_country ON partner_organizations(country_code);
ALTER TABLE partner_organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY partners_org_isolation ON partner_organizations
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- ═══════════════════════════════════════════════════════════════
-- 6. MARKETING CHANNELS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE marketing_channels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    name_ar VARCHAR(255) NOT NULL,
    name_en VARCHAR(255),
    channel_type VARCHAR(50) CHECK (channel_type IN (
        'digital_marketing',
        'committee',  -- Like Zakat committees
        'website',
        'branch',
        'social_media',
        'partnership',
        'other'
    )),
    description TEXT,
    
    manager_id UUID REFERENCES users(id),
    
    -- Goals (annual)
    annual_goal_count INT,  -- Number of sponsorships
    annual_goal_amount DECIMAL(15, 2),  -- Financial goal
    goal_year INT,
    goal_currency CHAR(3) REFERENCES currencies(code),
    
    -- Assignment rules
    max_orphan_assignment_days INT DEFAULT 30,
    
    status VARCHAR(20) DEFAULT 'active',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_channels_org ON marketing_channels(organization_id);
ALTER TABLE marketing_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY channels_org_isolation ON marketing_channels
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- ═══════════════════════════════════════════════════════════════
-- 7. FAMILIES & GUARDIANS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE families (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    partner_organization_id UUID REFERENCES partner_organizations(id),
    code VARCHAR(20) UNIQUE NOT NULL,  -- FAM-XXXXX
    
    family_name VARCHAR(255),
    deceased_father_name VARCHAR(255),
    father_death_date DATE,
    father_death_cause VARCHAR(255),
    
    -- Location
    country_code CHAR(2) REFERENCES countries(code_alpha2),
    governorate VARCHAR(100),
    city VARCHAR(100),
    district VARCHAR(100),
    address_details TEXT,
    coordinates POINT,  -- PostGIS
    
    -- Economic status
    monthly_income DECIMAL(10, 2),
    income_currency CHAR(3) REFERENCES currencies(code),
    housing_status VARCHAR(50),  -- owned, rented, donated, homeless
    
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_families_org ON families(organization_id);
CREATE INDEX idx_families_partner ON families(partner_organization_id);
CREATE INDEX idx_families_location ON families USING gist(coordinates);
ALTER TABLE families ENABLE ROW LEVEL SECURITY;
CREATE POLICY families_org_isolation ON families
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE TABLE guardians (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    family_id UUID REFERENCES families(id),
    user_id UUID UNIQUE REFERENCES users(id),
    
    -- Personal info
    full_name VARCHAR(255) NOT NULL,
    national_id VARCHAR(50),
    national_id_encrypted BYTEA,  -- AES-256
    date_of_birth DATE,
    gender CHAR(1) CHECK (gender IN ('M', 'F')),
    
    -- Relation to orphans
    relation VARCHAR(50) NOT NULL CHECK (relation IN (
        'mother', 'father', 'grandfather', 'grandmother', 
        'uncle', 'aunt', 'sibling', 'other'
    )),
    
    -- Contact
    phone VARCHAR(30),
    whatsapp VARCHAR(30),
    email VARCHAR(255),
    
    -- Digital literacy
    literacy_level VARCHAR(20) DEFAULT 'low' CHECK (
        literacy_level IN ('illiterate', 'low', 'medium', 'high')
    ),
    preferred_communication VARCHAR(20) DEFAULT 'whatsapp',
    
    -- Bank info (encrypted)
    bank_account_info JSONB,
    
    status VARCHAR(20) DEFAULT 'active',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_guardians_org ON guardians(organization_id);
CREATE INDEX idx_guardians_family ON guardians(family_id);
CREATE INDEX idx_guardians_user ON guardians(user_id);
ALTER TABLE guardians ENABLE ROW LEVEL SECURITY;
CREATE POLICY guardians_org_isolation ON guardians
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- ═══════════════════════════════════════════════════════════════
-- 8. ORPHANS (Core Entity)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE orphans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    partner_organization_id UUID NOT NULL REFERENCES partner_organizations(id),
    family_id UUID REFERENCES families(id),
    user_id UUID UNIQUE REFERENCES users(id),
    
    code VARCHAR(20) UNIQUE NOT NULL,  -- ORF-XXXXX
    
    -- Personal info
    first_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100),
    family_name VARCHAR(100) NOT NULL,
    full_name_en VARCHAR(255),
    
    date_of_birth DATE NOT NULL,
    gender CHAR(1) NOT NULL CHECK (gender IN ('M', 'F')),
    nationality CHAR(2) REFERENCES countries(code_alpha2),
    
    -- Identification
    birth_certificate_number VARCHAR(100),
    
    -- Father info (since orphan = lost father)
    father_name VARCHAR(255),
    father_death_date DATE,
    father_death_certificate VARCHAR(100),
    
    -- Status in system
    case_status VARCHAR(30) DEFAULT 'pending_review' CHECK (case_status IN (
        'pending_review',     -- Just submitted
        'approved',           -- Approved by partner
        'rejected',           -- Rejected
        'available',          -- Available for sponsorship
        'reserved',           -- Reserved for a marketing channel
        'sponsored',          -- Has active sponsorship
        'graduated',          -- Aged out (18+)
        'deceased',           -- Deceased
        'archived'            -- Archived
    )),
    
    -- Marketing assignment
    assigned_to_channel_id UUID REFERENCES marketing_channels(id),
    assigned_at TIMESTAMPTZ,
    assignment_deadline TIMESTAMPTZ,
    
    -- Approval workflow
    approved_by_partner_at TIMESTAMPTZ,
    approved_by_partner_user_id UUID REFERENCES users(id),
    rejection_reason TEXT,
    
    -- Sponsorship info (denormalized for performance)
    is_sponsored BOOLEAN DEFAULT FALSE,
    current_balance DECIMAL(15, 2) DEFAULT 0,
    balance_currency CHAR(3) REFERENCES currencies(code),
    
    -- Profile completeness
    profile_completion_percentage INT DEFAULT 0,
    profile_completion_score INT DEFAULT 0,
    
    -- Search optimization
    search_vector tsvector,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    deleted_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_orphans_org ON orphans(organization_id);
CREATE INDEX idx_orphans_partner ON orphans(partner_organization_id);
CREATE INDEX idx_orphans_family ON orphans(family_id);
CREATE INDEX idx_orphans_status ON orphans(organization_id, case_status);
CREATE INDEX idx_orphans_channel ON orphans(assigned_to_channel_id);
CREATE INDEX idx_orphans_search ON orphans USING gin(search_vector);
CREATE INDEX idx_orphans_dob ON orphans(date_of_birth);

-- Duplicate prevention - the critical rule
CREATE UNIQUE INDEX idx_orphans_no_duplicate ON orphans (
    organization_id,
    LOWER(first_name),
    LOWER(family_name),
    date_of_birth,
    father_name
) WHERE deleted_at IS NULL;

-- Search vector trigger
CREATE OR REPLACE FUNCTION orphans_search_trigger() RETURNS trigger AS $$
BEGIN
    NEW.search_vector := 
        setweight(to_tsvector('arabic', COALESCE(NEW.first_name, '')), 'A') ||
        setweight(to_tsvector('arabic', COALESCE(NEW.middle_name, '')), 'B') ||
        setweight(to_tsvector('arabic', COALESCE(NEW.family_name, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.full_name_en, '')), 'C') ||
        setweight(to_tsvector('arabic', COALESCE(NEW.father_name, '')), 'B') ||
        setweight(to_tsvector('arabic', NEW.code), 'A');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orphans_search_update
    BEFORE INSERT OR UPDATE ON orphans
    FOR EACH ROW EXECUTE FUNCTION orphans_search_trigger();

ALTER TABLE orphans ENABLE ROW LEVEL SECURITY;
CREATE POLICY orphans_org_isolation ON orphans
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- ═══════════════════════════════════════════════════════════════
-- 9. DOCUMENTS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    
    -- Owner (one of these)
    orphan_id UUID REFERENCES orphans(id) ON DELETE CASCADE,
    guardian_id UUID REFERENCES guardians(id) ON DELETE CASCADE,
    family_id UUID REFERENCES families(id) ON DELETE CASCADE,
    
    document_type VARCHAR(50) NOT NULL CHECK (document_type IN (
        'birth_certificate',
        'death_certificate',
        'national_id',
        'passport',
        'bank_statement',
        'school_certificate',
        'medical_report',
        'photo_id',
        'family_record',
        'other'
    )),
    
    title VARCHAR(255),
    description TEXT,
    
    -- File info
    file_url VARCHAR(500) NOT NULL,
    file_name VARCHAR(255),
    file_size_bytes BIGINT,
    file_mime_type VARCHAR(100),
    file_hash VARCHAR(64),  -- SHA-256
    storage_provider VARCHAR(20) DEFAULT 'local',
    
    -- Dates
    issue_date DATE,
    expiry_date DATE,
    issuing_authority VARCHAR(255),
    
    -- Verification
    verification_status VARCHAR(20) DEFAULT 'pending' CHECK (
        verification_status IN ('pending', 'verified', 'rejected', 'expired')
    ),
    verified_by UUID REFERENCES users(id),
    verified_at TIMESTAMPTZ,
    verification_notes TEXT,
    
    -- Encryption
    is_encrypted BOOLEAN DEFAULT TRUE,
    encryption_key_id VARCHAR(100),
    
    uploaded_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_documents_orphan ON documents(orphan_id);
CREATE INDEX idx_documents_guardian ON documents(guardian_id);
CREATE INDEX idx_documents_type ON documents(organization_id, document_type);
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY documents_org_isolation ON documents
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- ═══════════════════════════════════════════════════════════════
-- 10. ORPHAN PERIODIC UPDATES (Reports)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE orphan_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    orphan_id UUID NOT NULL REFERENCES orphans(id) ON DELETE CASCADE,
    
    report_type VARCHAR(30) NOT NULL CHECK (report_type IN (
        'monthly',
        'quarterly',
        'annual',
        'special',
        'incident'
    )),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- Content sections (JSONB for flexibility)
    educational_progress JSONB,
    quran_progress JSONB,
    activities JSONB,
    health_status JSONB,
    psychological_status JSONB,
    summary TEXT,
    
    -- Media
    photos_count INT DEFAULT 0,
    videos_count INT DEFAULT 0,
    documents_count INT DEFAULT 0,
    
    -- Approval workflow
    status VARCHAR(30) DEFAULT 'draft' CHECK (status IN (
        'draft',
        'pending_partner_approval',
        'partner_approved',
        'pending_org_approval',
        'org_approved',
        'published_to_donor',
        'rejected'
    )),
    
    submitted_by UUID REFERENCES users(id),
    submitted_at TIMESTAMPTZ,
    
    partner_approved_by UUID REFERENCES users(id),
    partner_approved_at TIMESTAMPTZ,
    
    org_approved_by UUID REFERENCES users(id),
    org_approved_at TIMESTAMPTZ,
    
    published_at TIMESTAMPTZ,
    
    rejection_reason TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reports_orphan ON orphan_reports(orphan_id, period_start DESC);
CREATE INDEX idx_reports_status ON orphan_reports(organization_id, status);
ALTER TABLE orphan_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY reports_org_isolation ON orphan_reports
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- ═══════════════════════════════════════════════════════════════
-- 11. MEDIA (Photos & Videos)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE media (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    orphan_id UUID NOT NULL REFERENCES orphans(id) ON DELETE CASCADE,
    report_id UUID REFERENCES orphan_reports(id) ON DELETE SET NULL,
    
    media_type VARCHAR(20) NOT NULL CHECK (media_type IN ('photo', 'video', 'audio')),
    title VARCHAR(255),
    description TEXT,
    
    -- File info
    file_url VARCHAR(500) NOT NULL,
    thumbnail_url VARCHAR(500),
    duration_seconds INT,
    file_size_bytes BIGINT,
    width INT,
    height INT,
    
    -- AI moderation
    ai_moderation_status VARCHAR(20) DEFAULT 'pending',
    ai_moderation_score DECIMAL(3, 2),
    ai_moderation_flags JSONB,
    
    -- Human moderation
    moderation_status VARCHAR(20) DEFAULT 'pending' CHECK (
        moderation_status IN ('pending', 'approved', 'rejected', 'flagged')
    ),
    moderated_by UUID REFERENCES users(id),
    moderated_at TIMESTAMPTZ,
    moderation_notes TEXT,
    
    -- Visibility
    visibility VARCHAR(20) DEFAULT 'private' CHECK (
        visibility IN ('private', 'donor_only', 'public', 'archived')
    ),
    
    -- Consent
    has_guardian_consent BOOLEAN DEFAULT FALSE,
    consent_document_id UUID REFERENCES documents(id),
    
    uploaded_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_media_orphan ON media(orphan_id);
CREATE INDEX idx_media_report ON media(report_id);
CREATE INDEX idx_media_moderation ON media(organization_id, moderation_status);
ALTER TABLE media ENABLE ROW LEVEL SECURITY;
CREATE POLICY media_org_isolation ON media
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- ═══════════════════════════════════════════════════════════════
-- 12. DONORS (Sponsors)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE donors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    user_id UUID UNIQUE REFERENCES users(id),
    code VARCHAR(20) UNIQUE NOT NULL,  -- DON-XXXXX
    
    -- Personal info
    full_name VARCHAR(255) NOT NULL,
    full_name_en VARCHAR(255),
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(30),
    whatsapp VARCHAR(30),
    
    -- Demographics (optional)
    nationality CHAR(2) REFERENCES countries(code_alpha2),
    country_of_residence CHAR(2) REFERENCES countries(code_alpha2),
    preferred_currency CHAR(3) REFERENCES currencies(code),
    
    -- KYC (for large donors)
    kyc_status VARCHAR(20) DEFAULT 'not_required',
    kyc_completed_at TIMESTAMPTZ,
    
    -- Source
    acquisition_channel VARCHAR(50),  -- website, social_media, branch, referral
    acquisition_channel_id UUID REFERENCES marketing_channels(id),
    referred_by UUID REFERENCES donors(id),
    
    -- Stats (denormalized)
    total_sponsorships INT DEFAULT 0,
    active_sponsorships INT DEFAULT 0,
    total_donated DECIMAL(15, 2) DEFAULT 0,
    total_donated_currency CHAR(3),
    first_donation_at TIMESTAMPTZ,
    last_donation_at TIMESTAMPTZ,
    
    -- Preferences
    notification_channels JSONB DEFAULT '["email"]'::jsonb,
    communication_preferences JSONB,
    
    -- Privacy
    is_anonymous BOOLEAN DEFAULT FALSE,
    is_zakat_donor BOOLEAN DEFAULT FALSE,
    
    status VARCHAR(20) DEFAULT 'active',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_donors_org ON donors(organization_id);
CREATE INDEX idx_donors_user ON donors(user_id);
CREATE INDEX idx_donors_status ON donors(organization_id, status);
CREATE INDEX idx_donors_channel ON donors(acquisition_channel_id);
ALTER TABLE donors ENABLE ROW LEVEL SECURITY;
CREATE POLICY donors_org_isolation ON donors
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- ═══════════════════════════════════════════════════════════════
-- 13. SPONSORSHIPS (The Core Relationship)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE sponsorships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(20) UNIQUE NOT NULL,  -- KAF-XXXXX
    
    donor_id UUID NOT NULL REFERENCES donors(id),
    orphan_id UUID NOT NULL REFERENCES orphans(id),
    marketing_channel_id UUID REFERENCES marketing_channels(id),
    
    -- Financial
    monthly_amount DECIMAL(10, 2) NOT NULL,
    currency CHAR(3) NOT NULL REFERENCES currencies(code),
    
    -- Duration
    start_date DATE NOT NULL,
    end_date DATE,  -- NULL = open-ended
    
    -- Payment plan
    payment_frequency VARCHAR(20) DEFAULT 'monthly' CHECK (
        payment_frequency IN ('monthly', 'quarterly', 'semi_annual', 'annual', 'one_time')
    ),
    payment_method VARCHAR(30),
    next_payment_date DATE,
    
    -- Status
    status VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (status IN (
        'pending',
        'active',
        'paused',
        'overdue',
        'cancelled',
        'completed',
        'transferred'
    )),
    
    -- Tracking
    total_paid DECIMAL(15, 2) DEFAULT 0,
    payments_count INT DEFAULT 0,
    last_payment_date DATE,
    last_payment_amount DECIMAL(10, 2),
    months_overdue INT DEFAULT 0,
    
    -- Acquisition
    acquisition_source VARCHAR(100),
    acquisition_campaign VARCHAR(100),
    
    -- Cancellation
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

-- CRITICAL: Prevent duplicate sponsorships
CREATE UNIQUE INDEX idx_sponsorships_no_duplicate ON sponsorships (donor_id, orphan_id)
    WHERE status IN ('active', 'paused', 'overdue');

CREATE INDEX idx_sponsorships_org ON sponsorships(organization_id);
CREATE INDEX idx_sponsorships_donor ON sponsorships(donor_id);
CREATE INDEX idx_sponsorships_orphan ON sponsorships(orphan_id);
CREATE INDEX idx_sponsorships_status ON sponsorships(organization_id, status);
CREATE INDEX idx_sponsorships_channel ON sponsorships(marketing_channel_id);
CREATE INDEX idx_sponsorships_next_payment ON sponsorships(next_payment_date)
    WHERE status = 'active';

ALTER TABLE sponsorships ENABLE ROW LEVEL SECURITY;
CREATE POLICY sponsorships_org_isolation ON sponsorships
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- ═══════════════════════════════════════════════════════════════
-- 14. PAYMENTS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(20) UNIQUE NOT NULL,  -- PAY-XXXXX
    
    donor_id UUID NOT NULL REFERENCES donors(id),
    sponsorship_id UUID REFERENCES sponsorships(id),
    orphan_id UUID REFERENCES orphans(id),
    
    -- Amount
    amount DECIMAL(10, 2) NOT NULL,
    currency CHAR(3) NOT NULL REFERENCES currencies(code),
    
    -- Amount in organization's default currency (for reporting)
    amount_in_default_currency DECIMAL(10, 2),
    exchange_rate DECIMAL(15, 6),
    
    -- Payment details
    payment_method VARCHAR(50) NOT NULL CHECK (payment_method IN (
        'credit_card',
        'debit_card',
        'bank_transfer',
        'knet',
        'paypal',
        'cash',
        'cheque',
        'standing_order',
        'mobile_payment',
        'other'
    )),
    payment_gateway VARCHAR(50),
    
    -- External references
    gateway_transaction_id VARCHAR(255),
    bank_reference VARCHAR(255),
    
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',
        'processing',
        'completed',
        'failed',
        'refunded',
        'partially_refunded',
        'chargeback',
        'disputed',
        'on_hold'
    )),
    
    -- Dates
    initiated_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    failure_reason TEXT,
    
    -- Receipt
    receipt_number VARCHAR(50),
    receipt_issued_at TIMESTAMPTZ,
    receipt_url VARCHAR(500),
    
    -- Source tracking
    source_type VARCHAR(50),
    source_id VARCHAR(255),
    acquisition_channel_id UUID REFERENCES marketing_channels(id),
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_payments_org ON payments(organization_id);
CREATE INDEX idx_payments_donor ON payments(donor_id, created_at DESC);
CREATE INDEX idx_payments_sponsorship ON payments(sponsorship_id);
CREATE INDEX idx_payments_orphan ON payments(orphan_id);
CREATE INDEX idx_payments_status ON payments(organization_id, status);
CREATE INDEX idx_payments_date ON payments(organization_id, completed_at DESC);
CREATE INDEX idx_payments_gateway_ref ON payments(gateway_transaction_id);
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY payments_org_isolation ON payments
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- ═══════════════════════════════════════════════════════════════
-- 15. BANK TRANSFERS (To Partners)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE bank_transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(20) UNIQUE NOT NULL,  -- TRF-XXXXX
    
    partner_organization_id UUID NOT NULL REFERENCES partner_organizations(id),
    
    -- Amount
    amount DECIMAL(15, 2) NOT NULL,
    currency CHAR(3) NOT NULL REFERENCES currencies(code),
    
    -- Bank details
    bank_name VARCHAR(255),
    bank_reference VARCHAR(255),
    
    -- Period covered
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN (
        'pending',
        'approved',
        'processing',
        'completed',
        'failed',
        'cancelled'
    )),
    
    -- Approval workflow
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    
    -- Execution
    executed_by UUID REFERENCES users(id),
    executed_at TIMESTAMPTZ,
    
    -- Confirmation from partner
    confirmed_by_partner_at TIMESTAMPTZ,
    confirmation_document_id UUID REFERENCES documents(id),
    
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transfers_org ON bank_transfers(organization_id);
CREATE INDEX idx_transfers_partner ON bank_transfers(partner_organization_id);
CREATE INDEX idx_transfers_status ON bank_transfers(organization_id, status);
ALTER TABLE bank_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY transfers_org_isolation ON bank_transfers
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- Items in each transfer (which orphans got how much)
CREATE TABLE bank_transfer_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_id UUID NOT NULL REFERENCES bank_transfers(id) ON DELETE CASCADE,
    orphan_id UUID NOT NULL REFERENCES orphans(id),
    amount DECIMAL(10, 2) NOT NULL,
    currency CHAR(3) NOT NULL,
    
    -- Delivery confirmation
    delivered_at TIMESTAMPTZ,
    delivery_confirmation TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transfer_items_transfer ON bank_transfer_items(transfer_id);
CREATE INDEX idx_transfer_items_orphan ON bank_transfer_items(orphan_id);

-- ═══════════════════════════════════════════════════════════════
-- 16. MESSAGES (Donor ↔ Orphan/Guardian)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    
    -- Participants
    from_user_id UUID NOT NULL REFERENCES users(id),
    -- Nullable: an orphan-composed message may not have a resolvable
    -- recipient yet (no provisioned guardian); a moderator routes it.
    to_user_id UUID REFERENCES users(id),
    related_orphan_id UUID REFERENCES orphans(id),
    related_sponsorship_id UUID REFERENCES sponsorships(id),
    
    -- Content
    message_type VARCHAR(20) DEFAULT 'text' CHECK (
        message_type IN ('text', 'voice', 'image', 'video', 'system')
    ),
    content TEXT,
    media_url VARCHAR(500),
    
    -- Moderation
    moderation_status VARCHAR(20) DEFAULT 'pending' CHECK (
        moderation_status IN ('pending', 'approved', 'rejected', 'auto_approved')
    ),
    moderated_by UUID REFERENCES users(id),
    moderated_at TIMESTAMPTZ,
    moderation_notes TEXT,
    
    -- Status
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    
    -- Translation (auto-generated)
    detected_language VARCHAR(5),
    translations JSONB,  -- {ar: "...", en: "..."}
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_from ON messages(from_user_id);
CREATE INDEX idx_messages_to ON messages(to_user_id);
CREATE INDEX idx_messages_orphan ON messages(related_orphan_id);
CREATE INDEX idx_messages_moderation ON messages(organization_id, moderation_status);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY messages_org_isolation ON messages
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- ═══════════════════════════════════════════════════════════════
-- 17. NOTIFICATIONS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    user_id UUID NOT NULL REFERENCES users(id),
    
    notification_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    
    -- Related entities
    related_entity_type VARCHAR(50),
    related_entity_id UUID,
    
    -- Delivery channels (one notification can go to multiple channels)
    channels JSONB DEFAULT '[]'::jsonb,  -- ["in_app", "email", "sms", "whatsapp", "push"]
    
    -- Status per channel
    channel_status JSONB DEFAULT '{}'::jsonb,
    
    -- In-app status
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    
    -- Action
    action_url VARCHAR(500),
    action_label VARCHAR(100),
    
    -- Priority
    priority VARCHAR(20) DEFAULT 'normal' CHECK (
        priority IN ('low', 'normal', 'high', 'urgent')
    ),
    
    expires_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_org_isolation ON notifications
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- ═══════════════════════════════════════════════════════════════
-- 18. AUDIT LOG (Append-Only)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID NOT NULL,
    user_id UUID,
    
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    
    -- Changes (old and new values)
    old_values JSONB,
    new_values JSONB,
    
    -- Context
    ip_address INET,
    user_agent TEXT,
    request_id VARCHAR(100),
    
    -- Sensitive operation flag
    is_sensitive BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- No UPDATE/DELETE allowed - append only
CREATE INDEX idx_audit_org ON audit_log(organization_id, created_at DESC);
CREATE INDEX idx_audit_user ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_action ON audit_log(action, created_at DESC);

-- Prevent updates and deletes
CREATE RULE no_update_audit AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_audit AS ON DELETE TO audit_log DO INSTEAD NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 19. BUSINESS RULES (Configurable Settings)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE business_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) UNIQUE,
    
    -- Marketing assignment timeouts
    marketing_assignment_days INT DEFAULT 30,
    marketing_warning_days_1 INT DEFAULT 10,
    marketing_warning_days_2 INT DEFAULT 5,
    
    -- Payment delay rules
    payment_overdue_warning_months INT DEFAULT 1,
    payment_critical_months INT DEFAULT 2,
    payment_auto_suspend_months INT DEFAULT 3,
    
    -- Orphan graduation
    orphan_graduation_age INT DEFAULT 18,
    orphan_warning_months_before_graduation INT DEFAULT 3,
    
    -- Report frequency
    monthly_report_required BOOLEAN DEFAULT TRUE,
    quarterly_health_report_required BOOLEAN DEFAULT TRUE,
    
    -- Approval workflow
    require_double_approval_for_reports BOOLEAN DEFAULT FALSE,
    require_double_approval_for_media BOOLEAN DEFAULT TRUE,
    
    -- Guardian visibility settings
    show_financial_to_guardian BOOLEAN DEFAULT FALSE,
    show_donor_identity_to_guardian BOOLEAN DEFAULT FALSE,
    show_balance_to_guardian BOOLEAN DEFAULT FALSE,
    show_sponsorship_dates_to_guardian BOOLEAN DEFAULT TRUE,

    -- Orphan portal visibility settings
    show_donor_first_name_to_orphan BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Custom rules (JSONB for extensibility)
    custom_rules JSONB DEFAULT '{}'::jsonb,
    
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID REFERENCES users(id)
);

ALTER TABLE business_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY rules_org_isolation ON business_rules
    USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- ═══════════════════════════════════════════════════════════════
-- 20. WEBHOOKS (External Integrations)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE webhook_endpoints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    
    name VARCHAR(255) NOT NULL,
    url VARCHAR(500) NOT NULL,
    secret VARCHAR(255) NOT NULL,
    
    events JSONB NOT NULL DEFAULT '[]'::jsonb,
    
    is_active BOOLEAN DEFAULT TRUE,
    last_triggered_at TIMESTAMPTZ,
    failed_count INT DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE TABLE webhook_deliveries (
    id BIGSERIAL PRIMARY KEY,
    webhook_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    
    response_status INT,
    response_body TEXT,
    
    delivered_at TIMESTAMPTZ DEFAULT NOW(),
    delivery_attempts INT DEFAULT 1
);

CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id, delivered_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- 21. API KEYS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    
    name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(255) UNIQUE NOT NULL,
    key_prefix VARCHAR(20) NOT NULL,
    
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    
    rate_limit_per_minute INT DEFAULT 60,
    
    is_active BOOLEAN DEFAULT TRUE,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_api_keys_org ON api_keys(organization_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

-- ═══════════════════════════════════════════════════════════════
-- 22. UTILITY FUNCTIONS & TRIGGERS
-- ═══════════════════════════════════════════════════════════════

-- Auto-generate codes
CREATE OR REPLACE FUNCTION generate_code(prefix TEXT, table_name TEXT) RETURNS TEXT AS $$
DECLARE
    next_num INT;
BEGIN
    EXECUTE format('SELECT COUNT(*) + 1 FROM %I', table_name) INTO next_num;
    RETURN prefix || '-' || LPAD(next_num::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- Update timestamps
CREATE OR REPLACE FUNCTION update_modified_column() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update trigger to all tables with updated_at
CREATE TRIGGER update_orgs_modtime BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_users_modtime BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_orphans_modtime BEFORE UPDATE ON orphans
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();
-- (Add for all other tables with updated_at)

-- ═══════════════════════════════════════════════════════════════
-- 23. MATERIALIZED VIEWS (For Performance)
-- ═══════════════════════════════════════════════════════════════

-- Organization-level statistics
CREATE MATERIALIZED VIEW mv_org_stats AS
SELECT 
    o.id AS organization_id,
    COUNT(DISTINCT orp.id) AS total_orphans,
    COUNT(DISTINCT orp.id) FILTER (WHERE orp.is_sponsored) AS sponsored_orphans,
    COUNT(DISTINCT d.id) AS total_donors,
    COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'active') AS active_sponsorships,
    COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'completed'), 0) AS total_donated,
    NOW() AS last_refreshed_at
FROM organizations o
LEFT JOIN orphans orp ON orp.organization_id = o.id AND orp.deleted_at IS NULL
LEFT JOIN donors d ON d.organization_id = o.id AND d.deleted_at IS NULL
LEFT JOIN sponsorships s ON s.organization_id = o.id
LEFT JOIN payments p ON p.organization_id = o.id
GROUP BY o.id;

CREATE UNIQUE INDEX idx_mv_org_stats ON mv_org_stats(organization_id);

-- Refresh nightly
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_org_stats;

-- ═══════════════════════════════════════════════════════════════
-- 24. INITIAL SEED DATA
-- ═══════════════════════════════════════════════════════════════

-- Insert common currencies
INSERT INTO currencies (code, name_ar, name_en, symbol, decimal_places) VALUES
('KWD', 'دينار كويتي', 'Kuwaiti Dinar', 'د.ك', 3),
('USD', 'دولار أمريكي', 'US Dollar', '$', 2),
('EUR', 'يورو', 'Euro', '€', 2),
('GBP', 'جنيه إسترليني', 'British Pound', '£', 2),
('SAR', 'ريال سعودي', 'Saudi Riyal', 'ر.س', 2),
('AED', 'درهم إماراتي', 'UAE Dirham', 'د.إ', 2),
('EGP', 'جنيه مصري', 'Egyptian Pound', 'ج.م', 2)
ON CONFLICT DO NOTHING;

-- Insert common countries (sample)
INSERT INTO countries (code_alpha2, code_alpha3, name_ar, name_en, flag_emoji, phone_code) VALUES
('KW', 'KWT', 'الكويت', 'Kuwait', '🇰🇼', '+965'),
('SA', 'SAU', 'السعودية', 'Saudi Arabia', '🇸🇦', '+966'),
('AE', 'ARE', 'الإمارات', 'UAE', '🇦🇪', '+971'),
('EG', 'EGY', 'مصر', 'Egypt', '🇪🇬', '+20'),
('PS', 'PSE', 'فلسطين', 'Palestine', '🇵🇸', '+970'),
('YE', 'YEM', 'اليمن', 'Yemen', '🇾🇪', '+967'),
('SY', 'SYR', 'سوريا', 'Syria', '🇸🇾', '+963'),
('SD', 'SDN', 'السودان', 'Sudan', '🇸🇩', '+249'),
('US', 'USA', 'الولايات المتحدة', 'USA', '🇺🇸', '+1'),
('GB', 'GBR', 'المملكة المتحدة', 'UK', '🇬🇧', '+44')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- END OF SCHEMA
-- ═══════════════════════════════════════════════════════════════
