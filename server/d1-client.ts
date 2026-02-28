// D1 HTTP API client for database operations
export class D1HttpClient {
  private accountId: string;
  private databaseId: string;
  private token: string;
  private baseUrl: string;

  constructor() {
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID!;
    this.databaseId = process.env.CLOUDFLARE_DATABASE_ID!;
    this.token = process.env.CLOUDFLARE_D1_TOKEN!;
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}`;

    if (!this.accountId || !this.databaseId || !this.token) {
      throw new Error('Missing required Cloudflare D1 environment variables');
    }
  }

  private async makeRequest(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`D1 API Error: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async query(sql: string, params: any[] = []): Promise<any> {
    return this.makeRequest('/query', 'POST', {
      sql,
      params,
    });
  }

  async execute(sql: string, params: any[] = []): Promise<any> {
    return this.makeRequest('/execute', 'POST', {
      sql,
      params,
    });
  }

  async batch(statements: Array<{ sql: string; params?: any[] }>): Promise<any> {
    return this.makeRequest('/execute', 'POST', statements);
  }

  // Check if database is accessible
  async checkConnection(): Promise<boolean> {
    try {
      await this.query('SELECT 1 as test');
      return true;
    } catch (error) {
      console.error('D1 connection check failed:', error);
      return false;
    }
  }

  // Initialize database schema
  async initializeSchema(): Promise<void> {
    console.log('Initializing D1 database schema...');
    
    // Read the migration file
    const fs = require('fs');
    const path = require('path');
    
    try {
      const migrationDir = path.join(process.cwd(), 'migrations-d1');
      const files = fs.readdirSync(migrationDir);
      const migrationFile = files.find((file: string) => file.endsWith('.sql'));
      
      if (!migrationFile) {
        throw new Error('No migration file found in migrations-d1 directory');
      }
      
      const migrationPath = path.join(migrationDir, migrationFile);
      const migrationSql = fs.readFileSync(migrationPath, 'utf8');
      
      // Split into individual statements and execute
      const statements = migrationSql
        .split(';')
        .map((stmt: string) => stmt.trim())
        .filter((stmt: string) => stmt.length > 0);
      
      for (const statement of statements) {
        if (statement.toLowerCase().includes('create table') || 
            statement.toLowerCase().includes('create index') ||
            statement.toLowerCase().includes('create unique')) {
          await this.execute(statement);
          console.log('Executed:', statement.substring(0, 50) + '...');
        }
      }
      
      console.log('D1 database schema initialized successfully');
    } catch (error) {
      console.error('Failed to initialize D1 schema:', error);
      throw error;
    }
  }
}

export const d1Client = new D1HttpClient();