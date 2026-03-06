import type { Express, Response } from "express";
import { storage } from "../../storage";
import { insertContactSchema } from "@shared/schema";
import { type AuthenticatedRequest } from "../../auth-service";
import { CredentialService } from "../../credential-service";
import { GoogleSheetsService, suggestColumnMappings } from "../../google-sheets-service";
import { z } from "zod";
import { asyncHandler } from "../../utils/async-handler";

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

  app.post("/api/leads/google-sheets/credentials", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
      res.status(400).json({ 
        message: 'Invalid Google Sheets credentials. Please verify your service account email and private key.',
        error: error instanceof Error ? error.message : 'Authentication failed'
      });
      return;
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
  }));

  // Check Google Sheets credential status
  app.get("/api/leads/google-sheets/credentials/status", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const contractorId = req.user!.contractorId;
    
    const hasCredentials = await CredentialService.hasRequiredCredentials(
      contractorId, 
      'google-sheets'
    );
    
    res.json({ configured: hasCredentials });
  }));

  // Validate Google Sheets connection with stored credentials
  app.post("/api/leads/google-sheets/validate", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const contractorId = req.user!.contractorId;
    const config = googleSheetsOperationSchema.parse(req.body);
    
    const credentials = await CredentialService.getServiceCredentials(contractorId, 'google-sheets');
    if (!credentials.serviceAccountEmail || !credentials.privateKey) {
      res.status(400).json({ 
        valid: false,
        message: 'Google Sheets credentials not configured. Please set up your credentials first.' 
      });
      return;
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
  }));

  // Get Google Sheets info and headers with stored credentials
  app.post("/api/leads/google-sheets/info", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const contractorId = req.user!.contractorId;
    const config = googleSheetsOperationSchema.parse(req.body);
    
    const credentials = await CredentialService.getServiceCredentials(contractorId, 'google-sheets');
    if (!credentials.serviceAccountEmail || !credentials.privateKey) {
      res.status(400).json({ 
        message: 'Google Sheets credentials not configured. Please set up your credentials first.' 
      });
      return;
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
  }));

  // Preview Google Sheets data with stored credentials
  app.post("/api/leads/google-sheets/preview", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const contractorId = req.user!.contractorId;
    const config = googleSheetsOperationSchema.extend({
      maxRows: z.number().int().min(1).max(50).optional().default(10)
    }).parse(req.body);
    
    const credentials = await CredentialService.getServiceCredentials(contractorId, 'google-sheets');
    if (!credentials.serviceAccountEmail || !credentials.privateKey) {
      res.status(400).json({ 
        message: 'Google Sheets credentials not configured. Please set up your credentials first.' 
      });
      return;
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
  }));

  // Import leads from Google Sheets with stored credentials
  app.post("/api/leads/google-sheets/import", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const contractorId = req.user!.contractorId;
    const importConfig = googleSheetsImportSchema.parse(req.body);
    
    if (!Object.values(importConfig.columnMapping).includes('name')) {
      res.status(400).json({ 
        message: 'Column mapping must include a "name" field mapping' 
      });
      return;
    }

    const credentials = await CredentialService.getServiceCredentials(contractorId, 'google-sheets');
    if (!credentials.serviceAccountEmail || !credentials.privateKey) {
      res.status(400).json({ 
        message: 'Google Sheets credentials not configured. Please set up your credentials first.' 
      });
      return;
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
        
        if (
          (validationResult.data.phones && validationResult.data.phones.length > 0) ||
          (validationResult.data.emails && validationResult.data.emails.length > 0)
        ) {
          const matchedId = await storage.findMatchingContact(
            contractorId,
            validationResult.data.emails ?? [],
            validationResult.data.phones ?? []
          );
          if (matchedId) {
            const duplicate = await storage.getContact(matchedId, contractorId);
            const duplicatePhone = duplicate?.phones?.find(p => validationResult.data.phones?.includes(p));
            results.skipped++;
            results.errors.push({
              row: importConfig.startRow + i,
              error: `Skipped - Duplicate ${duplicatePhone ? `phone number ${duplicatePhone}` : 'email'} (already exists for contact: ${duplicate?.name})`,
              data: leadData
            });
            continue;
          }
        }
        
        await storage.createContact(validationResult.data, contractorId);
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
  }));
}
