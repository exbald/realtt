const { execSync } = require('child_process');

// Check PostgreSQL
const results = {};

// Check if psql exists
try {
  execSync('which psql 2>/dev/null');
  results.psql = 'found';
} catch {
  results.psql = 'not found';
}

// Check if pg_isready exists
try {
  execSync('which pg_isready 2>/dev/null');
  results.pg_isready = 'found';
  try {
    const output = execSync('pg_isready 2>&1').toString();
    results.pg_status = output.trim();
  } catch (e) {
    results.pg_status = e.message;
  }
} catch {
  results.pg_isready = 'not found';
}

// Try connecting with node-postgres
async function testConnection() {
  try {
    const postgres = require('postgres');
    const sql = postgres('postgresql://dev_user:dev_password@localhost:5432/postgres_dev');
    const result = await sql`SELECT 1 as test`;
    results.db_connection = 'SUCCESS';
    results.db_result = result;
    await sql.end();
  } catch (e) {
    results.db_connection = 'FAILED';
    results.db_error = e.message;
  }
  console.log(JSON.stringify(results, null, 2));
}

testConnection();
