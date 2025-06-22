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
import Analytics from "@/pages/analytics";
import Profile from "@/pages/profile";
import AISettings from "@/pages/ai-settings";
import Preferences from "@/pages/preferences";
import Integrations from "@/pages/integrations";
import Login from "@/pages/auth/login";
import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

// Error Boundary Component
import { Component, ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('App crashed:', error, errorInfo);
    
    // Here you could send error to monitoring service
    // Example: Sentry.captureException(error, { extra: errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full flex items-center justify-center bg-background">
          <div className="max-w-md w-full mx-4">
            <div className="bg-card border border-border rounded-lg p-6 shadow-lg">
              <div className="text-center">
                <div className="text-6xl mb-4">⚠️</div>
                <h1 className="text-2xl font-bold text-foreground mb-2">
                  Something went wrong
                </h1>
                <p className="text-muted-foreground mb-6">
                  The application encountered an unexpected error. Our team has been notified.
                </p>
                <div className="space-y-3">
                  <button
                    onClick={() => window.location.reload()}
                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md font-medium transition-colors"
                  >
                    Refresh Page
                  </button>
                  <button
                    onClick={() => {
                      this.setState({ hasError: false, error: undefined });
                      window.location.href = '/dashboard';
                    }}
                    className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/90 px-4 py-2 rounded-md font-medium transition-colors"
                  >
                    Go to Dashboard
                  </button>
                </div>
                {process.env.NODE_ENV === 'development' && this.state.error && (
                  <details className="mt-4 text-left">
                    <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                      Error Details (Development)
                    </summary>
                    <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto max-h-32">
                      {this.state.error.stack}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// ✅ REMOVED: TimezoneAwareRoute wrapper - no longer needed since DashboardLayout provides context

// Protected Route wrapper component
interface ProtectedRouteProps {
  children: ReactNode;
  requiredRole?: string[];
}

function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { isAuthenticated, user, isLoading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, isLoading, navigate]);

  // Check role if specified
  if (requiredRole && user && !requiredRole.includes(user.role)) {
    console.log('Role check failed:', { 
      userRole: user.role, 
      requiredRole, 
      userId: user.id,
      userName: user.name 
    });
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <div className="max-w-md w-full mx-4">
          <div className="bg-card border border-border rounded-lg p-6 shadow-lg text-center">
            <div className="text-4xl mb-4">🔒</div>
            <h1 className="text-xl font-bold text-foreground mb-2">
              Access Denied
            </h1>
            <p className="text-muted-foreground mb-4">
              You don't have permission to access this page.
            </p>
            <div className="text-xs text-muted-foreground mb-4 font-mono">
              Role: {user.role} | Required: {requiredRole.join(', ')}
            </div>
            <button
              onClick={() => navigate('/dashboard')}
              className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md font-medium transition-colors"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return <>{children}</>;
}

function Router() {
  const { isAuthenticated, isLoading } = useAuth();
  const [location, navigate] = useLocation();

  // Handle redirects using router navigation instead of window.location
  useEffect(() => {
    if (isLoading) return; // Wait for auth to load

    // Redirect to login if not authenticated and not already on login page
    if (!isAuthenticated && location !== "/login") {
      navigate("/login");
      return;
    }

    // Redirect to dashboard if authenticated and on login page
    if (isAuthenticated && location === "/login") {
      navigate("/dashboard");
      return;
    }

    // Redirect root to dashboard if authenticated
    if (isAuthenticated && location === "/") {
      navigate("/dashboard");
      return;
    }
  }, [isAuthenticated, isLoading, location, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Switch>
      {/* Public routes */}
      <Route path="/login">
        {!isAuthenticated ? <Login /> : null}
      </Route>
      
      {/* ✅ SIMPLIFIED: Protected routes directly render components - DashboardLayout provides timezone context */}
      <Route path="/dashboard">
        <ProtectedRoute>
          <Dashboard />
        </ProtectedRoute>
      </Route>
      
      <Route path="/reservations">
        <ProtectedRoute>
          <Reservations />
        </ProtectedRoute>
      </Route>
      
      <Route path="/tables">
        <ProtectedRoute>
          <Tables />
        </ProtectedRoute>
      </Route>
      
      <Route path="/guests">
        <ProtectedRoute>
          <Guests />
        </ProtectedRoute>
      </Route>
      
      <Route path="/analytics">
        <ProtectedRoute>
          <Analytics />
        </ProtectedRoute>
      </Route>
      
      <Route path="/profile">
        <ProtectedRoute>
          <Profile />
        </ProtectedRoute>
      </Route>
      
      <Route path="/ai-settings">
        <ProtectedRoute requiredRole={['admin']}>
          <AISettings />
        </ProtectedRoute>
      </Route>
      
      <Route path="/preferences">
        <ProtectedRoute>
          <Preferences />
        </ProtectedRoute>
      </Route>
      
      <Route path="/integrations">
        <ProtectedRoute requiredRole={['admin']}>
          <Integrations />
        </ProtectedRoute>
      </Route>

      {/* Root redirect */}
      <Route path="/">
        <ProtectedRoute>
          <Dashboard />
        </ProtectedRoute>
      </Route>
      
      {/* 404 fallback */}
      <Route>
        <NotFound />
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;