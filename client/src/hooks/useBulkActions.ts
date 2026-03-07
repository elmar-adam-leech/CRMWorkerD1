import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { downloadCsv } from "@/lib/csv";

export type BulkEntityType = "contact" | "job" | "estimate";

export interface BulkEntity {
  id: string;
  [key: string]: unknown;
}

export interface BulkExportColumn {
  header: string;
  getValue: (entity: BulkEntity) => string | number | null | undefined;
}

export interface UseBulkActionsOptions {
  entityType: BulkEntityType;
  deleteEndpoint: (id: string) => string;
  statusEndpoint: (id: string) => string;
  onInvalidate: () => void;
  exportFilename: string;
  exportHeaders: string[];
  getExportRow: (entity: BulkEntity) => (string | number | undefined)[];
  entities: BulkEntity[];
}

export interface UseBulkActionsResult {
  handleBulkDelete: (ids: string[]) => Promise<void>;
  handleBulkStatusChange: (ids: string[], status: string) => Promise<void>;
  handleBulkExport: (ids: string[]) => Promise<void>;
  isBulkPending: boolean;
}

export function useBulkActions({
  deleteEndpoint,
  statusEndpoint,
  onInvalidate,
  exportFilename,
  exportHeaders,
  getExportRow,
  entities,
}: UseBulkActionsOptions): UseBulkActionsResult {
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(ids.map((id) => apiRequest("DELETE", deleteEndpoint(id)))),
    onSuccess: (_, ids) => {
      onInvalidate();
      toast({ title: `Deleted ${ids.length} item(s)` });
    },
    onError: (error) => {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Some items could not be deleted.",
        variant: "destructive",
      });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: string }) =>
      Promise.all(ids.map((id) => apiRequest("PATCH", statusEndpoint(id), { status }))),
    onSuccess: (_, { ids, status }) => {
      onInvalidate();
      toast({ title: `Updated ${ids.length} item(s) to ${status}` });
    },
    onError: (error) => {
      toast({
        title: "Status update failed",
        description: error instanceof Error ? error.message : "Some items could not be updated.",
        variant: "destructive",
      });
    },
  });

  const handleBulkDelete = async (ids: string[]) => {
    await deleteMutation.mutateAsync(ids);
  };

  const handleBulkStatusChange = async (ids: string[], status: string) => {
    await statusMutation.mutateAsync({ ids, status });
  };

  const handleBulkExport = async (ids: string[]) => {
    const selected = entities.filter((e) => ids.includes(e.id));
    downloadCsv(exportFilename, exportHeaders, selected.map(getExportRow));
    toast({ title: `Exported ${ids.length} item(s)` });
  };

  return {
    handleBulkDelete,
    handleBulkStatusChange,
    handleBulkExport,
    isBulkPending: deleteMutation.isPending || statusMutation.isPending,
  };
}
