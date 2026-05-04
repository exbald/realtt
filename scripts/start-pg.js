import EmbeddedPostgres from 'embedded-postgres';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', '.pgdata');

const pg = new EmbeddedPostgres({
  database: 'postgres_dev',
  user: 'dev_user',
  password: 'dev_password',
  port: 5432,
  dataDir: dbPath,
});

console.log('Starting embedded PostgreSQL...');
await pg.initialise();
console.log('PostgreSQL initialized.');

await pg.start();
console.log('PostgreSQL started on port 5432!');

// Keep process alive
process.on('SIGINT', async () => {
  console.log('Shutting down PostgreSQL...');
  await pg.stop();
  process.exit(0);
});

// Signal ready
console.log('POSTGRES_READY=true');
