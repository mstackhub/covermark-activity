// ========================================================
// Covermark Link Landing Management System
// Vercel Serverless Function Handler (Powered by Turso)
// ========================================================

const { getDb, ensureTables } = require('./lib/db');

const API_KEY = process.env.API_KEY || 'COVERMARK_SECRET_API_KEY';

module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Ensure DB Schema is initialized
  await ensureTables();
  const db = getDb();

  try {
    let body = req.body || {};
    if (typeof body === 'string' && body.trim().length > 0) {
      try {
        body = JSON.parse(body);
      } catch (e) {
        body = {};
      }
    } else if (Buffer.isBuffer(body)) {
      try {
        body = JSON.parse(body.toString('utf8'));
      } catch (e) {
        body = {};
      }
    }

    const isPost = req.method === 'POST';
    const params = isPost ? Object.assign({}, req.query || {}, body) : (req.query || {});
    const action = params.action || (req.query && req.query.action) || (body && body.action);

    if (!action) {
      return res.status(400).json({ success: false, message: 'Missing action parameter' });
    }

    // ──────────────────────────────────────────────────────
    // 1. PUBLIC ENDPOINTS (No Admin Auth Required)
    // ──────────────────────────────────────────────────────

    // Get public landing page by slug
    if (action === 'getLandingPageBySlug') {
      const slug = (params.slug || '').trim();
      if (!slug) {
        return res.status(400).json({ success: false, message: 'Missing slug' });
      }

      const lpResult = await db.execute({
        sql: 'SELECT * FROM landing_pages WHERE slug = ? LIMIT 1',
        args: [slug]
      });

      if (lpResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'ไม่พบหน้านี้ในระบบ' });
      }

      const lp = { ...lpResult.rows[0] };
      const btnsResult = await db.execute({
        sql: 'SELECT * FROM buttons WHERE landing_id = ? ORDER BY sort_order ASC',
        args: [lp.id]
      });
      lp.buttons = btnsResult.rows;

      return res.json({ success: true, data: lp });
    }

    // Track View
    if (action === 'trackView') {
      const landingId = params.landingId;
      const isUnique = !!params.isUnique;
      const today = new Date().toISOString().substring(0, 10);

      await db.execute({
        sql: `INSERT INTO analytics (landing_id, date, views, unique_visitors, button_clicks)
              VALUES (?, ?, 1, ?, 0)
              ON CONFLICT(landing_id, date) DO UPDATE SET
                views = views + 1,
                unique_visitors = unique_visitors + ?;`,
        args: [landingId, today, isUnique ? 1 : 0, isUnique ? 1 : 0]
      });

      return res.json({ success: true });
    }

    // Track Click
    if (action === 'trackClick') {
      const { landingId, buttonId } = params;
      const today = new Date().toISOString().substring(0, 10);
      const now = new Date().toISOString();

      // Get button & campaign title for detailed click log
      let campaignTitle = '';
      let buttonTitle = '';

      try {
        const lpRes = await db.execute({
          sql: 'SELECT title, headline FROM landing_pages WHERE id = ?',
          args: [landingId]
        });
        if (lpRes.rows.length > 0) {
          campaignTitle = lpRes.rows[0].title || lpRes.rows[0].headline || '';
        }

        const btnRes = await db.execute({
          sql: 'SELECT title FROM buttons WHERE id = ?',
          args: [buttonId]
        });
        if (btnRes.rows.length > 0) {
          buttonTitle = btnRes.rows[0].title;
        }
      } catch (e) {}

      await db.batch([
        // 1. Update overall button clicks in analytics
        {
          sql: `INSERT INTO analytics (landing_id, date, views, unique_visitors, button_clicks)
                VALUES (?, ?, 0, 0, 1)
                ON CONFLICT(landing_id, date) DO UPDATE SET
                  button_clicks = button_clicks + 1;`,
          args: [landingId, today]
        },
        // 2. Update button_clicks table
        {
          sql: `INSERT INTO button_clicks (landing_id, button_id, date, clicks)
                VALUES (?, ?, ?, 1)
                ON CONFLICT(landing_id, button_id, date) DO UPDATE SET
                  clicks = clicks + 1;`,
          args: [landingId, buttonId, today]
        },
        // 3. Append to detailed click_logs
        {
          sql: `INSERT INTO click_logs (id, landing_id, campaign_title, button_id, button_title, clicked_at)
                VALUES (?, ?, ?, ?, ?, ?);`,
          args: ['CLK' + Date.now() + Math.floor(Math.random() * 1000), landingId, campaignTitle, buttonId, buttonTitle, now]
        }
      ]);

      return res.json({ success: true });
    }

    // ──────────────────────────────────────────────────────
    // 2. ADMIN AUTHENTICATION CHECK
    // ──────────────────────────────────────────────────────
    const providedApiKey = params.apiKey || req.headers['x-api-key'];
    if (action !== 'login' && providedApiKey !== API_KEY) {
      return res.status(401).json({ success: false, message: 'Unauthorized API Key' });
    }

    // Login Action
    if (action === 'login') {
      const { employeeId, password, ip } = params;
      const adminRes = await db.execute({
        sql: 'SELECT * FROM admins WHERE employee_id = ? AND password = ? LIMIT 1',
        args: [employeeId, password]
      });

      if (adminRes.rows.length === 0) {
        // Log failed attempt
        await logActivity(db, employeeId || 'Guest', 'login_failed', 'Admins', employeeId, null, null, ip);
        return res.json({ success: false, message: 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง' });
      }

      const admin = adminRes.rows[0];
      const adminData = {
        id: admin.id,
        name: admin.name,
        employee_id: admin.employee_id,
        role: admin.role
      };

      await logActivity(db, admin.name, 'login', 'Admins', admin.id, null, JSON.stringify(adminData), ip);
      return res.json({ success: true, data: adminData });
    }

    // ──────────────────────────────────────────────────────
    // 3. ADMIN LANDING PAGES CRUD
    // ──────────────────────────────────────────────────────

    // Get all landing pages with buttons
    if (action === 'getLandingPages') {
      const lpRes = await db.execute('SELECT * FROM landing_pages ORDER BY created_at DESC');
      const btnRes = await db.execute('SELECT * FROM buttons ORDER BY sort_order ASC');

      const buttonsByLp = {};
      for (const btn of btnRes.rows) {
        if (!buttonsByLp[btn.landing_id]) buttonsByLp[btn.landing_id] = [];
        buttonsByLp[btn.landing_id].push(btn);
      }

      const lps = lpRes.rows.map(lp => ({
        ...lp,
        buttons: buttonsByLp[lp.id] || []
      }));

      return res.json({ success: true, data: lps });
    }

    // Create Landing Page
    if (action === 'createLandingPage') {
      const { data, admin, ip } = params;
      if (!data || !data.slug) {
        return res.status(400).json({ success: false, message: 'Missing required data or slug' });
      }

      // Check slug uniqueness
      const checkSlug = await db.execute({
        sql: 'SELECT id FROM landing_pages WHERE slug = ? LIMIT 1',
        args: [data.slug.trim()]
      });
      if (checkSlug.rows.length > 0) {
        return res.json({ success: false, message: 'Slug นี้ถูกใช้งานไปแล้ว กรุณาใช้ Slug อื่น' });
      }

      const lpId = 'LP' + Date.now() + Math.floor(Math.random() * 100);
      const now = new Date().toISOString();

      const batchStatements = [
        {
          sql: `INSERT INTO landing_pages (id, title, headline, message, slug, image_url, status, publish_at, expire_at, seo_title, meta_description, redirect_url, button_layout, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          args: [
            lpId,
            data.title || '',
            data.headline || '',
            data.message || '',
            data.slug.trim(),
            data.image_url || '',
            data.status || 'draft',
            data.publish_at || '',
            data.expire_at || '',
            data.seo_title || '',
            data.meta_description || '',
            data.redirect_url || '',
            data.button_layout || 'vertical',
            now,
            now
          ]
        }
      ];

      if (Array.isArray(data.buttons)) {
        data.buttons.forEach((btn, index) => {
          batchStatements.push({
            sql: `INSERT INTO buttons (id, landing_id, title, url, style, sort_order, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?);`,
            args: [
              'BTN' + Date.now() + Math.floor(Math.random() * 1000) + index,
              lpId,
              btn.title || '',
              btn.url || '',
              btn.style || 'primary',
              btn.sort_order ?? index,
              now
            ]
          });
        });
      }

      await db.batch(batchStatements);
      await logActivity(db, admin, 'create', 'LandingPages', lpId, null, JSON.stringify(data), ip);

      return res.json({ success: true, data: { id: lpId, ...data } });
    }

    // Update Landing Page
    if (action === 'updateLandingPage') {
      const { data, admin, ip } = params;
      if (!data || !data.id) {
        return res.status(400).json({ success: false, message: 'Missing page ID' });
      }

      // Check slug uniqueness across other landing pages
      if (data.slug) {
        const checkSlug = await db.execute({
          sql: 'SELECT id FROM landing_pages WHERE slug = ? AND id != ? LIMIT 1',
          args: [data.slug.trim(), data.id]
        });
        if (checkSlug.rows.length > 0) {
          return res.json({ success: false, message: 'Slug นี้ถูกใช้งานโดยแคมเปญอื่นแล้ว' });
        }
      }

      const oldRes = await db.execute({
        sql: 'SELECT * FROM landing_pages WHERE id = ?',
        args: [data.id]
      });
      const oldLp = oldRes.rows[0] || null;

      const now = new Date().toISOString();
      const batchStatements = [
        {
          sql: `UPDATE landing_pages SET
                  title = ?, headline = ?, message = ?, slug = ?, image_url = ?,
                  status = ?, publish_at = ?, expire_at = ?, seo_title = ?,
                  meta_description = ?, redirect_url = ?, button_layout = ?,
                  updated_at = ?
                WHERE id = ?;`,
          args: [
            data.title || '',
            data.headline || '',
            data.message || '',
            data.slug.trim(),
            data.image_url || '',
            data.status || 'draft',
            data.publish_at || '',
            data.expire_at || '',
            data.seo_title || '',
            data.meta_description || '',
            data.redirect_url || '',
            data.button_layout || 'vertical',
            now,
            data.id
          ]
        },
        // Remove old buttons and insert updated ones
        {
          sql: 'DELETE FROM buttons WHERE landing_id = ?',
          args: [data.id]
        }
      ];

      if (Array.isArray(data.buttons)) {
        data.buttons.forEach((btn, index) => {
          batchStatements.push({
            sql: `INSERT INTO buttons (id, landing_id, title, url, style, sort_order, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?);`,
            args: [
              'BTN' + Date.now() + Math.floor(Math.random() * 1000) + index,
              data.id,
              btn.title || '',
              btn.url || '',
              btn.style || 'primary',
              btn.sort_order ?? index,
              now
            ]
          });
        });
      }

      await db.batch(batchStatements);
      await logActivity(db, admin, 'update', 'LandingPages', data.id, JSON.stringify(oldLp), JSON.stringify(data), ip);

      return res.json({ success: true, data });
    }

    // Delete Landing Page
    if (action === 'deleteLandingPage') {
      const { id, admin, ip } = params;
      const oldRes = await db.execute({
        sql: 'SELECT * FROM landing_pages WHERE id = ?',
        args: [id]
      });
      const targetLp = oldRes.rows[0] || null;

      if (!targetLp) {
        return res.json({ success: false, message: 'ไม่พบหน้า Landing Page ที่ต้องการลบ' });
      }

      const btnRes = await db.execute({
        sql: 'SELECT * FROM buttons WHERE landing_id = ?',
        args: [id]
      });
      targetLp.buttons = btnRes.rows;

      await db.batch([
        { sql: 'DELETE FROM buttons WHERE landing_id = ?', args: [id] },
        { sql: 'DELETE FROM analytics WHERE landing_id = ?', args: [id] },
        { sql: 'DELETE FROM button_clicks WHERE landing_id = ?', args: [id] },
        { sql: 'DELETE FROM landing_pages WHERE id = ?', args: [id] }
      ]);

      await logActivity(db, admin, 'delete', 'LandingPages', id, JSON.stringify(targetLp), null, ip);
      return res.json({ success: true, data: { id } });
    }

    // Duplicate Landing Page
    if (action === 'duplicateLandingPage') {
      const { id, admin, ip } = params;
      const lpRes = await db.execute({
        sql: 'SELECT * FROM landing_pages WHERE id = ?',
        args: [id]
      });
      const sourceLp = lpRes.rows[0];

      if (!sourceLp) {
        return res.json({ success: false, message: 'ไม่พบแคมเปญต้นฉบับ' });
      }

      const newLpId = 'LP' + Date.now() + Math.floor(Math.random() * 100);
      const newSlug = sourceLp.slug + '-copy-' + Math.floor(Math.random() * 1000);
      const now = new Date().toISOString();

      const batchStatements = [
        {
          sql: `INSERT INTO landing_pages (id, title, headline, message, slug, image_url, status, publish_at, expire_at, seo_title, meta_description, redirect_url, button_layout, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?);`,
          args: [
            newLpId,
            (sourceLp.title || '') + ' (คัดลอก)',
            sourceLp.headline || '',
            sourceLp.message || '',
            newSlug,
            sourceLp.image_url || '',
            sourceLp.publish_at || '',
            sourceLp.expire_at || '',
            sourceLp.seo_title || '',
            sourceLp.meta_description || '',
            sourceLp.redirect_url || '',
            sourceLp.button_layout || 'vertical',
            now,
            now
          ]
        }
      ];

      const btnRes = await db.execute({
        sql: 'SELECT * FROM buttons WHERE landing_id = ? ORDER BY sort_order ASC',
        args: [id]
      });

      btnRes.rows.forEach((btn, index) => {
        batchStatements.push({
          sql: `INSERT INTO buttons (id, landing_id, title, url, style, sort_order, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?);`,
          args: [
            'BTN' + Date.now() + Math.floor(Math.random() * 1000) + index,
            newLpId,
            btn.title,
            btn.url,
            btn.style,
            btn.sort_order,
            now
          ]
        });
      });

      await db.batch(batchStatements);
      await logActivity(db, admin, 'duplicate', 'LandingPages', newLpId, JSON.stringify({ source_id: id }), null, ip);

      return res.json({ success: true, data: { id: newLpId } });
    }

    // ──────────────────────────────────────────────────────
    // 4. ANALYTICS & REPORTS
    // ──────────────────────────────────────────────────────
    if (action === 'getAnalytics') {
      const landingId = params.landingId;

      let analyticsSql = 'SELECT * FROM analytics';
      let buttonClicksSql = 'SELECT * FROM button_clicks';
      const args = [];

      if (landingId) {
        analyticsSql += ' WHERE landing_id = ?';
        buttonClicksSql += ' WHERE landing_id = ?';
        args.push(landingId);
      }
      analyticsSql += ' ORDER BY date ASC';

      const [analyticsRes, buttonClicksRes, buttonsRes] = await Promise.all([
        db.execute({ sql: analyticsSql, args }),
        db.execute({ sql: buttonClicksSql, args }),
        db.execute('SELECT id, title FROM buttons')
      ]);

      const buttonTitles = {};
      for (const btn of buttonsRes.rows) {
        buttonTitles[btn.id] = btn.title;
      }

      // Group button clicks
      const topButtonsMap = {};
      for (const row of buttonClicksRes.rows) {
        const title = buttonTitles[row.button_id] || `ปุ่ม (${row.button_id})`;
        if (!topButtonsMap[row.button_id]) {
          topButtonsMap[row.button_id] = {
            button_id: row.button_id,
            title,
            clicks: 0
          };
        }
        topButtonsMap[row.button_id].clicks += Number(row.clicks || 0);
      }

      const topButtons = Object.values(topButtonsMap).sort((a, b) => b.clicks - a.clicks);

      // Group & aggregate analytics by date if viewing across all campaigns
      const dateMap = {};
      for (const row of analyticsRes.rows) {
        const d = row.date;
        if (!dateMap[d]) {
          dateMap[d] = { date: d, views: 0, unique_visitors: 0, clicks: 0 };
        }
        dateMap[d].views += Number(row.views || 0);
        dateMap[d].unique_visitors += Number(row.unique_visitors || 0);
        dateMap[d].clicks += Number(row.button_clicks || 0);
      }

      const chartData = Object.values(dateMap).sort((a, b) => new Date(a.date) - new Date(b.date));

      return res.json({
        success: true,
        data: {
          chartData,
          topButtons
        }
      });
    }

    // ──────────────────────────────────────────────────────
    // 5. ACTIVITY LOGS & RESTORE
    // ──────────────────────────────────────────────────────
    if (action === 'getActivityLogs') {
      const logsRes = await db.execute('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 300');
      return res.json({ success: true, data: logsRes.rows });
    }

    if (action === 'restoreVersion') {
      const { logId, admin, ip } = params;
      const logRes = await db.execute({
        sql: 'SELECT * FROM activity_logs WHERE id = ?',
        args: [logId]
      });

      if (logRes.rows.length === 0) {
        return res.json({ success: false, message: 'ไม่พบ Log ที่ต้องการย้อนประวัติ' });
      }

      const log = logRes.rows[0];
      const targetTable = log.target_table;
      let dataToRestore = null;

      try {
        dataToRestore = JSON.parse(log.action === 'delete' ? log.old_value : (log.old_value || log.new_value));
      } catch (e) {
        return res.json({ success: false, message: 'ข้อมูลใน Log ไม่สมบูรณ์สำหรับการกู้คืน' });
      }

      if (targetTable === 'LandingPages' && dataToRestore) {
        const now = new Date().toISOString();
        const batchStatements = [
          {
            sql: `INSERT INTO landing_pages (id, title, headline, message, slug, image_url, status, publish_at, expire_at, seo_title, meta_description, redirect_url, button_layout, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    headline = excluded.headline,
                    message = excluded.message,
                    slug = excluded.slug,
                    image_url = excluded.image_url,
                    status = excluded.status,
                    publish_at = excluded.publish_at,
                    expire_at = excluded.expire_at,
                    seo_title = excluded.seo_title,
                    meta_description = excluded.meta_description,
                    redirect_url = excluded.redirect_url,
                    button_layout = excluded.button_layout,
                    updated_at = excluded.updated_at;`,
            args: [
              dataToRestore.id,
              dataToRestore.title || '',
              dataToRestore.headline || '',
              dataToRestore.message || '',
              dataToRestore.slug,
              dataToRestore.image_url || '',
              dataToRestore.status || 'draft',
              dataToRestore.publish_at || '',
              dataToRestore.expire_at || '',
              dataToRestore.seo_title || '',
              dataToRestore.meta_description || '',
              dataToRestore.redirect_url || '',
              dataToRestore.button_layout || 'vertical',
              dataToRestore.created_at || now,
              now
            ]
          },
          { sql: 'DELETE FROM buttons WHERE landing_id = ?', args: [dataToRestore.id] }
        ];

        if (Array.isArray(dataToRestore.buttons)) {
          dataToRestore.buttons.forEach((btn, index) => {
            batchStatements.push({
              sql: `INSERT INTO buttons (id, landing_id, title, url, style, sort_order, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?);`,
              args: [
                btn.id || ('BTN' + Date.now() + index),
                dataToRestore.id,
                btn.title,
                btn.url,
                btn.style || 'primary',
                btn.sort_order ?? index,
                now
              ]
            });
          });
        }

        await db.batch(batchStatements);
        await logActivity(db, admin, 'restore', 'LandingPages', dataToRestore.id, null, JSON.stringify(dataToRestore), ip);
        return res.json({ success: true, data: { id: dataToRestore.id } });
      }

      return res.json({ success: false, message: 'ไม่รองรับการกู้คืนข้อมูลประเภทนี้' });
    }

    // ──────────────────────────────────────────────────────
    // 6. ADMINS MANAGEMENT
    // ──────────────────────────────────────────────────────
    if (action === 'getAdmins') {
      const adminsRes = await db.execute('SELECT id, name, employee_id, role, created_at FROM admins ORDER BY created_at ASC');
      return res.json({ success: true, data: adminsRes.rows });
    }

    // Image Upload (Direct Base64 Data URI storage / CDN ready)
    if (action === 'uploadImage') {
      const { mimeType, base64Data } = params;
      if (!base64Data) {
        return res.status(400).json({ success: false, message: 'Missing image data' });
      }
      const dataUri = `data:${mimeType || 'image/jpeg'};base64,${base64Data}`;
      return res.json({
        success: true,
        data: { url: dataUri }
      });
    }

    return res.status(400).json({ success: false, message: 'Unknown action: ' + action });
  } catch (error) {
    console.error('API Handler Error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal Server Error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// Helper: Log Admin Activities
async function logActivity(db, admin, action, targetTable, recordId, oldValue, newValue, ip) {
  try {
    const id = 'LOG' + Date.now() + Math.floor(Math.random() * 1000);
    const now = new Date().toISOString();
    await db.execute({
      sql: `INSERT INTO activity_logs (id, admin, action, target_table, record_id, old_value, new_value, ip, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      args: [id, admin || 'System', action, targetTable, recordId || '', oldValue || null, newValue || null, ip || '127.0.0.1', now]
    });
  } catch (err) {
    console.error('Error writing activity log:', err);
  }
}
