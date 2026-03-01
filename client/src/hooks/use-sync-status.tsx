import { createContext, useContext, useState, useEffect, ReactNode, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";

interface SyncStatus {
  isRunning: boolean;
  progress?: string;
  error?: string;
  lastSync?: Date;
}

interface SyncStatusContextType {
  syncStatus: SyncStatus;
  startSync: () => void;
}

const SyncStatusContext = createContext<SyncStatusContextType | undefined>(undefined);

export function useSyncStatus() {
  const context = useContext(SyncStatusContext);
  if (!context) {
    throw new Error("useSyncStatus must be used within a SyncStatusProvider");
  }
  return context;
}

export function SyncStatusProvider({ children }: { children: ReactNode }) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isRunning: false,
  });
  const { toast } = useToast();
  const previousSyncStatus = useRef<SyncStatus>({ isRunning: false });
  const toastId = useRef<string | null>(null);

  // Read user role from cache (no extra network request — auth/me is fetched on app load)
  const { data: authData } = useQuery<{ user: { role: string; canManageIntegrations?: boolean } }>({
    queryKey: ['/api/auth/me'],
  });
  const user = authData?.user;
  const canReceiveSyncUpdates =
    user?.role === 'admin' ||
    user?.role === 'super_admin' ||
    user?.role === 'manager' ||
    user?.canManageIntegrations === true;

  // Adaptive polling: fast when sync is running, slow when idle, paused in background tabs.
  // Disabled entirely for regular users who cannot trigger or manage syncs.
  const { data: currentSyncStatus } = useQuery({
    queryKey: ['/api/sync-status'],
    enabled: canReceiveSyncUpdates,
    refetchInterval: (query) => query.state.data?.isRunning ? 2000 : 30000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  useEffect(() => {
    if (currentSyncStatus) {
      const prevStatus = previousSyncStatus.current;
      const newStatus = currentSyncStatus;
      
      // Handle sync start
      if (!prevStatus.isRunning && newStatus.isRunning) {
        toast({
          title: newStatus.progress?.includes('Dialpad') ? "Syncing with Dialpad..." : "Syncing...",
          description: newStatus.progress || "Starting sync...",
          action: <Loader2 className="h-4 w-4 animate-spin" />,
          duration: Infinity, // Keep showing while syncing
        });
        toastId.current = "sync-running";
      }
      
      // Handle sync completion
      else if (prevStatus.isRunning && !newStatus.isRunning && !newStatus.error) {
        // Dismiss the running toast
        if (toastId.current) {
          // Toast library doesn't have direct dismiss, but duration will handle it
          toastId.current = null;
        }
        
        toast({
          title: "Sync completed successfully!",
          description: newStatus.lastSync 
            ? `Completed at ${new Date(newStatus.lastSync).toLocaleTimeString()}`
            : "Your data is now up to date",
          action: <CheckCircle className="h-4 w-4 text-green-600" />,
          duration: 5000,
        });
      }
      
      // Handle sync error
      else if (newStatus.error && newStatus.error !== prevStatus.error) {
        // Dismiss the running toast
        if (toastId.current) {
          toastId.current = null;
        }
        
        toast({
          title: "Sync Error",
          description: newStatus.error,
          action: <AlertCircle className="h-4 w-4 text-destructive" />,
          duration: 8000,
          variant: "destructive",
        });
      }

      setSyncStatus(newStatus);
      previousSyncStatus.current = newStatus;
    }
  }, [currentSyncStatus, toast]);

  const startSync = () => {
    // Optimistically set sync as running for immediate UI feedback
    setSyncStatus(prev => ({
      ...prev,
      isRunning: true,
      error: undefined,
      progress: 'Starting sync...',
    }));
    
    // Show immediate toast notification
    toast({
      title: "Syncing...",
      description: "Starting sync...",
      action: <Loader2 className="h-4 w-4 animate-spin" />,
      duration: Infinity, // Keep showing while syncing
    });
  };

  return (
    <SyncStatusContext.Provider value={{ syncStatus, startSync }}>
      {children}
    </SyncStatusContext.Provider>
  );
}