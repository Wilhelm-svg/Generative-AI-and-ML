import { initDb, getDb, closeDb } from './db.js';

async function test() {
  try {
    console.log('Testing database connection...');
    await initDb();
    console.log('✅ Database initialized');
    
    const db = getDb();
    const result = await db.query('SELECT 1 AS test');
    console.log('✅ Query executed:', result.rows[0]);
    
    await closeDb();
    console.log('✅ Database closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

test();
