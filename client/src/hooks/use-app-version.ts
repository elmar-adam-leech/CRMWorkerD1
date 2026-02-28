import { useState, useEffect } from 'react';

export function useAppVersion() {
  const [showRefreshBanner, setShowRefreshBanner] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [newVersion, setNewVersion] = useState<string | null>(null);

  useEffect(() => {
    let broadcastChannel: BroadcastChannel | null = null;
    
    // Set up cross-tab communication
    if ('BroadcastChannel' in window) {
      broadcastChannel = new BroadcastChannel('app_version_updates');
      broadcastChannel.addEventListener('message', (event) => {
        if (event.data.type === 'version_changed') {
          setNewVersion(event.data.newVersion);
          // Reset dismissal state for new deployments received via broadcast
          sessionStorage.removeItem('refresh_banner_dismissed');
          setDismissed(false);
          setShowRefreshBanner(true);
        }
      });
    }

    const checkForUpdates = async () => {
      // Always check for version updates, regardless of dismissal state
      try {
        // Get the current build version from server
        const response = await fetch('/api/version', {
          method: 'GET',
          cache: 'no-cache',
        });
        
        if (!response.ok) return;
        
        const { version: currentVersion } = await response.json();
        
        // Get the version this tab knows about (per-tab tracking)
        const tabKnownVersion = sessionStorage.getItem('tab_known_version');
        
        // Get the last acknowledged version across all tabs
        const acknowledgedVersion = localStorage.getItem('app_acknowledged_version');
        
        if (!tabKnownVersion) {
          // First time this tab is running, store current version
          sessionStorage.setItem('tab_known_version', currentVersion);
          // If no acknowledged version exists, set it
          if (!acknowledgedVersion) {
            localStorage.setItem('app_acknowledged_version', currentVersion);
          }
          return;
        }
        
        // Check if server version is newer than what this tab knows
        if (tabKnownVersion !== currentVersion) {
          // Version has changed since this tab was loaded
          setNewVersion(currentVersion); // Store the new version for proper acknowledgment
          
          // Reset dismissal state for new deployments - clear flag and enable banner
          sessionStorage.removeItem('refresh_banner_dismissed');
          setDismissed(false);
          setShowRefreshBanner(true);
          
          // Always notify other tabs via BroadcastChannel
          if (broadcastChannel) {
            broadcastChannel.postMessage({
              type: 'version_changed',
              newVersion: currentVersion,
              oldVersion: tabKnownVersion
            });
          }
        }
        
        // Don't update tab_known_version until user refreshes
        // This ensures the banner stays visible until action is taken
        
      } catch (error) {
        console.error('Version check failed:', error);
      }
    };

    // Check on initial load
    checkForUpdates();
    
    // Check periodically (every 30 seconds)
    const interval = setInterval(checkForUpdates, 30000);

    return () => {
      if (interval) clearInterval(interval);
      if (broadcastChannel) broadcastChannel.close();
    };
  }, [dismissed]);

  const handleRefresh = async () => {
    try {
      // Use the new version (from server) for acknowledgment, not the stale tab version
      const versionToAcknowledge = newVersion || sessionStorage.getItem('tab_known_version');
      
      if (versionToAcknowledge) {
        // Update both sessionStorage and localStorage with the new version
        sessionStorage.setItem('tab_known_version', versionToAcknowledge);
        localStorage.setItem('app_acknowledged_version', versionToAcknowledge);
        
        // Clear dismissal flag to allow future deployment notifications
        sessionStorage.removeItem('refresh_banner_dismissed');
      }
      
      // Clear browser caches only, preserve user data
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames.map(cacheName => caches.delete(cacheName))
        );
      }
      
      // Force reload to get fresh assets
      window.location.reload();
    } catch (error) {
      console.error('Cache clear failed:', error);
      // Fallback to simple reload
      window.location.reload();
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    setShowRefreshBanner(false);
    // Remember dismissal for this session only
    sessionStorage.setItem('refresh_banner_dismissed', 'true');
  };

  // Check if banner was dismissed in this session
  useEffect(() => {
    if (sessionStorage.getItem('refresh_banner_dismissed')) {
      setDismissed(true);
      setShowRefreshBanner(false);
    }
  }, []);

  return {
    showRefreshBanner,
    handleRefresh,
    handleDismiss,
  };
}