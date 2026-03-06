import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, Search, Edit2, Trash2, MessageSquare, Mail, FileText, CheckCircle, XCircle, Clock, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header-v2";
import { PageLayout } from "@/components/ui/page-layout";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Template } from "@shared/schema";
import { useCurrentUser, isStrictAdmin } from "@/hooks/useCurrentUser";

const templateFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  type: z.enum(["text", "email"], { required_error: "Type is required" }),
  content: z.string().min(1, "Content is required"),
});

type TemplateFormData = z.infer<typeof templateFormSchema>;

export default function Templates() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "text" | "email">("all");
  const [templateModal, setTemplateModal] = useState<{
    isOpen: boolean;
    template?: Template;
    mode: "create" | "edit";
  }>({ isOpen: false, mode: "create" });
  
  const { toast } = useToast();

  // Fetch templates from API
  const { data: templates = [], isLoading: templatesLoading } = useQuery<Template[]>({
    queryKey: ['/api/templates', filterType === "all" ? undefined : filterType],
  });

  const form = useForm<TemplateFormData>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: {
      title: "",
      type: "text",
      content: "",
    },
  });

  // Create template mutation
  const createTemplateMutation = useMutation({
    mutationFn: (data: TemplateFormData) => 
      apiRequest("POST", "/api/templates", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/templates'] });
      setTemplateModal({ isOpen: false, mode: "create" });
      form.reset();
      toast({
        title: "Template created",
        description: "Your template has been created successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create template. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Update template mutation
  const updateTemplateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: TemplateFormData }) => 
      apiRequest("PUT", `/api/templates/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/templates'] });
      setTemplateModal({ isOpen: false, mode: "create" });
      form.reset();
      toast({
        title: "Template updated",
        description: "Your template has been updated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update template. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Delete template mutation
  const deleteTemplateMutation = useMutation({
    mutationFn: (id: string) => 
      apiRequest("DELETE", `/api/templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/templates'] });
      toast({
        title: "Template deleted",
        description: "Your template has been deleted successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete template. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Approve template mutation (admin only)
  const approveTemplateMutation = useMutation({
    mutationFn: (id: string) => 
      apiRequest("POST", `/api/templates/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/templates'] });
      toast({
        title: "Template approved",
        description: "Template is now available company-wide.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to approve template. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Reject template mutation (admin only)
  const rejectTemplateMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => 
      apiRequest("POST", `/api/templates/${id}/reject`, { rejectionReason: reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/templates'] });
      toast({
        title: "Template rejected",
        description: "Template creator has been notified.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to reject template. Please try again.",
        variant: "destructive",
      });
    },
  });

  const { data: currentUser } = useCurrentUser();
  const isAdmin = isStrictAdmin(currentUser?.user?.role);

  const handleOpenModal = (mode: "create" | "edit", template?: Template) => {
    if (mode === "edit" && template) {
      form.setValue("title", template.title);
      form.setValue("type", template.type as "text" | "email");
      form.setValue("content", template.content);
    } else {
      form.reset();
    }
    setTemplateModal({ isOpen: true, mode, template });
  };

  const handleCloseModal = () => {
    setTemplateModal({ isOpen: false, mode: "create" });
    form.reset();
  };

  const onSubmit = (data: TemplateFormData) => {
    if (templateModal.mode === "edit" && templateModal.template) {
      updateTemplateMutation.mutate({ id: templateModal.template.id, data });
    } else {
      createTemplateMutation.mutate(data);
    }
  };

  const handleDeleteTemplate = (id: string) => {
    if (window.confirm("Are you sure you want to delete this template?")) {
      deleteTemplateMutation.mutate(id);
    }
  };

  // Filter templates based on search and type
  const filteredTemplates = templates.filter((template) => {
    const matchesSearch = template.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         template.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === "all" || template.type === filterType;
    return matchesSearch && matchesType;
  });

  const getTypeIcon = (type: "text" | "email") => {
    return type === "text" ? MessageSquare : Mail;
  };

  const getTypeBadgeVariant = (type: "text" | "email") => {
    return type === "text" ? "default" : "secondary";
  };

  return (
    <PageLayout>
      <PageHeader
        title="Templates"
        description="Manage your text and email templates"
        icon={<FileText className="h-6 w-6" />}
        actions={
          <Button 
            onClick={() => handleOpenModal("create")}
            data-testid="button-create-template"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Template
          </Button>
        }
      />

      {/* Search and Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-templates"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant={filterType === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterType("all")}
            data-testid="filter-all"
          >
            All
          </Button>
          <Button
            variant={filterType === "text" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterType("text")}
            data-testid="filter-text"
          >
            <MessageSquare className="h-4 w-4 mr-1" />
            Text
          </Button>
          <Button
            variant={filterType === "email" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterType("email")}
            data-testid="filter-email"
          >
            <Mail className="h-4 w-4 mr-1" />
            Email
          </Button>
        </div>
      </div>

      {/* Templates Grid */}
      {templatesLoading ? (
        <div className="text-center py-8" data-testid="loading-templates">
          <div className="text-muted-foreground">Loading templates...</div>
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="text-center py-8" data-testid="no-templates">
          <div className="text-muted-foreground">
            {searchQuery || filterType !== "all" ? "No templates match your criteria" : "No templates found"}
          </div>
          {!searchQuery && filterType === "all" && (
            <Button 
              onClick={() => handleOpenModal("create")} 
              className="mt-4"
              data-testid="button-create-first-template"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create your first template
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredTemplates.map((template) => {
            const TypeIcon = getTypeIcon(template.type as "text" | "email");
            const templateAny = template as any;
            const status = templateAny.status || 'approved';
            const isPending = status === 'pending_approval';
            const isRejected = status === 'rejected';
            
            return (
              <Card 
                key={template.id} 
                className="hover-elevate"
                data-testid={`card-template-${template.id}`}
              >
                <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <TypeIcon className="h-4 w-4 shrink-0" />
                    <CardTitle className="text-base font-medium truncate">{template.title}</CardTitle>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleOpenModal("edit", template)}
                      data-testid={`button-edit-template-${template.id}`}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteTemplate(template.id)}
                      data-testid={`button-delete-template-${template.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge 
                        variant={getTypeBadgeVariant(template.type as "text" | "email")}
                        data-testid={`badge-template-type-${template.id}`}
                      >
                        {template.type.toUpperCase()}
                      </Badge>
                      {isPending && (
                        <Badge variant="outline" className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Pending
                        </Badge>
                      )}
                      {isRejected && (
                        <Badge variant="destructive" className="flex items-center gap-1">
                          <XCircle className="h-3 w-3" />
                          Rejected
                        </Badge>
                      )}
                      {status === 'approved' && (
                        <Badge variant="default" className="flex items-center gap-1 bg-green-600">
                          <CheckCircle className="h-3 w-3" />
                          Approved
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(template.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground line-clamp-3">
                    {template.content}
                  </div>
                  {isRejected && templateAny.rejectionReason && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        <strong>Rejection reason:</strong> {templateAny.rejectionReason}
                      </AlertDescription>
                    </Alert>
                  )}
                  {isPending && isAdmin && (
                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        onClick={() => approveTemplateMutation.mutate(template.id)}
                        disabled={approveTemplateMutation.isPending}
                        data-testid={`button-approve-${template.id}`}
                        className="flex-1"
                      >
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const reason = prompt("Enter rejection reason:");
                          if (reason) {
                            rejectTemplateMutation.mutate({ id: template.id, reason });
                          }
                        }}
                        disabled={rejectTemplateMutation.isPending}
                        data-testid={`button-reject-${template.id}`}
                        className="flex-1"
                      >
                        <XCircle className="h-3 w-3 mr-1" />
                        Reject
                      </Button>
                    </div>
                  )}
                  {isPending && !isAdmin && (
                    <Alert>
                      <Clock className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        This template is pending admin approval before it becomes available company-wide.
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Template Modal */}
      <Dialog open={templateModal.isOpen} onOpenChange={handleCloseModal}>
        <DialogContent className="sm:max-w-[500px]" data-testid="modal-template">
          <DialogHeader>
            <DialogTitle>
              {templateModal.mode === "create" ? "Create Template" : "Edit Template"}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Enter template title..." 
                        {...field} 
                        data-testid="input-template-title"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-template-type">
                          <SelectValue placeholder="Select template type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="text" data-testid="select-type-text">
                          <div className="flex items-center gap-2">
                            <MessageSquare className="h-4 w-4" />
                            Text Message
                          </div>
                        </SelectItem>
                        <SelectItem value="email" data-testid="select-type-email">
                          <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4" />
                            Email
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="content"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Content</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Enter template content..."
                        rows={6}
                        {...field}
                        data-testid="textarea-template-content"
                      />
                    </FormControl>
                    <FormDescription>
                      You can use variables like {"{"}customerName{"}"}, {"{"}companyName{"}"}, etc.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex gap-2 pt-4">
                <Button
                  type="submit"
                  disabled={createTemplateMutation.isPending || updateTemplateMutation.isPending}
                  data-testid="button-save-template"
                >
                  {templateModal.mode === "create" ? "Create Template" : "Update Template"}
                </Button>
                <Button type="button" variant="outline" onClick={handleCloseModal}>
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}