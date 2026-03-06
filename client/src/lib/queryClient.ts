/**
 * queryClient.ts — global React Query client configuration and request helpers.
 *
 * Design decisions:
 *   - `staleTime: 5 * 60 * 1000` (5 minutes): cached data is served immediately
 *     without a background re-fetch for up to 5 minutes after it was last fetched.
 *     This prevents redundant network requests when the user switches between pages
 *     that share the same query key. Increase for rarely-changing data (e.g. settings),
 *     decrease (or set to 0) for data that must always be fresh.
 *
 *   - `gcTime: 30 * 60 * 1000` (30 minutes): inactive (unmounted) query results are
 *     kept in the in-memory cache for 30 minutes before being garbage-collected.
 *     Longer gcTime means faster perceived navigation (cache hit on revisit) at the
 *     cost of slightly more memory. Set to 0 to always discard on unmount.
 *
 *   - `refetchOnWindowFocus: false`: prevents automatic re-fetch when the browser tab
 *     regains focus. Re-fetching is instead driven by WebSocket events via
 *     `useWebSocketInvalidation`, which gives us precise invalidation on real changes.
 *
 *   - `retry: 1`: retry each failed query once before surfacing the error to the UI.
 *     Keeps the UX tolerable on transient network hiccups without masking persistent errors.
 */
import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

/**
 * Makes an authenticated HTTP request to the backend API.
 *
 * Use this in useMutation callbacks and imperative event handlers where you need
 * to send a POST/PATCH/PUT/DELETE and handle the Response object directly.
 *
 * Do NOT use this inside `useQuery`'s `queryFn` — the default queryFn from
 * `getQueryFn` is already configured on the global QueryClient and handles
 * GET requests automatically by joining the queryKey segments as a URL path.
 *
 * @param method - HTTP verb (GET, POST, PATCH, PUT, DELETE).
 * @param url    - Absolute path (e.g. `/api/contacts/123`).
 * @param data   - Optional JSON body. When provided, sets `Content-Type: application/json`.
 * @throws       - Throws an `Error` with the status code + message for non-2xx responses.
 * @returns      - The raw `Response` object. Call `.json()` on it to parse the body.
 */
export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      staleTime: 5 * 60 * 1000, // 5 minutes default
      gcTime: 30 * 60 * 1000, // 30 minutes garbage collection
      retry: 1, // Retry once on failure
    },
    mutations: {
      retry: false,
    },
  },
});
