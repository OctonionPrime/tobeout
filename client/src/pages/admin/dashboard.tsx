import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useSuperAdmin } from "@/components/auth/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// UI Components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";

// Icons
import { 
  Shield, 
  Users, 
  Building2, 
  TrendingUp, 
  Plus,
  Settings,
  Search,
  Filter,
  MoreHorizontal,
  ExternalLink,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  LogOut,
  BarChart3,
  Database
} from "lucide-react";

// 🔒 SUPER ADMIN: Type Definitions
interface Tenant {
  id: number;
  name: string;
  subdomain: string;
  tenantPlan: 'starter' | 'professional' | 'enterprise';
  tenantStatus: 'active' | 'suspended' | 'terminated';
  createdAt: string;
  ownerId: number;
  ownerName: string;
  ownerEmail: string;
  features: {
    enableAiChat: boolean;
    enableTelegramBot: boolean;
    enableGuestAnalytics: boolean;
    enableAdvancedReporting: boolean;
    enableMenuManagement: boolean;
  };
  usage: {
    reservations: number;
    tables: number;
    users: number;
  };
  lastActivity: string;
}

interface PlatformMetrics {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  planDistribution: {
    starter: number;
    professional: number;
    enterprise: number;
  };
  totalReservations: number;
  totalRevenue: number;
  growthRate: number;
}

// 🔒 SUPER ADMIN: Create Tenant Form Schema
const createTenantSchema = z.object({
  restaurantName: z.string().min(1, "Restaurant name is required"),
  subdomain: z.string()
    .min(2, "Subdomain must be at least 2 characters")
    .regex(/^[a-z0-9-]+$/, "Subdomain can only contain lowercase letters, numbers, and hyphens"),
  plan: z.enum(['starter', 'professional', 'enterprise']),
  timezone: z.string().default('UTC'),
  ownerName: z.string().min(1, "Owner name is required"),
  ownerEmail: z.string().email("Valid email is required"),
  ownerPhone: z.string().optional(),
  initialPassword: z.string().min(6, "Password must be at least 6 characters"),
  enableAiChat: z.boolean().default(true),
  enableTelegramBot: z.boolean().default(false),
  enableGuestAnalytics: z.boolean().default(true),
  enableAdvancedReporting: z.boolean().default(false),
  enableMenuManagement: z.boolean().default(true),
});

type CreateTenantForm = z.infer<typeof createTenantSchema>;

// 🔒 SUPER ADMIN: API Functions
const fetchTenants = async (params: { 
  page: number; 
  limit: number; 
  search?: string; 
  status?: string; 
  plan?: string; 
}) => {
  const searchParams = new URLSearchParams({
    page: params.page.toString(),
    limit: params.limit.toString(),
    ...(params.search && { search: params.search }),
    ...(params.status && { status: params.status }),
    ...(params.plan && { plan: params.plan }),
  });
  
  const response = await apiRequest("GET", `/api/superadmin/tenants?${searchParams}`);
  return response.json();
};

const fetchPlatformMetrics = async () => {
  const response = await apiRequest("GET", "/api/superadmin/metrics");
  return response.json();
};

const createTenant = async (data: CreateTenantForm) => {
  const response = await apiRequest("POST", "/api/superadmin/tenants", data);
  return response.json();
};

