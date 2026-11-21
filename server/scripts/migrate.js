import { detectRunningServer } from './_db-admin.js'

const startedAt = Date.now()

const { running, port } = await detectRunningServer()
if (running) {
  console.error(
    `Refusing to run db:migrate while ChatDesk is running on port ${port}. Stop the server first so sql.js cannot race the migration writer.`,
  )
  process.exit(1)
}

console.log('[db-migrations] Checking database schema...')

try {
  const { getCurrentSchemaVersion } = await import('../db.js')

  const schemaVersion = await getCurrentSchemaVersion()

  console.log(
    `Migrations complete in ${((Date.now() - startedAt) / 1000).toFixed(1)}s. Current schema version: ${schemaVersion}`,
  )

  // Close the knex pool explicitly: without this the idle pool keeps the
  // Node process alive for idleTimeoutMillis (30s in Postgres mode), making
  // the updater appear to pause for no reason after migrations finish.
  try {
    const { dbKnex } = await import('../db/knex.js')
    await dbKnex.destroy()
  } catch {}
  process.exit(0)
} catch (error) {
  // Fail-fast errors (connectivity preflight, migration watchdog) carry a
  // full actionable message — print it cleanly instead of a stack trace.
  console.error(String(error?.message || error))
  console.error('[db-migrations] Migration FAILED. Nothing beyond the failed migration was changed.')
  process.exit(1)
}
