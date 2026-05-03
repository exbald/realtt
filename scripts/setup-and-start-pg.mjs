import { symlinkSync, existsSync, readdirSync } from "fs";
import path from "path";
import { execSync, spawnSync } from "child_process";
import { tmpdir } from "os";

const LIB_DIR = path.resolve("node_modules/@embedded-postgres/linux-x64/native/lib");
const BIN_DIR = path.resolve("node_modules/@embedded-postgres/linux-x64/native/bin");
const DATA_DIR = path.resolve(".postgres-data");

// Step 1: Create symlinks for shared libraries
console.log("Creating library symlinks...");
const libFiles = readdirSync(LIB_DIR);
const soFiles = libFiles.filter(f => f.includes(".so.") && !f.includes(".a"));

for (const file of soFiles) {
  // Extract the .so.N version (e.g., libpq.so.5 from libpq.so.5.18)
  const match = file.match(/^(.+\.so\.\d+)/);
  if (match && match[1] !== file) {
    const linkPath = path.join(LIB_DIR, match[1]);
    if (!existsSync(linkPath)) {
      symlinkSync(path.join(LIB_DIR, file), linkPath);
      console.log("  Created symlink:", match[1], "->", file);
    }
  }
  // Also create the .so link (without version number)
  const baseMatch = file.match(/^(.+\.so)\./);
  if (baseMatch && baseMatch[1] !== file) {
    const linkPath = path.join(LIB_DIR, baseMatch[1]);
    if (!existsSync(linkPath)) {
      symlinkSync(path.join(LIB_DIR, file), linkPath);
      console.log("  Created symlink:", baseMatch[1], "->", file);
    }
  }
}
console.log("Library symlinks created.\n");

// Step 2: Set up environment
const env = { ...process.env, LD_LIBRARY_PATH: LIB_DIR };
const INITDB = path.join(BIN_DIR, "initdb");
const PG_CTL = path.join(BIN_DIR, "pg_ctl");

// Step 3: Initialize database if needed
if (!existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
  console.log("Initializing database...");
  execSync("mkdir -p " + DATA_DIR);

  const pwFile = path.join(tmpdir(), "pg-pw-" + Date.now());
  const { writeFileSync, unlinkSync } = await import("fs");
  writeFileSync(pwFile, "dev_password\n");

  const initResult = spawnSync(INITDB, [
    "--pgdata=" + DATA_DIR,
    "--auth=password",
    "--username=dev_user",
    "--pwfile=" + pwFile,
    "--no-locale",
  ], { env, stdio: "inherit" });

  try { unlinkSync(pwFile); } catch (_) {}

  if (initResult.status !== 0) {
    console.error("initdb failed with code", initResult.status);
    process.exit(1);
  }
  console.log("Database initialized successfully.\n");
} else {
  console.log("Database already initialized.\n");
}

// Step 4: Start PostgreSQL
console.log("Starting PostgreSQL daemon...");
const startResult = spawnSync(PG_CTL, [
  "start",
  "-D", DATA_DIR,
  "-l", path.join(DATA_DIR, "logfile"),
  "-o", "-p 5432",
  "-w",
], { env, stdio: "inherit" });

if (startResult.status !== 0) {
  console.error("pg_ctl start failed with code", startResult.status);
  try {
    const { readFileSync } = await import("fs");
    const log = readFileSync(path.join(DATA_DIR, "logfile"), "utf8");
    console.error("Log:", log.split("\n").slice(-15).join("\n"));
  } catch (_) {}
  process.exit(1);
}

console.log("PostgreSQL daemon started on port 5432\n");

// Step 5: Create database
console.log("Checking for postgres_dev database...");
const pg = await import("pg");
const client = new pg.default.Client({
  user: "dev_user",
  password: "dev_password",
  port: 5432,
  host: "localhost",
  database: "postgres",
});

try {
  await client.connect();
  const res = await client.query("SELECT 1 FROM pg_database WHERE datname = 'postgres_dev'");
  if (res.rows.length === 0) {
    await client.query("CREATE DATABASE postgres_dev");
    console.log("Database postgres_dev created.");
  } else {
    console.log("Database postgres_dev already exists.");
  }
  await client.end();
} catch (e) {
  console.error("Database creation error:", e.message);
  await client.end();
}

console.log("\nALL_READY");
