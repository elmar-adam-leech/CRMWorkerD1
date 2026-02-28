import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWebSocketContext } from '@/contexts/WebSocketContext';
import type { Message } from '@shared/schema';

export interface SmsThreadParams {
  contactType?: 'lead' | 'customer' | 'estimate'; // Optional for backwards compatibility
  contactId: string;
  enabled?: boolean;
}

export interface SmsThreadResult {
  messages: Message[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Custom hook for fetching and managing SMS message threads
 * Handles both fetching messages and real-time WebSocket updates
 * Supports leads, customers, and estimates
 * 
 * @param params - Contact type and ID to fetch messages for
 * @returns Messages, loading state, error state, and refetch function
 */
export function useSmsThread({ contactType, contactId, enabled = true }: SmsThreadParams): SmsThreadResult {
  const queryClient = useQueryClient();
  const { subscribe } = useWebSocketContext();

  // Fetch messages for this contact
  // Use contactId-only endpoint if contactType is not provided (unified contacts API)
  const endpoint = contactType 
    ? `/api/conversations/${contactId}/${contactType}`
    : `/api/conversations/${contactId}`;
  
  const { data: messages = [], isLoading, error, refetch } = useQuery<Message[]>({
    queryKey: contactType 
      ? ['/api/conversations', contactId, contactType]
      : ['/api/conversations', contactId],
    queryFn: async () => {
      const response = await fetch(endpoint);
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
        // WebSocket messages include contactId (and optionally contactType for backwards compatibility)
        const matchesContact = message.contactId === contactId;
        const matchesType = !contactType || message.contactType === contactType;
        
        if (matchesContact && matchesType) {
          queryClient.invalidateQueries({
            queryKey: contactType 
              ? ['/api/conversations', contactId, contactType]
              : ['/api/conversations', contactId]
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
