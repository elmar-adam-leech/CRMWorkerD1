import { useQuery } from "@tanstack/react-query";

export interface CurrentUser {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
  contractorId: string;
  dialpadDefaultNumber?: string;
  gmailConnected?: boolean;
  gmailEmail?: string;
  canManageIntegrations: boolean;
}

export interface CurrentUserResponse {
  user: CurrentUser;
}

/**
 * Hook to access the current authenticated user's data.
 * This data is cached at the app level and reused across all components.
 */
export function useCurrentUser() {
  return useQuery<CurrentUserResponse>({
    queryKey: ['/api/auth/me'],
    queryFn: async () => {
      const response = await fetch('/api/auth/me', {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch user info');
      }
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes (formerly cacheTime)
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
