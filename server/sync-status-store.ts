export const syncStatus = new Map<string, {
  isRunning: boolean;
  progress: string | null;
  error: string | null;
  lastSync: string | null;
  startTime: Date | null;
}>();
