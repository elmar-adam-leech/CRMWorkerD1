interface DialpadMessage {
  to_numbers: string[];
  text: string;
  from_number?: string;
}

interface DialpadCallRequest {
  to_number: string;
  from_number?: string;
  auto_record?: boolean;
}

interface DialpadResponse {
  success: boolean;
  message?: string;
  error?: string;
  callId?: string;
  messageId?: string;
}

interface DialpadCallResponse extends DialpadResponse {
  callId?: string;
  callUrl?: string;
}

interface DialpadUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  display_name?: string;
  state?: string;
  department?: string | number;
  phone_numbers?: DialpadPhoneNumber[];
  departments?: number[];
}

interface DialpadDepartment {
  id: number;
  name: string;
  phone_numbers?: DialpadPhoneNumber[];
}

interface DialpadPhoneNumber {
  id: number;
  number: string;
  display_name?: string;
  type?: string;
  sms_enabled?: boolean;
  state?: string;
  department?: string | number;
  assigned_to?: string | number;
}

interface DialpadApiResponse<T> {
  data?: T;
  items?: T[];
  success?: boolean;
  error?: string;
}

import { credentialService } from './credential-service';
import { normalizePhoneNumber } from './utils/phone-normalizer';
import { withRetry } from './utils/retry';

/**
 * Wraps a fetch call and throws on retryable HTTP errors (429, 5xx) so that
 * `withRetry` can transparently retry transient Dialpad API failures.
 * 4xx errors (except 429) are not retried — they indicate a caller mistake.
 */
async function dialpadFetch(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (response.status === 429 || response.status >= 500) {
    const body = await response.text();
    throw new Error(`Dialpad API error ${response.status}: ${body}`);
  }
  return response;
}

export class DialpadService {
  /**
   * Get Dialpad credentials for a specific tenant or use fallback credentials
   */
  private async getCredentials(tenantId?: string): Promise<{ apiKey: string; baseUrl: string }> {
    let credentials;
    
    if (tenantId) {
      // Try to get tenant-specific credentials first
      credentials = await credentialService.getCredentialsWithFallback(tenantId, 'dialpad');
    } else {
      // Fallback to environment variables for system-level operations
      credentials = {
        api_key: process.env.DIALPAD_API_KEY || '',
        base_url: process.env.DIALPAD_API_BASE_URL || 'https://dialpad.com/api/v2'
      };
    }

    if (!credentials.api_key) {
      throw new Error(`Dialpad API key not configured for ${tenantId ? `tenant ${tenantId}` : 'system'}`);
    }

    return {
      apiKey: credentials.api_key,
      baseUrl: credentials.base_url || 'https://dialpad.com/api/v2'
    };
  }

