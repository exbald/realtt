const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const results = {};

// Check common PostgreSQL paths
const pgPaths = [
  '/usr/lib/postgresql',
  '/usr/local/pgsql',
  '/usr/bin/postgres',
  '/usr/bin/pg_ctl',
  '/etc/postgresql',
  '/var/lib/postgresql',
];

for (const p of pgPaths) {
  results[p] = fs.existsSync(p);
}

// Check if pg_ctl exists anywhere
try {
  const output = execSync('find /usr -name "pg_ctl" 2>/dev/null', { timeout: 5000 }).toString().trim();
  results.pg_ctl_locations = output || 'none found';
} catch (e) {
  results.pg_ctl_locations = 'search failed';
}

// Check if postgres binary exists
try {
  const output = execSync('find /usr -name "postgres" -type f 2>/dev/null', { timeout: 5000 }).toString().trim();
  results.postgres_binary = output || 'none found';
} catch (e) {
  results.postgres_binary = 'search failed';
}

// Check services
try {
  const output = execSync('service --status-all 2>&1 || systemctl list-units 2>&1').toString();
  results.services = output.substring(0, 500);
} catch (e) {
  results.services = 'cannot check services';
}

// Check if we can start anything
try {
  const output = execSync('ls /etc/init.d/ 2>/dev/null').toString();
  results.init_scripts = output.trim();
} catch (e) {
  results.init_scripts = 'none';
}

console.log(JSON.stringify(results, null, 2));
