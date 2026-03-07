import { useQuery } from "@tanstack/react-query";

export type UserSummary = {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
  contractorId: string;
  dialpadDefaultNumber?: string | null;
  canManageIntegrations?: boolean;
  createdAt: string;
};

export function useUsers() {
  return useQuery<UserSummary[]>({
    queryKey: ["/api/users"],
  });
}
