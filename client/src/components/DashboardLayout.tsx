import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Header } from "./Header";
import { ThemeProvider } from "./ThemeProvider";
import { CommandPalette } from "./CommandPalette";
import { useTerminology } from "@/hooks/useTerminology";

type DashboardLayoutProps = {
  children: React.ReactNode;
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
  onSearch?: (query: string) => void;
  onQuickAction?: (action: string) => void;
};

export function DashboardLayout({
  children,
  user,
  contractors,
  currentContractor,
  onContractorChange,
  onSearch,
  onQuickAction,
}: DashboardLayoutProps) {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  // Shared terminology hook — single cache entry for the whole app
  const { data: terminology } = useTerminology();

  return (
    <ThemeProvider defaultTheme="light" storageKey="crm-theme">
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex h-screen w-full">
          <AppSidebar
            user={user}
            contractors={contractors}
            currentContractor={currentContractor}
            onContractorChange={onContractorChange}
            onQuickAction={onQuickAction}
          />
          <div className="flex flex-col flex-1 min-w-0">
            <Header
              user={user}
              onSearch={onSearch}
            />
            <main className="flex-1 overflow-auto bg-background">
              {children}
            </main>
          </div>
        </div>
        {/* Global Command Palette (Cmd+K) */}
        <CommandPalette terminology={terminology} />
      </SidebarProvider>
    </ThemeProvider>
  );
}