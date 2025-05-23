import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Reservations from "@/pages/reservations";
import Tables from "@/pages/modern-tables";
import Guests from "@/pages/guests";
import Profile from "@/pages/profile";
import AISettings from "@/pages/ai-settings";
import Preferences from "@/pages/preferences";
import Integrations from "@/pages/integrations";
import Login from "@/pages/auth/login";
import { useAuth } from "@/components/auth/AuthProvider";
import { Loader2 } from "lucide-react";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Redirect to login if not authenticated and not already on login page
  if (!isAuthenticated && location !== "/login") {
    window.location.href = "/login";
    return null;
  }

  // Redirect to dashboard if authenticated and on login page
  if (isAuthenticated && location === "/login") {
    window.location.href = "/dashboard";
    return null;
  }

  return (
    <Switch>
      {/* Public routes */}
      <Route path="/login" component={Login} />
      
      {/* Protected routes */}
      <Route path="/" component={Dashboard} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/reservations" component={Reservations} />
      <Route path="/tables" component={Tables} />
      <Route path="/guests" component={Guests} />
      <Route path="/profile" component={Profile} />
      <Route path="/ai-settings" component={AISettings} />
      <Route path="/preferences" component={Preferences} />
      <Route path="/integrations" component={Integrations} />
      
      {/* Fallback to 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