  async sendText(toNumber: string, message: string, fromNumber?: string, tenantId?: string): Promise<DialpadResponse> {
    try {
      const { apiKey, baseUrl } = await this.getCredentials(tenantId);
      
      // Normalize to E.164 using the shared phone normalizer utility
      const formattedToNumber = normalizePhoneNumber(toNumber);
      const formattedFromNumber = fromNumber ? normalizePhoneNumber(fromNumber) : undefined;
      
      const payload: DialpadMessage = {
        to_numbers: [formattedToNumber],
        text: message,
      };

      if (formattedFromNumber) {
        payload.from_number = formattedFromNumber;
      }

      // Debug logging to match your working script
      console.log('Dialpad SMS Payload:', JSON.stringify(payload, null, 2));
      console.log('Dialpad SMS URL:', `${baseUrl}/sms/`);
      console.log('Formatted numbers:', { 
        original_to: toNumber, 
        formatted_to: formattedToNumber,
        original_from: fromNumber,
        formatted_from: formattedFromNumber 
      });

      const response = await fetch(`${baseUrl}/sms/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      console.log('Dialpad API Response Status:', response.status, response.statusText);
      console.log('Dialpad API Response Headers:', JSON.stringify(Array.from(response.headers.entries()), null, 2));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Dialpad API Error:', response.status, errorText);
        return {
          success: false,
          error: `Failed to send message: ${response.status} ${errorText}`,
        };
      }

      // Try to get the response text first
      const responseText = await response.text();
      console.log('Dialpad API Response Body (raw):', responseText);
      
      // Parse JSON if possible
      let result: any = {};
      if (responseText) {
        try {
          result = JSON.parse(responseText);
          console.log('Dialpad SMS Response (parsed):', JSON.stringify(result, null, 2));
        } catch (e) {
          console.error('Failed to parse Dialpad response as JSON:', e);
        }
      }
      
      return {
        success: true,
        message: 'Text message sent successfully',
        messageId: result.id || result.message_id || result.sms_id || null,
      };
    } catch (error) {
      console.error('Error sending text:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Get phone numbers from Dialpad API v2 (works with API keys)
   */
  async getCompanyNumbers(tenantId: string): Promise<DialpadPhoneNumber[]> {
    try {
      const { apiKey, baseUrl } = await this.getCredentials(tenantId);

      const response = await withRetry(
        () => dialpadFetch(`${baseUrl}/v2/numbers?limit=1000`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        }),
        'Dialpad getCompanyNumbers'
      );

      if (response.ok) {
        const result = await response.json();
        console.log('Dialpad v2/numbers API Success:', result);
        
        // Handle v2 API response format
        const numbers = result.items || result.data || result;
        if (Array.isArray(numbers)) {
          // Debug logging to understand API response structure
          if (numbers.length > 0) {
            console.log('Sample phone number from API:', JSON.stringify(numbers[0], null, 2));
          }
          
          return numbers.map(num => {
            // Debug individual number processing
            console.log(`Processing number ${num.number}: sms_enabled=${num.sms_enabled}, sms_capable=${num.sms_capable}, can_send_sms=${num.can_send_sms}`);
            
            // More robust SMS capability detection
            const smsEnabled = !!(num.sms_enabled === true || num.sms_capable === true || num.can_send_sms === true);
            
            // Extract user ID from target_id when target_type is "user" (matches Apps Script logic)
            let userId = null;
            if (num.target_type === 'user' && num.target_id) {
              userId = num.target_id;
              console.log(`Number ${num.number} mapped to user ID: ${userId} (via target_type=user, target_id=${num.target_id})`);
            } else if (num.assigned_to || num.owner || num.user_id) {
              // Fallback to other fields
              userId = num.assigned_to || num.owner || num.user_id;
              console.log(`Number ${num.number} mapped to user ID: ${userId} (via fallback fields)`);
            }
            
            return {
              id: num.id,
              number: num.number,
              display_name: num.display_name || num.name || num.number,
              type: num.type || 'company',
              sms_enabled: smsEnabled,
              state: num.state || 'active',
              department: num.department || num.dept_name || null,
              assigned_to: userId  // Now properly using target_id when target_type is "user"
            };
          });
        }
      } else {
        console.error(`Dialpad v2/numbers API Error:`, response.status, await response.text());
      }
      
      return [];
    } catch (error) {
      console.error('Error fetching Dialpad v2 numbers:', error);
      return [];
    }
  }

  /**
   * Get users from Dialpad API v2 (works with API keys)
   */
  async getCompanyUsers(tenantId: string): Promise<DialpadUser[]> {
    try {
      const { apiKey, baseUrl } = await this.getCredentials(tenantId);

      const response = await withRetry(
        () => dialpadFetch(`${baseUrl}/v2/users?state=active&limit=100`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        }),
        'Dialpad getCompanyUsers'
      );

      if (response.ok) {
        const result = await response.json();
        console.log('Dialpad v2/users API Success:', result);
        
        // Handle v2 API response format
        const users = result.items || result.data || result;
        if (Array.isArray(users)) {
          // Debug logging to understand API response structure
          if (users.length > 0) {
            console.log('Sample user from API:', JSON.stringify(users[0], null, 2));
          }
          
          return users.map(user => {
            // Debug individual user processing
            console.log(`Processing user ${user.email}: department=${user.department}, dept_name=${user.dept_name}, phone_numbers length=${user.phone_numbers?.length || 0}`);
            
            return {
              id: user.id,
              email: user.email,
              first_name: user.first_name,
              last_name: user.last_name,
              display_name: user.display_name || `${user.first_name} ${user.last_name}`.trim(),
              state: user.state || 'active',
              department: user.department || user.dept_name || null, // Try multiple department field names
              phone_numbers: user.phone_numbers || []
            };
          });
        }
      } else {
        console.error(`Dialpad v2/users API Error:`, response.status, await response.text());
      }
      
      return [];
    } catch (error) {
      console.error('Error fetching Dialpad v2 users:', error);
      return [];
    }
  }

  /**
   * Get departments from Dialpad API
   */
  async getDepartments(tenantId: string): Promise<DialpadDepartment[]> {
    try {
      const { apiKey, baseUrl } = await this.getCredentials(tenantId);

      const response = await withRetry(
        () => dialpadFetch(`${baseUrl}/departments`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        }),
        'Dialpad getDepartments'
      );

      if (!response.ok) {
        console.error('Dialpad Get Departments API Error:', response.status, await response.text());
        return [];
      }

      const result: DialpadApiResponse<DialpadDepartment> = await response.json();
      return result.items || [];
    } catch (error) {
      console.error('Error fetching Dialpad departments:', error);
      return [];
    }
  }

  /**
   * Get available phone numbers for texting and calling - uses cached data for performance
   */
  async getAvailablePhoneNumbers(tenantId: string, action: 'sms' | 'call' = 'sms'): Promise<DialpadPhoneNumber[]> {
    try {
      // First try to get cached phone numbers from database
      const cachedNumbers = await this.getCachedPhoneNumbers(tenantId);
      
      if (cachedNumbers.length > 0) {
        // Filter cached numbers based on action type
        const filteredNumbers = cachedNumbers.filter(num => {
          if (!num.phoneNumber || !num.isActive) {
            return false;
          }
          
          if (action === 'sms') {
            // For SMS, include numbers that explicitly have SMS capability OR if SMS capability is unknown (null)
            // This handles the case where API doesn't return SMS capability info
            return num.canSendSms === true || num.canSendSms === null;
          }
          
          // For calling, check if calling is enabled OR if calling capability is unknown
          return num.canMakeCalls === true || num.canMakeCalls === null;
        });

        console.log(`Found ${filteredNumbers.length} cached ${action}-capable phone numbers for tenant ${tenantId}`);
        return filteredNumbers.map(num => ({
          id: parseInt(num.dialpadId || '0') || 0, // Convert to number for API compatibility
          number: num.phoneNumber,
          display_name: num.displayName || num.phoneNumber,
          type: 'user', // Default type
          sms_enabled: num.canSendSms,
          state: num.isActive ? 'active' : 'inactive'
        }));
      }

      // Fallback to live API if no cached data available
      console.log(`No cached phone numbers found for tenant ${tenantId}, falling back to live API`);
      const numbers = await this.getCompanyNumbers(tenantId);
      
      // Filter numbers based on action type
      const filteredNumbers = numbers.filter(num => {
        if (!num.number || num.state !== 'active') {
          return false;
        }
        
        if (action === 'sms') {
          // For SMS, include numbers that explicitly have SMS capability OR if we're unsure
          // This handles the case where API doesn't clearly indicate SMS capability
          return num.sms_enabled === true || num.sms_enabled === undefined;
        }
        
        // For calling, just check if number is active
        return true;
      });

      console.log(`Found ${filteredNumbers.length} ${action}-capable phone numbers for tenant ${tenantId}`);
      return filteredNumbers;
    } catch (error) {
      console.error('Error getting available phone numbers:', error);
      return [];
    }
  }

  /**
   * Get cached phone numbers from database
   */
  private async getCachedPhoneNumbers(tenantId: string) {
    const { storage } = await import('./storage');
    return await storage.getDialpadPhoneNumbers(tenantId);
  }

  /**
   * Sync Dialpad data to database cache for improved performance
   */
  async syncDialpadDataToCache(tenantId: string): Promise<{ success: boolean; message: string; }> {
    const { storage } = await import('./storage');
    
    try {
      // Create sync job to track this operation
      const syncJob = await storage.createDialpadSyncJob({
        contractorId: tenantId,
        syncType: 'full',
        status: 'in_progress',
        startedAt: new Date(),
        recordsProcessed: 0,
        recordsSuccess: 0,
        recordsError: 0
      });

      let totalProcessed = 0;
      let totalSuccess = 0;
      let totalErrors = 0;

      // Sync users from Dialpad v2 API
      try {
        const users = await this.getCompanyUsers(tenantId);
        
        for (const user of users) {
          try {
            // Check if user already exists in cache
            const existingUser = await storage.getDialpadUserByDialpadId(user.id.toString(), tenantId);
            
            if (existingUser) {
              // Update existing user
              await storage.updateDialpadUser(existingUser.id, {
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                fullName: `${user.first_name} ${user.last_name}`.trim(),
                department: typeof user.department === 'string' ? user.department : user.department?.toString() || null,
                phoneNumbers: user.phone_numbers ? user.phone_numbers.map(p => p.number || p.toString()) : [],
                lastSyncAt: new Date(),
                isActive: true // API already filters to active users
              });
            } else {
              // Create new user
              await storage.createDialpadUser({
                contractorId: tenantId,
                dialpadUserId: user.id.toString(),
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                fullName: `${user.first_name} ${user.last_name}`.trim(),
                department: typeof user.department === 'string' ? user.department : user.department?.toString() || null,
                phoneNumbers: user.phone_numbers ? user.phone_numbers.map(p => p.number || p.toString()) : [],
                isActive: true, // API already filters to active users
                lastSyncAt: new Date()
              });
            }
            
            totalSuccess++;
          } catch (error) {
            console.error(`Error syncing user ${user.email}:`, error);
            totalErrors++;
          }
          
          totalProcessed++;
        }

        console.log(`Synced ${users.length} users for tenant ${tenantId}`);
        
      } catch (error) {
        console.error('Error fetching users from Dialpad v2 API:', error);
        totalErrors++;
      }

      // Sync phone numbers from Dialpad v2 API
      try {
        const phoneNumbers = await this.getCompanyNumbers(tenantId);
        
        for (const number of phoneNumbers) {
          try {
            // Check if phone number already exists in cache
            const existingNumber = await storage.getDialpadPhoneNumberByNumber(tenantId, number.number);
            
            if (existingNumber) {
              // Update existing phone number
              await storage.updateDialpadPhoneNumber(existingNumber.id, {
                displayName: number.display_name || number.number,
                department: typeof number.department === 'string' ? number.department : number.department?.toString() || null, // Store department assignment
                canSendSms: number.sms_enabled || false,
                canMakeCalls: true, // Assume calling is available if number exists
                lastSyncAt: new Date(),
                isActive: number.state === 'active'
              });
            } else {
              // Create new phone number
              await storage.createDialpadPhoneNumber({
                contractorId: tenantId,
                phoneNumber: number.number,
                dialpadId: number.id?.toString(),
                displayName: number.display_name || number.number,
                department: typeof number.department === 'string' ? number.department : number.department?.toString() || null, // Store department assignment
                canSendSms: number.sms_enabled || false,
                canMakeCalls: true,
                isActive: number.state === 'active',
                lastSyncAt: new Date()
              });
            }
            
            totalSuccess++;
          } catch (error) {
            console.error(`Error syncing phone number ${number.number}:`, error);
            totalErrors++;
          }
          
          totalProcessed++;
        }

        console.log(`Synced ${phoneNumbers.length} phone numbers for tenant ${tenantId}`);
        
      } catch (error) {
        console.error('Error fetching phone numbers from Dialpad v2 API:', error);
        totalErrors++;
      }

      // Create user-phone number associations based on Dialpad user data
      try {
        const users = await this.getCompanyUsers(tenantId);
        const associationErrors: string[] = [];
        let associationsCreated = 0;

        for (const user of users) {
          try {
            // Skip users without phone numbers
            if (!user.phone_numbers || user.phone_numbers.length === 0) {
              continue;
            }

            // Find the cached user in our database by email (using username field)
            const cachedUser = await storage.getUserByUsername(user.email);
            if (!cachedUser || cachedUser.contractorId !== tenantId) {
              console.log(`Skipping phone number associations for ${user.email} - user not found in tenant ${tenantId}`);
              continue;
            }

            // Process each phone number assigned to this user
            for (const phoneNumber of user.phone_numbers) {
              const phoneNumberString = typeof phoneNumber === 'string' ? phoneNumber : phoneNumber.number || phoneNumber.toString();
              
              // Find the cached phone number in our database
              const cachedPhoneNumber = await storage.getDialpadPhoneNumberByNumber(tenantId, phoneNumberString);
              if (!cachedPhoneNumber) {
                console.log(`Skipping association - phone number ${phoneNumberString} not found in cache`);
                continue;
              }

              // Check if permission already exists
              const existingPermission = await storage.getUserPhoneNumberPermission(cachedUser.id, cachedPhoneNumber.id);
              if (existingPermission) {
                // Update existing permission
                await storage.updateUserPhoneNumberPermission(existingPermission.id, {
                  canSendSms: cachedPhoneNumber.canSendSms,
                  canMakeCalls: cachedPhoneNumber.canMakeCalls,
                  isActive: true,
                });
              } else {
                // Create new permission
                await storage.createUserPhoneNumberPermission({
                  userId: cachedUser.id,
                  phoneNumberId: cachedPhoneNumber.id,
                  contractorId: tenantId,
                  canSendSms: cachedPhoneNumber.canSendSms,
                  canMakeCalls: cachedPhoneNumber.canMakeCalls,
                  isActive: true,
                });
              }
              
              associationsCreated++;
            }
          } catch (error) {
            const errorMsg = `Failed to create phone number associations for user ${user.email}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            associationErrors.push(errorMsg);
            console.error(errorMsg);
            totalErrors++;
          }
        }

        console.log(`Created ${associationsCreated} user-phone number associations`);
        if (associationErrors.length > 0) {
          console.log(`Encountered ${associationErrors.length} errors during association creation:`, associationErrors);
        }
        
      } catch (error) {
        console.error('Error creating user-phone number associations:', error);
        totalErrors++;
      }

