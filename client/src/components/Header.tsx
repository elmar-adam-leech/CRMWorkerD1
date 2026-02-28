import { Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { UserMenu } from "./UserMenu";
import { ThemeToggle } from "./ThemeToggle";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { NotificationDropdown } from "./NotificationDropdown";

type HeaderProps = {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    avatar?: string;
  };
  onSearch?: (query: string) => void;
  onNewItem?: () => void;
};

export function Header({
  user,
  onSearch,
  onNewItem,
}: HeaderProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    console.log(`Searching for: ${value}`);
    onSearch?.(value);
  };

  const handleNewItem = () => {
    console.log("New item clicked");
    onNewItem?.();
  };

  const handleSettings = () => {
    console.log("Settings clicked");
    setLocation("/settings");
  };

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
      toast({
        title: "Logged out successfully",
        description: "You have been logged out of your account.",
      });
      // Reload the page to trigger redirect to login
      window.location.reload();
    } catch (error) {
      console.error("Logout error:", error);
      toast({
        title: "Logout failed",
        description: "Failed to log out. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <header className="flex items-center justify-between gap-2 sm:gap-4 border-b bg-background px-3 sm:px-4 py-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <SidebarTrigger data-testid="button-sidebar-toggle" />
          <div className="relative flex-1 max-w-xs sm:max-w-md hidden sm:block">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customers, jobs, or estimates..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-8"
              data-testid="input-search"
            />
          </div>
        </div>
        
        <div className="flex items-center gap-1 sm:gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="sm:hidden"
            onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
            data-testid="button-mobile-search"
          >
            <Search className="h-4 w-4" />
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={handleNewItem}
            data-testid="button-new-item"
            className="hidden sm:flex"
          >
            <Plus className="h-4 w-4 mr-1" />
            New
          </Button>
          
          <Button
            variant="outline"
            size="icon"
            onClick={handleNewItem}
            data-testid="button-new-item-mobile"
            className="sm:hidden"
          >
            <Plus className="h-4 w-4" />
          </Button>
          
          <NotificationDropdown />
          
          <ThemeToggle />
          
          <UserMenu user={user} onSettingsClick={handleSettings} onLogout={handleLogout} />
        </div>
      </header>
      
      {/* Mobile Search Bar */}
      {mobileSearchOpen && (
        <div className="border-b bg-background px-3 py-2 sm:hidden">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customers, jobs, or estimates..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-8"
              data-testid="input-mobile-search"
              autoFocus
            />
          </div>
        </div>
      )}
    </>
  );
}