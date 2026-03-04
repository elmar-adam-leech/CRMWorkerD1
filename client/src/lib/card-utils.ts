import { apiRequest, queryClient } from "@/lib/queryClient";

export function getPriorityColor(priority: string): string {
  switch (priority) {
    case "high":
      return "border-l-4 border-l-destructive";
    case "medium":
      return "border-l-4 border-l-chart-3";
    default:
      return "border-l-4 border-l-chart-2";
  }
}

export async function updateContactTags(
  contactId: string,
  newTags: string[]
): Promise<void> {
  await apiRequest('PATCH', `/api/contacts/${contactId}`, { tags: newTags });
  queryClient.invalidateQueries({ queryKey: [`/api/contacts/${contactId}`] });
  queryClient.invalidateQueries({ queryKey: ['/api/contacts/paginated'] });
}