      // Update sync job with final status
      await storage.updateDialpadSyncJob(syncJob.id, {
        status: totalErrors > 0 ? 'failed' : 'completed',
        completedAt: new Date(),
        recordsProcessed: totalProcessed,
        recordsSuccess: totalSuccess,
        recordsError: totalErrors,
        lastSuccessfulSyncAt: totalErrors === 0 ? new Date() : undefined,
        errorMessage: totalErrors > 0 ? `${totalErrors} errors occurred during sync` : undefined
      });

      return {
        success: totalErrors === 0,
        message: `Sync completed: ${totalSuccess} successful, ${totalErrors} errors`
      };

    } catch (error) {
      console.error('Error during Dialpad sync:', error);
      return {
        success: false,
        message: `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async initiateCall(toNumber: string, fromNumber?: string, autoRecord: boolean = false, tenantId?: string): Promise<DialpadCallResponse> {
    try {
      const { apiKey, baseUrl } = await this.getCredentials(tenantId);
      
      const payload: DialpadCallRequest = {
        to_number: toNumber,
        auto_record: autoRecord,
      };

      if (fromNumber) {
        payload.from_number = fromNumber;
      }

      const response = await fetch(`${baseUrl}/calls`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Dialpad Call API Error:', response.status, errorText);
        return {
          success: false,
          error: `Failed to initiate call: ${response.status} ${errorText}`,
        };
      }

      const result = await response.json();
      return {
        success: true,
        message: 'Call initiated successfully',
        callId: result.call_id || result.id,
        callUrl: result.call_url,
      };
    } catch (error) {
      console.error('Error initiating call:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async getCallDetails(callId: string, tenantId?: string): Promise<DialpadResponse & { callDetails?: any }> {
    try {
      const { apiKey, baseUrl } = await this.getCredentials(tenantId);
      
      const response = await fetch(`${baseUrl}/calls/${callId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Dialpad Get Call Error:', response.status, errorText);
        return {
          success: false,
          error: `Failed to get call details: ${response.status} ${errorText}`,
        };
      }

      const result = await response.json();
      return {
        success: true,
        message: 'Call details retrieved successfully',
        callDetails: result,
      };
    } catch (error) {
      console.error('Error getting call details:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async checkConnection(tenantId?: string): Promise<{ connected: boolean; error?: string }> {
    try {
      const { apiKey, baseUrl } = await this.getCredentials(tenantId);
      
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
          error: `Dialpad API connection failed: ${response.status}`,
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

  async isConfigured(tenantId?: string): Promise<boolean> {
    try {
      const credentials = tenantId 
        ? await credentialService.getCredentialsWithFallback(tenantId, 'dialpad')
        : { api_key: process.env.DIALPAD_API_KEY };
      return !!credentials.api_key;
    } catch {
      return false;
    }
  }
}

export const dialpadService = new DialpadService();