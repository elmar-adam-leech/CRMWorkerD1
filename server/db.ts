import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// max: caps concurrent connections — raise via DB_POOL_MAX if queries queue under load.
// idleTimeoutMillis: release idle connections back to Neon after 30 s of inactivity.
// connectionTimeoutMillis: fail fast (5 s) rather than letting requests hang indefinitely.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 20),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});
console.info(`[DB] pool initialized — max: ${pool.options.max}`);
export const db = drizzle({ client: pool, schema });

// Enable pg_trgm extension for trigram-based GIN indexes on text columns.
// This makes ILIKE '%substring%' queries (used for name/title search) use
// index scans instead of full sequential scans. The extension is idempotent
// and safe to call on every startup.
pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm').catch((err: Error) => {
  console.error(
    '[db] pg_trgm extension not available — full-text search will be slow.',
    'Run: CREATE EXTENSION IF NOT EXISTS pg_trgm; on your database.',
    err.message
  );
});
