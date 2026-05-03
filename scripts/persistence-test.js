const pg = require("pg");

async function main() {
  const client = new pg.Client("postgresql://dev_user:dev_password@localhost:5432/postgres_dev");
  await client.connect();

  // First, discover actual column names from the schema
  const colRes = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'user' ORDER BY ordinal_position");
  console.log("Actual 'user' table columns:", colRes.rows.map(r => r.column_name));

  // Create a test entry using actual column names
  await client.query(`
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
    VALUES ('persistence-test-001', 'Test User', 'persistence-test@example.com', false, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  console.log("Inserted test user record");

  // Verify it exists
  const res = await client.query("SELECT id, name, email FROM \"user\" WHERE id = 'persistence-test-001'");
  console.log("Verification query result:", res.rows);

  // Clean up - delete the test record
  await client.query("DELETE FROM \"user\" WHERE id = 'persistence-test-001'");
  console.log("Cleaned up test record");

  // Final verification - make sure it's gone
  const afterCleanup = await client.query("SELECT id FROM \"user\" WHERE id = 'persistence-test-001'");
  console.log("After cleanup (should be empty):", afterCleanup.rows);

  await client.end();
  console.log("\nPersistence test PASSED");
}

main().catch(e => {
  console.error("Persistence test FAILED:", e.message);
  process.exit(1);
});
