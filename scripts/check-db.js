const pg = require("pg");

async function main() {
  const client = new pg.Client("postgresql://dev_user:dev_password@localhost:5432/postgres_dev");
  try {
    await client.connect();
    console.log("CONNECTED to PostgreSQL");

    const res = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    console.log("Existing tables:", res.rows.map(r => r.tablename));

    await client.end();
  } catch (e) {
    console.log("ERROR:", e.message);
    console.log("Stack:", e.stack);
    process.exit(1);
  }
}

main();
