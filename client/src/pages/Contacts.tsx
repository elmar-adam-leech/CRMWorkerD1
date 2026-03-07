import { useState, useCallback } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/ui/page-header-v2";
import { PageLayout } from "@/components/ui/page-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { LoadMoreButton } from "@/components/LoadMoreButton";
import { EmptyState } from "@/components/EmptyState";
import { CardSkeleton } from "@/components/CardSkeleton";
import { Search, Mail, Phone, MapPin, Trash2, Users, Briefcase, FileText, BookUser, ExternalLink } from "lucide-react";
import { getInitials } from "@/lib/utils";
import { Link } from "wouter";
import type { Contact } from "@shared/schema";
import { useWebSocketInvalidation } from "@/hooks/useWebSocketInvalidation";

type ContactWithCounts = Contact & {
  leadCount: number;
  estimateCount: number;
  jobCount: number;
};

type ContactsPage = {
  data: ContactWithCounts[];
  pagination: { total: number; hasMore: boolean; nextCursor: string | null };
};

export default function Contacts() {
  const [searchQuery, setSearchQuery] = useState("");
  const [detailContact, setDetailContact] = useState<ContactWithCounts | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; contactId?: string; contactName?: string }>({ isOpen: false });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useWebSocketInvalidation([
    { types: ["contact_created", "contact_updated", "contact_deleted"], queryKeys: ["/api/contacts/with-counts"] },
  ]);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ["/api/contacts/with-counts", { search: searchQuery }],
    queryFn: async ({ pageParam }) => {
      const url = new URL("/api/contacts/with-counts", window.location.origin);
      if (searchQuery) url.searchParams.set("search", searchQuery);
      if (pageParam) url.searchParams.set("cursor", pageParam as string);
      url.searchParams.set("limit", "50");
      return (await apiRequest("GET", url.toString())).json() as Promise<ContactsPage>;
    },
    getNextPageParam: (lastPage: ContactsPage) => lastPage.pagination.nextCursor,
    initialPageParam: undefined as string | undefined,
  });

  const contacts = data?.pages.flatMap((p) => p.data) ?? [];
  const total = data?.pages[0]?.pagination.total ?? 0;

  const deleteMutation = useMutation({
    mutationFn: async (contactId: string) => {
      return apiRequest("DELETE", `/api/contacts/${contactId}`);
    },
    onSuccess: () => {
      toast({ title: "Contact Deleted", description: "The contact and all associated records have been permanently deleted." });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/with-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/status-counts"] });
      setDeleteConfirm({ isOpen: false });
      setDetailContact(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to Delete", description: error.message || "Something went wrong.", variant: "destructive" });
    },
  });

  const handleDelete = useCallback((contact: ContactWithCounts) => {
    setDeleteConfirm({ isOpen: true, contactId: contact.id, contactName: contact.name });
  }, []);

  return (
    <PageLayout>
      <PageHeader
        title="Contacts"
        description="All contacts across leads, estimates, and jobs"
      />

      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search contacts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-contacts"
          />
        </div>
        {!isLoading && (
          <span className="text-sm text-muted-foreground shrink-0">
            {total} contact{total !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }, (_, i) => <CardSkeleton key={i} />)}
        </div>
      )}

      {!isLoading && contacts.length === 0 && (
        <EmptyState
          icon={BookUser}
          title="No contacts found"
          description={searchQuery ? "Try a different search term" : "Contacts are created automatically when leads, estimates, or jobs are added"}
        />
      )}

      {!isLoading && contacts.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {contacts.map((contact) => (
            <Card
              key={contact.id}
              className="hover-elevate cursor-pointer"
              onClick={() => setDetailContact(contact)}
              data-testid={`card-contact-${contact.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarFallback>{getInitials(contact.name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{contact.name}</div>
                    {contact.emails?.[0] && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5 truncate">
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate">{contact.emails[0]}</span>
                      </div>
                    )}
                    {contact.phones?.[0] && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                        <Phone className="h-3 w-3 shrink-0" />
                        <span>{contact.phones[0]}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {contact.leadCount > 0 && (
                    <Badge variant="secondary" className="text-xs gap-1">
                      <Users className="h-3 w-3" />
                      {contact.leadCount} lead{contact.leadCount !== 1 ? "s" : ""}
                    </Badge>
                  )}
                  {contact.estimateCount > 0 && (
                    <Badge variant="secondary" className="text-xs gap-1">
                      <FileText className="h-3 w-3" />
                      {contact.estimateCount} estimate{contact.estimateCount !== 1 ? "s" : ""}
                    </Badge>
                  )}
                  {contact.jobCount > 0 && (
                    <Badge variant="secondary" className="text-xs gap-1">
                      <Briefcase className="h-3 w-3" />
                      {contact.jobCount} job{contact.jobCount !== 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <LoadMoreButton
        hasNextPage={hasNextPage ?? false}
        isFetchingNextPage={isFetchingNextPage}
        onLoadMore={() => fetchNextPage()}
      />

      {/* Contact Detail Sheet */}
      <Sheet open={!!detailContact} onOpenChange={(open) => { if (!open) setDetailContact(null); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {detailContact && (
            <>
              <SheetHeader className="mb-4">
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="text-lg">{getInitials(detailContact.name)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <SheetTitle>{detailContact.name}</SheetTitle>
                    <SheetDescription className="capitalize">
                      {detailContact.type} · {detailContact.status}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <div className="space-y-4">
                {/* Contact Info */}
                <div className="space-y-2">
                  {detailContact.emails?.map((email) => (
                    <div key={email} className="flex items-center gap-2 text-sm">
                      <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                      <a href={`mailto:${email}`} className="text-foreground hover:underline truncate">{email}</a>
                    </div>
                  ))}
                  {detailContact.phones?.map((phone) => (
                    <div key={phone} className="flex items-center gap-2 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span>{phone}</span>
                    </div>
                  ))}
                  {detailContact.address && (
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">{detailContact.address}</span>
                    </div>
                  )}
                  {detailContact.source && (
                    <div className="text-sm text-muted-foreground">Source: {detailContact.source}</div>
                  )}
                </div>

                <Separator />

                {/* Record Counts */}
                <div className="space-y-2">
                  <div className="text-sm font-medium">Records</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center p-3 rounded-md bg-muted">
                      <div className="text-lg font-semibold">{detailContact.leadCount}</div>
                      <div className="text-xs text-muted-foreground">Lead{detailContact.leadCount !== 1 ? "s" : ""}</div>
                    </div>
                    <div className="text-center p-3 rounded-md bg-muted">
                      <div className="text-lg font-semibold">{detailContact.estimateCount}</div>
                      <div className="text-xs text-muted-foreground">Estimate{detailContact.estimateCount !== 1 ? "s" : ""}</div>
                    </div>
                    <div className="text-center p-3 rounded-md bg-muted">
                      <div className="text-lg font-semibold">{detailContact.jobCount}</div>
                      <div className="text-xs text-muted-foreground">Job{detailContact.jobCount !== 1 ? "s" : ""}</div>
                    </div>
                  </div>
                </div>

                {/* Quick links */}
                <div className="space-y-2">
                  <div className="text-sm font-medium">Quick Links</div>
                  <div className="flex flex-col gap-1">
                    {detailContact.leadCount > 0 && (
                      <Link href={`/leads?search=${encodeURIComponent(detailContact.name)}`}>
                        <Button variant="outline" size="sm" className="w-full justify-start gap-2">
                          <Users className="h-4 w-4" />
                          View Leads
                          <ExternalLink className="h-3 w-3 ml-auto" />
                        </Button>
                      </Link>
                    )}
                    {detailContact.estimateCount > 0 && (
                      <Link href={`/estimates?search=${encodeURIComponent(detailContact.name)}`}>
                        <Button variant="outline" size="sm" className="w-full justify-start gap-2">
                          <FileText className="h-4 w-4" />
                          View Estimates
                          <ExternalLink className="h-3 w-3 ml-auto" />
                        </Button>
                      </Link>
                    )}
                    {detailContact.jobCount > 0 && (
                      <Link href={`/jobs?search=${encodeURIComponent(detailContact.name)}`}>
                        <Button variant="outline" size="sm" className="w-full justify-start gap-2">
                          <Briefcase className="h-4 w-4" />
                          View Jobs
                          <ExternalLink className="h-3 w-3 ml-auto" />
                        </Button>
                      </Link>
                    )}
                    <Link href={`/messages?contactId=${detailContact.id}`}>
                      <Button variant="outline" size="sm" className="w-full justify-start gap-2">
                        <Mail className="h-4 w-4" />
                        View Messages
                        <ExternalLink className="h-3 w-3 ml-auto" />
                      </Button>
                    </Link>
                  </div>
                </div>

                {detailContact.notes && (
                  <>
                    <Separator />
                    <div className="space-y-1">
                      <div className="text-sm font-medium">Notes</div>
                      <p className="text-sm text-muted-foreground">{detailContact.notes}</p>
                    </div>
                  </>
                )}

                <Separator />

                {/* Delete */}
                <div className="space-y-2">
                  <div className="text-sm font-medium text-destructive">Danger Zone</div>
                  <p className="text-xs text-muted-foreground">
                    Permanently deletes this contact along with all associated leads, estimates, jobs, messages, and activities. This cannot be undone.
                  </p>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    onClick={() => handleDelete(detailContact)}
                    data-testid={`button-delete-contact-${detailContact.id}`}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Contact Permanently
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <DeleteConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onOpenChange={(open) => setDeleteConfirm((prev) => ({ ...prev, isOpen: open }))}
        title="Delete Contact"
        description={`This will permanently delete "${deleteConfirm.contactName}" along with ALL associated leads, estimates, jobs, messages, and activity history. This cannot be undone.`}
        onConfirm={() => {
          if (deleteConfirm.contactId) deleteMutation.mutate(deleteConfirm.contactId);
        }}
        confirmTestId="button-confirm-delete-contact"
      />
    </PageLayout>
  );
}
