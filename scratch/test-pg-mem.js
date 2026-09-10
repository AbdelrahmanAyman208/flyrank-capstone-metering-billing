const { newDb } = require('pg-mem');
const fs = require('fs');
const path = require('path');

async function test() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    try {
      await pool.query(sql);
      console.log(`Applied ${file}`);
    } catch (e) {
      console.error(`Failed ${file}:`, e.message);
    }
  }
  
  const { rows } = await pool.query('SELECT * FROM plans');
  console.log('Plans:', rows);
}

test();
