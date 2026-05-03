const EmbeddedPostgres = require("embedded-postgres").default;
const path = require("path");
const fs = require("fs");

const DATA_DIR = path.join(__dirname, "..", ".pgdata");

async function main() {
  console.log("Starting embedded PostgreSQL...");
  console.log("Data directory:", DATA_DIR);

  const pg = new EmbeddedPostgres({
    dataDir: DATA_DIR,
    port: 5432,
    user: "dev_user",
    password: "dev_password",
    database: "postgres_dev",
    persistent: true,
  });

  // Initialize only if data dir doesn't exist
  if (!fs.existsSync(DATA_DIR)) {
    console.log("Initializing new database cluster...");
    await pg.initialise();
    console.log("Database cluster initialized.");
  } else {
    console.log("Data directory exists, skipping initialization.");
  }

  await pg.start();
  console.log("PostgreSQL started on port 5432");

  // Create the database if needed
  try {
    await pg.createDatabase("postgres_dev");
    console.log("Database 'postgres_dev' created.");
  } catch (e) {
    if (e.message && e.message.includes("already exists")) {
      console.log("Database 'postgres_dev' already exists.");
    } else {
      console.log("Database creation note:", e.message);
    }
  }

  // Test the connection
  const client = pg.getPgClient("postgres_dev");
  try {
    await client.connect();
    const result = await client.query("SELECT 1 as ping");
    console.log("Connection test: SUCCESS", result.rows[0]);

    const tables = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
    );
    console.log(
      "Existing tables:",
      tables.rows.length > 0 ? tables.rows.map((r) => r.tabename) : "(none)"
    );

    await client.end();
  } catch (e) {
    console.log("Connection test FAILED:", e.message);
    await client.end().catch(() => {});
  }

  // Keep running - don't stop the server
  console.log("\nPostgreSQL is running. Press Ctrl+C to stop.");
  console.log("Connection string: postgresql://dev_user:dev_password@localhost:5432/postgres_dev");

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down PostgreSQL...");
    await pg.stop();
    console.log("PostgreSQL stopped.");
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nShutting down PostgreSQL...");
    await pg.stop();
    console.log("PostgreSQL stopped.");
    process.exit(0);
  });
}

main().catch((e) => {
  console.error("Failed to start PostgreSQL:", e);
  process.exit(1);
});
