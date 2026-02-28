import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBulkSelection, type EntityType } from "@/contexts/BulkSelectionContext";
import { X, Trash2, Download, Edit } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface BulkActionToolbarProps {
  onDelete?: (ids: string[]) => Promise<void>;
  onStatusChange?: (ids: string[], status: string) => Promise<void>;
  onExport?: (ids: string[]) => Promise<void>;
  statusOptions?: { value: string; label: string }[];
  className?: string;
}

export function BulkActionToolbar({
  onDelete,
  onStatusChange,
  onExport,
  statusOptions = [],
  className,
}: BulkActionToolbarProps) {
  const { selectedIds, selectedCount, clearSelection, isSelectionMode } = useBulkSelection();
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isSelectionMode) return null;

  const handleDelete = async () => {
    if (!onDelete || !confirm(`Are you sure you want to delete ${selectedCount} item(s)?`)) {
      return;
    }
    
    setIsProcessing(true);
    try {
      await onDelete(Array.from(selectedIds));
      clearSelection();
    } catch (error) {
      console.error("Failed to delete items:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStatusChange = async (status: string) => {
    if (!onStatusChange) return;
    
    setIsProcessing(true);
    try {
      await onStatusChange(Array.from(selectedIds), status);
      clearSelection();
    } catch (error) {
      console.error("Failed to update status:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExport = async () => {
    if (!onExport) return;
    
    setIsProcessing(true);
    try {
      await onExport(Array.from(selectedIds));
    } catch (error) {
      console.error("Failed to export items:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 bg-primary text-primary-foreground shadow-lg border-t z-50",
        "transition-transform duration-300 ease-in-out",
        className
      )}
      data-testid="bulk-action-toolbar"
    >
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="font-medium" data-testid="text-selected-count">
              {selectedCount} {selectedCount === 1 ? 'item' : 'items'} selected
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              disabled={isProcessing}
              className="text-primary-foreground hover:bg-primary-foreground/20"
              data-testid="button-clear-selection"
            >
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {statusOptions.length > 0 && onStatusChange && (
              <Select onValueChange={handleStatusChange} disabled={isProcessing}>
                <SelectTrigger 
                  className="w-[180px] bg-white/90 border-white/40 text-primary hover:bg-white"
                  data-testid="select-status-change"
                >
                  <Edit className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Change status" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {onExport && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleExport}
                disabled={isProcessing}
                className="text-primary-foreground hover:bg-primary-foreground/20"
                data-testid="button-export"
              >
                <Download className="h-4 w-4 mr-1" />
                Export
              </Button>
            )}

            {onDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                disabled={isProcessing}
                className="text-primary-foreground hover:bg-destructive hover:text-destructive-foreground"
                data-testid="button-delete"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
