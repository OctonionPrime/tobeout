import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
  ArrowLeft,
  Building2, 
  User,
  Settings,
  Activity,
  BarChart3,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Save,
  AlertTriangle,
  Ban,
  RefreshCw,
  Eye,
  Calendar,
  Database,
  Globe,
  Mail,
  Phone,
  Edit,
  Trash2,
  Plus
} from "lucide-react";

// 🔒 SUPER ADMIN: Type Definitions
interface TenantDetails {
  id: number;
  name: string;
  subdomain: string;
  tenantPlan: 'starter' | 'professional' | 'enterprise';
  tenantStatus: 'active' | 'suspended' | 'terminated';
  timezone: string;
  createdAt: string;
  updatedAt: string;
  ownerId: number;
  ownerName: string;
  ownerEmail: string;
  ownerPhone?: string;
  features: {
    enableAiChat: boolean;
    enableTelegramBot: boolean;
    enableGuestAnalytics: boolean;
    enableAdvancedReporting: boolean;
    enableMenuManagement: boolean;
  };
  limits: {
    maxTables?: number;
    maxUsers?: number;
    maxReservationsPerMonth?: number;
  };
  customSettings?: Record<string, any>;
  adminNotes?: string;
}

interface TenantMetrics {
  totalReservations: number;
  activeReservations: number;
  totalTables: number;
  totalUsers: number;
  revenue: number;
  lastActivity: string;
  avgReservationDuration: number;
  completionRate: number;
}

