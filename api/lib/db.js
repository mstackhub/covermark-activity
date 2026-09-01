const { createClient } = require('@libsql/client');

let dbClient = null;
let isDbInitialized = false;

function getDb() {
  if (dbClient) return dbClient;

  let url = process.env.TURSO_DATABASE_URL || 'libsql://covermark-activity-mstackhub.aws-ap-northeast-1.turso.io';
  // Standardize URL protocol for HTTP-based Serverless Fetch
  if (url.startsWith('libsql://')) {
    url = url.replace('libsql://', 'https://');
  }
  const authToken = process.env.TURSO_AUTH_TOKEN || '';

  dbClient = createClient({
    url,
    authToken,
  });

  return dbClient;
}

// Auto-run schema migrations on cold start if not yet initialized
async function ensureTables() {
  if (isDbInitialized) return;
  const db = getDb();

  try {
    await db.batch([
      // 1. Admins
      `CREATE TABLE IF NOT EXISTS admins (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        employee_id TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        created_at TEXT NOT NULL
      );`,

      // 2. Landing Pages
      `CREATE TABLE IF NOT EXISTS landing_pages (
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
        audio_url TEXT DEFAULT '',
        audio_enabled INTEGER DEFAULT 0,
        audio_show_icon INTEGER DEFAULT 1,
        audio_volume REAL DEFAULT 0.5,
        audio_loop INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,

      // 3. Buttons
      `CREATE TABLE IF NOT EXISTS buttons (
        id TEXT PRIMARY KEY,
        landing_id TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        style TEXT DEFAULT 'primary',
        sort_order INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );`,

      // 4. Analytics
      `CREATE TABLE IF NOT EXISTS analytics (
        landing_id TEXT NOT NULL,
        date TEXT NOT NULL,
        views INTEGER DEFAULT 0,
        unique_visitors INTEGER DEFAULT 0,
        button_clicks INTEGER DEFAULT 0,
        PRIMARY KEY (landing_id, date)
      );`,

      // 5. Button Clicks
      `CREATE TABLE IF NOT EXISTS button_clicks (
        landing_id TEXT NOT NULL,
        button_id TEXT NOT NULL,
        date TEXT NOT NULL,
        clicks INTEGER DEFAULT 0,
        PRIMARY KEY (landing_id, button_id, date)
      );`,

      // 6. Click Logs
      `CREATE TABLE IF NOT EXISTS click_logs (
        id TEXT PRIMARY KEY,
        landing_id TEXT NOT NULL,
        campaign_title TEXT,
        button_id TEXT NOT NULL,
        button_title TEXT,
        clicked_at TEXT NOT NULL
      );`,

      // 7. Activity Logs
      `CREATE TABLE IF NOT EXISTS activity_logs (
        id TEXT PRIMARY KEY,
        admin TEXT NOT NULL,
        action TEXT NOT NULL,
        target_table TEXT NOT NULL,
        record_id TEXT,
        old_value TEXT,
        new_value TEXT,
        ip TEXT,
        created_at TEXT NOT NULL
      );`,

      // Indexes
      `CREATE INDEX IF NOT EXISTS idx_landing_pages_slug ON landing_pages(slug);`,
      `CREATE INDEX IF NOT EXISTS idx_buttons_landing_id ON buttons(landing_id);`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics(date);`,
      `CREATE INDEX IF NOT EXISTS idx_click_logs_landing_id ON click_logs(landing_id);`,
      `CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);`,

      // Default Admin Seed
      `INSERT OR IGNORE INTO admins (id, name, employee_id, password, role, created_at)
       VALUES ('ADM001', 'ผู้ดูแลระบบ', 'admin', 'CvM#Pass2026', 'super_admin', datetime('now'));`
    ]);

    // Ensure audio columns exist on older database schemas
    const alterCols = [
      'ALTER TABLE landing_pages ADD COLUMN audio_url TEXT DEFAULT ""',
      'ALTER TABLE landing_pages ADD COLUMN audio_enabled INTEGER DEFAULT 0',
      'ALTER TABLE landing_pages ADD COLUMN audio_show_icon INTEGER DEFAULT 1',
      'ALTER TABLE landing_pages ADD COLUMN audio_volume REAL DEFAULT 0.5',
      'ALTER TABLE landing_pages ADD COLUMN audio_loop INTEGER DEFAULT 1'
    ];
    for (const alterQuery of alterCols) {
      try {
        await db.execute(alterQuery);
      } catch (e) {
        // Ignored if column already exists
      }
    }

    isDbInitialized = true;
  } catch (err) {
    console.error('Error ensuring Turso database tables:', err);
  }
}

module.exports = {
  getDb,
  ensureTables,
};
