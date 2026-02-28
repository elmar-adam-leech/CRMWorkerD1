import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SyncStatusProvider } from "@/hooks/use-sync-status";
import { WebSocketProvider } from "@/contexts/WebSocketContext";
import { BulkSelectionProvider } from "@/contexts/BulkSelectionContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { LoginForm } from "@/components/LoginForm";
import { RefreshBanner } from "@/components/ui/refresh-banner";
import { useAppVersion } from "@/hooks/use-app-version";
import { useState, useEffect } from "react";

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
import AIMonitor from "@/pages/AI-Monitor";
import WorkflowBuilder from "@/pages/WorkflowBuilder";
import WorkflowExecutions from "@/pages/WorkflowExecutions";
import WorkflowsList from "@/pages/WorkflowsList";
import SignUp from "@/pages/SignUp";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import UserManagement from "@/pages/UserManagement";
import EnhancedDialpadSetup from "@/pages/EnhancedDialpadSetup";
import PublicBooking from "@/pages/PublicBooking";
import NotFound from "@/pages/not-found";

function Router({ isAuthenticated, onLogin, isLoading, loginError }: { 
  isAuthenticated: boolean; 
  onLogin: (credentials: { email: string; password: string }) => void;
  isLoading: boolean;
  loginError: string;
}) {
  return (
    <Switch>
      {/* Public routes */}
      <Route path="/" component={() => isAuthenticated ? <Dashboard /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/login" component={() => isAuthenticated ? <Dashboard /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/signup" component={SignUp} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/book/:slug" component={PublicBooking} />
      
      {/* Protected routes - redirect to login if not authenticated */}
      <Route path="/leads" component={() => isAuthenticated ? <Leads /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/follow-ups" component={() => isAuthenticated ? <FollowUps /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/estimates" component={() => isAuthenticated ? <Estimates /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/jobs" component={() => isAuthenticated ? <Jobs /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/templates" component={() => isAuthenticated ? <Templates /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/messages" component={() => isAuthenticated ? <Messages /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/workflows/manage" component={() => isAuthenticated ? <WorkflowsList /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/workflows/new" component={() => isAuthenticated ? <WorkflowBuilder /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/workflows/:id/edit" component={() => isAuthenticated ? <WorkflowBuilder /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/workflows/:id/executions" component={() => isAuthenticated ? <WorkflowExecutions /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/workflows" component={() => isAuthenticated ? <WorkflowBuilder /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/reports" component={() => isAuthenticated ? <Reports /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/ai-monitor" component={() => isAuthenticated ? <AIMonitor /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/settings" component={() => isAuthenticated ? <Settings /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/users" component={() => isAuthenticated ? <UserManagement /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/dialpad-setup" component={() => isAuthenticated ? <EnhancedDialpadSetup /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route path="/enhanced-dialpad-setup" component={() => isAuthenticated ? <EnhancedDialpadSetup /> : <LoginForm onLogin={onLogin} isLoading={isLoading} error={loginError} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [isInitializing, setIsInitializing] = useState(true);
  const [user, setUser] = useState<{
    id: string;
    name: string;
    email: string;
    role: string;
    contractorId: string;
  } | null>(null);
  
  // App version and refresh functionality
  const { showRefreshBanner, handleRefresh, handleDismiss } = useAppVersion();

  // User contractors - will be fetched from API
  const [userContractors, setUserContractors] = useState<any[]>([]);
  const [currentContractor, setCurrentContractor] = useState<any | null>(null);

  // Fetch user contractors when authenticated
  useEffect(() => {
    if (isAuthenticated && user) {
      const fetchContractors = async () => {
        try {
          const response = await fetch('/api/user/contractors', {
            method: 'GET',
            credentials: 'include',
          });
          
          if (response.ok) {
            const contractorData = await response.json();
            setUserContractors(contractorData);
            
            // Set current contractor from the list
            if (contractorData.length > 0 && user.contractorId) {
              const current = contractorData.find((c: any) => c.contractorId === user.contractorId);
              if (current) {
                setCurrentContractor({
                  id: current.contractor.id,
                  name: current.contractor.name,
                  domain: current.contractor.domain,
                  role: current.role
                });
              }
            }
          }
        } catch (error) {
          console.error("Failed to fetch contractors:", error);
        }
      };
      
      fetchContractors();
    }
  }, [isAuthenticated, user]);
  
  // Check if user is already authenticated on app load
  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          method: 'GET',
          credentials: 'include', // Include HTTP-only cookies
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log("Already authenticated:", data);
          setUser(data.user);
          setIsAuthenticated(true);
        } else {
          // Not authenticated, that's fine
          setUser(null);
          setIsAuthenticated(false);
        }
      } catch (error) {
        console.log("Auth check failed:", error);
        setUser(null);
        setIsAuthenticated(false);
      } finally {
        setIsInitializing(false);
      }
    };

    checkAuthStatus();
  }, []);

  const handleLogin = async (credentials: { email: string; password: string }) => {
    console.log("Login attempt:", credentials);
    setIsLoading(true);
    setLoginError("");
    
    try {
      // First check if demo credentials, if so create user
      if (credentials.email === "demo@example.com" && credentials.password === "demo") {
        // Try to create demo user if doesn't exist (registration will fail if user exists, that's ok)
        try {
          await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
              username: 'demo',
              password: 'demo',
              name: 'Demo User',
              email: 'demo@example.com',
              role: 'admin',
              contractorName: 'Demo Company'
            }),
          });
        } catch {
          // User might already exist, continue with login
        }
      }

      // Now attempt login
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include cookies for HTTP-only token
        body: JSON.stringify({
          email: credentials.email,
          password: credentials.password,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log("Login successful", data);
        setUser(data.user);
        setIsAuthenticated(true);
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

  const handleContractorChange = async (contractor: any) => {
    console.log("Switching to contractor:", contractor);
    
    try {
      const response = await fetch('/api/user/switch-contractor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ contractorId: contractor.id }),
      });
      
      if (response.ok) {
        // Reload the page to refresh all data with the new contractor context
        window.location.reload();
      } else {
        console.error("Failed to switch contractor");
      }
    } catch (error) {
      console.error("Error switching contractor:", error);
    }
  };

  const handleSearch = (query: string) => {
    console.log("Global search:", query);
  };

  const [, setLocation] = useLocation();
  
  const handleQuickAction = (action: string) => {
    console.log("🚀 Quick action triggered:", action);
    // Navigate to the appropriate page with a URL parameter to trigger the modal
    switch (action) {
      case "create-lead":
        console.log("🚀 Navigating to /leads?add=true");
        setLocation("/leads?add=true");
        break;
      case "create-estimate":
        console.log("🚀 Navigating to /estimates?add=true");
        setLocation("/estimates?add=true");
        break;
      case "create-job":
        console.log("🚀 Navigating to /jobs?add=true");
        setLocation("/jobs?add=true");
        break;
      default:
        console.log("Unknown action:", action);
    }
  };

  // Show initialization loading state
  if (isInitializing) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <div className="min-h-screen bg-background flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading...</p>
            </div>
          </div>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  // Render with or without dashboard layout based on authentication
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WebSocketProvider>
          {isAuthenticated && user ? (
            <SyncStatusProvider>
              <BulkSelectionProvider>
                {/* Refresh banner for cached content detection */}
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
                  role: uc.role
                }))}
                currentContractor={currentContractor || {
                  id: user.contractorId,
                  name: 'Loading...',
                  domain: '',
                  role: user.role
                }}
                onContractorChange={handleContractorChange}
                onSearch={handleSearch}
                onQuickAction={handleQuickAction}
              >
                <Router 
                  isAuthenticated={isAuthenticated} 
                  onLogin={handleLogin} 
                  isLoading={isLoading} 
                  loginError={loginError} 
                />
              </DashboardLayout>
              <Toaster />
              </BulkSelectionProvider>
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
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;