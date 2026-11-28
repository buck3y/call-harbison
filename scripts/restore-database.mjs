// Puts a backup back in place of the site's database. Run it only while the site is stopped (docs/VPS.md, "Restore"):
//
//   sudo systemctl stop call-harbison
//   sudo -u callharbison env STATE_DIRECTORY=/var/lib/call-harbison \
//     node /srv/call-harbison/current/scripts/restore-database.mjs /var/lib/call-harbison/backups/db-2026-11-27.tar.gz
//   sudo systemctl start call-harbison
//
// The backup is first opened in a new folder to check it is whole; only then is it swapped in. The folder it
// replaces is kept next to it (db.before-restore-<time>) until you delete it. If the site is still running, or
// anything goes wrong before the swap, nothing is changed.
import { databaseDir, restoreDatabase } from '../lib/local-database.js';

const file = process.argv[2];
if (!file || process.argv.length > 3) {
  console.error('Usage: node scripts/restore-database.mjs <backup file, for example /var/lib/call-harbison/backups/db-2026-11-27.tar.gz>');
  process.exit(2);
}
if (!process.env.STATE_DIRECTORY && !process.env.DATABASE_DIR) {
  console.error('Say where the database is: put STATE_DIRECTORY=/var/lib/call-harbison (the service\'s state folder) in front of the command, or DATABASE_DIR=<folder>. Nothing was changed.');
  process.exit(2);
}
console.log(`Restoring ${file}\n     into ${databaseDir(process.env)}`);
try {
  const { leads, previous } = await restoreDatabase({ file, env: process.env });
  console.log(`Done. The restored database holds ${leads} lead${leads === 1 ? '' : 's'}.`);
  if (previous) console.log(`The database it replaced is kept in ${previous}. Delete that folder once you are sure.`);
  console.log('Start the site again: sudo systemctl start call-harbison');
} catch (err) {
  console.error(`Nothing was changed: ${err.message}`);
  process.exit(1);
}
