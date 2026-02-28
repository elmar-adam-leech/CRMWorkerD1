import { credentialService } from './credential-service';
import { storage } from './storage';
import { DialpadService } from './dialpad-service';
import type { 
  DialpadPhoneNumber, 
  InsertDialpadPhoneNumber,
  UserPhoneNumberPermission,
  InsertUserPhoneNumberPermission
} from '@shared/schema';

// Dialpad API response types based on user's working code
interface DialpadUser {
  id: string;
  display_name: string;
  emails?: string[];
  state: string;
}

interface DialpadNumber {
  id: string;
  number: string;
  target_type: string;
  target_id?: string;
  department_id?: string;
  can_send_sms?: boolean;
  can_receive_sms?: boolean;
  can_make_calls?: boolean;
  can_receive_calls?: boolean;
}

interface DialpadDepartment {
  id: string;
  name: string;
  office_id: string;
}

interface DialpadApiResponse<T> {
  items: T[];
  total_count?: number;
  next_cursor?: string;
}

export class DialpadEnhancedService {
  private dialpadService: DialpadService;
  private storage: typeof storage;

  constructor() {
    this.dialpadService = new DialpadService();
    this.storage = storage;
  }

  /**
   * Get Dialpad credentials for a contractor
   */
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

  /**
   * Fetch all active users from Dialpad (based on user's working code)
   */
  async fetchDialpadUsers(contractorId: string): Promise<DialpadUser[]> {
    const { apiKey, baseUrl } = await this.getCredentials(contractorId);
    
    const response = await fetch(`${baseUrl}/users?state=active&limit=100`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Dialpad users: ${response.status}`);
    }

    const data: DialpadApiResponse<DialpadUser> = await response.json();
    return data.items || [];
  }

  /**
   * Fetch all phone numbers from Dialpad (based on user's working code)
   */
  async fetchDialpadNumbers(contractorId: string): Promise<DialpadNumber[]> {
    const { apiKey, baseUrl } = await this.getCredentials(contractorId);
    
    const response = await fetch(`${baseUrl}/numbers?limit=1000`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Dialpad numbers: ${response.status}`);
    }

