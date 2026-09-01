-- ========================================================
-- Covermark Link Landing Management System
-- Turso (libSQL / SQLite) Database Schema
-- ========================================================

-- 1. Admins Table
CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    employee_id TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at TEXT NOT NULL
);

-- 2. Landing Pages Table
CREATE TABLE IF NOT EXISTS landing_pages (
    id TEXT PRIMARY KEY,
    title TEXT,
    headline TEXT,
    message TEXT,
    slug TEXT UNIQUE NOT NULL,
    image_url TEXT,
    status TEXT DEFAULT 'published',
    publish_at TEXT,
    expire_at TEXT,
    seo_title TEXT,
    meta_description TEXT,
    redirect_url TEXT,
    button_layout TEXT DEFAULT 'vertical',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 3. Buttons Table (1-to-many with landing_pages)
CREATE TABLE IF NOT EXISTS buttons (
    id TEXT PRIMARY KEY,
    landing_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    style TEXT DEFAULT 'primary',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (landing_id) REFERENCES landing_pages(id) ON DELETE CASCADE
);

-- 4. Daily Analytics Aggregation
CREATE TABLE IF NOT EXISTS analytics (
    landing_id TEXT NOT NULL,
    date TEXT NOT NULL,
    views INTEGER DEFAULT 0,
    unique_visitors INTEGER DEFAULT 0,
    button_clicks INTEGER DEFAULT 0,
    PRIMARY KEY (landing_id, date),
    FOREIGN KEY (landing_id) REFERENCES landing_pages(id) ON DELETE CASCADE
);

-- 5. Button-level Daily Clicks
CREATE TABLE IF NOT EXISTS button_clicks (
    landing_id TEXT NOT NULL,
    button_id TEXT NOT NULL,
    date TEXT NOT NULL,
    clicks INTEGER DEFAULT 0,
    PRIMARY KEY (landing_id, button_id, date)
);

-- 6. Click Event Logs (Detailed timestamped clicks)
CREATE TABLE IF NOT EXISTS click_logs (
    id TEXT PRIMARY KEY,
    landing_id TEXT NOT NULL,
    campaign_title TEXT,
    button_id TEXT NOT NULL,
    button_title TEXT,
    clicked_at TEXT NOT NULL
);

-- 7. Admin Activity Logs
CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    admin TEXT NOT NULL,
    action TEXT NOT NULL,
    target_table TEXT NOT NULL,
    record_id TEXT,
    old_value TEXT,
    new_value TEXT,
    ip TEXT,
    created_at TEXT NOT NULL
);

-- Indexes for lightning-fast queries
CREATE INDEX IF NOT EXISTS idx_landing_pages_slug ON landing_pages(slug);
CREATE INDEX IF NOT EXISTS idx_buttons_landing_id ON buttons(landing_id);
CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics(date);
CREATE INDEX IF NOT EXISTS idx_click_logs_landing_id ON click_logs(landing_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);

-- Default Admin Account (Seeding)
INSERT OR IGNORE INTO admins (id, name, employee_id, password, role, created_at)
VALUES ('ADM001', 'ผู้ดูแลระบบ', 'admin', 'CvM#Pass2026', 'super_admin', datetime('now'));
