import { useQuery } from "@tanstack/react-query";

export type UserSummary = { id: string; fullName: string };

export function useUsers() {
  return useQuery<UserSummary[]>({
    queryKey: ["/api/users"],
  });
}
