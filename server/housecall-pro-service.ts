import { credentialService } from './credential-service';

export interface HousecallProCustomer {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  mobile_number?: string;
  home_number?: string;
  work_number?: string;
  company?: string;
  phone_numbers?: Array<{
    phone_number: string;
    type?: string;
  }>;
  address?: {
    street?: string;
    street_line_2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
}

export interface HousecallProEmployee {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  is_active: boolean;
}

export interface HousecallProEstimate {
  id: string;
  number?: string; // Estimate number like "121937604"
  estimate_number?: string; // Alternative field name
  name?: string; // Estimate name field
  customer_id?: string;
  customer?: HousecallProCustomer; // Embedded customer data
  employee_id?: string;
  work_status?: string;
  status?: string;
  total_amount?: number;
  total?: number;
  total_price?: number;
  estimate_total?: number;
  amount?: number;
  description?: string;
  created_at?: string;
  modified_at?: string;
  expires_at?: string; // Estimate expiration date
  expiry_date?: string; // Alternative expiration field name
  valid_until?: string; // Another common expiration field name
  scheduled_start?: string; // ISO datetime
  scheduled_end?: string; // ISO datetime
  service_location?: {
    street?: string;
    street_line_2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  address?: {
    street?: string;
    street_line_2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  source?: {
    name?: string;
  };
  options?: Array<{
    id: string;
    total_amount?: number;
  }>;
  work_timestamps?: {
    on_my_way_at?: string;
    started_at?: string;
    completed_at?: string;
  };
  line_items?: Array<{
    name: string;
    description?: string;
    quantity: number;
    unit_cost: number;
    total_amount?: number;
  }>;
}

export interface HousecallProJob {
  id: string;
  invoice_number?: string;
  description?: string;
  customer_id?: string;
  customer?: HousecallProCustomer;
  work_status?: string;
  total_amount?: number;
  outstanding_balance?: number;
  subtotal?: number;
  schedule?: {
    scheduled_start?: string;
    scheduled_end?: string;
    arrival_window?: number;
    appointments?: unknown[];
  };
  scheduled_start?: string;
  address?: {
    id?: string;
    type?: string;
    street?: string;
    street_line_2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  notes?: Array<{ id: string; content: string }>;
  work_timestamps?: {
    on_my_way_at?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
  };
  assigned_employees?: Array<{
    id: string;
    first_name: string;
    last_name: string;
    email?: string;
    mobile_number?: string;
    role?: string;
  }>;
  tags?: string[];
  original_estimate_id?: string | null;
  original_estimate_uuids?: string[];
  lead_source?: string | null;
  job_fields?: {
    job_type?: string | null;
    business_unit?: string | null;
  };
  locked_at?: string | null;
  created_at?: string;
  updated_at?: string;
  company_name?: string;
  company_id?: string;
  recurrence_number?: number | null;
  recurrence_rule?: string | null;
}

export interface HousecallProResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export class HousecallProService {
  private readonly baseUrl = 'https://api.housecallpro.com';

  /**
   * Get Housecall Pro credentials for a specific tenant
   */
  private async getCredentials(tenantId: string): Promise<{ apiKey: string }> {
    // Get credentials from the new unified system (housecall-pro with api_key)
    let credentials = await credentialService.getCredentialsWithFallback(tenantId, 'housecall-pro');
    
    if (credentials.api_key) {
      return {
        apiKey: credentials.api_key,
      };
    }
    
    // Fallback to old system (housecallpro with api_key)
    credentials = await credentialService.getCredentialsWithFallback(tenantId, 'housecallpro');
    
    if (credentials.api_key) {
      return {
        apiKey: credentials.api_key,
      };
    }

    throw new Error(`Housecall Pro API key not configured for tenant ${tenantId}`);
  }

  /**
   * Check if an HTTP status code is retryable (transient error)
   */
  private isRetryableStatus(status: number): boolean {
    // Retry on rate limiting (429) and server errors (5xx)
    return status === 429 || (status >= 500 && status < 600);
  }

  /**
   * Sleep for a specified number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async makeRequest<T>(
    endpoint: string,
    tenantId: string,
    method: string = 'GET',
    body?: any,
    maxRetries: number = 3
  ): Promise<HousecallProResponse<T>> {
    let apiKey: string;
    try {
      const credentials = await this.getCredentials(tenantId);
      apiKey = credentials.apiKey;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get Housecall Pro credentials',
      };
    }
    
    // Use different Accept headers based on endpoint - matching working scripts
    const isEstimatesEndpoint = endpoint.includes('/estimates');
    const acceptHeader = isEstimatesEndpoint ? 'application/json' : 'application/vnd.api+json';

    let lastError: string = 'Unknown error occurred';
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Exponential backoff: wait 1s, 2s, 4s between retries
        if (attempt > 0) {
          const backoffMs = Math.pow(2, attempt - 1) * 1000;
          console.log(`[HCP] Retry attempt ${attempt}/${maxRetries} after ${backoffMs}ms delay for ${method} ${endpoint}`);
          await this.sleep(backoffMs);
        }
        
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          method,
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Accept': acceptHeader,
          },
          body: body ? JSON.stringify(body) : undefined,
        });

        // Check if response is ok first
        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}`;
          try {
            // Try to get error details from response, but handle non-JSON responses
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
              const errorData = await response.json();
              console.log(`[HCP] API Error ${response.status} for ${method} ${endpoint}:`, JSON.stringify(errorData));
              errorMessage = errorData.message || errorData.error || JSON.stringify(errorData);
            } else {
              // If it's not JSON, get the text content
              const errorText = await response.text();
              console.log(`[HCP] API Error ${response.status} for ${method} ${endpoint}:`, errorText);
              errorMessage = errorText.substring(0, 200) || errorMessage; // Limit error message length
            }
          } catch (parseError) {
            // If we can't parse the error, just use the status
            errorMessage = `HTTP ${response.status} ${response.statusText}`;
          }
          
          if (body) {
            console.log(`[HCP] Request body was:`, JSON.stringify(body));
          }
          
          lastError = `Housecall Pro API Error: ${errorMessage}`;
          
          // Only retry on transient errors (rate limit or server errors)
          if (this.isRetryableStatus(response.status) && attempt < maxRetries) {
            console.log(`[HCP] Retryable error (${response.status}), will retry...`);
            continue;
          }
          
          return {
            success: false,
            error: lastError,
          };
        }

        // Only try to parse JSON if response is ok
        const responseData = await response.json();

        return {
          success: true,
          data: responseData,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error occurred';
        console.log(`[HCP] Network error on attempt ${attempt + 1}/${maxRetries + 1}: ${lastError}`);
        
        // Retry on network errors
        if (attempt < maxRetries) {
          continue;
        }
      }
    }
    
    return {
      success: false,
      error: lastError,
    };
  }

  /**
   * Get all customers from Housecall Pro
   */
  async getCustomers(tenantId: string): Promise<HousecallProResponse<HousecallProCustomer[]>> {
    return this.makeRequest<HousecallProCustomer[]>('/customers', tenantId);
  }

  /**
   * Search customers by email or phone
   */
  async searchCustomers(tenantId: string, searchParams: { 
    email?: string; 
    phone?: string; 
  }): Promise<HousecallProResponse<HousecallProCustomer[]>> {
    return this.makeRequest<HousecallProCustomer[]>('/customers/search', tenantId, 'POST', searchParams);
  }

  /**
   * Get all employees (salespeople) - handles pagination to fetch all employees
   */
  async getEmployees(tenantId: string): Promise<HousecallProResponse<HousecallProEmployee[]>> {
    const allEmployees: HousecallProEmployee[] = [];
    let page = 1;
    const pageSize = 100; // Fetch 100 at a time for efficiency
    let totalPages = 1;
    
    console.log('[HCP] Fetching all employees with pagination...');
    
    while (page <= totalPages) {
      const response = await this.makeRequest<any>(`/employees?page=${page}&page_size=${pageSize}`, tenantId);
      
      if (!response.success || !response.data) {
        // If first page fails, return the error
        if (page === 1) {
          return response;
        }
        // If subsequent pages fail, return what we have
        break;
      }
      
      // Extract pagination metadata from response
      const responseData = response.data;
      if (responseData.total_pages) {
        totalPages = responseData.total_pages;
      }
      if (responseData.total_items) {
        console.log(`[HCP] Total employees in HCP: ${responseData.total_items}`);
      }
      
      // Handle various response formats from HCP API
      const employees = Array.isArray(responseData) ? responseData :
                       Array.isArray(responseData.employees) ? responseData.employees :
                       Array.isArray(responseData.data) ? responseData.data :
                       [];
      
      console.log(`[HCP] Page ${page}/${totalPages}: fetched ${employees.length} employees`);
      allEmployees.push(...employees);
      
      page++;
      
      // Safety limit to prevent infinite loops
      if (page > 50) {
        console.warn('[HCP] Reached page limit (50 pages), stopping pagination');
        break;
      }
    }
    
    console.log(`[HCP] Total employees fetched: ${allEmployees.length}`);
    return {
      success: true,
      data: allEmployees,
    };
  }

  /**
   * Get all estimates
   */
  async getEstimates(tenantId: string, params?: {
    modified_since?: string; // ISO datetime - filter by modification date
    scheduled_start_min?: string; // ISO datetime
    scheduled_start_max?: string; // ISO datetime
    customer_id?: string;
    work_status?: string;
    page_size?: number;
    page?: number;
    sort_by?: string;
    sort_direction?: string;
  }): Promise<HousecallProResponse<HousecallProEstimate[]>> {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }
    
    const endpoint = `/estimates${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await this.makeRequest<any>(endpoint, tenantId);
    
    // Handle response structure like the working Google Apps Script
    if (response.success && response.data) {
      // Try multiple response formats like the working script
      const estimates = Array.isArray(response.data.data) ? response.data.data :
                       Array.isArray(response.data?.estimates) ? response.data.estimates :
                       Array.isArray(response.data.estimates) ? response.data.estimates :
                       Array.isArray(response.data.results) ? response.data.results :
                       Array.isArray(response.data) ? response.data : [];
      return {
        success: true,
        data: estimates,
      };
    }
    
    return response;
  }

  /**
   * Create a new estimate in Housecall Pro
   */
  async createEstimate(tenantId: string, estimateData: {
    customer_id: string;
    employee_id?: string;
    message?: string; // Customer-facing message
    options: Array<{
      name: string;
      message?: string;
      total_amount?: string;
      schedule?: {
        scheduled_start?: string; // ISO datetime
        scheduled_end?: string; // ISO datetime
        arrival_window?: number; // minutes
        dispatched_employees?: Array<{ employee_id: string }>; // Required to show on calendar
      };
      line_items?: Array<{
        name: string;
        description?: string;
        quantity: number;
        unit_cost: number;
      }>;
    }>;
    address?: {
      street: string;
      street_line_2?: string;
      city: string;
      state: string;
      zip: string;
      country?: string;
    };
  }): Promise<HousecallProResponse<HousecallProEstimate>> {
    return this.makeRequest<HousecallProEstimate>('/estimates', tenantId, 'POST', estimateData);
  }

  /**
   * Update an existing estimate
   */
  async updateEstimate(
    tenantId: string, 
    estimateId: string, 
    estimateData: Partial<HousecallProEstimate>
  ): Promise<HousecallProResponse<HousecallProEstimate>> {
    return this.makeRequest<HousecallProEstimate>(`/estimates/${estimateId}`, tenantId, 'PUT', estimateData);
  }

  /**
   * Update estimate option schedule - required to show on HCP calendar
   * PUT /estimates/{estimate_id}/options/{option_id}/schedule
   */
  async updateEstimateOptionSchedule(
    tenantId: string,
    estimateId: string,
    optionId: string,
    scheduleData: {
      start_time: string; // ISO datetime
      end_time?: string; // ISO datetime  
      arrival_window_in_minutes?: number;
      notify?: boolean;
      notify_pro?: boolean;
      dispatched_employees?: Array<{ employee_id: string }>;
    }
  ): Promise<HousecallProResponse<any>> {
    return this.makeRequest<any>(
      `/estimates/${estimateId}/options/${optionId}/schedule`, 
      tenantId, 
      'PUT', 
      scheduleData
    );
  }

  /**
   * Get estimate by ID
   */
  async getEstimate(tenantId: string, estimateId: string): Promise<HousecallProResponse<HousecallProEstimate>> {
    return this.makeRequest<HousecallProEstimate>(`/estimates/${estimateId}`, tenantId);
  }

  /**
   * Create a customer in Housecall Pro
   * Required before creating a lead
   */
  async createCustomer(tenantId: string, customerData: {
    first_name?: string;
    last_name?: string;
    company?: string;
    email?: string;
    mobile_number?: string;
    home_number?: string;
    work_number?: string;
    lead_source?: string;
    notes?: string;
    notifications_enabled?: boolean;
    tags?: string[];
    addresses?: Array<{
      street?: string;
      street_line_2?: string;
      city?: string;
      state?: string;
      zip?: string;
      country?: string;
      type?: 'service' | 'billing' | 'mailing';
    }>;
  }): Promise<HousecallProResponse<{ id: string; first_name?: string; last_name?: string; email?: string }>> {
    return this.makeRequest('/customers', tenantId, 'POST', customerData);
  }

  /**
   * Get customer by ID
   */
  async getCustomer(tenantId: string, customerId: string): Promise<HousecallProResponse<any>> {
    return this.makeRequest(`/customers/${customerId}`, tenantId);
  }

  /**
   * Create a lead in Housecall Pro (requires customer_id)
   */
  async createLead(tenantId: string, leadData: {
    customer_id: string;
    job_type_id?: string;
    note?: string;
    address_id?: string;
    lead_source?: string;
  }): Promise<HousecallProResponse<{ id: string; customer_id: string; created_at?: string }>> {
    return this.makeRequest('/leads', tenantId, 'POST', leadData);
  }

  /**
   * Get lead by ID
   */
  async getLead(tenantId: string, leadId: string): Promise<HousecallProResponse<any>> {
    return this.makeRequest(`/leads/${leadId}`, tenantId);
  }

  /**
   * Get jobs from Housecall Pro
   */
  async getJobs(tenantId: string, params?: {
    modified_since?: string;
    sort_by?: string;
    sort_direction?: string;
    page_size?: number;
    include?: string;
  }): Promise<HousecallProResponse<HousecallProJob[]>> {
    const queryParams = new URLSearchParams();
    
    if (params?.modified_since) {
      queryParams.append('modified_since', params.modified_since);
    }
    if (params?.sort_by) {
      queryParams.append('sort_by', params.sort_by);
    }
    if (params?.sort_direction) {
      queryParams.append('sort_direction', params.sort_direction);
    }
    if (params?.page_size) {
      queryParams.append('page_size', params.page_size.toString());
    }
    if (params?.include) {
      queryParams.append('include', params.include);
    }

    const endpoint = `/jobs${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await this.makeRequest<any>(endpoint, tenantId);
    
    // Handle JSON:API format response structure
    if (response.success && response.data) {
      const jobs = Array.isArray(response.data.data) ? response.data.data : 
                  Array.isArray(response.data.jobs) ? response.data.jobs :
                  Array.isArray(response.data) ? response.data : [];
      return {
        success: true,
        data: jobs,
      };
    }
    
    return response;
  }

  /**
   * Check if Housecall Pro is configured for a tenant
   */
  async isConfigured(tenantId: string): Promise<boolean> {
    try {
      await this.getCredentials(tenantId);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Test connection to Housecall Pro API
   */
  async checkConnection(tenantId: string): Promise<{ connected: boolean; error?: string }> {
    try {
      const result = await this.getEmployees(tenantId);
      
      if (result.success) {
        return { connected: true };
      } else {
        return {
          connected: false,
          error: result.error || 'Unknown connection error',
        };
      }
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get available time slots for estimators on a specific date
   */
  async getEstimatorAvailability(
    tenantId: string, 
    date: string, // YYYY-MM-DD format
    estimatorIds?: string[]
  ): Promise<HousecallProResponse<{
    employee_id: string;
    employee_name: string;
    available_slots: Array<{
      start_time: string; // HH:MM format
      end_time: string;   // HH:MM format
      duration_minutes: number;
    }>;
  }[]>> {
    try {
      // Get all employees first
      const employeesResult = await this.getEmployees(tenantId);
      if (!employeesResult.success || !employeesResult.data) {
        return {
          success: false,
          error: employeesResult.error || 'Failed to fetch employees',
        };
      }

      // Filter for estimators only (or specific estimator IDs)
      const estimators = employeesResult.data.filter(emp => {
        const isEstimator = emp.role.toLowerCase().includes('estimator') || emp.role.toLowerCase().includes('sales');
        const isSpecific = !estimatorIds || estimatorIds.includes(emp.id);
        return emp.is_active && isEstimator && isSpecific;
      });

      const availability = [];

      for (const estimator of estimators) {
        // Get scheduled estimates for this estimator on the specified date
        const startOfDay = `${date}T00:00:00Z`;
        const endOfDay = `${date}T23:59:59Z`;
        
        const estimatesResult = await this.getEstimates(tenantId, {
          scheduled_start_min: startOfDay,
          scheduled_start_max: endOfDay,
          work_status: 'scheduled',
        });

        if (!estimatesResult.success) {
          continue; // Skip this estimator if we can't get their schedule
        }

        // Filter estimates for this specific estimator
        const estimatorSchedule = (estimatesResult.data || []).filter(est => 
          est.employee_id === estimator.id && est.scheduled_start && est.scheduled_end
        );

        // Calculate available time slots
        const businessHours = {
          start: '08:00', // 8 AM
          end: '17:00',   // 5 PM
        };

        const availableSlots = this.calculateAvailableSlots(
          businessHours,
          estimatorSchedule.map(est => ({
            start: est.scheduled_start!,
            end: est.scheduled_end!,
          }))
        );

        availability.push({
          employee_id: estimator.id,
          employee_name: `${estimator.first_name} ${estimator.last_name}`,
          available_slots: availableSlots,
        });
      }

      return {
        success: true,
        data: availability,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get availability',
      };
    }
  }

  /**
   * Calculate available time slots given business hours and existing appointments
   */
  private calculateAvailableSlots(
    businessHours: { start: string; end: string },
    appointments: Array<{ start: string; end: string }>
  ): Array<{ start_time: string; end_time: string; duration_minutes: number }> {
    const slots = [];
    
    // Convert business hours to minutes from midnight
    const businessStartMinutes = this.timeToMinutes(businessHours.start);
    const businessEndMinutes = this.timeToMinutes(businessHours.end);
    
    // Convert appointments to minutes and sort by start time
    const appointmentSlots = appointments
      .map(apt => ({
        start: this.isoToMinutes(apt.start),
        end: this.isoToMinutes(apt.end),
      }))
      .sort((a, b) => a.start - b.start);

    let currentTime = businessStartMinutes;
    
    for (const appointment of appointmentSlots) {
      // If there's a gap before this appointment, add it as available
      if (currentTime < appointment.start) {
        const duration = appointment.start - currentTime;
        if (duration >= 60) { // Only slots of 1 hour or more
          slots.push({
            start_time: this.minutesToTime(currentTime),
            end_time: this.minutesToTime(appointment.start),
            duration_minutes: duration,
          });
        }
      }
      currentTime = Math.max(currentTime, appointment.end);
    }
    
    // Add final slot if there's time left in the business day
    if (currentTime < businessEndMinutes) {
      const duration = businessEndMinutes - currentTime;
      if (duration >= 60) {
        slots.push({
          start_time: this.minutesToTime(currentTime),
          end_time: this.minutesToTime(businessEndMinutes),
          duration_minutes: duration,
        });
      }
    }
    
    return slots;
  }

  private timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private isoToMinutes(isoString: string): number {
    const date = new Date(isoString);
    return date.getHours() * 60 + date.getMinutes();
  }

  private minutesToTime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }

  /**
   * Get scheduled estimates for a specific employee within a date range
   * Used to determine busy windows for calendar/scheduling
   */
  async getEmployeeScheduledEstimates(
    tenantId: string, 
    employeeId: string, 
    startDate: Date, 
    endDate: Date
  ): Promise<HousecallProResponse<any[]>> {
    try {
      // Fetch all estimates for the date range, then filter by employee
      const params = new URLSearchParams();
      params.append('scheduled_start_min', startDate.toISOString());
      params.append('scheduled_start_max', endDate.toISOString());
      params.append('page_size', '100');
      params.append('sort_by', 'created_at');
      params.append('sort_direction', 'desc');
      
      const result = await this.makeRequest<any>(`/estimates?${params.toString()}`, tenantId);
      
      if (result.success && result.data) {
        // Handle different HCP response structures: data.data, data.estimates, or direct array
        const allEstimates = Array.isArray(result.data.data) ? result.data.data : 
                         Array.isArray(result.data.estimates) ? result.data.estimates :
                         Array.isArray(result.data) ? result.data : [];
        
        console.log(`[HCP] Fetched ${allEstimates.length} total estimates for date range`);
        
        // Filter estimates by employee and exclude canceled/rejected statuses
        // HCP statuses that should NOT block availability - check both work_status and status fields
        const excludedStatuses = ['canceled', 'cancelled', 'rejected', 'declined', 'completed', 'unscheduled', 'pro_canceled', 'customer_declined'];
        
        const employeeEstimates = allEstimates.filter((est: any) => {
          // Check both work_status and status fields - HCP uses either
          const workStatus = (est.work_status || '').toLowerCase();
          const status = (est.status || '').toLowerCase();
          
          // Skip if either status field indicates canceled/rejected/completed
          const shouldExclude = excludedStatuses.some(excluded => 
            workStatus.includes(excluded) || status.includes(excluded)
          );
          
          if (shouldExclude) {
            return false;
          }
          
          // Check direct employee_id field
          if (est.employee_id === employeeId || est.assigned_employee_id === employeeId) {
            return true;
          }
          
          // Check dispatched_employees array (used in options/schedule)
          if (est.options && Array.isArray(est.options)) {
            for (const opt of est.options) {
              if (opt.schedule?.dispatched_employees?.some((emp: any) => emp.id === employeeId)) {
                return true;
              }
              // Also check dispatched_employees directly on option
              if (opt.dispatched_employees?.some((emp: any) => emp.id === employeeId)) {
                return true;
              }
            }
          }
          
          // Check assigned_employees array
          if (est.assigned_employees?.some((emp: any) => emp.id === employeeId || emp === employeeId)) {
            return true;
          }
          
          return false;
        });
        
        console.log(`[HCP] Found ${employeeEstimates.length} estimates for employee ${employeeId}`);
        return { success: true, data: employeeEstimates };
      }
      
      return { success: false, error: result.error || 'Failed to fetch estimates' };
    } catch (error: any) {
      console.error(`[HCP] Error fetching employee estimates:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get scheduled jobs for a specific employee within a date range
   * Used to determine busy windows for calendar/scheduling
   */
  async getEmployeeScheduledJobs(
    tenantId: string, 
    employeeId: string, 
    startDate: Date, 
    endDate: Date
  ): Promise<HousecallProResponse<any[]>> {
    try {
      const params = new URLSearchParams();
      params.append('employee_ids', employeeId);
      params.append('scheduled_start_min', startDate.toISOString());
      params.append('scheduled_start_max', endDate.toISOString());
      params.append('page_size', '100');
      
      const result = await this.makeRequest<any>(`/jobs?${params.toString()}`, tenantId);
      
      if (result.success && result.data) {
        // Handle different response structures
        const jobs = result.data.jobs || result.data.data || result.data || [];
        return { success: true, data: Array.isArray(jobs) ? jobs : [] };
      }
      
      return { success: false, error: result.error || 'Failed to fetch jobs' };
    } catch (error: any) {
      console.error(`[HCP] Error fetching employee jobs:`, error);
      return { success: false, error: error.message };
    }
  }

}

export const housecallProService = new HousecallProService();