    const data: DialpadApiResponse<DialpadNumber> = await response.json();
    return data.items || [];
  }

  /**
   * Fetch departments for an office (based on Dialpad API docs)
   */
  async fetchDialpadDepartments(contractorId: string, officeId: string): Promise<DialpadDepartment[]> {
    const { apiKey, baseUrl } = await this.getCredentials(contractorId);
    
    const response = await fetch(`${baseUrl}/offices/${officeId}/departments`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Dialpad departments: ${response.status}`);
    }

    const data: DialpadApiResponse<DialpadDepartment> = await response.json();
    return data.items || [];
  }

  /**
   * Get detailed phone number info including SMS capabilities
   */
  async getPhoneNumberDetails(contractorId: string, phoneNumber: string): Promise<DialpadNumber | null> {
    const { apiKey, baseUrl } = await this.getCredentials(contractorId);
    
    const response = await fetch(`${baseUrl}/phone-numbers/${phoneNumber}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to fetch phone number details: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Sync phone numbers from Dialpad to local database
   */
  async syncPhoneNumbers(contractorId: string): Promise<{ 
    fetched: number;
    synced: number; 
    phoneNumbers: DialpadPhoneNumber[];
    errors: string[];
  }> {
    const errors: string[] = [];
    let synced = 0;

    try {
      // Fetch phone numbers from Dialpad
      const dialpadNumbers = await this.fetchDialpadNumbers(contractorId);
      const phoneNumbers: DialpadPhoneNumber[] = [];
      const totalFetched = dialpadNumbers.length;

      for (const dialpadNumber of dialpadNumbers) {
        try {
          // Get detailed info for each number to check SMS capabilities
          const details = await this.getPhoneNumberDetails(contractorId, dialpadNumber.number);
          
          // Extract user ID from target_id when target_type is "user" (matches Apps Script logic)
          let userId: string | null = null;
          if (dialpadNumber.target_type === 'user' && dialpadNumber.target_id) {
            userId = String(dialpadNumber.target_id);
            console.log(`[sync] Number ${dialpadNumber.number} mapped to user ID: ${userId} (target_type=${dialpadNumber.target_type})`);
          } else {
            console.log(`[sync] Number ${dialpadNumber.number} has no user assignment (target_type=${dialpadNumber.target_type || 'none'}, target_id=${dialpadNumber.target_id || 'none'})`);
          }
          
          const phoneNumberData: InsertDialpadPhoneNumber = {
            contractorId,
            phoneNumber: dialpadNumber.number,
            dialpadId: userId, // Use target_id (user ID), not the phone number's own ID
            displayName: dialpadNumber.number, // Default to the number itself
            department: undefined, // Will be set manually by admin
            canSendSms: details?.can_send_sms ?? false,
            canReceiveSms: details?.can_receive_sms ?? false,
            canMakeCalls: details?.can_make_calls ?? true, // Most numbers can make calls
            canReceiveCalls: details?.can_receive_calls ?? true,
            isActive: true,
            lastSyncAt: new Date(),
          };

          // Insert or update phone number
          const existing = await storage.getDialpadPhoneNumberByNumber(contractorId, dialpadNumber.number);
          let phoneNumber: DialpadPhoneNumber;
          
          if (existing) {
            phoneNumber = await storage.updateDialpadPhoneNumber(existing.id, {
              ...phoneNumberData,
              lastSyncAt: new Date(),
            });
          } else {
            phoneNumber = await storage.createDialpadPhoneNumber(phoneNumberData);
          }
          
          phoneNumbers.push(phoneNumber);
          synced++;
        } catch (err) {
          errors.push(`Failed to sync number ${dialpadNumber.number}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }

      return { fetched: totalFetched, synced, phoneNumbers, errors };
    } catch (err) {
      throw new Error(`Failed to sync phone numbers: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  /**
   * Sync users from Dialpad to local database
   */
  async syncUsers(contractorId: string): Promise<{ 
    fetched: number;
    synced: number; 
    users: any[];
    errors: string[];
  }> {
    const errors: string[] = [];
    let synced = 0;

    try {
      // Fetch users from Dialpad
      const dialpadUsers = await this.fetchDialpadUsers(contractorId);
      const users: any[] = [];
      const totalFetched = dialpadUsers.length;

      for (const dialpadUser of dialpadUsers) {
        try {
          const userData = {
            contractorId,
            dialpadUserId: dialpadUser.id,
            email: dialpadUser.emails?.[0] || '',
            firstName: dialpadUser.display_name.split(' ')[0] || '',
            lastName: dialpadUser.display_name.split(' ').slice(1).join(' ') || '',
            displayName: dialpadUser.display_name,
            department: (dialpadUser as any).department || null,
            role: (dialpadUser as any).role || null,
            extension: (dialpadUser as any).extension || null,
            isActive: dialpadUser.state === 'active',
            lastSyncAt: new Date(),
          };

          // Insert or update user
          const existing = await storage.getDialpadUserByDialpadId(dialpadUser.id, contractorId);
          let user: any;
          
          if (existing) {
            user = await storage.updateDialpadUser(existing.id, {
              ...userData,
              lastSyncAt: new Date(),
            });
          } else {
            user = await storage.createDialpadUser(userData);
          }
          
          users.push(user);
          synced++;
        } catch (err) {
          errors.push(`Failed to sync user ${dialpadUser.display_name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }

      return { fetched: totalFetched, synced, users, errors };
    } catch (err) {
      throw new Error(`Failed to sync users: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  /**
   * Sync departments from Dialpad to local database
   */
  async syncDepartments(contractorId: string): Promise<{ 
    fetched: number;
    synced: number; 
    departments: any[];
    errors: string[];
  }> {
    const errors: string[] = [];
    let synced = 0;

    try {
      // Fetch departments from Dialpad
      const dialpadDepartments = await this.dialpadService.getDepartments(contractorId);
      const departments: any[] = [];
      const totalFetched = dialpadDepartments.length;

      for (const dialpadDepartment of dialpadDepartments) {
        try {
          const departmentData = {
            contractorId,
            dialpadDepartmentId: dialpadDepartment.id.toString(),
            name: dialpadDepartment.name,
            description: '', // Dialpad doesn't provide description in basic dept info
            isActive: true,
            lastSyncAt: new Date(),
          };

          // Check if department already exists
          const existing = await storage.getDialpadDepartmentByDialpadId(dialpadDepartment.id.toString(), contractorId);
          let department;
          
          if (existing) {
            department = await storage.updateDialpadDepartment(existing.id, {
              ...departmentData,
              lastSyncAt: new Date(),
            });
          } else {
            department = await storage.createDialpadDepartment(departmentData);
          }
          
          departments.push(department);
          synced++;
        } catch (err) {
          errors.push(`Failed to sync department ${dialpadDepartment.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }

      return { fetched: totalFetched, synced, departments, errors };
    } catch (err) {
      throw new Error(`Failed to sync departments: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if a user has permission to use a specific phone number
   * Admins and managers have implicit access to all phone numbers
   */
  async checkUserPhonePermission(
    userId: string, 
    phoneNumberId: string, 
    action: 'sms' | 'call'
  ): Promise<{ hasPermission: boolean; reason?: string }> {
    try {
      // Get user to check their role
      const user = await storage.getUser(userId);
      
      if (!user) {
        return { 
          hasPermission: false, 
          reason: 'User not found' 
        };
      }

      // Admins and managers have implicit access to all phone numbers
      if (user.role === 'admin' || user.role === 'manager') {
        return { hasPermission: true };
      }

      // For regular users, check explicit permissions
      const permission = await storage.getUserPhoneNumberPermission(userId, phoneNumberId);
      
      if (!permission || !permission.isActive) {
        return { 
          hasPermission: false, 
          reason: 'No permission assigned for this phone number' 
        };
      }

      if (action === 'sms' && !permission.canSendSms) {
        return { 
          hasPermission: false, 
          reason: 'SMS permission not granted for this phone number' 
        };
      }

      if (action === 'call' && !permission.canMakeCalls) {
        return { 
          hasPermission: false, 
          reason: 'Call permission not granted for this phone number' 
        };
      }

      return { hasPermission: true };
    } catch (err) {
      return { 
        hasPermission: false, 
        reason: 'Error checking permissions' 
      };
    }
  }

  /**
   * Get available phone numbers for a user based on their permissions
   */
  async getUserAvailablePhoneNumbers(
    userId: string, 
    contractorId: string, 
    action: 'sms' | 'call'
  ): Promise<DialpadPhoneNumber[]> {
    try {
      console.log(`getUserAvailablePhoneNumbers called with userId: ${userId}, contractorId: ${contractorId}, action: ${action}`);
      
      // Get the user to check their role
      const user = await storage.getUser(userId);
      console.log(`User lookup result:`, user);
      
      // Get all phone numbers from the database for this contractor
      const allPhoneNumbers = await storage.getDialpadPhoneNumbers(contractorId);
      console.log(`Found ${allPhoneNumbers.length} total phone numbers for contractor`);
      
      // If user is admin or manager, return all phone numbers
      if (user && (user.role === 'admin' || user.role === 'manager')) {
        console.log(`Admin/Manager ${user.username} has access to all ${allPhoneNumbers.length} phone numbers`);
        return allPhoneNumbers;
      }
      
      // For regular users, filter based on permissions
      const availableNumbers: DialpadPhoneNumber[] = [];
      
      for (const phoneNumber of allPhoneNumbers) {
        const permission = await storage.getUserPhoneNumberPermission(userId, phoneNumber.id);
        
        if (permission && permission.isActive) {
          const hasPermission = action === 'sms' 
            ? permission.canSendSms 
            : permission.canMakeCalls;
            
          if (hasPermission) {
            availableNumbers.push(phoneNumber);
          }
        }
      }
      
      console.log(`Found ${availableNumbers.length} ${action}-capable phone numbers for user ${userId}`);
      return availableNumbers;
    } catch (err) {
      console.error('Error getting user available phone numbers:', err);
      return [];
    }
  }

  /**
   * List recent SMS messages from Dialpad API
   */
  async listRecentSms(contractorId: string, limit: number = 10): Promise<any[]> {
    try {
      const { apiKey, baseUrl } = await this.getCredentials(contractorId);
      
      const response = await fetch(`${baseUrl}/sms?limit=${limit}&sort=-created_date`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        console.error(`Failed to list SMS: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return data.items || [];
    } catch (error) {
      console.error('Error listing SMS messages:', error);
      return [];
    }
  }

  /**
   * Get SMS message content by ID from Dialpad API
   */
  async getSmsById(contractorId: string, smsId: string): Promise<{ text?: string; error?: string }> {
    try {
      const { apiKey, baseUrl } = await this.getCredentials(contractorId);
      
      const response = await fetch(`${baseUrl}/sms/${smsId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        console.error(`Failed to fetch SMS ${smsId}: ${response.status}`);
        return { error: `Failed to fetch SMS: ${response.status}` };
      }

      const data = await response.json();
      return { text: data.text };
    } catch (error) {
      console.error(`Error fetching SMS ${smsId}:`, error);
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Send SMS using Dialpad API (based on user's working code)
   */
  async sendSms(options: {
    to: string;
    message: string;
    fromNumber: string;
    contractorId: string;
    userId?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // Check permissions if userId provided
      if (options.userId) {
        const phoneNumber = await storage.getDialpadPhoneNumberByNumber(options.contractorId, options.fromNumber);
        if (phoneNumber) {
          const permissionCheck = await this.checkUserPhonePermission(
            options.userId, 
            phoneNumber.id, 
            'sms'
          );
          
          if (!permissionCheck.hasPermission) {
            return {
              success: false,
              error: permissionCheck.reason || 'Permission denied'
            };
          }
        }
      }

      const { apiKey, baseUrl } = await this.getCredentials(options.contractorId);
      
      // Use exact payload structure from user's working code
      const payload = {
        to_numbers: [options.to],
        from_number: options.fromNumber,
        text: options.message
      };

      const response = await fetch(`${baseUrl}/sms/`, {
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

  /**
   * Initiate call using Dialpad API (based on user's working code)
   */
  async initiateCall(options: {
    to: string;
    fromNumber: string;
    contractorId: string;
    userId?: string;
    dialpadUserId?: string;
  }): Promise<{ success: boolean; callId?: string; error?: string }> {
    try {
      // Check permissions if userId provided
      if (options.userId) {
        const phoneNumber = await storage.getDialpadPhoneNumberByNumber(options.contractorId, options.fromNumber);
        if (phoneNumber) {
          const permissionCheck = await this.checkUserPhonePermission(
            options.userId, 
            phoneNumber.id, 
            'call'
          );
          
          if (!permissionCheck.hasPermission) {
            return {
              success: false,
              error: permissionCheck.reason || 'Permission denied'
            };
          }
        }
      }

      const { apiKey, baseUrl } = await this.getCredentials(options.contractorId);
      
      // Use exact payload structure from user's working code
      const payload = {
        phone_number: options.to,
        from_number: options.fromNumber,
        action: 'dial',
        ...(options.dialpadUserId && { user_id: options.dialpadUserId })
      };

      const response = await fetch(`${baseUrl}/call/`, {
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
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Create a webhook in Dialpad with tenant-specific URL
   */
  async createWebhook(contractorId: string, hookUrl?: string, secret?: string): Promise<{
    success: boolean;
    webhookId?: string;
    hookUrl?: string;
    error?: string;
  }> {
    try {
      const { apiKey, baseUrl } = await this.getCredentials(contractorId);
      
      // Webhook URL must be provided
      if (!hookUrl) {
        return {
          success: false,
          error: 'Webhook URL is required',
        };
      }
      
      const payload: { hook_url: string; secret?: string } = { hook_url: hookUrl };
      if (secret) {
        payload.secret = secret;
      }

      const response = await fetch(`${baseUrl}/webhooks`, {
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
          error: `Failed to create webhook: ${response.status} ${errorText}`,
        };
      }

      const result = await response.json();
      return {
        success: true,
        webhookId: result.id?.toString(),
        hookUrl: result.hook_url,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Create webhook and SMS subscription in one call
   */
  async createWebhookWithSubscription(
    contractorId: string,
    direction: 'inbound' | 'outbound' | 'all' = 'inbound',
    baseWebhookUrl?: string
  ): Promise<{
    success: boolean;
    webhookId?: string;
    subscriptionId?: string;
    hookUrl?: string;
    error?: string;
  }> {
    console.log('[createWebhookWithSubscription] Starting webhook creation', { contractorId, direction, baseWebhookUrl });
    
    // Step 1: Create webhook with tenant-specific URL
    const hookUrl = baseWebhookUrl 
      ? `${baseWebhookUrl}/api/webhooks/dialpad/sms/${contractorId}`
      : undefined;
    
    console.log('[createWebhookWithSubscription] Built webhook URL:', hookUrl);
    
    const webhookResult = await this.createWebhook(contractorId, hookUrl);
    console.log('[createWebhookWithSubscription] Webhook creation result:', webhookResult);
    
    if (!webhookResult.success || !webhookResult.webhookId) {
      return {
        success: false,
        error: webhookResult.error || 'Failed to create webhook',
      };
    }

    // Step 2: Create SMS subscription
    const subscriptionResult = await this.createSmsSubscription(
      contractorId,
      webhookResult.webhookId,
      direction
    );

    if (!subscriptionResult.success) {
      return {
        success: false,
        webhookId: webhookResult.webhookId,
        error: subscriptionResult.error || 'Failed to create SMS subscription',
      };
    }

    return {
      success: true,
      webhookId: webhookResult.webhookId,
      subscriptionId: subscriptionResult.subscriptionId,
      hookUrl: webhookResult.hookUrl,
    };
  }

  /**
   * Create an SMS event subscription for a webhook
   */
  async createSmsSubscription(
    contractorId: string, 
    webhookId: string,
    direction: 'inbound' | 'outbound' | 'all' = 'inbound'
  ): Promise<{
    success: boolean;
    subscriptionId?: string;
    error?: string;
  }> {
    try {
      const { apiKey, baseUrl } = await this.getCredentials(contractorId);
      
      const payload = {
        endpoint_id: parseInt(webhookId),
        direction,
        enabled: true,
        status: false, // Don't need delivery status updates
        include_internal: false, // Don't include internal SMS between users
      };

      const response = await fetch(`${baseUrl}/subscriptions/sms`, {
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
          error: `Failed to create SMS subscription: ${response.status} ${errorText}`,
        };
      }

      const result = await response.json();
      return {
        success: true,
        subscriptionId: result.id?.toString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Delete a webhook from Dialpad
   */
  async deleteWebhook(contractorId: string, webhookId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const { apiKey, baseUrl } = await this.getCredentials(contractorId);

      const response = await fetch(`${baseUrl}/webhooks/${webhookId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok && response.status !== 404) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to delete webhook: ${response.status} ${errorText}`,
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Delete an SMS subscription from Dialpad
   */
  async deleteSmsSubscription(contractorId: string, subscriptionId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const { apiKey, baseUrl } = await this.getCredentials(contractorId);

      const response = await fetch(`${baseUrl}/subscriptions/sms/${subscriptionId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok && response.status !== 404) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to delete SMS subscription: ${response.status} ${errorText}`,
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * List all webhooks for the contractor
   */
  async listWebhooks(contractorId: string): Promise<{
    success: boolean;
    webhooks?: Array<{ id: string; hook_url: string; }>;
    error?: string;
  }> {
    try {
      const { apiKey, baseUrl } = await this.getCredentials(contractorId);

      const response = await fetch(`${baseUrl}/webhooks`, {
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
          error: `Failed to list webhooks: ${response.status} ${errorText}`,
        };
      }

      const data: DialpadApiResponse<{ id: number; hook_url: string }> = await response.json();
      return {
        success: true,
        webhooks: (data.items || []).map(w => ({
          id: w.id.toString(),
          hook_url: w.hook_url,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}

export const dialpadEnhancedService = new DialpadEnhancedService();