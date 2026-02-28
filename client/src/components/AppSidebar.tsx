import {
  LayoutDashboard,
  Users,
  Briefcase,
  Calendar,
  MessageSquare,
  Settings,
  BarChart3,
  Plus,
  FileText,
  Brain,
  Workflow,
  Clock,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { ContractorSwitcher } from "./TenantSwitcher";
import { useLocation, Link } from "wouter";
import { useQueryClient, useQuery } from "@tanstack/react-query";

// Default menu item structure (will be customized with terminology)
const getMenuItems = (terminology?: any) => [
  {
    title: "Dashboard",
    url: "/",
    icon: LayoutDashboard,
  },
  {
    title: terminology?.leadsLabel || "Leads",
    url: "/leads",
    icon: Users,
  },
  {
    title: terminology?.estimatesLabel || "Estimates",
    url: "/estimates",
    icon: Calendar,
  },
  {
    title: terminology?.jobsLabel || "Jobs",
    url: "/jobs",
    icon: Briefcase,
  },
  {
    title: "Follow-Ups",
    url: "/follow-ups",
    icon: Clock,
  },
  {
    title: terminology?.messagesLabel || "Messages",
    url: "/messages",
    icon: MessageSquare,
  },
  {
    title: terminology?.templatesLabel || "Templates",
    url: "/templates",
    icon: FileText,
  },
  {
    title: "Workflows",
    url: "/workflows/manage",
    icon: Workflow,
  },
  {
    title: "Reports",
    url: "/reports",
    icon: BarChart3,
  },
  {
    title: "AI Monitor",
    url: "/ai-monitor",
    icon: Brain,
  },
];

const getQuickActions = (terminology?: any) => [
  {
    title: `New ${terminology?.leadLabel || "Lead"}`,
    action: "create-lead",
    icon: Users,
  },
  {
    title: `New ${terminology?.estimateLabel || "Estimate"}`,
    action: "create-estimate", 
    icon: Calendar,
  },
  {
    title: `New ${terminology?.jobLabel || "Job"}`,
    action: "create-job",
    icon: Briefcase,
  },
];

type AppSidebarProps = {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    avatar?: string;
  };
  contractors: any[];
  currentContractor: any;
  onContractorChange: (contractor: any) => void;
  onQuickAction?: (action: string) => void;
};

export function AppSidebar({
  user,
  contractors,
  currentContractor,
  onContractorChange,
  onQuickAction,
}: AppSidebarProps) {
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const { setOpenMobile, isMobile } = useSidebar();

  // Fetch terminology settings
  const { data: terminology } = useQuery<any>({
    queryKey: ['/api/terminology'],
  });

  // Get menu items with custom terminology
  const menuItems = getMenuItems(terminology);
  const quickActions = getQuickActions(terminology);

  // Filter menu items based on user role
  const visibleMenuItems = menuItems.filter(item => {
    // AI Monitor is only visible to admin and manager roles
    if (item.url === '/ai-monitor') {
      return user.role === 'admin' || user.role === 'manager' || user.role === 'super_admin';
    }
    return true;
  });

  const handleQuickAction = (action: string) => {
    console.log(`Quick action: ${action}`);
    onQuickAction?.(action);
  };

  // Debounced prefetch data on hover for faster navigation
  const handleNavHover = (url: string) => {
    // Debounce prefetching to avoid spamming slow endpoints on casual hovers
    setTimeout(() => {
      switch (url) {
        case '/':
          queryClient.prefetchQuery({ queryKey: ['/api/dashboard/metrics'] });
          queryClient.prefetchQuery({ queryKey: ['/api/contacts', { type: 'customer' }] });
          break;
        case '/leads':
          queryClient.prefetchQuery({ queryKey: ['/api/contacts', { type: 'lead' }] });
          break;
        case '/estimates':
          queryClient.prefetchQuery({ queryKey: ['/api/estimates'] });
          break;
        case '/jobs':
          queryClient.prefetchQuery({ queryKey: ['/api/jobs'] });
          break;
        case '/templates':
          queryClient.prefetchQuery({ queryKey: ['/api/templates'] });
          break;
        case '/messages':
          queryClient.prefetchQuery({ queryKey: ['/api/messages'] });
          break;
      }
    }, 200); // 200ms debounce delay
  };

  // Close mobile sidebar when navigation link is clicked
  const handleNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  return (
    <Sidebar>
      {contractors.length > 1 && (
        <SidebarHeader className="border-b p-4">
          <ContractorSwitcher
            contractors={contractors}
            currentContractor={currentContractor}
            onContractorChange={onContractorChange}
          />
        </SidebarHeader>
      )}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleMenuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={`nav-${item.title.toLowerCase()}`}
                  >
                    <Link 
                      href={item.url}
                      onMouseEnter={() => handleNavHover(item.url)}
                      onClick={handleNavClick}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        
        <SidebarGroup>
          <SidebarGroupLabel>Quick Actions</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="space-y-2 px-2">
              {quickActions.map((action) => (
                <Button
                  key={action.action}
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => handleQuickAction(action.action)}
                  data-testid={`quick-${action.action}`}
                >
                  <Plus className="mr-2 h-3 w-3" />
                  {action.title}
                </Button>
              ))}
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      
      <SidebarFooter className="border-t">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild data-testid="nav-settings">
              <Link href="/settings" onClick={handleNavClick}>
                <Settings />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}