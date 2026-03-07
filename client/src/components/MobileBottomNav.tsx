import { Link, useLocation } from "wouter";
import { Users, FileText, MessageSquare, Menu, BookUser } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

const tabs = [
  { href: "/leads", icon: Users, label: "Leads" },
  { href: "/estimates", icon: FileText, label: "Estimates" },
  { href: "/contacts", icon: BookUser, label: "Contacts" },
  { href: "/messages", icon: MessageSquare, label: "Messages" },
];

export function MobileBottomNav() {
  const isMobile = useIsMobile();
  const [location] = useLocation();

  if (!isMobile) return null;

  const handleMore = () => {
    const trigger = document.querySelector<HTMLButtonElement>('[data-testid="button-sidebar-toggle"]');
    trigger?.click();
  };

  const isActive = (href: string) => {
    return location.startsWith(href);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-sidebar border-t flex items-stretch"
      data-testid="mobile-bottom-nav"
    >
      {tabs.map(({ href, icon: Icon, label }) => (
        <Link
          key={href}
          href={href}
          className={`flex flex-col items-center justify-center flex-1 py-2 gap-1 text-xs transition-colors ${
            isActive(href)
              ? "text-sidebar-primary font-medium"
              : "text-sidebar-foreground/60"
          }`}
          data-testid={`bottom-nav-${label.toLowerCase()}`}
        >
          <Icon className="h-5 w-5" />
          <span>{label}</span>
        </Link>
      ))}
      <button
        onClick={handleMore}
        className="flex flex-col items-center justify-center flex-1 py-2 gap-1 text-xs text-sidebar-foreground/60 transition-colors"
        data-testid="bottom-nav-more"
        type="button"
      >
        <Menu className="h-5 w-5" />
        <span>More</span>
      </button>
    </nav>
  );
}
