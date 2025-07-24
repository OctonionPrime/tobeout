import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// 🔒 SUPER ADMIN: Enhanced User Type Definitions
interface BaseTenantUser {
  id: number;
  email: string;
  name: string;
  role: 'restaurant' | 'staff';
  isSuperAdmin: false;
}

interface SuperAdminUser {
  id: number;
  email: string;
  name: string;
  role: 'super_admin';
  isSuperAdmin: true;
  loginTime?: string; // When the super admin logged in
}

// Union type for all possible authenticated users
type AuthenticatedUser = BaseTenantUser | SuperAdminUser;

// 🔒 SUPER ADMIN: Enhanced Auth Context Interface
interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthenticatedUser | null;
  
  // Regular tenant user functions (existing)
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (userData: any) => Promise<void>;
  
  // 🔒 SUPER ADMIN: New super admin function
  superAdminLogin: (email: string, password: string) => Promise<void>;
  
  // Helper functions for role checking
  isTenantUser: () => boolean;
  isSuperAdmin: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    // Check if user is already authenticated on mount
    checkAuthStatus();
  }, []);

  // 🔒 SUPER ADMIN: Enhanced Auth Status Check with Role Detection
  const checkAuthStatus = async () => {
    try {
      setIsLoading(true);
      const response = await fetch("/api/auth/me", {
        credentials: "include",
      });
      
      if (response.ok) {
        const userData = await response.json();
        
        // Validate user data structure
        if (userData && typeof userData.isSuperAdmin === 'boolean') {
          setUser(userData as AuthenticatedUser);
          console.log(`[Auth] User authenticated: ${userData.email} (${userData.isSuperAdmin ? 'Super Admin' : 'Tenant User'})`);
        } else {
          console.warn('[Auth] Invalid user data structure received:', userData);
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error("[Auth] Auth check failed:", error);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Regular tenant user login (existing functionality, enhanced)
  const login = async (email: string, password: string) => {
    try {
      setIsLoading(true);
      console.log(`[Auth] Tenant login attempt for: ${email}`);
      
      const response = await apiRequest("POST", "/api/auth/login", { 
        email, 
        password 
      });
      
      const userData = await response.json();
      
      // Ensure this is a tenant user
      if (userData.isSuperAdmin) {
        throw new Error("Super admin accounts cannot login through the regular login. Please use the admin portal.");
      }
      
      setUser(userData as BaseTenantUser);
      console.log(`[Auth] Tenant login successful: ${userData.email}`);
      
      toast({
        title: "Welcome back!",
        description: `Successfully logged in as ${userData.name}`,
      });
      
    } catch (error: any) {
      console.error('[Auth] Tenant login failed:', error);
      toast({
        title: "Login failed",
        description: error.message || "Please check your credentials and try again",
        variant: "destructive",
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // 🔒 SUPER ADMIN: New Super Admin Login Function
  const superAdminLogin = async (email: string, password: string) => {
    try {
      setIsLoading(true);
      console.log(`[Auth] Super admin login attempt for: ${email}`);
      
      const response = await apiRequest("POST", "/api/superadmin/auth/login", { 
        email, 
        password 
      });
      
      const userData = await response.json();
      
      // Ensure this is a super admin user
      if (!userData.isSuperAdmin || userData.role !== 'super_admin') {
        throw new Error("Invalid super admin credentials");
      }
      
      setUser(userData as SuperAdminUser);
      console.log(`[Auth] Super admin login successful: ${userData.email}`);
      
      toast({
        title: "Admin Access Granted",
        description: `Welcome back, ${userData.name}`,
      });
      
    } catch (error: any) {
      console.error('[Auth] Super admin login failed:', error);
      
      // Enhanced error messages for super admin login
      let errorMessage = "Invalid super admin credentials";
      
      if (error.message?.includes('not found')) {
        errorMessage = "Super admin account not found";
      } else if (error.message?.includes('inactive')) {
        errorMessage = "Super admin account is inactive";
      } else if (error.message?.includes('credentials')) {
        errorMessage = "Invalid super admin credentials";
      }
      
      toast({
        title: "Admin Login Failed",
        description: errorMessage,
        variant: "destructive",
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // Enhanced logout (works for both user types)
  const logout = async () => {
    try {
      setIsLoading(true);
      const currentUser = user;
      
      await apiRequest("POST", "/api/auth/logout", {});
      setUser(null);
      
      console.log(`[Auth] Logout successful: ${currentUser?.email} (${currentUser?.isSuperAdmin ? 'Super Admin' : 'Tenant User'})`);
      
      toast({
        title: "Logged out",
        description: "You have been successfully logged out",
      });
      
    } catch (error) {
      console.error("[Auth] Logout failed:", error);
      toast({
        title: "Logout failed",
        description: "There was a problem logging out. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Enhanced register (tenant users only)
  const register = async (userData: any) => {
    try {
      setIsLoading(true);
      console.log(`[Auth] Registration attempt for: ${userData.email}`);
      
      const response = await apiRequest("POST", "/api/auth/register", userData);
      const newUserData = await response.json();
      
      // Registration always creates tenant users
      setUser(newUserData as BaseTenantUser);
      console.log(`[Auth] Registration successful: ${newUserData.email}`);
      
      toast({
        title: "Welcome!",
        description: `Account created successfully for ${newUserData.name}`,
      });
      
    } catch (error: any) {
      console.error('[Auth] Registration failed:', error);
      toast({
        title: "Registration failed",
        description: error.message || "Please check your information and try again",
        variant: "destructive",
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // 🔒 SUPER ADMIN: Helper Functions for Role Checking
  const isTenantUser = (): boolean => {
    return user !== null && !user.isSuperAdmin;
  };

  const isSuperAdmin = (): boolean => {
    return user !== null && user.isSuperAdmin === true;
  };

  // Enhanced context value with all functions
  const value: AuthContextType = {
    isAuthenticated: !!user,
    isLoading,
    user,
    
    // Authentication functions
    login,
    logout,
    register,
    superAdminLogin, // 🔒 NEW: Super admin login
    
    // Helper functions
    isTenantUser,
    isSuperAdmin,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Enhanced useAuth hook with better TypeScript support
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

// 🔒 SUPER ADMIN: Additional Utility Hooks

// Hook specifically for super admin features
export const useSuperAdmin = () => {
  const auth = useAuth();
  
  if (!auth.isSuperAdmin()) {
    throw new Error("useSuperAdmin hook can only be used by authenticated super admins");
  }
  
  return {
    user: auth.user as SuperAdminUser,
    logout: auth.logout,
  };
};

// Hook specifically for tenant features  
export const useTenant = () => {
  const auth = useAuth();
  
  if (!auth.isTenantUser()) {
    throw new Error("useTenant hook can only be used by authenticated tenant users");
  }
  
  return {
    user: auth.user as BaseTenantUser,
    logout: auth.logout,
  };
};

// Generic role-based redirect helper
export const getRedirectPath = (user: AuthenticatedUser | null): string => {
  if (!user) return '/login';
  
  if (user.isSuperAdmin) {
    return '/admin/dashboard';
  } else {
    return '/dashboard';
  }
};

// Export types for use in other components
export type { AuthenticatedUser, BaseTenantUser, SuperAdminUser, AuthContextType };