import { defineConfig } from "drizzle-kit";

if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_DATABASE_ID || !process.env.CLOUDFLARE_D1_TOKEN) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID, and CLOUDFLARE_D1_TOKEN environment variables are required");
}

export default defineConfig({
  out: "./migrations-d1",
  schema: "./shared/schema-d1.ts",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    databaseId: process.env.CLOUDFLARE_DATABASE_ID,
    token: process.env.CLOUDFLARE_D1_TOKEN,
  },
});