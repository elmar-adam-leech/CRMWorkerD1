import type { SmsProvider, CallProvider, SmsResult, CallResult } from './interfaces';
import { credentialService } from '../credential-service';
import { storage } from '../storage';

/**
 * Wraps `fetch` with exponential-backoff retry for transient Dialpad API errors.
 *
 * Retry policy:
 *   - Retries on HTTP 429 (rate limited) and any 5xx (server error).
 *   - Does NOT retry on 4xx client errors (bad request, auth failure, etc.).
 *   - Up to `maxAttempts` total attempts (default 3).
 *   - Delay between attempts: baseDelayMs * 2^(attempt - 1)
 *     Attempt 1 → 0 ms (immediate), attempt 2 → 500 ms, attempt 3 → 1000 ms.
 *
 * @param url         - URL to fetch.
 * @param init        - Standard fetch RequestInit options.
 * @param maxAttempts - Total attempts before giving up (default 3).
 * @param baseDelayMs - Base delay for the exponential backoff (default 500 ms).
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxAttempts = 3,
  baseDelayMs = 500
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(url, init);

    const isRateLimit = response.status === 429;
    const isServerError = response.status >= 500 && response.status < 600;

    if (!isRateLimit && !isServerError) {
      return response;
    }

    lastError = new Error(`Dialpad API returned ${response.status} on attempt ${attempt}`);

    if (attempt < maxAttempts) {
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError!;
}

/**
 * Format a phone number to E.164 format
 * Assumes US numbers if no country code is present
 */
function formatToE164(phoneNumber: string): string {
  // Remove all non-digit characters
  const cleaned = phoneNumber.replace(/\D/g, '');
  
  // If already has country code (11 digits starting with 1), add +
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }
  
  // If 10 digits (US number without country code), add +1
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }
  
  // If already formatted with +, return as-is
  if (phoneNumber.startsWith('+')) {
    return phoneNumber;
  }
  
  // Otherwise, assume US and add +1
  return `+1${cleaned}`;
}

/**
 * Dialpad provider for SMS functionality
 */
export class DialpadSmsProvider implements SmsProvider {
  readonly providerName = 'dialpad';
  readonly providerType = 'sms' as const;

  private async getCredentials(contractorId: string): Promise<{ apiKey: string; baseUrl: string }> {
    const credentials = await credentialService.getCredentialsWithFallback(contractorId, 'dialpad');

    if (!credentials.api_key) {
      throw new Error(`Dialpad API key not configured for contractor ${contractorId}`);
    }

    return {
      apiKey: credentials.api_key,
      baseUrl: credentials.base_url || 'https://dialpad.com/api/v2'
    };
  }