interface TenantAuditLog {
  id: number;
  action: string;
  description: string;
  adminId: number;
  adminEmail: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

// 🔒 SUPER ADMIN: Validation Schemas
const updateTenantSchema = z.object({
  restaurantName: z.string().min(1, "Restaurant name is required"),
  subdomain: z.string()
    .min(2, "Subdomain must be at least 2 characters")
    .regex(/^[a-z0-9-]+$/, "Subdomain can only contain lowercase letters, numbers, and hyphens"),
  plan: z.enum(['starter', 'professional', 'enterprise']),
  status: z.enum(['active', 'suspended', 'terminated']),
  timezone: z.string(),
  enableAiChat: z.boolean(),
  enableTelegramBot: z.boolean(),
  enableGuestAnalytics: z.boolean(),
  enableAdvancedReporting: z.boolean(),
  enableMenuManagement: z.boolean(),
  maxTables: z.number().optional(),
  maxUsers: z.number().optional(),
  maxReservationsPerMonth: z.number().optional(),
  adminNotes: z.string().optional(),
});

type UpdateTenantForm = z.infer<typeof updateTenantSchema>;

// 🔒 SUPER ADMIN: API Functions
const fetchTenantDetails = async (tenantId: string) => {
  const response = await apiRequest("GET", `/api/superadmin/tenants/${tenantId}`);
  return response.json();
};

const updateTenant = async (tenantId: string, data: Partial<UpdateTenantForm>) => {
  const response = await apiRequest("PATCH", `/api/superadmin/tenants/${tenantId}`, data);
  return response.json();
};

const suspendTenant = async (tenantId: string, data: { reason: string; notifyOwner: boolean }) => {
  const response = await apiRequest("POST", `/api/superadmin/tenants/${tenantId}/suspend`, data);
  return response.json();
};

const reactivateTenant = async (tenantId: string, data: { notes: string; notifyOwner: boolean }) => {
  const response = await apiRequest("POST", `/api/superadmin/tenants/${tenantId}/reactivate`, data);
  return response.json();
};

const fetchTenantAuditLogs = async (tenantId: string) => {
  const response = await apiRequest("GET", `/api/superadmin/tenants/${tenantId}/audit`);
  return response.json();
};

// 🔒 SUPER ADMIN: Status Badge Component
function StatusBadge({ status }: { status: string }) {
  const variants = {
    active: { variant: "default" as const, icon: CheckCircle, color: "text-green-600", bg: "bg-green-50" },
    suspended: { variant: "secondary" as const, icon: Ban, color: "text-red-600", bg: "bg-red-50" },
    terminated: { variant: "destructive" as const, icon: XCircle, color: "text-red-600", bg: "bg-red-50" },
  };

  const config = variants[status as keyof typeof variants] || variants.active;
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className={`flex items-center gap-1 ${config.bg}`}>
      <Icon className={`h-3 w-3 ${config.color}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

// 🔒 SUPER ADMIN: Plan Badge Component
function PlanBadge({ plan }: { plan: string }) {
  const variants = {
    starter: { variant: "outline" as const, color: "text-blue-600", bg: "bg-blue-50" },
    professional: { variant: "default" as const, color: "text-purple-600", bg: "bg-purple-50" },
    enterprise: { variant: "secondary" as const, color: "text-orange-600", bg: "bg-orange-50" },
  };

  const config = variants[plan as keyof typeof variants] || variants.starter;

  return (
    <Badge variant={config.variant} className={`${config.color} ${config.bg}`}>
      {plan.charAt(0).toUpperCase() + plan.slice(1)}
    </Badge>
  );
}

// 🔒 SUPER ADMIN: Metrics Cards Component
function TenantMetricsCards({ metrics, isLoading }: { metrics?: TenantMetrics; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-6 w-12" />
            </CardHeader>
          </Card>
        ))}
      </div>
    );
  }

  if (!metrics) return null;

  const cards = [
    {
      title: "Total Reservations",
      value: metrics.totalReservations?.toLocaleString() || "0",
      icon: Calendar,
      description: `${metrics.activeReservations || 0} active`,
      color: "text-blue-600",
      bgColor: "bg-blue-50"
    },
    {
      title: "Tables",
      value: metrics.totalTables || "0",
      icon: Database,
      description: "Configured tables",
      color: "text-green-600",
      bgColor: "bg-green-50"
    },
    {
      title: "Users",
      value: metrics.totalUsers || "0",
      icon: User,
      description: "Total users",
      color: "text-purple-600",
      bgColor: "bg-purple-50"
    },
    {
      title: "Completion Rate",
      value: `${metrics.completionRate || 0}%`,
      icon: BarChart3,
      description: "Reservation completion",
      color: "text-orange-600",
      bgColor: "bg-orange-50"
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {cards.map((card, index) => {
        const Icon = card.icon;
        return (
          <Card key={index}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardDescription className="text-xs font-medium">
                  {card.title}
                </CardDescription>
                <div className={`p-1.5 rounded-full ${card.bgColor}`}>
                  <Icon className={`h-3 w-3 ${card.color}`} />
                </div>
              </div>
              <div className="space-y-1">
                <CardTitle className="text-xl font-bold">
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

// 🔒 SUPER ADMIN: Suspend Tenant Dialog
function SuspendTenantDialog({ 
  tenant, 
  onSuccess 
}: { 
  tenant: TenantDetails; 
  onSuccess: () => void; 
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [notifyOwner, setNotifyOwner] = useState(true);
  const { toast } = useToast();

  const suspendMutation = useMutation({
    mutationFn: (data: { reason: string; notifyOwner: boolean }) => 
      suspendTenant(tenant.id.toString(), data),
    onSuccess: () => {
      toast({
        title: "Tenant Suspended",
        description: `${tenant.name} has been suspended successfully.`,
      });
      setOpen(false);
      setReason("");
      onSuccess();
    },
    onError: (error: any) => {
      toast({
        title: "Suspension Failed",
        description: error.message || "Failed to suspend tenant",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!reason.trim()) {
      toast({
        title: "Reason Required",
        description: "Please provide a reason for suspension",
        variant: "destructive",
      });
      return;
    }
    suspendMutation.mutate({ reason, notifyOwner });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Ban className="h-4 w-4 mr-2" />
          Suspend Tenant
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            Suspend Tenant
          </DialogTitle>
          <DialogDescription>
            This will immediately suspend <strong>{tenant.name}</strong> and prevent access to their account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reason">Suspension Reason *</Label>
            <Textarea
              id="reason"
              placeholder="Explain why this tenant is being suspended..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="notifyOwner"
              checked={notifyOwner}
              onCheckedChange={setNotifyOwner}
            />
            <Label htmlFor="notifyOwner" className="text-sm">
              Notify tenant owner via email
            </Label>
          </div>

          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              This action will immediately block access to the tenant's dashboard and services.
            </AlertDescription>
          </Alert>

          <div className="flex justify-end space-x-3">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={suspendMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleSubmit}
              disabled={suspendMutation.isPending}
            >
              {suspendMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Suspending...
                </>
              ) : (
                <>
                  <Ban className="mr-2 h-4 w-4" />
                  Suspend Tenant
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// 🔒 SUPER ADMIN: Reactivate Tenant Dialog
function ReactivateTenantDialog({ 
  tenant, 
  onSuccess 
}: { 
  tenant: TenantDetails; 
  onSuccess: () => void; 
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [notifyOwner, setNotifyOwner] = useState(true);
  const { toast } = useToast();

  const reactivateMutation = useMutation({
    mutationFn: (data: { notes: string; notifyOwner: boolean }) => 
      reactivateTenant(tenant.id.toString(), data),
    onSuccess: () => {
      toast({
        title: "Tenant Reactivated",
        description: `${tenant.name} has been reactivated successfully.`,
      });
      setOpen(false);
      setNotes("");
      onSuccess();
    },
    onError: (error: any) => {
      toast({
        title: "Reactivation Failed",
        description: error.message || "Failed to reactivate tenant",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    reactivateMutation.mutate({ notes, notifyOwner });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Reactivate Tenant
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            Reactivate Tenant
          </DialogTitle>
          <DialogDescription>
            This will restore access for <strong>{tenant.name}</strong> and their users.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notes">Reactivation Notes (Optional)</Label>
            <Textarea
              id="notes"
              placeholder="Add any notes about the reactivation..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="notifyOwner"
              checked={notifyOwner}
              onCheckedChange={setNotifyOwner}
            />
            <Label htmlFor="notifyOwner" className="text-sm">
              Notify tenant owner via email
            </Label>
          </div>

          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              This will immediately restore full access to the tenant's services.
            </AlertDescription>
          </Alert>

          <div className="flex justify-end space-x-3">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={reactivateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={reactivateMutation.isPending}
            >
              {reactivateMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Reactivating...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Reactivate Tenant
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// 🔒 SUPER ADMIN: Main Manage Tenant Component
export default function ManageTenantPage() {
  const { user } = useSuperAdmin();
  const [, navigate] = useLocation();
  const params = useParams();
  const tenantId = params.id as string;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Queries
  const {
    data: tenantData,
    isLoading: isLoadingTenant,
    error: tenantError,
  } = useQuery({
    queryKey: ['tenant', tenantId],
    queryFn: () => fetchTenantDetails(tenantId),
    enabled: !!tenantId,
  });

  const {
    data: auditData,
    isLoading: isLoadingAudit,
  } = useQuery({
    queryKey: ['tenant-audit', tenantId],
    queryFn: () => fetchTenantAuditLogs(tenantId),
    enabled: !!tenantId,
  });

  const tenant = tenantData?.tenant as TenantDetails;
  const metrics = tenantData?.metrics as TenantMetrics;
  const auditLogs = auditData?.auditLogs as TenantAuditLog[];

  // Form for tenant updates
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
    setValue,
    watch,
  } = useForm<UpdateTenantForm>({
    resolver: zodResolver(updateTenantSchema),
  });

  // Reset form when tenant data loads
  useEffect(() => {
    if (tenant) {
      reset({
        restaurantName: tenant.name,
        subdomain: tenant.subdomain,
        plan: tenant.tenantPlan,
        status: tenant.tenantStatus,
        timezone: tenant.timezone,
        enableAiChat: tenant.features.enableAiChat,
        enableTelegramBot: tenant.features.enableTelegramBot,
        enableGuestAnalytics: tenant.features.enableGuestAnalytics,
        enableAdvancedReporting: tenant.features.enableAdvancedReporting,
        enableMenuManagement: tenant.features.enableMenuManagement,
        maxTables: tenant.limits.maxTables,
        maxUsers: tenant.limits.maxUsers,
        maxReservationsPerMonth: tenant.limits.maxReservationsPerMonth,
        adminNotes: tenant.adminNotes,
      });
    }
  }, [tenant, reset]);

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Partial<UpdateTenantForm>) => updateTenant(tenantId, data),
    onSuccess: () => {
      toast({
        title: "Tenant Updated",
        description: "Tenant settings have been saved successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] });
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update tenant",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: UpdateTenantForm) => {
    updateMutation.mutate(data);
  };

  const handleRefreshData = () => {
    queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] });
    queryClient.invalidateQueries({ queryKey: ['tenant-audit', tenantId] });
  };

  // Loading state
  if (isLoadingTenant) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-6">
            <Skeleton className="h-8 w-64 mb-2" />
            <Skeleton className="h-4 w-96" />
          </div>
          <div className="space-y-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-4 w-72" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-32 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (tenantError || !tenant) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center gap-4 mb-6">
            <Button
              variant="ghost"
              onClick={() => navigate('/admin/dashboard')}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Button>
          </div>
          
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load tenant details. The tenant may not exist or you may not have permission to view it.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 🔒 Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-4">
              <Button
                variant="ghost"
                onClick={() => navigate('/admin/dashboard')}
                className="flex items-center gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Dashboard
              </Button>
              <Separator orientation="vertical" className="h-6" />
              <div className="flex items-center gap-3">
                <Building2 className="h-6 w-6 text-blue-600" />
                <div>
                  <h1 className="text-lg font-semibold text-slate-900">{tenant.name}</h1>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Globe className="h-3 w-3" />
                    {tenant.subdomain}.yourdomain.com
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <StatusBadge status={tenant.tenantStatus} />
              <PlanBadge plan={tenant.tenantPlan} />
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefreshData}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 🔒 Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Tenant Metrics */}
        <TenantMetricsCards metrics={metrics} isLoading={isLoadingTenant} />

        {/* Main Content Tabs */}
        <Tabs defaultValue="settings" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Settings
            </TabsTrigger>
            <TabsTrigger value="features" className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Features
            </TabsTrigger>
            <TabsTrigger value="actions" className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Actions
            </TabsTrigger>
            <TabsTrigger value="audit" className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Audit Log
            </TabsTrigger>
          </TabsList>

          {/* Settings Tab */}
          <TabsContent value="settings">
            <form onSubmit={handleSubmit(onSubmit)}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Basic Information */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Building2 className="h-5 w-5" />
                      Basic Information
                    </CardTitle>
                    <CardDescription>
                      Core tenant details and configuration
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="restaurantName">Restaurant Name</Label>
                      <Input
                        id="restaurantName"
                        {...register("restaurantName")}
                      />
                      {errors.restaurantName && (
                        <p className="text-sm text-red-600">{errors.restaurantName.message}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="subdomain">Subdomain</Label>
                      <Input
                        id="subdomain"
                        {...register("subdomain")}
                      />
                      {errors.subdomain && (
                        <p className="text-sm text-red-600">{errors.subdomain.message}</p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="plan">Plan</Label>
                        <Select onValueChange={(value) => setValue('plan', value as any)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="starter">Starter</SelectItem>
                            <SelectItem value="professional">Professional</SelectItem>
                            <SelectItem value="enterprise">Enterprise</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="status">Status</Label>
                        <Select onValueChange={(value) => setValue('status', value as any)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="suspended">Suspended</SelectItem>
                            <SelectItem value="terminated">Terminated</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="timezone">Timezone</Label>
                      <Input
                        id="timezone"
                        {...register("timezone")}
                        placeholder="America/New_York"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Owner Information */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <User className="h-5 w-5" />
                      Owner Information
                    </CardTitle>
                    <CardDescription>
                      Restaurant owner contact details
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                        <User className="h-4 w-4 text-slate-600" />
                        <div>
                          <p className="font-medium text-slate-900">{tenant.ownerName}</p>
                          <p className="text-sm text-slate-600">Owner</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                        <Mail className="h-4 w-4 text-slate-600" />
                        <div>
                          <p className="font-medium text-slate-900">{tenant.ownerEmail}</p>
                          <p className="text-sm text-slate-600">Email</p>
                        </div>
                      </div>

                      {tenant.ownerPhone && (
                        <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                          <Phone className="h-4 w-4 text-slate-600" />
                          <div>
                            <p className="font-medium text-slate-900">{tenant.ownerPhone}</p>
                            <p className="text-sm text-slate-600">Phone</p>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                        <Calendar className="h-4 w-4 text-slate-600" />
                        <div>
                          <p className="font-medium text-slate-900">
                            {new Date(tenant.createdAt).toLocaleDateString()}
                          </p>
                          <p className="text-sm text-slate-600">Account Created</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Limits Configuration */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="h-5 w-5" />
                      Usage Limits
                    </CardTitle>
                    <CardDescription>
                      Set maximum limits for tenant resources
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="maxTables">Max Tables</Label>
                      <Input
                        id="maxTables"
                        type="number"
                        {...register("maxTables", { valueAsNumber: true })}
                        placeholder="Unlimited"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="maxUsers">Max Users</Label>
                      <Input
                        id="maxUsers"
                        type="number"
                        {...register("maxUsers", { valueAsNumber: true })}
                        placeholder="Unlimited"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="maxReservationsPerMonth">Max Reservations/Month</Label>
                      <Input
                        id="maxReservationsPerMonth"
                        type="number"
                        {...register("maxReservationsPerMonth", { valueAsNumber: true })}
                        placeholder="Unlimited"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Admin Notes */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Edit className="h-5 w-5" />
                      Admin Notes
                    </CardTitle>
                    <CardDescription>
                      Internal notes for this tenant
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      {...register("adminNotes")}
                      placeholder="Add internal notes about this tenant..."
                      rows={4}
                    />
                  </CardContent>
                </Card>
              </div>

              {/* Save Button */}
              {isDirty && (
                <div className="flex justify-end mt-6">
                  <Button
                    type="submit"
                    disabled={updateMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {updateMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save Changes
                      </>
                    )}
                  </Button>
                </div>
              )}
            </form>
          </TabsContent>

          {/* Features Tab */}
          <TabsContent value="features">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Feature Configuration
                </CardTitle>
                <CardDescription>
                  Enable or disable features for this tenant
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 border rounded-lg">
                      <div>
                        <h4 className="font-medium">AI Chat Assistant</h4>
                        <p className="text-sm text-slate-600">Enable Sofia AI booking assistant</p>
                      </div>
                      <Switch {...register("enableAiChat")} />
                    </div>

                    <div className="flex items-center justify-between p-4 border rounded-lg">
                      <div>
                        <h4 className="font-medium">Telegram Bot</h4>
                        <p className="text-sm text-slate-600">Enable Telegram integration</p>
                      </div>
                      <Switch {...register("enableTelegramBot")} />
                    </div>

                    <div className="flex items-center justify-between p-4 border rounded-lg">
                      <div>
                        <h4 className="font-medium">Guest Analytics</h4>
                        <p className="text-sm text-slate-600">Track guest behavior and preferences</p>
                      </div>
                      <Switch {...register("enableGuestAnalytics")} />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 border rounded-lg">
                      <div>
                        <h4 className="font-medium">Advanced Reporting</h4>
                        <p className="text-sm text-slate-600">Detailed analytics and reports</p>
                      </div>
                      <Switch {...register("enableAdvancedReporting")} />
                    </div>

                    <div className="flex items-center justify-between p-4 border rounded-lg">
                      <div>
                        <h4 className="font-medium">Menu Management</h4>
                        <p className="text-sm text-slate-600">Digital menu creation and management</p>
                      </div>
                      <Switch {...register("enableMenuManagement")} />
                    </div>
                  </div>
                </div>

                {isDirty && (
                  <div className="flex justify-end mt-6">
                    <Button
                      onClick={handleSubmit(onSubmit)}
                      disabled={updateMutation.isPending}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      {updateMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          Save Features
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Actions Tab */}
          <TabsContent value="actions">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-red-600" />
                    Suspend Tenant
                  </CardTitle>
                  <CardDescription>
                    Temporarily disable access to this tenant's account
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-600 mb-4">
                    Suspending this tenant will immediately block access to their dashboard and services. 
                    This action can be reversed later.
                  </p>
                  <SuspendTenantDialog 
                    tenant={tenant} 
                    onSuccess={handleRefreshData}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    Reactivate Tenant
                  </CardTitle>
                  <CardDescription>
                    Restore access to a suspended tenant account
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-600 mb-4">
                    Reactivating this tenant will restore full access to their dashboard and services.
                  </p>
                  <ReactivateTenantDialog 
                    tenant={tenant} 
                    onSuccess={handleRefreshData}
                  />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Audit Log Tab */}
          <TabsContent value="audit">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Eye className="h-5 w-5" />
                  Audit Log
                </CardTitle>
                <CardDescription>
                  Complete history of administrative actions for this tenant
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingAudit ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex items-center space-x-3">
                        <Skeleton className="h-8 w-8 rounded-full" />
                        <div className="space-y-1 flex-1">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-3 w-1/2" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : auditLogs?.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Action</TableHead>
                        <TableHead>Admin</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell>
                            <div>
                              <div className="font-medium">{log.action}</div>
                              <div className="text-sm text-slate-600">{log.description}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              <div className="font-medium">{log.adminEmail}</div>
                              <div className="text-slate-600">ID: {log.adminId}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {new Date(log.timestamp).toLocaleString()}
                            </div>
                          </TableCell>
                          <TableCell>
                            {log.metadata && (
                              <pre className="text-xs bg-slate-50 p-2 rounded max-w-xs overflow-x-auto">
                                {JSON.stringify(log.metadata, null, 2)}
                              </pre>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8">
                    <Eye className="h-8 w-8 mx-auto mb-2 text-slate-400" />
                    <p className="text-slate-500">No audit logs found</p>
                    <p className="text-sm text-slate-400">Administrative actions will appear here</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}