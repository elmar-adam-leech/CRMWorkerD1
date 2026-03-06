import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWebSocketContext } from "@/contexts/WebSocketContext";

interface WebSocketRule {
  types: string[];
  queryKeys: string[];
}

/**
 * Subscribes to WebSocket events and automatically invalidates the specified
 * React Query cache keys whenever a matching event arrives.
 *
 * Usage:
 * ```ts
 * useWebSocketInvalidation([
 *   { types: ['new_job', 'job_updated', 'job_deleted'], queryKeys: ['/api/jobs/paginated'] },
 *   { types: ['job_status_changed'],                    queryKeys: ['/api/jobs/status-counts'] },
 * ]);
 * ```
 *
 * Why `rulesRef` instead of `rules` directly in the effect?
 *   The `rules` array is typically constructed inline at the call site
 *   (a new object reference on every render). If it were included in the effect's
 *   dependency array, the effect would re-subscribe on every render — creating
 *   and destroying WebSocket subscriptions in a tight loop.
 *
 *   Instead, we store `rules` in a ref (`rulesRef`) and keep it in sync by
 *   assigning `rulesRef.current = rules` on every render. The effect reads from
 *   the ref at call-time, so it always sees the latest rules without ever
 *   needing to re-subscribe. This is the "rules-as-ref" pattern.
 *
 * @param rules - Array of { types, queryKeys } pairs. Rules can be changed on
 *                every render without triggering a re-subscription.
 */
export function useWebSocketInvalidation(rules: WebSocketRule[]) {
  const { subscribe } = useWebSocketContext();
  const queryClient = useQueryClient();
  // rulesRef holds the latest rules without re-running the effect on every render.
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  useEffect(() => {
    const unsubscribe = subscribe((message: { type: string }) => {
      for (const rule of rulesRef.current) {
        if (rule.types.includes(message.type)) {
          rule.queryKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
        }
      }
    });
    return unsubscribe;
  }, [subscribe, queryClient]);
}
