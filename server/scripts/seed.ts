import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import * as schema from '../../shared/schema.js';

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set.');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool, schema });

async function seed() {
  try {
    const existing = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, 'admin'))
      .limit(1);

    if (existing.length > 0) {
      console.log('Admin user already exists. Skipping creation.');
      await pool.end();
      return;
    }

    const hashedPassword = await bcrypt.hash('password', 10);

    await db.insert(schema.users).values({
      username: 'admin',
      password: hashedPassword,
      name: 'Admin User',
      email: 'admin@example.com',
      role: 'super_admin',
    });

    console.log('Default admin user created successfully.');
    console.log('Username: admin');
    console.log('Password: password');
  } catch (error) {
    console.error('Seed error:', error);
  } finally {
    await pool.end();
  }
}

seed();
