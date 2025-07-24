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

// 🔒 SUPER ADMIN: Import admin components
import AdminLogin from "@/pages/auth/admin-login";
import AdminDashboard from "@/pages/admin/dashboard";
import ManageTenantPage from "@/pages/admin/manage-tenant";

import { AuthProvider, useAuth, getRedirectPath } from "@/components/auth/AuthProvider";
import type { AuthenticatedUser } from "@/components/auth/AuthProvider";
import { Loader2, Shield, AlertTriangle } from "lucide-react";
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

// 🔒 SUPER ADMIN: Enhanced Protected Route for Tenant Users
interface ProtectedRouteProps {
  children: ReactNode;
  requiredRole?: string[];
}

function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { isAuthenticated, user, isLoading, isTenantUser } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading) {
      if (!isAuthenticated) {
        navigate('/login');
        return;
      }
      
      // Redirect super admins away from tenant routes
      if (user?.isSuperAdmin) {
        console.log('[ProtectedRoute] Super admin detected, redirecting to admin dashboard');
        navigate('/admin/dashboard');
        return;
      }
    }
  }, [isAuthenticated, isLoading, user, navigate]);

  // Check role if specified (for tenant users)
  if (requiredRole && user && !requiredRole.includes(user.role)) {
    console.log('[ProtectedRoute] Role check failed:', { 
      userRole: user.role, 
      requiredRole, 
      userId: user.id,
      userName: user.name 
    });
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <div className="max-w-md w-full mx-4">
          <div className="bg-card border border-border rounded-lg p-6 shadow-lg text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-amber-500 mb-4" />
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

  if (!isAuthenticated || !isTenantUser()) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return <>{children}</>;
}

// 🔒 SUPER ADMIN: New Admin Protected Route Component
interface AdminProtectedRouteProps {
  children: ReactNode;
}

function AdminProtectedRoute({ children }: AdminProtectedRouteProps) {
  const { isAuthenticated, user, isLoading, isSuperAdmin } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading) {
      if (!isAuthenticated) {
        console.log('[AdminProtectedRoute] Not authenticated, redirecting to admin login');
        navigate('/admin/login');
        return;
      }
      
      // Redirect non-super-admins away from admin routes
      if (!user?.isSuperAdmin) {
        console.log('[AdminProtectedRoute] Non-admin user detected, redirecting to regular login');
        navigate('/login');
        return;
      }
    }
  }, [isAuthenticated, isLoading, user, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <Shield className="mx-auto h-8 w-8 animate-pulse text-blue-600 mb-2" />
          <p className="text-sm text-slate-600">Loading admin panel...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !isSuperAdmin()) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-50">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-lg text-center">
            <Shield className="mx-auto h-12 w-12 text-red-500 mb-4" />
            <h1 className="text-xl font-bold text-slate-900 mb-2">
              Admin Access Required
            </h1>
            <p className="text-slate-600 mb-4">
              You need super admin privileges to access this area.
            </p>
            <div className="space-y-2">
              <button
                onClick={() => navigate('/admin/login')}
                className="w-full bg-blue-600 text-white hover:bg-blue-700 px-4 py-2 rounded-md font-medium transition-colors"
              >
                Admin Login
              </button>
              <button
                onClick={() => navigate('/login')}
                className="w-full bg-slate-100 text-slate-700 hover:bg-slate-200 px-4 py-2 rounded-md font-medium transition-colors"
              >
                Regular Login
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