  async sendSms(options: {
    to: string;
    message: string;
    fromNumber?: string;
    contractorId: string;
    userId?: string;
  }): Promise<SmsResult> {
    try {
      // Check user permissions if userId and fromNumber are provided
      if (options.userId && options.fromNumber) {
        const phoneNumber = await storage.getDialpadPhoneNumberByNumber(options.contractorId, options.fromNumber);
        if (phoneNumber) {
          const userPermissions = await storage.getUserPhoneNumberPermission(options.userId, phoneNumber.id);
          const hasPermission = userPermissions?.canSendSms ?? false;
          
          if (!hasPermission) {
            return {
              success: false,
              error: `User does not have permission to send SMS from ${options.fromNumber}`,
            };
          }
        } else {
          return {
            success: false,
            error: `Phone number ${options.fromNumber} not found in your organization`,
          };
        }
      }
      
      const { apiKey, baseUrl } = await this.getCredentials(options.contractorId);
      
      const payload = {
        to_numbers: [formatToE164(options.to)],
        text: options.message,
        ...(options.fromNumber && { from_number: formatToE164(options.fromNumber) })
      };

      const response = await fetchWithRetry(`${baseUrl}/sms/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to send SMS: ${response.status} ${errorText}`,
        };
      }

      const result = await response.json();
      return {
        success: true,
        messageId: result.message_id || result.id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async checkConnection(contractorId: string): Promise<{ connected: boolean; error?: string }> {
    try {
      const { apiKey, baseUrl } = await this.getCredentials(contractorId);
      
      const response = await fetch(`${baseUrl}/me`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return {
          connected: false,
          error: `Dialpad connection failed: ${response.status}`,
        };
      }

      return { connected: true };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async isConfigured(contractorId: string): Promise<boolean> {
    try {
      const credentials = await credentialService.getCredentialsWithFallback(contractorId, 'dialpad');
      return !!credentials.api_key;
    } catch {
      return false;
    }
  }
}

/**
 * Dialpad provider for calling functionality
 */
export class DialpadCallProvider implements CallProvider {
  readonly providerName = 'dialpad';
  readonly providerType = 'calling' as const;

  private async getCredentials(contractorId: string): Promise<{ apiKey: string; baseUrl: string }> {
    const credentials = await credentialService.getCredentialsWithFallback(contractorId, 'dialpad');

    if (!credentials.api_key) {
      throw new Error(`Dialpad API key not configured for contractor ${contractorId}`);
    }

    return {
      apiKey: credentials.api_key,
      baseUrl: credentials.base_url || 'https://dialpad.com/api/v2'
    };
  }

  async initiateCall(options: {
    to: string;
    fromNumber?: string;
    autoRecord?: boolean;
    contractorId: string;
    userId?: string;
  }): Promise<CallResult> {
    try {
      console.log('[DialpadCallProvider] initiateCall called with options:', {
        to: options.to,
        fromNumber: options.fromNumber,
        contractorId: options.contractorId,
        userId: options.userId,
        hasUserId: !!options.userId
      });
      
      // Check user permissions if userId and fromNumber are provided
      if (options.userId && options.fromNumber) {
        const phoneNumber = await storage.getDialpadPhoneNumberByNumber(options.contractorId, options.fromNumber);
        if (phoneNumber) {
          const userPermissions = await storage.getUserPhoneNumberPermission(options.userId, phoneNumber.id);
          const hasPermission = userPermissions?.canMakeCalls ?? false;
          
          if (!hasPermission) {
            return {
              success: false,
              error: `User does not have permission to make calls from ${options.fromNumber}`,
            };
          }
        } else {
          return {
            success: false,
            error: `Phone number ${options.fromNumber} not found in your organization`,
          };
        }
      }
      
      const { apiKey, baseUrl } = await this.getCredentials(options.contractorId);
      
      // Get user_id from the phone number being called FROM
      // This matches the phone number to its associated Dialpad user
      let dialpadUserId: string | undefined;
      
      if (options.fromNumber) {
        console.log('[DialpadCallProvider] Looking up phone number:', options.fromNumber, 'for contractor:', options.contractorId);
        // Look up the phone number in the database to get its dialpad_id
        const phoneNumber = await storage.getDialpadPhoneNumberByNumber(options.contractorId, options.fromNumber);
        console.log('[DialpadCallProvider] Found phone number record:', phoneNumber ? { id: phoneNumber.id, phoneNumber: phoneNumber.phoneNumber, dialpadId: phoneNumber.dialpadId } : 'NOT FOUND');
        if (phoneNumber?.dialpadId) {
          dialpadUserId = phoneNumber.dialpadId;
          console.log('[DialpadCallProvider] Using phone number\'s assigned user ID:', dialpadUserId);
        }
      }
      
      // If phone number has no assigned user (office/department number), use logged-in user's Dialpad ID
      if (!dialpadUserId && options.userId) {
        try {
          // Get the current user's information
          const user = await storage.getUser(options.userId);
          if (user?.email) {
            // Look up this user's Dialpad ID from the synced Dialpad users
            const dialpadUsers = await storage.getDialpadUsers(options.contractorId);
            const dialpadUser = dialpadUsers.find(du => du.email?.toLowerCase() === user.email.toLowerCase());
            if (dialpadUser?.dialpadUserId) {
              dialpadUserId = dialpadUser.dialpadUserId;
              console.log('[DialpadCallProvider] Phone number has no assigned user - using logged-in user\'s Dialpad ID:', dialpadUserId, 'for email:', user.email);
            } else {
              console.log('[DialpadCallProvider] Could not find Dialpad user for email:', user.email);
            }
          }
        } catch (err) {
          // Non-fatal: fall through to the global credential fallback below.
          // Log user + contractor context so this is diagnosable without a debugger.
          console.warn(
            `[DialpadCallProvider] Failed to look up Dialpad user ID — ` +
            `contractorId=${options.contractorId}, userId=${options.userId}, ` +
            `error=${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
      
      // If still no user_id, fall back to global user_id credential
      if (!dialpadUserId) {
        try {
          const userIdCred = await credentialService.getCredential(options.contractorId, 'dialpad', 'user_id');
          dialpadUserId = userIdCred || undefined;
          if (dialpadUserId) {
            console.log('[DialpadCallProvider] Using global default user ID from credentials');
          }
        } catch (credErr) {
          // Credential lookup can fail if the key doesn't exist (expected) or due
          // to a DB error (unexpected). Log at error level so the latter is visible.
          console.error('[DialpadCallProvider] Failed to fetch global user_id credential:', credErr);
        }
      }

      // user_id is REQUIRED by Dialpad
      if (!dialpadUserId) {
        return {
          success: false,
          error: 'Dialpad user_id is required. Either select a phone number with an assigned user, or configure a default user ID in Settings > Integrations > Dialpad.',
        };
      }

      // Log the from_number and user_id being used for debugging
      console.log('[DialpadCallProvider] Making call with user_id:', dialpadUserId, 'from_number:', options.fromNumber);

      // Use the working Google Apps Script format
      const payload = {
        phone_number: formatToE164(options.to),
        from_number: options.fromNumber ? formatToE164(options.fromNumber) : undefined,
        user_id: dialpadUserId,
        action: 'dial'
      };

      // Use singular /call/ endpoint like in Google Apps Script (note trailing slash)
      const response = await fetchWithRetry(`${baseUrl}/call/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to initiate call: ${response.status} ${errorText}`,
        };
      }

      const result = await response.json();
      return {
        success: true,
        callId: result.call_id || result.id,
        callUrl: result.call_url,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async getCallDetails(callId: string, contractorId: string): Promise<{ success: boolean; callDetails?: any; error?: string }> {
    try {
      const { apiKey, baseUrl } = await this.getCredentials(contractorId);
      
      const response = await fetch(`${baseUrl}/calls/${callId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to get call details: ${response.status} ${errorText}`,
        };
      }

      const result = await response.json();
      return {
        success: true,
        callDetails: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async checkConnection(contractorId: string): Promise<{ connected: boolean; error?: string }> {
    try {
      const { apiKey, baseUrl } = await this.getCredentials(contractorId);
      
      const response = await fetch(`${baseUrl}/me`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return {
          connected: false,
          error: `Dialpad connection failed: ${response.status}`,
        };
      }

      return { connected: true };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async isConfigured(contractorId: string): Promise<boolean> {
    try {
      const credentials = await credentialService.getCredentialsWithFallback(contractorId, 'dialpad');
      return !!credentials.api_key;
    } catch {
      return false;
    }
  }

  async getUserCallerIdNumbers(dialpadUserId: string, contractorId: string): Promise<string[]> {
    try {
      const { apiKey, baseUrl } = await this.getCredentials(contractorId);
      
      const response = await fetch(`${baseUrl}/users/${dialpadUserId}/caller_id_numbers`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        // Using console.error here intentionally: returning [] on failure means callers
        // cannot distinguish "user has no numbers" from "API is down". Logging at error
        // level ensures the difference is visible in server logs.
        console.error(`[DialpadCallProvider] Failed to get caller ID numbers for user ${dialpadUserId}: ${response.status}`);
        return [];
      }

      const result = await response.json();
      const numbers = result.caller_id_numbers || [];
      console.log(`[DialpadCallProvider] User ${dialpadUserId} has ${numbers.length} authorized caller ID numbers:`, numbers);
      return numbers;
    } catch (error) {
      console.error('[DialpadCallProvider] Error getting caller ID numbers:', error);
      return [];
    }
  }

  async ensureUserHasAccessToNumber(dialpadUserId: string, phoneNumber: string, contractorId: string): Promise<{ hasAccess: boolean; error?: string }> {
    try {
      const authorizedNumbers = await this.getUserCallerIdNumbers(dialpadUserId, contractorId);
      const formattedNumber = formatToE164(phoneNumber);
      
      const hasAccess = authorizedNumbers.some(num => formatToE164(num) === formattedNumber);
      
      if (hasAccess) {
        console.log(`[DialpadCallProvider] User ${dialpadUserId} has access to ${formattedNumber}`);
        return { hasAccess: true };
      }

      console.log(`[DialpadCallProvider] User ${dialpadUserId} does NOT have access to ${formattedNumber}`);
      console.log(`[DialpadCallProvider] Authorized numbers:`, authorizedNumbers);
      
      return { 
        hasAccess: false,
        error: `You don't have permission to call from ${phoneNumber} in Dialpad. Please ask your admin to grant you access to this number in Dialpad settings.`
      };
    } catch (error) {
      console.log('[DialpadCallProvider] Error checking user access:', error);
      return {
        hasAccess: false,
        error: 'Could not verify phone number access. Please try again.'
      };
    }
  }
}