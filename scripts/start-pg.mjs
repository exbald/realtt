import { spawnSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync, chmodSync, statSync, readFileSync } from "fs";
import path from "path";
import { tmpdir } from "os";

const NATIVE_DIR = path.resolve("node_modules/@embedded-postgres/linux-x64/native");
const INITDB = path.join(NATIVE_DIR, "bin/initdb");
const PG_CTL = path.join(NATIVE_DIR, "bin/pg_ctl");
const POSTGRES = path.join(NATIVE_DIR, "bin/postgres");
const DATA_DIR = path.resolve(".postgres-data");
const PORT = "5432";
const USER = "dev_user";
const PASSWORD = "dev_password";
const LIB_DIR = path.join(NATIVE_DIR, "lib");

function ensureExec(fp) {
  const st = statSync(fp);
  const need = 0o555;
  if ((st.mode & need) !== need) {
    chmodSync(fp, st.mode | need);
  }
}

ensureExec(INITDB);
ensureExec(PG_CTL);
ensureExec(POSTGRES);

const env = { ...process.env, LD_LIBRARY_PATH: LIB_DIR };

if (!existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
  console.log("Initializing database...");
  mkdirSync(DATA_DIR, { recursive: true });

  const pwFile = path.join(tmpdir(), "pg-pw-" + Date.now());
  writeFileSync(pwFile, PASSWORD + "\n");

  const initResult = spawnSync(INITDB, [
    "--pgdata=" + DATA_DIR,
    "--auth=password",
    "--username=" + USER,
    "--pwfile=" + pwFile,
    "--no-locale",
  ], { env, stdio: "inherit" });

  if (initResult.status !== 0) {
    console.error("initdb failed with code", initResult.status);
    process.exit(1);
  }
  console.log("Database initialized successfully.");
} else {
  console.log("Database already initialized.");
}

console.log("Starting PostgreSQL daemon...");
const startResult = spawnSync(PG_CTL, [
  "start",
  "-D", DATA_DIR,
  "-l", path.join(DATA_DIR, "logfile"),
  "-o", "-p " + PORT,
  "-w",
], { env, stdio: "inherit" });

if (startResult.status !== 0) {
  console.error("pg_ctl start failed with code", startResult.status);
  try {
    const log = readFileSync(path.join(DATA_DIR, "logfile"), "utf8");
    console.error("Log:", log.split("\n").slice(-10).join("\n"));
  } catch (_) {}
  process.exit(1);
}

console.log("PostgreSQL daemon started on port " + PORT);

console.log("Checking for postgres_dev database...");
const pg = await import("pg");
const client = new pg.default.Client({
  user: USER,
  password: PASSWORD,
  port: parseInt(PORT),
  host: "localhost",
  database: "postgres",
});

try {
  await client.connect();
  const res = await client.query(
    "SELECT 1 FROM pg_database WHERE datname = 'postgres_dev'"
  );
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

console.log("ALL_READY");
