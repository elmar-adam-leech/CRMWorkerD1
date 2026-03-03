import { useState, useEffect } from "react";
import { type FilterState } from "@/components/FilterPanel";
// Re-export so callers don't need to import FilterPanel separately
export type { FilterState };

export type ViewMode = "cards" | "kanban";

export interface PagePreferences {
  viewMode?: ViewMode;
  filterStatus?: string;
  advancedFilters?: FilterState;
  searchQuery?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

interface UsePagePreferencesOptions {
  pageKey: string;
  defaultViewMode?: ViewMode;
  defaultFilterStatus?: string;
  defaultSortBy?: string;
  defaultSortOrder?: "asc" | "desc";
}

export function usePagePreferences({
  pageKey,
  defaultViewMode = "cards",
  defaultFilterStatus = "all",
  defaultSortBy,
  defaultSortOrder = "desc",
}: UsePagePreferencesOptions) {
  const storageKey = `page-preferences-${pageKey}`;

  // Load initial preferences from localStorage
  const loadPreferences = (): PagePreferences => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error(`Failed to load preferences for ${pageKey}:`, error);
    }
    return {
      viewMode: defaultViewMode,
      filterStatus: defaultFilterStatus,
      advancedFilters: {},
      searchQuery: "",
      sortBy: defaultSortBy,
      sortOrder: defaultSortOrder,
    };
  };

  const [preferences, setPreferences] = useState<PagePreferences>(loadPreferences);

  // Save preferences to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences));
    } catch (error) {
      console.error(`Failed to save preferences for ${pageKey}:`, error);
    }
  }, [preferences, storageKey, pageKey]);

  // Helper functions to update individual preferences
  const setViewMode = (viewMode: ViewMode) => {
    setPreferences((prev) => ({ ...prev, viewMode }));
  };

  const setFilterStatus = (filterStatus: string) => {
    setPreferences((prev) => ({ ...prev, filterStatus }));
  };

  const setAdvancedFilters = (advancedFilters: FilterState) => {
    setPreferences((prev) => ({ ...prev, advancedFilters }));
  };

  const setSearchQuery = (searchQuery: string) => {
    setPreferences((prev) => ({ ...prev, searchQuery }));
  };

  const setSortBy = (sortBy: string) => {
    setPreferences((prev) => ({ ...prev, sortBy }));
  };

  const setSortOrder = (sortOrder: "asc" | "desc") => {
    setPreferences((prev) => ({ ...prev, sortOrder }));
  };

  // Reset all preferences to defaults
  const resetPreferences = () => {
    const defaultPrefs: PagePreferences = {
      viewMode: defaultViewMode,
      filterStatus: defaultFilterStatus,
      advancedFilters: {},
      searchQuery: "",
      sortBy: defaultSortBy,
      sortOrder: defaultSortOrder,
    };
    setPreferences(defaultPrefs);
  };

  return {
    preferences,
    setViewMode,
    setFilterStatus,
    setAdvancedFilters,
    setSearchQuery,
    setSortBy,
    setSortOrder,
    resetPreferences,
    // Convenience getters
    viewMode: preferences.viewMode || defaultViewMode,
    filterStatus: preferences.filterStatus || defaultFilterStatus,
    advancedFilters: (preferences.advancedFilters || {}) as FilterState,
    searchQuery: preferences.searchQuery || "",
    sortBy: preferences.sortBy || defaultSortBy,
    sortOrder: preferences.sortOrder || defaultSortOrder,
  };
}
