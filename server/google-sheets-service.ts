import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

export interface GoogleSheetsConfig {
  serviceAccountEmail: string;
  privateKey: string;
  spreadsheetId: string;
  sheetName?: string; // Optional, defaults to first sheet
}

export interface LeadRowData {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  source?: string;
  notes?: string;
  scheduled?: string;
  followUpDate?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  pageUrl?: string;
  [key: string]: any; // Allow additional fields
}

export interface ColumnMapping {
  [sheetColumn: string]: string; // Maps sheet column name to lead field name
}

export class GoogleSheetsService {
  private auth: JWT;

  constructor(config: GoogleSheetsConfig) {
    this.auth = new JWT({
      email: config.serviceAccountEmail,
      key: config.privateKey.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
  }

  /**
   * Validate Google Sheets credentials without requiring a specific spreadsheet
   */
  async validateCredentials(): Promise<boolean> {
    try {
      // Create a simple request to test authentication
      // We'll use a known invalid spreadsheet ID to test auth without accessing real data
      const doc = new GoogleSpreadsheet('1dummy_test_id', this.auth);
      await doc.loadInfo();
      return false; // This will never be reached with a dummy ID
    } catch (error: any) {
      // If it's an auth error, credentials are invalid
      if (error.message?.includes('Unable to authenticate') || 
          error.message?.includes('Invalid credentials') ||
          error.message?.includes('No key specified') ||
          error.message?.includes('private_key') ||
          error.response?.status === 403) {
        throw new Error('Invalid Google Sheets credentials');
      }
      
      // If it's a "not found" error, credentials are valid but spreadsheet doesn't exist
      if (error.message?.includes('not found') || 
          error.response?.status === 404) {
        return true; // Credentials are valid
      }
      
      // Any other error might indicate valid credentials but other issues
      return true;
    }
  }

  async validateConnection(spreadsheetId: string): Promise<boolean> {
    try {
      const doc = new GoogleSpreadsheet(spreadsheetId, this.auth);
      await doc.loadInfo();
      return true;
    } catch (error) {
      console.error('Failed to validate Google Sheets connection:', error);
      return false;
    }
  }

  async getSheetInfo(spreadsheetId: string): Promise<{
    title: string;
    sheets: Array<{ title: string; index: number; rowCount: number; columnCount: number }>;
  }> {
    const doc = new GoogleSpreadsheet(spreadsheetId, this.auth);
    await doc.loadInfo();

    return {
      title: doc.title,
      sheets: doc.sheetsByIndex.map((sheet, index) => ({
        title: sheet.title,
        index,
        rowCount: sheet.rowCount,
        columnCount: sheet.columnCount,
      })),
    };
  }

  async getSheetHeaders(spreadsheetId: string, sheetName?: string): Promise<string[]> {
    const doc = new GoogleSpreadsheet(spreadsheetId, this.auth);
    await doc.loadInfo();
    
    const sheet = sheetName 
      ? doc.sheetsByTitle[sheetName] 
      : doc.sheetsByIndex[0];
    
    if (!sheet) {
      throw new Error(`Sheet "${sheetName || 'first sheet'}" not found`);
    }

    // Load the header row
    await sheet.loadHeaderRow();
    return sheet.headerValues;
  }

  async importLeadsFromSheet(
    spreadsheetId: string,
    columnMapping: ColumnMapping,
    sheetName?: string,
    startRow: number = 2 // Default to row 2 (skip header)
  ): Promise<LeadRowData[]> {
    const doc = new GoogleSpreadsheet(spreadsheetId, this.auth);
    await doc.loadInfo();
    
    const sheet = sheetName 
      ? doc.sheetsByTitle[sheetName] 
      : doc.sheetsByIndex[0];
    
    if (!sheet) {
      throw new Error(`Sheet "${sheetName || 'first sheet'}" not found`);
    }

    // Get all rows
    const rows = await sheet.getRows();
    
    const leads: LeadRowData[] = [];
    
    for (let i = startRow - 2; i < rows.length; i++) { // -2 because getRows() is 0-indexed and excludes header
      const row = rows[i];
      const lead: LeadRowData = {};
      
      // Map columns according to the provided mapping
      for (const [sheetColumn, leadField] of Object.entries(columnMapping)) {
        const value = row.get(sheetColumn);
        if (value && value.trim()) {
          // Handle special date fields
          if (leadField === 'followUpDate' || leadField === 'scheduled') {
            // Try to parse date
            const dateValue = new Date(value);
            if (!isNaN(dateValue.getTime())) {
              lead[leadField] = dateValue.toISOString();
            } else {
              lead[leadField] = value; // Keep original if can't parse
            }
          } else {
            lead[leadField] = value.trim();
          }
        }
      }
      
      // Only add leads that have at least a name or email
      if (lead.name || lead.email) {
        leads.push(lead);
      }
    }
    
    return leads;
  }

  async previewSheetData(
    spreadsheetId: string, 
    sheetName?: string, 
    maxRows: number = 10
  ): Promise<{ headers: string[]; rows: any[][] }> {
    const doc = new GoogleSpreadsheet(spreadsheetId, this.auth);
    await doc.loadInfo();
    
    const sheet = sheetName 
      ? doc.sheetsByTitle[sheetName] 
      : doc.sheetsByIndex[0];
    
    if (!sheet) {
      throw new Error(`Sheet "${sheetName || 'first sheet'}" not found`);
    }

    await sheet.loadHeaderRow();
    const headers = sheet.headerValues;
    
    const rows = await sheet.getRows({ limit: maxRows });
    const previewRows = rows.map(row => 
      headers.map(header => row.get(header) || '')
    );
    
    return { headers, rows: previewRows };
  }
}

// Helper function to suggest column mappings based on common patterns
export function suggestColumnMappings(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  
  const mappingPatterns: { [key: string]: string[] } = {
    name: ['name', 'full name', 'customer name', 'client name', 'contact name', 'lead name'],
    email: ['email', 'email address', 'e-mail', 'contact email'],
    phone: ['phone', 'phone number', 'telephone', 'mobile', 'contact phone', 'cell'],
    address: ['address', 'street address', 'location', 'service address'],
    source: ['source', 'lead source', 'referral source', 'how did you hear'],
    notes: ['notes', 'comments', 'description', 'details', 'remarks'],
    scheduled: ['scheduled', 'appointment', 'scheduled date', 'appointment date'],
    followUpDate: ['follow up', 'followup', 'follow-up', 'callback date', 'next contact'],
    utmSource: ['utm source', 'utm_source', 'traffic source'],
    utmMedium: ['utm medium', 'utm_medium', 'marketing medium'],
    utmCampaign: ['utm campaign', 'utm_campaign', 'campaign'],
    pageUrl: ['page url', 'landing page', 'page', 'url'],
  };
  
  for (const header of headers) {
    const lowerHeader = header.toLowerCase().trim();
    
    for (const [fieldName, patterns] of Object.entries(mappingPatterns)) {
      if (patterns.some(pattern => lowerHeader.includes(pattern))) {
        mapping[header] = fieldName;
        break;
      }
    }
  }
  
  return mapping;
}