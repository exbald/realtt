const postgres = require('postgres');
const sql = postgres('postgresql://dev_user:dev_password@localhost:5432/postgres_dev');

async function main() {
  // Check what tables exist
  const tables = await sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    ORDER BY tablename
  `;
  console.log('Tables:', tables.map(t => t.tablename));

  // Check transcription_session columns
  const columns = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'transcription_session'
    ORDER BY ordinal_position
  `;
  console.log('\ntranscription_session columns:', columns.map(c => `${c.column_name} (${c.data_type})`));

  // Check transcript_segment columns
  const segColumns = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'transcript_segment'
    ORDER BY ordinal_position
  `;
  console.log('\ntranscript_segment columns:', segColumns.map(c => `${c.column_name} (${c.data_type})`));

  // Check user_settings columns
  const settingsColumns = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'user_settings'
    ORDER BY ordinal_position
  `;
  console.log('\nuser_settings columns:', settingsColumns.map(c => `${c.column_name} (${c.data_type})`));

  await sql.end();
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