// 🔒 SUPER ADMIN: Temporary Admin Login Component (until we create the real one)
function TemporaryAdminLogin() {
  const { superAdminLogin, isLoading } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await superAdminLogin(email, password);
      navigate('/admin/dashboard');
    } catch (error) {
      console.error('Admin login failed:', error);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-lg">
          <div className="text-center mb-6">
            <Shield className="mx-auto h-12 w-12 text-blue-600 mb-4" />
            <h1 className="text-2xl font-bold text-slate-900">Admin Portal</h1>
            <p className="text-slate-600">Super admin access required</p>
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 px-4 py-2 rounded-md font-medium transition-colors flex items-center justify-center"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
          
          <div className="mt-4 text-center">
            <button
              onClick={() => navigate('/login')}
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              ← Back to regular login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 🔒 SUPER ADMIN: Temporary Admin Dashboard Component (until we create the real one)
function TemporaryAdminDashboard() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <Shield className="h-8 w-8 text-blue-600 mr-3" />
              <h1 className="text-xl font-bold text-slate-900">Admin Portal</h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-slate-600">
                Welcome, {user?.name}
              </span>
              <button
                onClick={logout}
                className="text-sm text-slate-600 hover:text-slate-900"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-medium text-slate-900 mb-4">
            🚀 Super Admin Dashboard
          </h2>
          <p className="text-slate-600 mb-4">
            This is a temporary admin dashboard. The full admin interface is being built.
          </p>
          <div className="space-y-2">
            <p className="text-sm">✅ Backend routes configured</p>
            <p className="text-sm">✅ Authentication working</p>
            <p className="text-sm">⏳ Building tenant management UI...</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// 🔒 SUPER ADMIN: Enhanced Router with Admin Routes
function Router() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [location, navigate] = useLocation();

  // 🔒 SUPER ADMIN: Enhanced redirect logic with role-based routing
  useEffect(() => {
    if (isLoading) return; // Wait for auth to load

    // Handle unauthenticated users
    if (!isAuthenticated) {
      // Allow access to login pages
      if (location === "/login" || location === "/admin/login") {
        return;
      }
      
      // Redirect to appropriate login based on route
      if (location.startsWith("/admin")) {
        navigate("/admin/login");
      } else {
        navigate("/login");
      }
      return;
    }

    // Handle authenticated users
    if (isAuthenticated && user) {
      const redirectPath = getRedirectPath(user);
      
      // Redirect from login pages to appropriate dashboard
      if (location === "/login" || location === "/admin/login") {
        navigate(redirectPath);
        return;
      }
      
      // Redirect root to appropriate dashboard
      if (location === "/") {
        navigate(redirectPath);
        return;
      }
      
      // Ensure super admins don't access tenant routes
      if (user.isSuperAdmin && !location.startsWith("/admin")) {
        console.log('[Router] Super admin accessing tenant route, redirecting to admin dashboard');
        navigate("/admin/dashboard");
        return;
      }
      
      // Ensure tenant users don't access admin routes
      if (!user.isSuperAdmin && location.startsWith("/admin")) {
        console.log('[Router] Tenant user accessing admin route, redirecting to regular dashboard');
        navigate("/dashboard");
        return;
      }
    }
  }, [isAuthenticated, isLoading, location, navigate, user]);

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Switch>
      {/* ============================================================================ */}
      {/* 🔒 SUPER ADMIN: Admin Routes */}
      {/* ============================================================================ */}
      
      {/* Admin login - accessible without authentication */}
      <Route path="/admin/login">
        {!isAuthenticated ? (
          <AdminLogin />
        ) : null}
      </Route>
      
      {/* Admin dashboard - requires super admin authentication */}
      <Route path="/admin/dashboard">
        <AdminProtectedRoute>
          <AdminDashboard />
        </AdminProtectedRoute>
      </Route>
      
      {/* Individual tenant management - requires super admin authentication */}
      <Route path="/admin/tenants/:id">
        <AdminProtectedRoute>
          <ManageTenantPage />
        </AdminProtectedRoute>
      </Route>

      {/* ============================================================================ */}
      {/* Regular Tenant Routes (Existing) */}
      {/* ============================================================================ */}
      
      {/* Public routes */}
      <Route path="/login">
        {!isAuthenticated ? <Login /> : null}
      </Route>
      
      {/* Protected tenant routes */}
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

      {/* Root redirect - handled by useEffect above */}
      <Route path="/">
        {isAuthenticated && user ? (
          user.isSuperAdmin ? (
            <AdminProtectedRoute>
              <AdminDashboard />
            </AdminProtectedRoute>
          ) : (
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          )
        ) : null}
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