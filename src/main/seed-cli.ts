/**
 * Standalone seeder: `npm run db:seed`
 * Builds the DB (menu + dev users) without launching the Electron window.
 */
import { initDatabase, getDbPath, closeDatabase } from './db/connection'
import { seedAll } from './db/seed'
import { DEV_CREDENTIALS } from './db/seed'

initDatabase()
seedAll({ withDevUsers: true })
closeDatabase()

// eslint-disable-next-line no-console
console.log(`\nSeed complete → ${getDbPath()}\n`)
// eslint-disable-next-line no-console
console.log('Development credentials (all must change password on first login):')
for (const c of DEV_CREDENTIALS) {
  // eslint-disable-next-line no-console
  console.log(`  ${c.role.padEnd(8)}  ${c.username.padEnd(10)}  ${c.password}`)
}
