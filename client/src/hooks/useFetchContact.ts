import type { Contact } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export function useFetchContact() {
  const { toast } = useToast();

  const fetchContact = async (contactId: string): Promise<Contact | null> => {
    const response = await fetch(`/api/contacts/${contactId}`, { credentials: "include" });
    if (!response.ok) {
      toast({
        title: "Error",
        description: "Failed to load contact information",
        variant: "destructive",
      });
      return null;
    }
    return response.json() as Promise<Contact>;
  };

  return { fetchContact };
}
