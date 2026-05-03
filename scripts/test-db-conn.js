const postgres = require('postgres');
const sql = postgres('postgresql://dev_user:dev_password@localhost:5432/postgres_dev');
sql`SELECT 1 as test`.then(r => {
  console.log('DB CONNECTED:', JSON.stringify(r));
  sql.end();
}).catch(e => {
  console.log('DB ERROR:', e.message);
  sql.end();
});
