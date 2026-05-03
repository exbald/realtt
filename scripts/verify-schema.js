const pg = require("pg");

async function main() {
  const client = new pg.Client("postgresql://dev_user:dev_password@localhost:5432/postgres_dev");
  await client.connect();
  console.log("=== DATABASE SCHEMA VERIFICATION ===\n");

  // 1. List all tables
  const tables = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
  );
  console.log("1. TABLES IN DATABASE:");
  for (const row of tables.rows) {
    console.log("   - " + row.tablename);
  }
  console.log();

  // 2. Verify required application tables exist
  const requiredTables = ["transcription_session", "transcript_segment", "user_settings"];
  const existingTables = tables.rows.map(r => r.tablename);
  console.log("2. REQUIRED APPLICATION TABLES:");
  for (const t of requiredTables) {
    const exists = existingTables.includes(t);
    console.log("   - " + t + ": " + (exists ? "EXISTS" : "MISSING"));
  }
  console.log();

  // 3. Check columns for each required table
  for (const tableName of requiredTables) {
    if (!existingTables.includes(tableName)) continue;

    const columns = await client.query(
      "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public' ORDER BY ordinal_position",
      [tableName]
    );
    console.log("3. COLUMNS FOR '" + tableName + "':");
    for (const col of columns.rows) {
      console.log("   - " + col.column_name + " (" + col.data_type + ", nullable=" + col.is_nullable + ", default=" + (col.column_default || "none") + ")");
    }
    console.log();
  }

  // 4. Check indexes
  const indexes = await client.query(
    "SELECT indexname, tablename, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname"
  );
  console.log("4. INDEXES:");
  for (const idx of indexes.rows) {
    console.log("   - " + idx.indexname + " ON " + idx.tablename);
    console.log("     " + idx.indexdef);
  }
  console.log();

  // 5. Check foreign keys
  const fks = await client.query(
    "SELECT tc.table_name, tc.constraint_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name, rc.delete_rule FROM information_schema.table_constraints AS tc JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name JOIN information_schema.referential_constraints AS rc ON rc.constraint_name = tc.constraint_name WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' ORDER BY tc.table_name"
  );
  console.log("5. FOREIGN KEYS:");
  for (const fk of fks.rows) {
    console.log("   - " + fk.table_name + "." + fk.column_name + " -> " + fk.foreign_table_name + "." + fk.foreign_column_name + " (ON DELETE " + fk.delete_rule + ")");
  }
  console.log();

  // 6. Specific verifications per feature requirements
  console.log("6. SPECIFIC VERIFICATION CHECKS:");

  // Check transcription_session columns
  const tsCols = await client.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'transcription_session' AND table_schema = 'public'"
  );
  const tsColNames = tsCols.rows.map(r => r.column_name);
  const requiredTsCols = ["id", "user_id", "title", "status", "source_language", "target_language", "duration_seconds", "speaker_count", "created_at", "updated_at"];
  console.log("   transcription_session columns:");
  for (const col of requiredTsCols) {
    const colRow = tsCols.rows.find(r => r.column_name === col);
    console.log("     - " + col + ": " + (colRow ? colRow.data_type : "MISSING"));
  }

  // Check transcript_segment columns
  const tsegCols = await client.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'transcript_segment' AND table_schema = 'public'"
  );
  const requiredTsegCols = ["id", "session_id", "speaker_label", "original_text", "translated_text", "start_time", "end_time", "is_final", "created_at", "updated_at"];
  console.log("   transcript_segment columns:");
  for (const col of requiredTsegCols) {
    const colRow = tsegCols.rows.find(r => r.column_name === col);
    console.log("     - " + col + ": " + (colRow ? colRow.data_type : "MISSING"));
  }

  // Check user_settings columns
  const usCols = await client.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'user_settings' AND table_schema = 'public'"
  );
  const requiredUsCols = ["id", "user_id", "default_target_language", "selected_microphone_id", "updated_at"];
  console.log("   user_settings columns:");
  for (const col of requiredUsCols) {
    const colRow = usCols.rows.find(r => r.column_name === col);
    console.log("     - " + col + ": " + (colRow ? colRow.data_type : "MISSING"));
  }

  console.log("\n=== VERIFICATION COMPLETE ===");
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
