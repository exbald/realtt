/**
 * Full server restart persistence test for Feature #3.
 * Creates data, kills the Next.js server, restarts it, then verifies data.
 */
const pg = require("pg");
const { execSync } = require("child_process");
const crypto = require("crypto");

const TEST_MARKER = "RESTART_FULL_" + crypto.randomBytes(4).toString("hex");
const TEST_SESSION_ID = crypto.randomUUID();
const TEST_USER_ID = "test-restart-" + crypto.randomBytes(3).toString("hex");
const PORT = 3000;

async function main() {
  console.log("=".repeat(60));
  console.log("Feature #3: FULL Server Restart Persistence Test");
  console.log("=".repeat(60));
  console.log("Test marker:", TEST_MARKER);
  console.log("");

  const connectionString = "postgresql://dev_user:dev_password@localhost:5432/postgres_dev";
  const client = new pg.Client(connectionString);
  await client.connect();

  // Step 1: Create test data
  console.log("Step 1: Creating test data...");
  await client.query(`
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
    VALUES ($1, 'Full Restart Test', 'fullrestart-${TEST_MARKER}@test.com', true, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `, [TEST_USER_ID]);

  await client.query(`
    INSERT INTO transcription_session
      (id, user_id, title, status, source_language, target_language, duration_seconds, speaker_count, created_at, updated_at)
    VALUES ($1, $2, $3, 'completed', 'en', 'fr', 300, 3, NOW(), NOW())
  `, [TEST_SESSION_ID, TEST_USER_ID, TEST_MARKER]);

  console.log("  Created session:", TEST_SESSION_ID, "title:", TEST_MARKER);

  // Step 2: Verify server is running
  console.log("\nStep 2: Checking server is running...");
  try {
    const response = await fetch("http://localhost:" + PORT + "/api/diagnostics");
    const data = await response.json();
    console.log("  Server running: db connected =", data.database.connected, ", schema =", data.database.schemaApplied);
  } catch (e) {
    console.log("  WARNING: Server not responding on port", PORT);
  }

  // Step 3: Kill the Next.js server
  console.log("\nStep 3: Killing Next.js server on port", PORT, "...");
  try {
    execSync("kill $(lsof -ti :" + PORT + ") 2>/dev/null || true");
    console.log("  Server killed");
  } catch (e) {
    console.log("  Could not kill server:", e.message);
  }

  // Wait for process to fully stop
  await new Promise(r => setTimeout(r, 3000));

  // Verify port is free
  try {
    const pid = execSync("lsof -ti :" + PORT + " 2>/dev/null").toString().trim();
    if (pid) {
      console.log("  WARNING: Process still on port", PORT, "PID:", pid);
      execSync("kill -9 " + pid + " 2>/dev/null || true");
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch {
    console.log("  Port", PORT, "is free");
  }

  // Step 4: Restart the server
  console.log("\nStep 4: Restarting Next.js server...");
  execSync("cd /app/generations/realtt && npx pnpm run dev &", { stdio: "ignore", detached: true });
  console.log("  Server starting...");

  // Wait for server to be ready
  let serverReady = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const response = await fetch("http://localhost:" + PORT + "/api/diagnostics", {
        signal: AbortSignal.timeout(2000)
      });
      if (response.ok) {
        serverReady = true;
        console.log("  Server ready after", (i + 1) * 2, "seconds");
        break;
      }
    } catch {}
  }

  if (!serverReady) {
    console.log("  WARNING: Server may not be ready yet, but checking DB directly...");
  }

  // Step 5: Verify data persists
  console.log("\nStep 5: Verifying data persists after full restart...");
  const client2 = new pg.Client(connectionString);
  await client2.connect();

  let allPassed = true;

  const sess = await client2.query("SELECT * FROM transcription_session WHERE id = $1", [TEST_SESSION_ID]);
  if (sess.rows.length === 0) {
    console.log("  FAIL: Session data LOST after server restart!");
    allPassed = false;
  } else {
    const s = sess.rows[0];
    console.log("  PASS: Session found");
    console.log("    title:", s.title, "(expected:", TEST_MARKER + ")");
    console.log("    target_language:", s.target_language);
    console.log("    duration:", s.duration_seconds, "seconds");
    console.log("    speaker_count:", s.speaker_count);

    if (s.title !== TEST_MARKER) allPassed = false;
    if (s.target_language !== "fr") allPassed = false;
    if (s.duration_seconds !== 300) allPassed = false;
    if (s.speaker_count !== 3) allPassed = false;
  }

  // Step 6: Cleanup
  console.log("\nStep 6: Cleaning up test data...");
  await client2.query("DELETE FROM transcript_segment WHERE session_id = $1", [TEST_SESSION_ID]);
  await client2.query("DELETE FROM transcription_session WHERE id = $1", [TEST_SESSION_ID]);
  await client2.query("DELETE FROM \"user\" WHERE id = $1", [TEST_USER_ID]);
  console.log("  Cleanup complete");

  await client2.end();

  console.log("\n" + "=".repeat(60));
  if (allPassed) {
    console.log("PASS: Data persists across full server restart");
  } else {
    console.log("FAIL: Data was lost");
  }
  console.log("=".repeat(60));

  process.exit(allPassed ? 0 : 1);
}

main().catch(e => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
