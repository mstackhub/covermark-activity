// ========================================================
// Turso Database Initialization / Migration Script
// Run: node scripts/init-db.js
// ========================================================

const fs = require('fs');
const path = require('path');
const { getDb } = require('../api/lib/db');

async function main() {
  console.log('🚀 Connecting to Turso database...');
  const db = getDb();

  const schemaPath = path.join(__dirname, '../schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  // Split into separate statements
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  console.log(`📝 Executing ${statements.length} SQL statements...`);

  for (let i = 0; i < statements.length; i++) {
    try {
      await db.execute(statements[i]);
      console.log(`✅ [${i + 1}/${statements.length}] Statement executed successfully.`);
    } catch (err) {
      console.error(`❌ Statement ${i + 1} failed:`, err.message);
    }
  }

  console.log('🎉 Turso database setup completed successfully!');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
