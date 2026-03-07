import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SyncStatusProvider } from "@/hooks/use-sync-status";
import { WebSocketProvider } from "@/contexts/WebSocketContext";
import { BulkSelectionProvider } from "@/contexts/BulkSelectionContext";
import { TerminologyProvider } from "@/contexts/TerminologyContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { LoginForm } from "@/components/LoginForm";
import { RefreshBanner } from "@/components/ui/refresh-banner";
import { useAppVersion } from "@/hooks/use-app-version";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { ContractorMembership, ActiveContractor } from "@/types/contractor";

// Import pages
import Dashboard from "@/pages/Dashboard";
import Leads from "@/pages/Leads";
import FollowUps from "@/pages/Follow-ups";
import Estimates from "@/pages/Estimates";
import Jobs from "@/pages/Jobs";
import Templates from "@/pages/Templates";
import Messages from "@/pages/Messages";
import Reports from "@/pages/Reports";
import Settings from "@/pages/Settings";
import WorkflowBuilder from "@/pages/WorkflowBuilder";
import WorkflowExecutions from "@/pages/WorkflowExecutions";
import WorkflowsList from "@/pages/WorkflowsList";
import SignUp from "@/pages/SignUp";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import UserManagement from "@/pages/UserManagement";
import EnhancedDialpadSetup from "@/pages/EnhancedDialpadSetup";
import PublicBooking from "@/pages/PublicBooking";
import Contacts from "@/pages/Contacts";
import NotFound from "@/pages/not-found";

