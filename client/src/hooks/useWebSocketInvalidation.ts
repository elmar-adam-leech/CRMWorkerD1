import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWebSocketContext } from "@/contexts/WebSocketContext";

interface WebSocketRule {
  types: string[];
  queryKeys: string[];
}

export function useWebSocketInvalidation(rules: WebSocketRule[]) {
  const { subscribe } = useWebSocketContext();
  const queryClient = useQueryClient();
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