// 🔒 SUPER ADMIN: Status Badge Component
function StatusBadge({ status }: { status: string }) {
  const variants = {
    active: { variant: "default" as const, icon: CheckCircle, color: "text-green-600" },
    suspended: { variant: "secondary" as const, icon: XCircle, color: "text-red-600" },
    terminated: { variant: "destructive" as const, icon: XCircle, color: "text-red-600" },
  };

  const config = variants[status as keyof typeof variants] || variants.active;
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className="flex items-center gap-1">
      <Icon className={`h-3 w-3 ${config.color}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

// 🔒 SUPER ADMIN: Plan Badge Component
function PlanBadge({ plan }: { plan: string }) {
  const variants = {
    starter: { variant: "outline" as const, color: "text-blue-600" },
    professional: { variant: "default" as const, color: "text-purple-600" },
    enterprise: { variant: "secondary" as const, color: "text-orange-600" },
  };

  const config = variants[plan as keyof typeof variants] || variants.starter;

  return (
    <Badge variant={config.variant} className={config.color}>
      {plan.charAt(0).toUpperCase() + plan.slice(1)}
    </Badge>
  );
}

// 🔒 SUPER ADMIN: Metrics Cards Component
function MetricsCards({ metrics, isLoading }: { metrics?: PlatformMetrics; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
            </CardHeader>
          </Card>
        ))}
      </div>
    );
  }

  if (!metrics) return null;

  const cards = [
    {
      title: "Total Tenants",
      value: metrics.totalTenants,
      icon: Building2,
      description: `${metrics.activeTenants} active`,
      color: "text-blue-600",
      bgColor: "bg-blue-50"
    },
    {
      title: "Active Users", 
      value: metrics.activeTenants,
      icon: Users,
      description: `${metrics.suspendedTenants} suspended`,
      color: "text-green-600",
      bgColor: "bg-green-50"
    },
    {
      title: "Total Reservations",
      value: metrics.totalReservations?.toLocaleString() || "0",
      icon: BarChart3,
      description: "All time",
      color: "text-purple-600",
      bgColor: "bg-purple-50"
    },
    {
      title: "Growth Rate",
      value: `+${metrics.growthRate || 0}%`,
      icon: TrendingUp,
      description: "This month",
      color: "text-orange-600",
      bgColor: "bg-orange-50"
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {cards.map((card, index) => {
        const Icon = card.icon;
        return (
          <Card key={index} className="relative overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardDescription className="text-sm font-medium">
                  {card.title}
                </CardDescription>
                <div className={`p-2 rounded-full ${card.bgColor}`}>
                  <Icon className={`h-4 w-4 ${card.color}`} />
                </div>
              </div>
              <div className="space-y-1">
                <CardTitle className="text-2xl font-bold">
                  {card.value}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {card.description}
                </p>
              </div>
            </CardHeader>
          </Card>
        );
      })}
    </div>
  );
}

// 🔒 SUPER ADMIN: Create Tenant Dialog Component
function CreateTenantDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    watch,
    setValue,
  } = useForm<CreateTenantForm>({
    resolver: zodResolver(createTenantSchema),
    defaultValues: {
      plan: 'starter',
      timezone: 'UTC',
      enableAiChat: true,
      enableTelegramBot: false,
      enableGuestAnalytics: true,
      enableAdvancedReporting: false,
      enableMenuManagement: true,
    },
  });

  const createTenantMutation = useMutation({
    mutationFn: createTenant,
    onSuccess: (data) => {
      toast({
        title: "Tenant Created Successfully",
        description: `${data.tenant.restaurant.name} has been created with subdomain: ${data.tenant.restaurant.subdomain}`,
      });
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
      reset();
      setOpen(false);
      onSuccess();
    },
    onError: (error: any) => {
      console.error('[CreateTenant] Error:', error);
      toast({
        title: "Failed to Create Tenant",
        description: error.message || "An error occurred while creating the tenant",
        variant: "destructive",
      });
    },
  });

  // ✅ FIX 1: Explicit boolean conversion in form submission
  const onSubmit = (data: CreateTenantForm) => {
    // ✅ BUG FIX: Ensure all feature flags are explicitly set as booleans
    const tenantData = {
      ...data,
      // Explicitly ensure feature flags are booleans, not undefined
      enableAiChat: Boolean(data.enableAiChat),
      enableTelegramBot: Boolean(data.enableTelegramBot), 
      enableGuestAnalytics: Boolean(data.enableGuestAnalytics),
      enableAdvancedReporting: Boolean(data.enableAdvancedReporting),
      enableMenuManagement: Boolean(data.enableMenuManagement),
    };
    
    console.log('[CreateTenant] Submitting tenant data with explicit feature flags:', {
      features: {
        enableAiChat: tenantData.enableAiChat,
        enableTelegramBot: tenantData.enableTelegramBot,
        enableGuestAnalytics: tenantData.enableGuestAnalytics,
        enableAdvancedReporting: tenantData.enableAdvancedReporting,
        enableMenuManagement: tenantData.enableMenuManagement,
      }
    });
    
    createTenantMutation.mutate(tenantData);
  };

  // Auto-generate subdomain from restaurant name
  const restaurantName = watch('restaurantName');
  useEffect(() => {
    if (restaurantName) {
      const subdomain = restaurantName
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 20);
      setValue('subdomain', subdomain);
    }
  }, [restaurantName, setValue]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-blue-600 hover:bg-blue-700">
          <Plus className="mr-2 h-4 w-4" />
          Create New Tenant
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Create New Tenant
          </DialogTitle>
          <DialogDescription>
            Create a new restaurant tenant with owner account and initial configuration.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Restaurant Details */}
          <div className="space-y-4">
            <h4 className="font-medium text-sm text-slate-900">Restaurant Details</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="restaurantName">Restaurant Name *</Label>
                <Input
                  id="restaurantName"
                  placeholder="Bella Vista Restaurant"
                  {...register("restaurantName")}
                />
                {errors.restaurantName && (
                  <p className="text-sm text-red-600">{errors.restaurantName.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="subdomain">Subdomain *</Label>
                <Input
                  id="subdomain"
                  placeholder="bella-vista"
                  {...register("subdomain")}
                />
                {errors.subdomain && (
                  <p className="text-sm text-red-600">{errors.subdomain.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="plan">Subscription Plan *</Label>
                <Select onValueChange={(value) => setValue('plan', value as any)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select plan" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
                {errors.plan && (
                  <p className="text-sm text-red-600">{errors.plan.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Input
                  id="timezone"
                  placeholder="America/New_York"
                  {...register("timezone")}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Owner Details */}
          <div className="space-y-4">
            <h4 className="font-medium text-sm text-slate-900">Owner Account</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ownerName">Full Name *</Label>
                <Input
                  id="ownerName"
                  placeholder="John Doe"
                  {...register("ownerName")}
                />
                {errors.ownerName && (
                  <p className="text-sm text-red-600">{errors.ownerName.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="ownerEmail">Email *</Label>
                <Input
                  id="ownerEmail"
                  type="email"
                  placeholder="john@bellavista.com"
                  {...register("ownerEmail")}
                />
                {errors.ownerEmail && (
                  <p className="text-sm text-red-600">{errors.ownerEmail.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ownerPhone">Phone (Optional)</Label>
                <Input
                  id="ownerPhone"
                  placeholder="+1 (555) 123-4567"
                  {...register("ownerPhone")}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="initialPassword">Initial Password *</Label>
                <Input
                  id="initialPassword"
                  type="password"
                  placeholder="Temporary password"
                  {...register("initialPassword")}
                />
                {errors.initialPassword && (
                  <p className="text-sm text-red-600">{errors.initialPassword.message}</p>
                )}
              </div>
            </div>
          </div>

          <Separator />

          {/* Feature Configuration */}
          <div className="space-y-4">
            <h4 className="font-medium text-sm text-slate-900">Feature Configuration</h4>
            
            {/* ✅ FIX 2: Proper Switch handling with watch() and setValue() */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="enableAiChat" className="text-sm">AI Chat Assistant</Label>
                <Switch
                  id="enableAiChat"
                  checked={watch("enableAiChat")}
                  onCheckedChange={(checked) => setValue("enableAiChat", checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="enableTelegramBot" className="text-sm">Telegram Bot</Label>
                <Switch
                  id="enableTelegramBot"
                  checked={watch("enableTelegramBot")}
                  onCheckedChange={(checked) => setValue("enableTelegramBot", checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="enableGuestAnalytics" className="text-sm">Guest Analytics</Label>
                <Switch
                  id="enableGuestAnalytics"
                  checked={watch("enableGuestAnalytics")}
                  onCheckedChange={(checked) => setValue("enableGuestAnalytics", checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="enableAdvancedReporting" className="text-sm">Advanced Reporting</Label>
                <Switch
                  id="enableAdvancedReporting"
                  checked={watch("enableAdvancedReporting")}
                  onCheckedChange={(checked) => setValue("enableAdvancedReporting", checked)}
                />
              </div>

              <div className="flex items-center justify-between col-span-2">
                <Label htmlFor="enableMenuManagement" className="text-sm">Menu Management</Label>
                <Switch
                  id="enableMenuManagement"
                  checked={watch("enableMenuManagement")}
                  onCheckedChange={(checked) => setValue("enableMenuManagement", checked)}
                />
              </div>
            </div>
          </div>

          {/* Submit Buttons */}
          <div className="flex justify-end space-x-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Tenant
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// 🔒 SUPER ADMIN: Main Dashboard Component
export default function AdminDashboard() {
  const { user, logout } = useSuperAdmin();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // State for filters and pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const tenantsPerPage = 10;

  // Queries
  const {
    data: tenantsData,
    isLoading: isLoadingTenants,
    error: tenantsError,
  } = useQuery({
    queryKey: ['tenants', currentPage, searchTerm, statusFilter, planFilter],
    queryFn: () => fetchTenants({
      page: currentPage,
      limit: tenantsPerPage,
      search: searchTerm || undefined,
      status: statusFilter || undefined,
      plan: planFilter || undefined,
    }),
    staleTime: 30000, // Cache for 30 seconds
  });

  const {
    data: metricsData,
    isLoading: isLoadingMetrics,
  } = useQuery({
    queryKey: ['metrics'],
    queryFn: fetchPlatformMetrics,
    staleTime: 60000, // Cache for 1 minute
  });

  const handleManageTenant = (tenantId: number) => {
    navigate(`/admin/tenants/${tenantId}`);
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/admin/login');
    } catch (error) {
      console.error('[AdminDashboard] Logout failed:', error);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 🔒 Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-4">
              <div className="flex items-center">
                <Shield className="h-8 w-8 text-blue-600 mr-3" />
                <div>
                  <h1 className="text-xl font-bold text-slate-900">Admin Portal</h1>
                  <p className="text-sm text-slate-600">Tenant Management System</p>
                </div>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <p className="text-sm font-medium text-slate-900">{user.name}</p>
                <p className="text-xs text-slate-600">Super Administrator</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="text-slate-600 hover:text-slate-900"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 🔒 Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Platform Metrics */}
        <MetricsCards metrics={metricsData?.metrics} isLoading={isLoadingMetrics} />

        {/* Tenants Section */}
        <Card>
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  Tenant Management
                </CardTitle>
                <CardDescription>
                  Manage all restaurant tenants and their configurations
                </CardDescription>
              </div>
              <CreateTenantDialog onSuccess={() => {
                // Refresh data after successful creation
                setCurrentPage(1);
              }} />
            </div>
          </CardHeader>

          <CardContent>
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search tenants..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              
              <Select 
                value={statusFilter || 'all'} 
                onValueChange={(value) => setStatusFilter(value === 'all' ? '' : value)}
              >
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                  <SelectItem value="terminated">Terminated</SelectItem>
                </SelectContent>
              </Select>

              <Select 
                value={planFilter || 'all'} 
                onValueChange={(value) => setPlanFilter(value === 'all' ? '' : value)}
              >
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="All Plans" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Plans</SelectItem>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="professional">Professional</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Error State */}
            {tenantsError && (
              <Alert variant="destructive" className="mb-6">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Failed to load tenants. Please try again.
                </AlertDescription>
              </Alert>
            )}

            {/* Tenants Table */}
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Restaurant</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Usage</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingTenants ? (
                    // Loading skeleton
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-8 w-20" /></TableCell>
                      </TableRow>
                    ))
                  ) : tenantsData?.tenants?.length > 0 ? (
                    tenantsData.tenants.map((tenant: Tenant) => (
                      <TableRow key={tenant.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{tenant.name}</div>
                            <div className="text-sm text-slate-600">
                              {tenant.subdomain}.yourdomain.com
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium">{tenant.ownerName}</div>
                            <div className="text-sm text-slate-600">{tenant.ownerEmail}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <PlanBadge plan={tenant.tenantPlan} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={tenant.tenantStatus} />
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <div>{tenant.usage?.reservations || 0} reservations</div>
                            <div className="text-slate-600">{tenant.usage?.tables || 0} tables</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {new Date(tenant.createdAt).toLocaleDateString()}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleManageTenant(tenant.id)}
                          >
                            <Settings className="h-4 w-4 mr-2" />
                            Manage
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">
                        <div className="text-slate-500">
                          <Building2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p>No tenants found</p>
                          <p className="text-sm">Create your first tenant to get started</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {tenantsData?.pagination && tenantsData.pagination.totalPages > 1 && (
              <div className="flex justify-between items-center mt-6">
                <div className="text-sm text-slate-600">
                  Page {tenantsData.pagination.currentPage} of {tenantsData.pagination.totalPages} 
                  ({tenantsData.pagination.totalTenants} total tenants)
                </div>
                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(currentPage - 1)}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(currentPage + 1)}
                    disabled={currentPage === tenantsData.pagination.totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}