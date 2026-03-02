import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import crypto from 'crypto';
import { db } from './db';
import { oauthStates } from '@shared/schema';
import { eq, lt } from 'drizzle-orm';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const STATE_EXPIRATION_MINUTES = 10;

// Lazy-load and validate encryption key
let ENCRYPTION_KEY: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (ENCRYPTION_KEY) {
    return ENCRYPTION_KEY;
  }
  
  // Use existing CREDENTIAL_ENCRYPTION_KEY from production secrets
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
  
  if (!key) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY environment variable must be set (32 bytes, hex-encoded). Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  
  const keyBuffer = Buffer.from(key, 'hex');
  
  if (keyBuffer.length !== 32) {
    throw new Error(`CREDENTIAL_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters). Got ${keyBuffer.length} bytes.`);
  }
  
  ENCRYPTION_KEY = keyBuffer;
  return keyBuffer;
}

/**
 * Encrypt sensitive data (like refresh tokens)
 */
function encrypt(text: string): string {
  const key = getEncryptionKey(); // Validates key on first use
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt sensitive data
 */
function decrypt(encryptedText: string): string {
  const key = getEncryptionKey(); // Validates key on first use
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv, { authTagLength: 16 });
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// Clean up expired OAuth state tokens from database every 10 minutes
setInterval(async () => {
  try {
    const now = new Date();
    const result = await db.delete(oauthStates)
      .where(lt(oauthStates.expiresAt, now));
    const deletedCount = result.rowCount || 0;
    if (deletedCount > 0) {
      console.log(`[Gmail OAuth] Cleaned up ${deletedCount} expired state token(s)`);
    }
  } catch (error) {
    console.error('[Gmail OAuth] Error cleaning up expired states:', error);
  }
}, 10 * 60 * 1000);

export class GmailService {
  private clientId: string;
  private clientSecret: string;
  private allowedDomains: Set<string>;

  constructor() {
    this.clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
    this.clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
    
    // Build allowlist from REPLIT_DOMAINS environment variable
    const domains = process.env.REPLIT_DOMAINS 
      ? process.env.REPLIT_DOMAINS.split(',').map(d => d.trim())
      : ['localhost:5000'];
    this.allowedDomains = new Set(domains);
    
    console.log('[Gmail OAuth] Allowed redirect domains:', Array.from(this.allowedDomains));
  }

  /**
   * Validate that a host is in the allowlist
   */
  validateHost(host: string): boolean {
    return this.allowedDomains.has(host);
  }

  /**
   * Get OAuth2 client instance with dynamic redirect URI
   */
  private getOAuth2Client(redirectHost: string) {
    const protocol = redirectHost.startsWith('localhost') ? 'http' : 'https';
    const redirectUri = `${protocol}://${redirectHost}/api/oauth/gmail/callback`;
    
    return new google.auth.OAuth2(
      this.clientId,
      this.clientSecret,
      redirectUri
    );
  }

  /**
   * Create Gmail client for a specific user using their stored refresh token
   */
  private async createGmailClient(refreshToken: string, redirectHost: string = 'localhost:5000') {
    try {
      const oauth2Client = this.getOAuth2Client(redirectHost);
      
      // Decrypt the refresh token
      console.log('[Gmail] Decrypting refresh token...');
      const decryptedToken = decrypt(refreshToken);
      console.log('[Gmail] Refresh token decrypted successfully');
      
      oauth2Client.setCredentials({
        refresh_token: decryptedToken,
      });

      console.log('[Gmail] OAuth2 credentials set, creating Gmail client...');
      return google.gmail({ version: 'v1', auth: oauth2Client });
    } catch (error: any) {
      console.error('[Gmail] Error creating Gmail client:', {
        message: error.message,
        code: error.code,
        stack: error.stack?.split('\n').slice(0, 3).join('\n')
      });
      throw error;
    }
  }

  /**
   * Generate authorization URL for user to connect their Gmail
   */
  async generateAuthUrl(userId: string, redirectHost: string): Promise<string> {
    if (!this.validateHost(redirectHost)) {
      throw new Error(`Invalid redirect host: ${redirectHost}. Must be one of: ${Array.from(this.allowedDomains).join(', ')}`);
    }

    const oauth2Client = this.getOAuth2Client(redirectHost);
    
    // Generate secure random state token for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    
    // Calculate expiration time (10 minutes from now)
    const expiresAt = new Date(Date.now() + STATE_EXPIRATION_MINUTES * 60 * 1000);
    
    // Store state token in database for persistence across restarts
    await db.insert(oauthStates).values({
      state,
      userId,
      redirectHost,
      expiresAt,
    });
    
    console.log(`[Gmail OAuth] Created state token for user ${userId}, expires at ${expiresAt.toISOString()}`);
    
    const scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
    ];

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent', // Force consent to get refresh token
      state: state, // Secure random state for CSRF protection
    });
  }

  /**
   * Get user data from state token
   * Returns userId and redirectHost for the OAuth callback
   * Uses atomic DELETE ... RETURNING to prevent race conditions (single-use guarantee)
   */
  async getStateData(state: string): Promise<{ userId: string; redirectHost: string } | null> {
    try {
      // Atomic delete-and-return: ensures single-use semantics for CSRF protection
      // If another request tries to use the same state token, it will get no results
      const deletedRecords = await db.delete(oauthStates)
        .where(eq(oauthStates.state, state))
        .returning();
      
      if (deletedRecords.length === 0) {
        console.error('[Gmail OAuth] No matching state token found in database (may have already been used)');
        return null;
      }
      
      const stateRecord = deletedRecords[0];
      
      // Check if state is expired
      const now = new Date();
      if (stateRecord.expiresAt < now) {
        console.error('[Gmail OAuth] State expired for user:', stateRecord.userId);
        // State was already deleted, no need to clean up
        return null;
      }
      
      console.log(`[Gmail OAuth] Validated and consumed state token for user ${stateRecord.userId}`);
      
      return {
        userId: stateRecord.userId,
        redirectHost: stateRecord.redirectHost,
      };
    } catch (error) {
      console.error('[Gmail OAuth] Error looking up state token:', error);
      return null;
    }
  }

  /**
   * Get userId from state token (legacy method - kept for compatibility)
   */
  async getUserIdFromState(state: string): Promise<string | null> {
    const data = await this.getStateData(state);
    return data ? data.userId : null;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code: string, redirectHost: string): Promise<{
    refreshToken: string;
    email: string;
  }> {
    const oauth2Client = this.getOAuth2Client(redirectHost);
    
    const { tokens } = await oauth2Client.getToken(code);
    
    if (!tokens.refresh_token) {
      throw new Error('No refresh token received. User may have already authorized this app.');
    }

    // Get user's email address
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    
    return {
      refreshToken: encrypt(tokens.refresh_token),
      email: profile.data.emailAddress || '',
    };
  }

  async sendEmail(options: {
    to: string;
    subject: string;
    content: string;
    fromEmail?: string;
    fromName?: string; // Display name for the sender
    refreshToken: string; // User's encrypted refresh token
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const gmail = await this.createGmailClient(options.refreshToken);
      
      // Format the From header with display name if provided
      let fromHeader = '';
      if (options.fromEmail) {
        if (options.fromName) {
          // Quote the display name to properly handle special characters like "@"
          // Format as "Display Name" <email@domain.com>
          fromHeader = `From: "${options.fromName}" <${options.fromEmail}>`;
        } else {
          fromHeader = `From: ${options.fromEmail}`;
        }
      }
      
      // Create the email message with HTML support
      const headers = [
        `To: ${options.to}`,
        fromHeader,
        `Subject: ${options.subject}`,
        'Content-Type: text/html; charset=utf-8',
      ].filter(Boolean).join('\r\n');
      
      // Add blank line separator between headers and body
      const email = headers + '\r\n\r\n' + options.content;
      
      // Debug log to verify the From header
      console.log('[Gmail] Sending email with headers:', {
        to: options.to,
        from: fromHeader,
        subject: options.subject,
        fromName: options.fromName,
      });

      // Encode the email in base64
      const encodedEmail = Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      // Send the email
      const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedEmail,
        },
      });

      console.log('[Gmail] Email sent successfully:', response.data.id);

      return {
        success: true,
        messageId: response.data.id || undefined,
      };
    } catch (error) {
      console.error('[Gmail] Error sending email:', error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error sending email',
      };
    }
  }

  async checkConnection(refreshToken: string): Promise<{ connected: boolean; email?: string; error?: string }> {
    try {
      const gmail = await this.createGmailClient(refreshToken);
      const profile = await gmail.users.getProfile({ userId: 'me' });
      return {
        connected: true,
        email: profile.data.emailAddress || undefined,
      };
    } catch (error) {
      console.error('[Gmail] Connection check failed:', error);
      return { 
        connected: false, 
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret);
  }

  /**
   * Validate encryption key is configured (for pre-flight checks)
   */
  validateEncryptionKey(): void {
    getEncryptionKey(); // Will throw if not configured
  }

  private parseEmailHeaders(headers: gmail_v1.Schema$MessagePartHeader[] | undefined): {
    from: string;
    to: string[];
    subject: string;
    date: string;
  } {
    const result = {
      from: '',
      to: [] as string[],
      subject: '',
      date: '',
    };

    if (!headers) return result;

    for (const header of headers) {
      const name = header.name?.toLowerCase();
      const value = header.value || '';

      switch (name) {
        case 'from':
          result.from = value;
          break;
        case 'to':
          result.to = value.split(',').map(email => email.trim());
          break;
        case 'subject':
          result.subject = value;
          break;
        case 'date':
          result.date = value;
          break;
      }
    }

    return result;
  }

  private extractEmailAddress(emailString: string): string {
    const match = emailString.match(/<(.+?)>/);
    return match ? match[1] : emailString.trim();
  }

  private decodeBase64(data: string): string {
    const replaced = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(replaced, 'base64').toString('utf-8');
  }

  private getEmailBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
    if (!payload) return '';

    if (payload.body?.data) {
      return this.decodeBase64(payload.body.data);
    }

    if (payload.parts) {
      // Prefer plain text — check text/plain first to avoid storing raw HTML
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return this.decodeBase64(part.body.data);
        }
      }

      // Fall back to HTML only if no plain text part exists
      for (const part of payload.parts) {
        if (part.mimeType === 'text/html' && part.body?.data) {
          return this.decodeBase64(part.body.data);
        }
      }

      for (const part of payload.parts) {
        const body = this.getEmailBody(part);
        if (body) return body;
      }
    }

    return '';
  }

  async fetchNewEmails(refreshToken: string, sinceDate?: Date): Promise<{
    emails: Array<{
      id: string;
      threadId: string;
      from: string;
      to: string[];
      subject: string;
      body: string;
      date: Date;
      snippet: string;
    }>;
    tokenExpired?: boolean;
    error?: string;
  }> {
    try {
      console.log('[Gmail] Starting email fetch...', { 
        hasSinceDate: !!sinceDate,
        sinceDate: sinceDate?.toISOString()
      });

      const gmail = await this.createGmailClient(refreshToken);
      console.log('[Gmail] Gmail client created successfully');
      
      // Fetch both inbox and sent emails to capture all communication
      let query = 'in:inbox OR in:sent';
      if (sinceDate) {
        const dateStr = sinceDate.toISOString().split('T')[0].replace(/-/g, '/');
        query += ` after:${dateStr}`;
      }

      console.log('[Gmail] Listing messages with query:', query);
      const listResponse = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100, // Increased since we're fetching both inbox and sent
      });

      const messages = listResponse.data.messages || [];
      console.log(`[Gmail] Found ${messages.length} message(s) to fetch`);
      
      const emailMessages = [];

      for (const message of messages) {
        if (!message.id) continue;

        try {
          const fullMessage = await gmail.users.messages.get({
            userId: 'me',
            id: message.id,
            format: 'full',
          });

          const headers = this.parseEmailHeaders(fullMessage.data.payload?.headers);
          const body = this.getEmailBody(fullMessage.data.payload);

          emailMessages.push({
            id: fullMessage.data.id || '',
            threadId: fullMessage.data.threadId || '',
            from: this.extractEmailAddress(headers.from),
            to: headers.to.map(email => this.extractEmailAddress(email)),
            subject: headers.subject,
            body: body,
            date: headers.date ? new Date(headers.date) : new Date(),
            snippet: fullMessage.data.snippet || '',
          });
        } catch (msgError: any) {
          console.error(`[Gmail] Error fetching individual message ${message.id}:`, {
            error: msgError.message,
            code: msgError.code,
            status: msgError.status,
            errors: msgError.errors
          });
          // Continue with other messages
        }
      }

      console.log(`[Gmail] Successfully fetched ${emailMessages.length} emails`);
      return { emails: emailMessages };
    } catch (error: any) {
      console.error('[Gmail] Error fetching emails:', {
        message: error.message,
        code: error.code,
        status: error.status,
        errors: error.errors,
        stack: error.stack?.split('\n').slice(0, 3).join('\n')
      });
      
      // Detect token expiration errors
      const isTokenExpired = 
        error.code === 401 || 
        error.code === 403 ||
        error.message?.includes('invalid_grant') ||
        error.message?.includes('Token has been expired') ||
        error.message?.includes('Token has been revoked') ||
        error.response?.data?.error === 'invalid_grant';
      
      if (isTokenExpired) {
        console.error('[Gmail] Token expired or revoked - user needs to reconnect Gmail');
        return { 
          emails: [], 
          tokenExpired: true, 
          error: 'Gmail access has expired. Please reconnect your Gmail account.' 
        };
      } else if (error.code === 429) {
        console.error('[Gmail] Rate limit exceeded - too many requests to Gmail API');
        return { emails: [], error: 'Rate limit exceeded' };
      } else if (error.code >= 500) {
        console.error('[Gmail] Gmail API server error - temporary issue with Google servers');
        return { emails: [], error: 'Gmail API server error' };
      }
      
      return { emails: [], error: error.message };
    }
  }
}

export const gmailService = new GmailService();