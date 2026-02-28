import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWebSocketContext } from '@/contexts/WebSocketContext';
import type { Message } from '@shared/schema';

export interface EmailThreadParams {
  contactType: 'lead' | 'customer' | 'estimate';
  contactId: string;
  enabled?: boolean;
}

export interface EmailThreadResult {
  messages: Message[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Custom hook for fetching and managing email message threads
 * Handles both fetching email messages and real-time WebSocket updates
 * Supports leads, customers, and estimates
 * 
 * @param params - Contact type and ID to fetch email messages for
 * @returns Email messages, loading state, error state, and refetch function
 */
export function useEmailThread({ contactType, contactId, enabled = true }: EmailThreadParams): EmailThreadResult {
  const queryClient = useQueryClient();
  const { subscribe } = useWebSocketContext();

  // Fetch email messages for this contact (will be filtered to email type in component)
  const { data: messages = [], isLoading, error, refetch } = useQuery<Message[]>({
    queryKey: ['/api/conversations', contactId, contactType],
    queryFn: async () => {
      const response = await fetch(`/api/conversations/${contactId}/${contactType}`);
      if (!response.ok) throw new Error('Failed to fetch messages');
      return response.json();
    },
    enabled: enabled && !!contactId,
  });

  // Subscribe to WebSocket for real-time updates
  useEffect(() => {
    if (!enabled || !contactId) return;

    const unsubscribe = subscribe((message: any) => {
      // When a new message arrives for this contact, refresh
      if (message.type === 'new_message' || message.type === 'message_update' || message.type === 'message_updated') {
        // WebSocket messages include contactId and contactType properties
        if (message.contactId === contactId && message.contactType === contactType) {
          queryClient.invalidateQueries({
            queryKey: ['/api/conversations', contactId, contactType]
          });
        }
      }
    });

    return unsubscribe;
  }, [subscribe, contactId, contactType, enabled, queryClient]);

  return {
    messages,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}
