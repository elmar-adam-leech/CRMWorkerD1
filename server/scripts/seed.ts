import { db, pool } from '../db.js';
import { users } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';

async function seed() {
  try {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.username, 'admin'))
      .limit(1);

    if (existing.length > 0) {
      console.log('Admin user already exists. Skipping creation.');
      return;
    }

    const hashedPassword = await bcrypt.hash('password', 10);

    await db.insert(users).values({
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
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
