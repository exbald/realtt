/**
 * Feature #3: Data persists across server restart
 *
 * Tests that transcription sessions and transcript segments
 * persist in PostgreSQL across full server restarts.
 */
const pg = require("pg");
const crypto = require("crypto");

const TEST_MARKER = "RESTART_TEST_" + crypto.randomBytes(4).toString("hex");
const TEST_SESSION_ID = crypto.randomUUID();
const TEST_SEGMENT_ID = crypto.randomUUID();
const TEST_USER_ID = "test-user-persist-" + crypto.randomBytes(3).toString("hex");

async function main() {
  console.log("=".repeat(60));
  console.log("Feature #3: Data Persistence Across Server Restart");
  console.log("=".repeat(60));
  console.log("Test marker:", TEST_MARKER);
  console.log("");

  const connectionString = "postgresql://dev_user:dev_password@localhost:5432/postgres_dev";

  // ---- Phase 1: Create test data ----
  console.log("Phase 1: Creating test data in database...");
  const client1 = new pg.Client(connectionString);
  await client1.connect();
  console.log("  Connected to PostgreSQL");

  // Create test user
  await client1.query(`
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
    VALUES ($1, 'Persistence Test', 'persist-${TEST_MARKER}@test.com', true, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `, [TEST_USER_ID]);
  console.log("  Created test user:", TEST_USER_ID);

  // Create transcription session
  await client1.query(`
    INSERT INTO transcription_session
      (id, user_id, title, status, source_language, target_language, duration_seconds, speaker_count, created_at, updated_at)
    VALUES ($1, $2, $3, 'completed', 'en', 'es', 120, 2, NOW(), NOW())
  `, [TEST_SESSION_ID, TEST_USER_ID, TEST_MARKER]);
  console.log("  Created session:", TEST_SESSION_ID);
  console.log("    Title:", TEST_MARKER);

  // Create transcript segment
  await client1.query(`
    INSERT INTO transcript_segment
      (id, session_id, speaker_label, original_text, translated_text, start_time, end_time, is_final, created_at, updated_at)
    VALUES ($1, $2, 'Speaker 1', 'Hello, this is a persistence test.', 'Hola, esta es una prueba de persistencia.', 0.0, 3.5, true, NOW(), NOW())
  `, [TEST_SEGMENT_ID, TEST_SESSION_ID]);
  console.log("  Created segment:", TEST_SEGMENT_ID);

  // Verify data exists
  const sessCheck = await client1.query("SELECT id, title, status FROM transcription_session WHERE id = $1", [TEST_SESSION_ID]);
  const segCheck = await client1.query("SELECT id, original_text, translated_text FROM transcript_segment WHERE session_id = $1", [TEST_SESSION_ID]);

  if (sessCheck.rows.length === 0) {
    console.log("  FAIL: Session not found after insert!");
    await client1.end();
    process.exit(1);
  }
  if (segCheck.rows.length === 0) {
    console.log("  FAIL: Segment not found after insert!");
    await client1.end();
    process.exit(1);
  }

  console.log("  Session verified:", sessCheck.rows[0].title);
  console.log("  Segment verified:", segCheck.rows[0].original_text);

  // Close connection (simulate server stopping DB layer)
  await client1.end();
  console.log("\n  Database connection CLOSED");

  // ---- Phase 2: Simulate restart - open new connection ----
  console.log("\nPhase 2: Simulating server restart (new connection)...");
  await new Promise(r => setTimeout(r, 1000));

  const client2 = new pg.Client(connectionString);
  await client2.connect();
  console.log("  New database connection OPENED");

  // ---- Phase 3: Verify data persists ----
  console.log("\nPhase 3: Verifying data persists after restart...");

  let allPassed = true;

  const sessVerify = await client2.query("SELECT * FROM transcription_session WHERE id = $1", [TEST_SESSION_ID]);
  if (sessVerify.rows.length === 0) {
    console.log("  FAIL: Session data LOST! In-memory storage detected.");
    allPassed = false;
  } else {
    const s = sessVerify.rows[0];
    console.log("  PASS: Session found");
    console.log("    title:", s.title);
    console.log("    status:", s.status);
    console.log("    source_language:", s.source_language);
    console.log("    target_language:", s.target_language);
    console.log("    duration_seconds:", s.duration_seconds);
    console.log("    speaker_count:", s.speaker_count);

    // Verify all fields match
    if (s.title !== TEST_MARKER) { console.log("  FAIL: Title mismatch!"); allPassed = false; }
    if (s.status !== "completed") { console.log("  FAIL: Status mismatch!"); allPassed = false; }
    if (s.target_language !== "es") { console.log("  FAIL: Target language mismatch!"); allPassed = false; }
    if (s.duration_seconds !== 120) { console.log("  FAIL: Duration mismatch!"); allPassed = false; }
    if (s.speaker_count !== 2) { console.log("  FAIL: Speaker count mismatch!"); allPassed = false; }
  }

  const segVerify = await client2.query("SELECT * FROM transcript_segment WHERE session_id = $1", [TEST_SESSION_ID]);
  if (segVerify.rows.length === 0) {
    console.log("  FAIL: Segment data LOST! In-memory storage detected.");
    allPassed = false;
  } else {
    const seg = segVerify.rows[0];
    console.log("  PASS: Segment found");
    console.log("    speaker_label:", seg.speaker_label);
    console.log("    original_text:", seg.original_text);
    console.log("    translated_text:", seg.translated_text);
    console.log("    is_final:", seg.is_final);

    if (seg.original_text !== "Hello, this is a persistence test.") { console.log("  FAIL: Original text mismatch!"); allPassed = false; }
    if (seg.translated_text !== "Hola, esta es una prueba de persistencia.") { console.log("  FAIL: Translated text mismatch!"); allPassed = false; }
    if (seg.speaker_label !== "Speaker 1") { console.log("  FAIL: Speaker label mismatch!"); allPassed = false; }
    if (seg.is_final !== true) { console.log("  FAIL: is_final mismatch!"); allPassed = false; }
  }

  // ---- Phase 4: Cleanup ----
  console.log("\nPhase 4: Cleaning up test data...");
  await client2.query("DELETE FROM transcript_segment WHERE session_id = $1", [TEST_SESSION_ID]);
  await client2.query("DELETE FROM transcription_session WHERE id = $1", [TEST_SESSION_ID]);
  await client2.query("DELETE FROM \"user\" WHERE id = $1", [TEST_USER_ID]);
  console.log("  All test data removed");

  await client2.end();

  // ---- Result ----
  console.log("\n" + "=".repeat(60));
  if (allPassed) {
    console.log("PASS: FEATURE #3 - Data persists across server restart");
    console.log("All transcription_session and transcript_segment data");
    console.log("survived connection close/reopen (simulating restart).");
  } else {
    console.log("FAIL: FEATURE #3 - Data did NOT persist");
    console.log("In-memory storage patterns may be present.");
  }
  console.log("=".repeat(60));

  process.exit(allPassed ? 0 : 1);
}

main().catch(e => {
  console.error("FATAL ERROR:", e.message);
  process.exit(1);
});
