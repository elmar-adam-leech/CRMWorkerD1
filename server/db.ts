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

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle({ client: pool, schema });

// Enable pg_trgm extension for trigram-based GIN indexes on text columns.
// This makes ILIKE '%substring%' queries (used for name/title search) use
// index scans instead of full sequential scans. The extension is idempotent
// and safe to call on every startup.
pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm').catch((err: Error) => {
  console.warn('[db] Could not enable pg_trgm extension:', err.message);
});
