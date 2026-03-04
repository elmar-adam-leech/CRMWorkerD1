import type { Express, Response } from "express";
import { storage } from "../../storage";
import { insertContactSchema } from "@shared/schema";
import { type AuthenticatedRequest } from "../../auth-service";
import { CredentialService } from "../../credential-service";
import { GoogleSheetsService, suggestColumnMappings } from "../../google-sheets-service";
import { z } from "zod";

export function registerGoogleSheetsRoutes(app: Express): void {
  // Validation schemas for secure Google Sheets import
  const googleSheetsCredentialSchema = z.object({
    serviceAccountEmail: z.string().email("Valid service account email is required"),
    privateKey: z.string().min(1, "Private key is required")
  });

  const googleSheetsOperationSchema = z.object({
    spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
    sheetName: z.string().optional()
  });

  const googleSheetsImportSchema = z.object({
    spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
    sheetName: z.string().optional(),
    columnMapping: z.record(z.string(), z.string()),
    startRow: z.number().int().min(1).optional().default(2)
  });

  app.post("/api/leads/google-sheets/credentials", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      const credentials = googleSheetsCredentialSchema.parse(req.body);
      
      const service = new GoogleSheetsService({
        serviceAccountEmail: credentials.serviceAccountEmail,
        privateKey: credentials.privateKey,
        spreadsheetId: '',
        sheetName: ''
      });

      try {
        await service.validateCredentials();
      } catch (error) {
        return res.status(400).json({ 
          message: 'Invalid Google Sheets credentials. Please verify your service account email and private key.',
          error: error instanceof Error ? error.message : 'Authentication failed'
        });
      }

      await Promise.all([
        CredentialService.setCredential(contractorId, 'google-sheets', 'serviceAccountEmail', credentials.serviceAccountEmail),
        CredentialService.setCredential(contractorId, 'google-sheets', 'privateKey', credentials.privateKey)
      ]);
      
      res.json({ 
        success: true,
        message: 'Google Sheets credentials stored securely',
        configured: true
      });
    } catch (error) {
      console.error('Error storing Google Sheets credentials:', error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid credential format", errors: error.errors });
        return;
      }
      res.status(500).json({ 
        message: 'Failed to store credentials. Please try again.' 
      });
    }
  });

  // Check Google Sheets credential status
  app.get("/api/leads/google-sheets/credentials/status", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      
      const hasCredentials = await CredentialService.hasRequiredCredentials(
        contractorId, 
        'google-sheets'
      );
      
      res.json({ configured: hasCredentials });
    } catch (error) {
      console.error('Error checking Google Sheets credentials:', error);
      res.status(500).json({ message: 'Failed to check credential status' });
    }
  });

  // Validate Google Sheets connection with stored credentials
  app.post("/api/leads/google-sheets/validate", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      const config = googleSheetsOperationSchema.parse(req.body);
      
      const credentials = await CredentialService.getServiceCredentials(contractorId, 'google-sheets');
      if (!credentials.serviceAccountEmail || !credentials.privateKey) {
        return res.status(400).json({ 
          valid: false,
          message: 'Google Sheets credentials not configured. Please set up your credentials first.' 
        });
      }

      const service = new GoogleSheetsService({
        serviceAccountEmail: credentials.serviceAccountEmail,
        privateKey: credentials.privateKey,
        spreadsheetId: config.spreadsheetId,
        sheetName: config.sheetName
      });

      const isValid = await service.validateConnection(config.spreadsheetId);
      
      if (isValid) {
        res.json({ valid: true, message: "Connection successful" });
      } else {
        res.status(400).json({ valid: false, message: "Failed to connect to Google Sheets" });
      }
    } catch (error) {
      console.error('Google Sheets validation error:', error);
      const message = error instanceof Error ? error.message : 'Validation failed';
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ valid: false, message: "Invalid configuration", errors: error.errors });
      }
      if (message.includes('permission') || message.includes('access')) {
        return res.status(403).json({ 
          valid: false,
          message: 'Access denied. Please ensure the service account has permission to access this spreadsheet.' 
        });
      }
      if (message.includes('not found')) {
        return res.status(404).json({ 
          valid: false,
          message: 'Spreadsheet not found. Please check the spreadsheet ID.' 
        });
      }
      
      res.status(500).json({ valid: false, message: `Validation failed: ${message}` });
    }
  });

  // Get Google Sheets info and headers with stored credentials
  app.post("/api/leads/google-sheets/info", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      const config = googleSheetsOperationSchema.parse(req.body);
      
      const credentials = await CredentialService.getServiceCredentials(contractorId, 'google-sheets');
      if (!credentials.serviceAccountEmail || !credentials.privateKey) {
        return res.status(400).json({ 
          message: 'Google Sheets credentials not configured. Please set up your credentials first.' 
        });
      }

      const service = new GoogleSheetsService({
        serviceAccountEmail: credentials.serviceAccountEmail,
        privateKey: credentials.privateKey,
        spreadsheetId: config.spreadsheetId,
        sheetName: config.sheetName
      });

      const [sheetInfo, headers] = await Promise.all([
        service.getSheetInfo(config.spreadsheetId),
        service.getSheetHeaders(config.spreadsheetId, config.sheetName)
      ]);

      const suggestedMappings = suggestColumnMappings(headers);

      res.json({
        sheetInfo,
        headers,
        suggestedMappings
      });
    } catch (error) {
      console.error('Google Sheets info error:', error);
      const message = error instanceof Error ? error.message : 'Failed to get sheet information';
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid configuration", errors: error.errors });
      }
      if (message.includes('permission') || message.includes('access')) {
        return res.status(403).json({ 
          message: 'Access denied. Please ensure the service account has permission to access this spreadsheet.' 
        });
      }
      if (message.includes('not found')) {
        return res.status(404).json({ 
          message: 'Spreadsheet not found. Please check the spreadsheet ID.' 
        });
      }
      
      res.status(500).json({ message: `Failed to get Google Sheets information: ${message}` });
    }
  });

  // Preview Google Sheets data with stored credentials
  app.post("/api/leads/google-sheets/preview", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      const config = googleSheetsOperationSchema.extend({
        maxRows: z.number().int().min(1).max(50).optional().default(10)
      }).parse(req.body);
      
      const credentials = await CredentialService.getServiceCredentials(contractorId, 'google-sheets');
      if (!credentials.serviceAccountEmail || !credentials.privateKey) {
        return res.status(400).json({ 
          message: 'Google Sheets credentials not configured. Please set up your credentials first.' 
        });
      }

      const service = new GoogleSheetsService({
        serviceAccountEmail: credentials.serviceAccountEmail,
        privateKey: credentials.privateKey,
        spreadsheetId: config.spreadsheetId,
        sheetName: config.sheetName
      });

      const previewData = await service.previewSheetData(
        config.spreadsheetId, 
        config.sheetName, 
        config.maxRows
      );

      res.json(previewData);
    } catch (error) {
      console.error('Google Sheets preview error:', error);
      const message = error instanceof Error ? error.message : 'Preview failed';
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid configuration", errors: error.errors });
      }
      if (message.includes('permission') || message.includes('access')) {
        return res.status(403).json({ 
          message: 'Access denied. Please ensure the service account has permission to access this spreadsheet.' 
        });
      }
      if (message.includes('not found')) {
        return res.status(404).json({ 
          message: 'Spreadsheet not found. Please check the spreadsheet ID.' 
        });
      }
      
      res.status(500).json({ message: `Preview failed: ${message}` });
    }
  });

  // Import leads from Google Sheets with stored credentials
  app.post("/api/leads/google-sheets/import", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      const importConfig = googleSheetsImportSchema.parse(req.body);
      
      if (!Object.values(importConfig.columnMapping).includes('name')) {
        return res.status(400).json({ 
          message: 'Column mapping must include a "name" field mapping' 
        });
      }

      const credentials = await CredentialService.getServiceCredentials(contractorId, 'google-sheets');
      if (!credentials.serviceAccountEmail || !credentials.privateKey) {
        return res.status(400).json({ 
          message: 'Google Sheets credentials not configured. Please set up your credentials first.' 
        });
      }
      
      const service = new GoogleSheetsService({
        serviceAccountEmail: credentials.serviceAccountEmail,
        privateKey: credentials.privateKey,
        spreadsheetId: importConfig.spreadsheetId,
        sheetName: importConfig.sheetName
      });

      const rawLeads = await service.importLeadsFromSheet(
        importConfig.spreadsheetId,
        importConfig.columnMapping,
        importConfig.sheetName,
        importConfig.startRow
      );

      console.log(`Starting Google Sheets import for contractor ${contractorId}: ${rawLeads.length} leads to process`);

      const results = {
        total: rawLeads.length,
        imported: 0,
        skipped: 0,
        errors: [] as Array<{ row: number; error: string; data: any }>
      };

      for (let i = 0; i < rawLeads.length; i++) {
        try {
          const leadData = rawLeads[i];
          
          if (!leadData.name && !leadData.email) {
            continue;
          }
          
          const emails = leadData.email?.trim() ? [leadData.email.trim()] : [];
          const phones = leadData.phone?.trim() ? [leadData.phone.trim()] : [];
          
          const validationResult = insertContactSchema.omit({ contractorId: true }).safeParse({
            name: leadData.name?.trim(),
            type: 'lead' as const,
            emails,
            phones,
            address: leadData.address?.trim() || undefined,
            source: leadData.source?.trim() || 'Google Sheets Import',
            notes: leadData.notes?.trim() || undefined,
            followUpDate: leadData.followUpDate || undefined,
            utmSource: leadData.utmSource?.trim() || undefined,
            utmMedium: leadData.utmMedium?.trim() || undefined,
            utmCampaign: leadData.utmCampaign?.trim() || undefined,
            utmTerm: leadData.utmTerm?.trim() || undefined,
            utmContent: leadData.utmContent?.trim() || undefined,
            pageUrl: leadData.pageUrl?.trim() || undefined
          });
          
          if (!validationResult.success) {
            const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
            results.errors.push({
              row: importConfig.startRow + i,
              error: `Validation failed: ${errorMessages}`,
              data: leadData
            });
            continue;
          }
          
          if (validationResult.data.phones && validationResult.data.phones.length > 0) {
            const existingContacts = await storage.getContacts(contractorId, 'lead');
            const duplicate = existingContacts.find(existingContact =>
              existingContact.phones && existingContact.phones.some(existingPhone =>
                validationResult.data.phones!.includes(existingPhone)
              )
            );
            if (duplicate) {
              const duplicatePhone = duplicate.phones?.find(p => validationResult.data.phones!.includes(p));
              results.skipped++;
              results.errors.push({
                row: importConfig.startRow + i,
                error: `Skipped - Duplicate phone number ${duplicatePhone} (already exists for contact: ${duplicate.name})`,
                data: leadData
              });
              continue;
            }
          }
          
          const newContact = await storage.createContact(validationResult.data, contractorId);
          results.imported++;
          
        } catch (error) {
          results.errors.push({
            row: importConfig.startRow + i,
            error: error instanceof Error ? error.message : "Unknown error",
            data: rawLeads[i]
          });
        }
      }
      
      console.log(`Google Sheets import completed for contractor ${contractorId}: ${results.imported}/${results.total} leads imported, ${results.skipped} skipped (duplicates)`);
      
      const statusCode = results.errors.length > 0 ? 207 : 200;
      
      const message = results.skipped > 0
        ? `Successfully imported ${results.imported} out of ${results.total} leads (${results.skipped} skipped as duplicates)`
        : `Successfully imported ${results.imported} out of ${results.total} leads from Google Sheets`;
      
      res.status(statusCode).json({
        success: true,
        message,
        total: results.total,
        imported: results.imported,
        skipped: results.skipped,
        failedCount: results.errors.length,
        errors: results.errors.slice(0, 10)
      });
      
    } catch (error) {
      console.error('Google Sheets import error:', error);
      const message = error instanceof Error ? error.message : 'Import failed';
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid import configuration", errors: error.errors });
      }
      if (message.includes('permission') || message.includes('access')) {
        return res.status(403).json({ 
          message: 'Access denied. Please ensure the service account has permission to access this spreadsheet.' 
        });
      }
      if (message.includes('not found')) {
        return res.status(404).json({ 
          message: 'Spreadsheet not found. Please check the spreadsheet ID.' 
        });
      }
      if (message.includes('mapping')) {
        return res.status(400).json({ 
          message: `Column mapping error: ${message}` 
        });
      }
      
      res.status(500).json({ 
        message: `Failed to import leads from Google Sheets: ${message}`
      });
    }
  });
}
