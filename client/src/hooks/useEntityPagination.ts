/**
 * useEntityPagination — generic paginated list hook.
 *
 * Eliminates the copy-pasted useInfiniteQuery + status-counts pattern that
 * existed independently in Leads.tsx, Jobs.tsx, and Estimates.tsx. Each page
 * had an identical block (~40 lines) for:
 *   - useInfiniteQuery with cursor, search, status, and advanced-filter params
 *   - A separate useQuery for status counts
 *   - Flattening infinite pages into a flat array of items
 *
 * Usage:
 * ```ts
 * const {
 *   items, totalItems, isLoading,
 *   hasNextPage, fetchNextPage, isFetchingNextPage,
 *   statusCounts, statusCountsLoading,
 * } = useEntityPagination<MyItem, MyPaginatedResponse>({
 *   paginatedKey: '/api/jobs/paginated',
 *   statusCountsKey: '/api/jobs/status-counts',
 *   filterStatus,
 *   searchQuery,
 *   advancedFilters,
 *   buildParams: (params, { filterStatus, searchQuery, advancedFilters }) => {
 *     if (filterStatus !== 'all') params.append('status', filterStatus);
 *     if (searchQuery) params.append('search', searchQuery);
 *   },
 *   buildStatusCountsParams: (params, { searchQuery }) => {
 *     if (searchQuery) params.append('search', searchQuery);
 *   },
 *   getNextPageParam: (lastPage) => lastPage.pagination.nextCursor,
 *   extractItems: (page) => page.data,
 *   extractTotal: (firstPage) => firstPage.pagination.total,
 * });
 * ```
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface AdvancedFilters {
  assignedTo?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

interface UseEntityPaginationOptions<TItem, TPage> {
  paginatedKey: string;
  statusCountsKey: string;
  filterStatus: string;
  searchQuery: string;
  advancedFilters?: AdvancedFilters;
  buildParams: (
    params: URLSearchParams,
    ctx: { filterStatus: string; searchQuery: string; advancedFilters?: AdvancedFilters }
  ) => void;
  buildStatusCountsParams: (
    params: URLSearchParams,
    ctx: { searchQuery: string }
  ) => void;
  getNextPageParam: (lastPage: TPage) => string | null | undefined;
  extractItems: (page: TPage) => TItem[];
  extractTotal: (firstPage: TPage) => number;
  enabled?: boolean;
}

export interface EntityPaginationResult<TItem> {
  items: TItem[];
  totalItems: number;
  isLoading: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isFetchingNextPage: boolean;
  statusCounts: Record<string, number>;
  statusCountsLoading: boolean;
}

export function useEntityPagination<TItem, TPage>({
  paginatedKey,
  statusCountsKey,
  filterStatus,
  searchQuery,
  advancedFilters,
  buildParams,
  buildStatusCountsParams,
  getNextPageParam,
  extractItems,
  extractTotal,
  enabled = true,
}: UseEntityPaginationOptions<TItem, TPage>): EntityPaginationResult<TItem> {
  const ctx = { filterStatus, searchQuery, advancedFilters };

  const {
    data,
    isLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: [paginatedKey, { status: filterStatus, search: searchQuery, ...advancedFilters }],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.append("cursor", pageParam as string);
      params.append("limit", "50");
      buildParams(params, ctx);
      return (await apiRequest("GET", `${paginatedKey}?${params}`)).json() as Promise<TPage>;
    },
    getNextPageParam,
    initialPageParam: null as string | null,
    enabled,
  });

  const { data: statusCountsData, isLoading: statusCountsLoading } = useQuery<Record<string, number>>({
    queryKey: [statusCountsKey, searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      buildStatusCountsParams(params, { searchQuery });
      return (await apiRequest("GET", `${statusCountsKey}?${params}`)).json();
    },
    enabled,
  });

  const items: TItem[] = data?.pages.flatMap(extractItems) ?? [];
  const totalItems = data?.pages[0] != null ? extractTotal(data.pages[0]) : 0;
  const statusCounts: Record<string, number> = statusCountsData ?? {};

  return {
    items,
    totalItems,
    isLoading,
    hasNextPage: hasNextPage ?? false,
    fetchNextPage,
    isFetchingNextPage,
    statusCounts,
    statusCountsLoading,
  };
}