function Router({ isAuthenticated, onLogin, isLoading, loginError, globalSearch = "" }: { 
  isAuthenticated: boolean; 
  onLogin: (credentials: { email: string; password: string }) => void;
  isLoading: boolean;
  loginError: string;
  globalSearch?: string;
}) {
  const loginFallback = <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />;
  return (
    <Switch>
      {/* Public routes */}
      <Route path="/" component={() => isAuthenticated ? <Dashboard /> : loginFallback} />
      <Route path="/login" component={() => isAuthenticated ? <Dashboard /> : loginFallback} />
      <Route path="/signup" component={SignUp} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/book/:slug" component={PublicBooking} />
      
      {/* Protected routes - redirect to login if not authenticated */}
      <Route path="/contacts" component={() => isAuthenticated ? <Contacts /> : loginFallback} />
      <Route path="/leads" component={() => isAuthenticated ? <Leads externalSearch={globalSearch} /> : loginFallback} />
      <Route path="/follow-ups" component={() => isAuthenticated ? <FollowUps /> : loginFallback} />
      <Route path="/estimates" component={() => isAuthenticated ? <Estimates externalSearch={globalSearch} /> : loginFallback} />
      <Route path="/jobs" component={() => isAuthenticated ? <Jobs externalSearch={globalSearch} /> : loginFallback} />
      <Route path="/templates" component={() => isAuthenticated ? <Templates /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/messages" component={() => isAuthenticated ? <Messages /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/workflows/manage" component={() => isAuthenticated ? <WorkflowsList /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/workflows/new" component={() => isAuthenticated ? <WorkflowBuilder /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/workflows/:id/edit" component={() => isAuthenticated ? <WorkflowBuilder /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/workflows/:id/executions" component={() => isAuthenticated ? <WorkflowExecutions /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/workflows" component={() => isAuthenticated ? <WorkflowBuilder /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/reports" component={() => isAuthenticated ? <Reports /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/settings" component={() => isAuthenticated ? <Settings /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/users" component={() => isAuthenticated ? <UserManagement /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/dialpad-setup" component={() => isAuthenticated ? <EnhancedDialpadSetup /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/enhanced-dialpad-setup" component={() => isAuthenticated ? <EnhancedDialpadSetup /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

/**
 * AppInner — rendered inside QueryClientProvider so hooks like useCurrentUser
 * and useToast have access to the React Query client and toast context.
 *
 * Auth strategy: useCurrentUser calls /api/auth/me via React Query (5-minute
 * staleTime, retry:1). This is the single canonical fetch — all other
 * components that call useCurrentUser share the same cache entry and never
 * make a duplicate network request. Previously, App.tsx had a raw fetch()
 * inside a useEffect that did NOT populate the React Query cache, causing
 * at least two /api/auth/me requests on every hard refresh.
 */
function AppInner() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  // Single source of truth for the authenticated user.
  // isLoading is true only during the initial /api/auth/me fetch.
  // All other components that call useCurrentUser share this same cache entry.
  const { data: currentUserData, isLoading: isInitializing } = useCurrentUser();
  const user = currentUserData?.user ?? null;
  const isAuthenticated = !!user;

  // App version and refresh functionality
  const { showRefreshBanner, handleRefresh, handleDismiss } = useAppVersion();

  // User contractors - fetched from API once the user is known
  const [userContractors, setUserContractors] = useState<ContractorMembership[]>([]);
  const [currentContractor, setCurrentContractor] = useState<ActiveContractor | null>(null);

  useEffect(() => {
    if (!user) return;
    const fetchContractors = async () => {
      try {
        const response = await fetch('/api/user/contractors', {
          method: 'GET',
          credentials: 'include',
        });
        if (response.ok) {
          const contractorData = await response.json();
          setUserContractors(contractorData);
          if (contractorData.length > 0 && user.contractorId) {
            const current = contractorData.find((c: ContractorMembership) => c.contractorId === user.contractorId);
            if (current) {
              setCurrentContractor({
                id: current.contractor.id,
                name: current.contractor.name,
                domain: current.contractor.domain,
                role: current.role,
              });
            }
          }
        }
      } catch (error) {
        console.error("Failed to fetch contractors:", error);
      }
    };
    fetchContractors();
  }, [user?.id]);

  const handleLogin = async (credentials: { email: string; password: string }) => {
    setIsLoading(true);
    setLoginError("");
    
    try {
      if (credentials.email === "demo@example.com" && credentials.password === "demo") {
        try {
          await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              username: 'demo',
              password: 'demo',
              name: 'Demo User',
              email: 'demo@example.com',
              role: 'admin',
              contractorName: 'Demo Company',
            }),
          });
        } catch {
          // User might already exist, continue with login
        }
      }

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: credentials.email, password: credentials.password }),
      });

      if (response.ok) {
        // Invalidate the React Query cache so useCurrentUser refetches with
        // the new session cookie, which triggers a re-render for all consumers.
        queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
      } else {
        const errorData = await response.json();
        setLoginError(errorData.message || "Login failed");
      }
    } catch (error) {
      console.error("Login error:", error);
      setLoginError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleContractorChange = async (contractor: ActiveContractor) => {
    try {
      const response = await fetch('/api/user/switch-contractor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ contractorId: contractor.id }),
      });
      if (response.ok) {
        window.location.reload();
      } else {
        toast({
          title: "Failed to switch account",
          description: "Could not switch to the selected account. Please refresh the page and try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error switching contractor:", error);
      toast({
        title: "Failed to switch account",
        description: "A network error occurred. Please refresh the page and try again.",
        variant: "destructive",
      });
    }
  };

  const [globalSearch, setGlobalSearch] = useState("");
  const handleSearch = (query: string) => setGlobalSearch(query);

  const [, setLocation] = useLocation();
  const handleQuickAction = (action: string) => {
    switch (action) {
      case "create-lead":      setLocation("/leads?add=true");     break;
      case "create-estimate":  setLocation("/estimates?add=true"); break;
      case "create-job":       setLocation("/jobs?add=true");      break;
    }
  };

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <WebSocketProvider>
      {isAuthenticated && user ? (
        <SyncStatusProvider>
          <TerminologyProvider>
          <BulkSelectionProvider>
            {showRefreshBanner && (
              <RefreshBanner
                onRefresh={handleRefresh}
                onDismiss={handleDismiss}
              />
            )}
            <DashboardLayout
              user={user}
              contractors={userContractors.map(uc => ({
                id: uc.contractor.id,
                name: uc.contractor.name,
                domain: uc.contractor.domain,
                role: uc.role,
              }))}
              currentContractor={currentContractor || {
                id: user.contractorId,
                name: 'Loading...',
                domain: '',
                role: user.role,
              }}
              onContractorChange={handleContractorChange}
              onSearch={handleSearch}
              onQuickAction={handleQuickAction}
            >
              <ErrorBoundary fallbackTitle="Page error">
                <Router
                  isAuthenticated={isAuthenticated}
                  onLogin={handleLogin}
                  isLoading={isLoading}
                  loginError={loginError}
                  globalSearch={globalSearch}
                />
              </ErrorBoundary>
            </DashboardLayout>
            <MobileBottomNav />
            <Toaster />
          </BulkSelectionProvider>
          </TerminologyProvider>
        </SyncStatusProvider>
      ) : (
        <>
          <Router
            isAuthenticated={isAuthenticated}
            onLogin={handleLogin}
            isLoading={isLoading}
            loginError={loginError}
          />
          <Toaster />
        </>
      )}
    </WebSocketProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppInner />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;