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
import { useTerminology } from "@/hooks/useTerminology";

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
  user: _user,
  contractors,
  currentContractor,
  onContractorChange,
  onQuickAction,
}: AppSidebarProps) {
  const [location] = useLocation();
  const { setOpenMobile, isMobile } = useSidebar();

  // Shared terminology hook — single cache entry for the whole app
  const { data: terminology } = useTerminology();

  // Get menu items with custom terminology
  const menuItems = getMenuItems(terminology);
  const quickActions = getQuickActions(terminology);

  const visibleMenuItems = menuItems;

  const handleQuickAction = (action: string) => {
    console.log(`Quick action: ${action}`);
    onQuickAction?.(action);
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