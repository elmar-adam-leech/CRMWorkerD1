import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertCircle, CheckCircle, Upload } from "lucide-react";

interface SheetInfo {
  title: string;
  sheets: { title: string }[];
}

interface PreviewData {
  headers: string[];
  rows: string[][];
}

interface GoogleSheetsImportTabProps {
  onImportSuccess: () => void;
  onCancel: () => void;
}

type GoogleSheetsConfig = {
  spreadsheetId: string;
  sheetName: string;
};

type Credentials = {
  serviceAccountEmail: string;
  privateKey: string;
};

async function sheetsPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as any).message || "Request failed");
  }
  return response.json();
}

export function GoogleSheetsImportTab({ onImportSuccess, onCancel }: GoogleSheetsImportTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [googleSheetsConfig, setGoogleSheetsConfig] = useState<GoogleSheetsConfig>({
    spreadsheetId: "",
    sheetName: "",
  });
  const [pendingCredentials, setPendingCredentials] = useState<Credentials | null>(null);
  const [googleSheetsHeaders, setGoogleSheetsHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [sheetInfo, setSheetInfo] = useState<SheetInfo | null>(null);
  const [showCredentialsForm, setShowCredentialsForm] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);

  const { data: credentialStatus } = useQuery({
    queryKey: ["/api/leads/google-sheets/credentials/status"],
    queryFn: async () => {
      const response = await fetch("/api/leads/google-sheets/credentials/status", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to check credential status");
      return response.json() as Promise<{ configured: boolean }>;
    },
  });

  const hasStoredCredentials = credentialStatus?.configured ?? false;

  const storeCredentialsMutation = useMutation({
    mutationFn: (credentials: Credentials) =>
      sheetsPost("/api/leads/google-sheets/credentials", credentials),
    onSuccess: () => {
      toast({
        title: "Credentials Stored Successfully",
        description: "Your Google Sheets credentials have been stored securely.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/google-sheets/credentials/status"] });
      setShowCredentialsForm(false);
      setPendingCredentials(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Credential Storage Failed",
        description: error.message || "Failed to store Google Sheets credentials",
        variant: "destructive",
      });
    },
  });

  const googleSheetsValidateMutation = useMutation({
    mutationFn: (config: GoogleSheetsConfig) =>
      sheetsPost("/api/leads/google-sheets/validate", config),
  });

  const googleSheetsInfoMutation = useMutation({
    mutationFn: (config: GoogleSheetsConfig) =>
      sheetsPost<{ sheetInfo: SheetInfo; headers: string[]; suggestedMappings: Record<string, string> }>(
        "/api/leads/google-sheets/info",
        config
      ),
    onSuccess: (data) => {
      setSheetInfo(data.sheetInfo);
      setGoogleSheetsHeaders(data.headers);
      setColumnMapping(data.suggestedMappings);
    },
  });

  const googleSheetsPreviewMutation = useMutation({
    mutationFn: (config: GoogleSheetsConfig) =>
      sheetsPost<PreviewData>("/api/leads/google-sheets/preview", config),
    onSuccess: (data) => {
      setPreviewData(data);
    },
  });

  const googleSheetsImportMutation = useMutation({
    mutationFn: (importData: GoogleSheetsConfig & { columnMapping: Record<string, string> }) =>
      sheetsPost<{ message?: string; errors?: unknown[] }>("/api/leads/google-sheets/import", importData),
    onSuccess: (data) => {
      toast({
        title: "Google Sheets Import Successful",
        description: data.message || "Leads imported successfully from Google Sheets",
      });
      if (data.errors && data.errors.length > 0) {
        toast({
          title: "Some rows had errors",
          description: `${data.errors.length} rows failed validation and were skipped.`,
          variant: "destructive",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/paginated"] });
      onImportSuccess();
    },
    onError: (error: Error) => {
      toast({
        title: "Google Sheets Import Failed",
        description: error.message || "Failed to import from Google Sheets",
        variant: "destructive",
      });
    },
  });

  const isValidating =
    googleSheetsValidateMutation.isPending || googleSheetsInfoMutation.isPending;

  const handleKeyFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (!json.client_email || !json.private_key) {
          toast({
            title: "Invalid Key File",
            description: "The JSON file must contain 'client_email' and 'private_key' fields.",
            variant: "destructive",
          });
          return;
        }
        setPendingCredentials({
          serviceAccountEmail: json.client_email,
          privateKey: json.private_key,
        });
      } catch {
        toast({
          title: "Invalid JSON File",
          description: "Could not parse the service account key file. Please use the JSON file downloaded from Google Cloud.",
          variant: "destructive",
        });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleStoreCredentials = async () => {
    if (!pendingCredentials) {
      toast({
        title: "No Key File Selected",
        description: "Please select your service account JSON key file first.",
        variant: "destructive",
      });
      return;
    }
    storeCredentialsMutation.mutate(pendingCredentials);
  };

  const handleValidateSheets = async () => {
    if (!hasStoredCredentials) {
      toast({
        title: "Credentials Required",
        description: "Please set up your Google Sheets credentials first",
        variant: "destructive",
      });
      return;
    }
    if (!googleSheetsConfig.spreadsheetId) {
      toast({
        title: "Missing Spreadsheet ID",
        description: "Please enter a Google Sheets spreadsheet ID",
        variant: "destructive",
      });
      return;
    }
    try {
      await googleSheetsValidateMutation.mutateAsync(googleSheetsConfig);
      toast({
        title: "Connection Successful",
        description: "Successfully connected to Google Sheets",
      });
      await googleSheetsInfoMutation.mutateAsync(googleSheetsConfig);
    } catch (error: unknown) {
      toast({
        title: "Connection Failed",
        description: error instanceof Error ? error.message : "Failed to connect to Google Sheets",
        variant: "destructive",
      });
    }
  };

  const handlePreviewSheets = async () => {
    if (!sheetInfo) {
      toast({
        title: "No Sheet Info",
        description: "Please validate your connection first",
        variant: "destructive",
      });
      return;
    }
    try {
      await googleSheetsPreviewMutation.mutateAsync(googleSheetsConfig);
      toast({
        title: "Preview Loaded",
        description: "Sheet data preview loaded successfully",
      });
    } catch (error: unknown) {
      toast({
        title: "Preview Failed",
        description: error instanceof Error ? error.message : "Failed to load preview",
        variant: "destructive",
      });
    }
  };

  const handleImportFromSheets = async () => {
    if (!sheetInfo || Object.keys(columnMapping).length === 0) {
      toast({
        title: "Missing Configuration",
        description: "Please validate connection and configure column mapping",
        variant: "destructive",
      });
      return;
    }
    googleSheetsImportMutation.mutate({ ...googleSheetsConfig, columnMapping });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Import leads directly from your Google Sheets. First set up your credentials securely,
        then configure your spreadsheet import.
      </p>

      {/* Credential Status */}
      {!hasStoredCredentials ? (
        <div className="border bg-muted p-4 rounded-md">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
            <h4 className="font-medium">Google Sheets Credentials Required</h4>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            To import from Google Sheets, you need to provide a Google service account JSON key
            file. The credentials are stored securely and encrypted on the server.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowCredentialsForm(!showCredentialsForm)}
            data-testid="button-setup-credentials"
          >
            {showCredentialsForm ? "Cancel Setup" : "Set Up Credentials"}
          </Button>
        </div>
      ) : (
        <div className="border bg-muted p-4 rounded-md">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
            <h4 className="font-medium">Google Sheets Credentials Configured</h4>
          </div>
          <p className="text-sm text-muted-foreground">
            Your credentials are securely stored and ready to use for importing leads.
          </p>
        </div>
      )}

      {/* Credential Setup Form */}
      {showCredentialsForm && !hasStoredCredentials && (
        <div className="border p-4 rounded-md bg-muted space-y-4">
          <h4 className="font-medium">Google Service Account Key File</h4>
          <p className="text-sm text-muted-foreground">
            Upload the JSON key file you downloaded from the Google Cloud Console when creating
            your service account.
          </p>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleKeyFileSelect}
              className="hidden"
              data-testid="input-key-file"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              data-testid="button-select-key-file"
            >
              <Upload className="h-4 w-4 mr-2" />
              Select JSON Key File
            </Button>
          </div>

          {pendingCredentials && (
            <div className="rounded-md border bg-background p-3 text-sm space-y-1">
              <p className="font-medium text-foreground">Key file loaded</p>
              <p className="text-muted-foreground break-all">
                Account: {pendingCredentials.serviceAccountEmail}
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              onClick={handleStoreCredentials}
              disabled={storeCredentialsMutation.isPending || !pendingCredentials}
              data-testid="button-store-credentials"
            >
              {storeCredentialsMutation.isPending ? "Storing..." : "Store Credentials Securely"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowCredentialsForm(false);
                setPendingCredentials(null);
              }}
              data-testid="button-cancel-credentials"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Spreadsheet Configuration */}
      {hasStoredCredentials && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Spreadsheet ID *</label>
              <Input
                placeholder="Enter Google Sheets ID from URL"
                value={googleSheetsConfig.spreadsheetId}
                onChange={(e) =>
                  setGoogleSheetsConfig((prev) => ({ ...prev, spreadsheetId: e.target.value }))
                }
                data-testid="input-spreadsheet-id"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Extract ID from the URL:{" "}
                https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Sheet Name (optional)</label>
              <Input
                placeholder="Leave empty for first sheet"
                value={googleSheetsConfig.sheetName}
                onChange={(e) =>
                  setGoogleSheetsConfig((prev) => ({ ...prev, sheetName: e.target.value }))
                }
                data-testid="input-sheet-name"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              onClick={handleValidateSheets}
              disabled={isValidating || !googleSheetsConfig.spreadsheetId}
              data-testid="button-validate-sheets"
            >
              {isValidating ? "Validating..." : "Validate & Load Headers"}
            </Button>
            {sheetInfo && (
              <Button
                type="button"
                variant="outline"
                onClick={handlePreviewSheets}
                disabled={googleSheetsPreviewMutation.isPending}
                data-testid="button-preview-sheets"
              >
                {googleSheetsPreviewMutation.isPending ? "Loading..." : "Preview Data"}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Sheet Info */}
      {sheetInfo && (
        <div className="bg-muted p-4 rounded border">
          <h4 className="font-medium mb-2">Sheet Information</h4>
          <p>
            <strong>Spreadsheet:</strong> {sheetInfo.title}
          </p>
          <p>
            <strong>Sheets:</strong> {sheetInfo.sheets.map((s) => s.title).join(", ")}
          </p>
          <p>
            <strong>Headers found:</strong> {googleSheetsHeaders.join(", ")}
          </p>
        </div>
      )}

      {/* Column Mapping */}
      {googleSheetsHeaders.length > 0 && (
        <div className="space-y-4">
          <div>
            <h4 className="font-medium">Column Mapping</h4>
            <p className="text-sm text-muted-foreground mt-1">
              Map your Google Sheets columns to lead fields. Suggested mappings are pre-filled.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {googleSheetsHeaders.map((header) => (
              <div key={header} className="space-y-1">
                <label className="text-sm font-medium">
                  Sheet Column:{" "}
                  <span className="font-normal text-muted-foreground">"{header}"</span>
                </label>
                <select
                  value={columnMapping[header] || ""}
                  onChange={(e) =>
                    setColumnMapping((prev) => ({ ...prev, [header]: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-input bg-background rounded-md text-sm"
                  data-testid={`select-mapping-${header}`}
                >
                  <option value="">-- Skip this column --</option>
                  <option value="name">Name</option>
                  <option value="email">Email</option>
                  <option value="phone">Phone</option>
                  <option value="address">Address</option>
                  <option value="source">Source</option>
                  <option value="notes">Notes</option>
                  <option value="followUpDate">Follow Up Date</option>
                  <option value="utmSource">UTM Source</option>
                  <option value="utmMedium">UTM Medium</option>
                  <option value="utmCampaign">UTM Campaign</option>
                  <option value="utmTerm">UTM Term</option>
                  <option value="utmContent">UTM Content</option>
                  <option value="pageUrl">Page URL</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Data Preview */}
      {previewData && (
        <div className="space-y-2">
          <h4 className="font-medium">Data Preview</h4>
          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto max-h-64">
              <table className="min-w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    {previewData.headers.map((header, index) => (
                      <th key={index} className="px-3 py-2 text-left font-medium">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewData.rows.slice(0, 5).map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-t">
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="px-3 py-2 border-r last:border-r-0">
                          {cell || <span className="text-muted-foreground">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 bg-muted text-xs text-muted-foreground">
              Showing first 5 rows of {previewData.rows.length} total rows
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} data-testid="button-cancel-sheets">
          Cancel
        </Button>
        <Button
          onClick={handleImportFromSheets}
          disabled={
            googleSheetsImportMutation.isPending ||
            !sheetInfo ||
            Object.keys(columnMapping).length === 0
          }
          data-testid="button-import-sheets"
        >
          {googleSheetsImportMutation.isPending ? "Importing..." : "Import Leads"}
        </Button>
      </div>
    </div>
  );
}
