import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/components/auth/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Shield, Loader2, Eye, EyeOff, ArrowLeft, Lock, User } from "lucide-react";

// 🔒 SUPER ADMIN: Validation Schema for Admin Login
const adminLoginSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address"),
  password: z
    .string()
    .min(1, "Password is required")
    .min(6, "Password must be at least 6 characters"),
});

type AdminLoginForm = z.infer<typeof adminLoginSchema>;

export default function AdminLogin() {
  const [, navigate] = useLocation();
  const { superAdminLogin, isLoading, isAuthenticated, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // 🔒 Redirect authenticated super admins
  useEffect(() => {
    if (isAuthenticated && isSuperAdmin()) {
      navigate("/admin/dashboard");
    }
  }, [isAuthenticated, isSuperAdmin, navigate]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setFocus,
  } = useForm<AdminLoginForm>({
    resolver: zodResolver(adminLoginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  // Auto-focus email field on mount
  useEffect(() => {
    setFocus("email");
  }, [setFocus]);

  const onSubmit = async (data: AdminLoginForm) => {
    try {
      setLoginError(null);
      console.log(`[AdminLogin] Attempting super admin login for: ${data.email}`);

      await superAdminLogin(data.email, data.password);
      
      // Success toast is handled by AuthProvider
      console.log(`[AdminLogin] Super admin login successful, redirecting...`);
      navigate("/admin/dashboard");
      
    } catch (error: any) {
      console.error("[AdminLogin] Login failed:", error);
      
      // Set specific error message for the form
      let errorMessage = "Invalid admin credentials";
      
      if (error.message?.includes("not found")) {
        errorMessage = "Super admin account not found";
      } else if (error.message?.includes("inactive")) {
        errorMessage = "Super admin account is inactive";
      } else if (error.message?.includes("credentials")) {
        errorMessage = "Invalid email or password";
      } else if (error.message?.includes("network")) {
        errorMessage = "Network error. Please check your connection.";
      }
      
      setLoginError(errorMessage);
      
      // Focus password field for retry
      setFocus("password");
    }
  };

  const handleBackToRegularLogin = () => {
    console.log("[AdminLogin] Navigating back to regular login");
    navigate("/login");
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100">
      <div className="w-full max-w-md px-6">
        
        {/* 🔒 Admin Portal Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-full mb-4 shadow-lg">
            <Shield className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            Admin Portal
          </h1>
          <p className="text-slate-600">
            Super administrator access required
          </p>
        </div>

        {/* 🔒 Login Card */}
        <Card className="shadow-xl border-0 bg-white/95 backdrop-blur">
          <CardHeader className="space-y-2 pb-4">
            <CardTitle className="text-xl font-semibold text-center text-slate-900">
              Sign In
            </CardTitle>
            <CardDescription className="text-center text-slate-600">
              Enter your super admin credentials to continue
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            
            {/* 🔒 Error Alert */}
            {loginError && (
              <Alert variant="destructive" className="border-red-200 bg-red-50">
                <Lock className="h-4 w-4" />
                <AlertDescription className="text-red-800">
                  {loginError}
                </AlertDescription>
              </Alert>
            )}

            {/* 🔒 Login Form */}
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              
              {/* Email Field */}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium text-slate-700">
                  Admin Email
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="admin@company.com"
                    className="pl-10 h-11 border-slate-300 focus:border-blue-500 focus:ring-blue-500"
                    {...register("email")}
                    disabled={isLoading || isSubmitting}
                  />
                </div>
                {errors.email && (
                  <p className="text-sm text-red-600">{errors.email.message}</p>
                )}
              </div>

              {/* Password Field */}
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium text-slate-700">
                  Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    className="pl-10 pr-12 h-11 border-slate-300 focus:border-blue-500 focus:ring-blue-500"
                    {...register("password")}
                    disabled={isLoading || isSubmitting}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    disabled={isLoading || isSubmitting}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-sm text-red-600">{errors.password.message}</p>
                )}
              </div>

              {/* Submit Button */}
              <Button
                type="submit"
                disabled={isLoading || isSubmitting}
                className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-lg transition-all duration-200 hover:shadow-xl"
              >
                {isLoading || isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    <Shield className="mr-2 h-4 w-4" />
                    Sign In as Admin
                  </>
                )}
              </Button>
            </form>

            {/* 🔒 Security Notice */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <Shield className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="text-blue-800 font-medium mb-1">
                    Secure Admin Access
                  </p>
                  <p className="text-blue-700">
                    This portal is for authorized super administrators only. All login attempts are monitored and logged.
                  </p>
                </div>
              </div>
            </div>

            {/* 🔒 Separator */}
            <div className="relative">
              <Separator className="bg-slate-200" />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="bg-white px-3 text-xs text-slate-500 uppercase tracking-wider">
                  Not an admin?
                </span>
              </span>
            </div>

            {/* 🔒 Back to Regular Login */}
            <Button
              type="button"
              variant="ghost"
              onClick={handleBackToRegularLogin}
              className="w-full h-11 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              disabled={isLoading || isSubmitting}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Regular Login
            </Button>
          </CardContent>
        </Card>

        {/* 🔒 Footer */}
        <div className="text-center mt-8">
          <p className="text-xs text-slate-500">
            Super Admin Portal • Secure Access Required
          </p>
          {process.env.NODE_ENV === 'development' && (
            <p className="text-xs text-amber-600 mt-1">
              Development Mode • Extended Logging Enabled
            </p>
          )}
        </div>
      </div>
    </div>
  );
}