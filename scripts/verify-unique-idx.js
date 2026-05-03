const pg = require("pg");

async function main() {
  const client = new pg.Client("postgresql://dev_user:dev_password@localhost:5432/postgres_dev");
  await client.connect();

  const indexes = await client.query(
    "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'user_settings' AND schemaname = 'public'"
  );
  console.log("user_settings indexes:");
  for (const idx of indexes.rows) {
    console.log("  " + idx.indexname + ": " + idx.indexdef);
  }

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
