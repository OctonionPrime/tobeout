import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db, pool, getDatabaseHealth } from "./db";
import {
    insertUserSchema, insertRestaurantSchema,
    insertTableSchema, insertGuestSchema,
    insertReservationSchema, insertIntegrationSettingSchema,
    reservations,
    type Guest
} from "@shared/schema";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { initializeTelegramBot } from "./services/telegram";
import {
    createReservation,
    cancelReservation,
    findAvailableTables,
    findAlternativeSlots,
} from "./services/booking";
import { getAvailableTimeSlots, isTableAvailableAtTimeSlot } from "./services/availability.service";
import { cache, CacheKeys, CacheInvalidation, withCache } from "./cache";
import { getPopularRestaurantTimezones, getRestaurantOperatingStatus } from "./utils/timezone-utils";
import { eq, and, desc, sql, count, or, inArray, gt, ne, notExists } from "drizzle-orm";
import { DateTime } from 'luxon';
import passport from "passport";
// Sofia AI Enhanced Conversation Manager
import { enhancedConversationManager } from "./services/enhanced-conversation-manager";

// Multi-tenant security middleware
import { tenantIsolation, strictTenantValidation, trackUsage, getTenantContext } from "./middleware/tenant-isolation";
import { 
    requireFeature, 
    requireAiChat, 
    requireMenuManagement, 
    requireGuestAnalytics, 
    requireAdvancedReporting,
    requireTelegramBot
} from "./middleware/feature-flags";

// 🔒 SUPER ADMIN: User type interfaces (for TypeScript only - no auth setup)
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
}

type AuthenticatedUser = BaseTenantUser | SuperAdminUser;

// ✅ DYNAMIC: PostgreSQL timestamp parser that handles both formats
function parsePostgresTimestamp(timestamp: string): DateTime {
    if (!timestamp) {
        console.warn('[Routes] Empty timestamp provided');
        return DateTime.invalid('empty timestamp');
    }

    try {
        // Try ISO format first: "2025-06-23T10:00:00.000Z"
        let dt = DateTime.fromISO(timestamp, { zone: 'utc' });
        if (dt.isValid) {
            return dt;
        }

        // Try PostgreSQL format: "2025-06-23 10:00:00+00"
        const pgTimestamp = timestamp.replace(' ', 'T').replace('+00', 'Z');
        dt = DateTime.fromISO(pgTimestamp, { zone: 'utc' });
        if (dt.isValid) {
            return dt;
        }

        // Try without timezone indicator: "2025-06-23 10:00:00"
        if (timestamp.includes(' ') && !timestamp.includes('T')) {
            const isoFormat = timestamp.replace(' ', 'T') + 'Z';
            dt = DateTime.fromISO(isoFormat, { zone: 'utc' });
            if (dt.isValid) {
                return dt;
            }
        }

        console.error(`[Routes] Failed to parse timestamp: ${timestamp}`);
        return DateTime.invalid(`unparseable timestamp: ${timestamp}`);
    } catch (error) {
        console.error(`[Routes] Error parsing timestamp ${timestamp}:`, error);
        return DateTime.invalid(`parse error: ${error}`);
    }
}

// ✅ DYNAMIC: Overnight operation detection (works for ANY times)
function isOvernightOperation(openingTime: string, closingTime: string): boolean {
    const parseTime = (timeStr: string): number | null => {
        if (!timeStr) return null;
        const parts = timeStr.split(':');
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10) || 0;
        if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            return null;
        }
        return hours * 60 + minutes;
    };
    
    const openingMinutes = parseTime(openingTime);
    const closingMinutes = parseTime(closingTime);
    
    if (openingMinutes === null || closingMinutes === null) {
        return false;
    }
    
    return closingMinutes < openingMinutes;
}

export async function registerRoutes(app: Express): Promise<Server> {

    // 🔒 SUPER ADMIN: Authorization Middleware Functions
    
    // Basic authentication check (existing)
    const isAuthenticated = (req: Request, res: Response, next: Function) => {
        if (req.isAuthenticated()) {
            return next();
        }
        res.status(401).json({ message: "Unauthorized" });
    };

    // 🔒 SUPER ADMIN: Super Admin Authorization Middleware (NEW)
    const isSuperAdmin = (req: Request, res: Response, next: NextFunction) => {
        if (req.isAuthenticated()) {
            const user = req.user as AuthenticatedUser;
            if (user.isSuperAdmin && user.role === 'super_admin') {
                console.log(`[SuperAdmin] Access granted to ${user.email} (ID: ${user.id})`);
                return next();
            }
        }
        
        console.log(`[SuperAdmin] Access denied - user not authenticated as super admin`);
        res.status(403).json({ 
            message: "Super admin access required",
            code: 'INSUFFICIENT_PERMISSIONS'
        });
    };

    // 🔒 SUPER ADMIN: Super Admin Activity Logging Middleware (NEW)
    const logSuperAdminActivity = (action: string) => {
        return async (req: Request, res: Response, next: NextFunction) => {
            const user = req.user as SuperAdminUser;
            try {
                await storage.logSuperAdminActivity(user.id, action, {
                    method: req.method,
                    path: req.path,
                    params: req.params,
                    query: req.query,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                console.error(`[SuperAdmin] Failed to log activity:`, error);
                // Don't block the request if logging fails
            }
            next();
        };
    };

    // ============================================================================
    // 🔒 SUPER ADMIN: Authentication Routes (Enhanced with Dual Strategies)
    // ============================================================================

    // Tenant user registration (existing, unchanged)
    app.post("/api/auth/register", async (req, res, next) => {
        try {
            const userSchema = insertUserSchema.extend({
                confirmPassword: z.string(),
                restaurantName: z.string(),
            });
            const validatedData = userSchema.parse(req.body);
            if (validatedData.password !== validatedData.confirmPassword) {
                return res.status(400).json({ message: "Passwords do not match" });
            }
            const existingUser = await storage.getUserByEmail(validatedData.email);
            if (existingUser) {
                return res.status(400).json({ message: "Email already registered" });
            }
            const hashedPassword = await bcrypt.hash(validatedData.password, 10);
            const user = await storage.createUser({
                email: validatedData.email,
                password: hashedPassword,
                name: validatedData.name,
                role: 'restaurant',
                phone: validatedData.phone,
            });
            const restaurant = await storage.createRestaurant({
                userId: user.id,
                name: validatedData.restaurantName,
                phone: validatedData.phone,
            });
            req.login(user, (err) => {
                if (err) {
                    return next(err);
                }
                return res.status(201).json({
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    restaurant: {
                        id: restaurant.id,
                        name: restaurant.name,
                    },
                });
            });
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: "Validation failed", errors: error.errors });
            }
            next(error);
        }
    });

    // Tenant user login (enhanced to use specific strategy)
    app.post("/api/auth/login", passport.authenticate("local-tenant"), (req, res) => {
        const user = req.user as BaseTenantUser;
        console.log(`✅ [Auth] Tenant login successful: ${user.email}`);
        res.json({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            isSuperAdmin: false
        });
    });

    // 🔒 SUPER ADMIN: Super Admin Login Route (NEW)
    app.post("/api/superadmin/auth/login", passport.authenticate("local-superadmin"), (req, res) => {
        const user = req.user as SuperAdminUser;
        console.log(`✅ [SuperAdmin] Super admin login successful: ${user.email}`);
        res.json({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            isSuperAdmin: true,
            loginTime: new Date().toISOString()
        });
    });

    // Universal logout (works for both tenant users and super admins)
    app.post("/api/auth/logout", (req, res, next) => {
        const user = req.user as AuthenticatedUser | undefined;
        if (user) {
            console.log(`[Auth] Logout: ${user.email} (${user.isSuperAdmin ? 'Super Admin' : 'Tenant User'})`);
        }
        
        req.logout((err) => {
            if (err) {
                return next(err);
            }
            res.json({ success: true });
        });
    });

    // Enhanced auth status endpoint (returns role information)
    app.get("/api/auth/me", (req, res) => {
        if (!req.user) {
            return res.status(401).json({ message: "Not authenticated" });
        }
        const user = req.user as AuthenticatedUser;
        res.json({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            isSuperAdmin: user.isSuperAdmin
        });
    });

    // ============================================================================
    // 🔒 SUPER ADMIN: Tenant Management API Routes (NEW)
    // ============================================================================

    // 🔒 SUPER ADMIN: Get all tenants with filtering and pagination
    app.get("/api/superadmin/tenants", isSuperAdmin, logSuperAdminActivity('list_tenants'), async (req, res, next) => {
        try {
            const { 
                page = 1, 
                limit = 20, 
                status, 
                plan, 
                search,
                sortBy = 'created_at',
                sortOrder = 'desc'
            } = req.query;

            console.log(`[SuperAdmin] Fetching tenants: page=${page}, limit=${limit}, status=${status}, plan=${plan}`);

            const filters = {
                status: status ? String(status) : undefined,
                plan: plan ? String(plan) : undefined,
                searchQuery: search ? String(search) : undefined,
                page: parseInt(page as string),
                limit: Math.min(parseInt(limit as string), 100), // Cap at 100 for performance
                sortBy: String(sortBy),
                sortOrder: String(sortOrder) as 'asc' | 'desc'
            };

            const result = await storage.getAllTenants(filters);

            res.json({
                tenants: result.tenants,
                pagination: {
                    currentPage: result.pagination.currentPage,
                    totalPages: result.pagination.totalPages,
                    totalTenants: result.pagination.totalCount,
                    limit: result.pagination.limit,
                    hasNextPage: result.pagination.hasNextPage,
                    hasPreviousPage: result.pagination.hasPreviousPage
                },
                summary: {
                    totalTenants: result.summary.totalTenants,
                    activeTenants: result.summary.activeTenants,
                    suspendedTenants: result.summary.suspendedTenants,
                    planDistribution: result.summary.planDistribution
                },
                filters: filters,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('[SuperAdmin] Error fetching tenants:', error);
            next(error);
        }
    });

    // 🔒 SUPER ADMIN: Get specific tenant details
    app.get("/api/superadmin/tenants/:id", isSuperAdmin, logSuperAdminActivity('view_tenant'), async (req, res, next) => {
        try {
            const tenantId = parseInt(req.params.id);
            
            if (isNaN(tenantId)) {
                return res.status(400).json({ message: "Invalid tenant ID" });
            }

            console.log(`[SuperAdmin] Fetching tenant details: ${tenantId}`);

            const tenant = await storage.getTenantById(tenantId);
            if (!tenant) {
                return res.status(404).json({ message: "Tenant not found" });
            }

            // Get additional tenant metrics and usage
            const metrics = await storage.getTenantMetrics(tenantId);
            const usage = await storage.getTenantUsage(tenantId);
            const recentActivity = await storage.getTenantRecentActivity(tenantId, 10);

            res.json({
                tenant: tenant,
                metrics: metrics,
                usage: usage,
                recentActivity: recentActivity,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('[SuperAdmin] Error fetching tenant details:', error);
            next(error);
        }
    });

    // 🔒 SUPER ADMIN: Create new tenant
    app.post("/api/superadmin/tenants", isSuperAdmin, logSuperAdminActivity('create_tenant'), async (req, res, next) => {
        try {
            // Validation schema for tenant creation
            const createTenantSchema = z.object({
                // Restaurant details
                restaurantName: z.string().min(1, "Restaurant name is required"),
                subdomain: z.string().min(2, "Subdomain must be at least 2 characters").regex(/^[a-z0-9-]+$/, "Subdomain can only contain lowercase letters, numbers, and hyphens"),
                plan: z.enum(['starter', 'professional', 'enterprise']),
                timezone: z.string().default('UTC'),
                
                // Owner details
                ownerName: z.string().min(1, "Owner name is required"),
                ownerEmail: z.string().email("Valid email is required"),
                ownerPhone: z.string().optional(),
                initialPassword: z.string().min(6, "Password must be at least 6 characters"),
                
                // Feature configuration
                enableAiChat: z.boolean().default(true),
                enableTelegramBot: z.boolean().default(false),
                enableGuestAnalytics: z.boolean().default(true),
                enableAdvancedReporting: z.boolean().default(false),
                enableMenuManagement: z.boolean().default(true),
                
                // Optional settings
                maxTables: z.number().optional(),
                maxUsers: z.number().optional(),
                customSettings: z.record(z.any()).optional()
            });

            const validatedData = createTenantSchema.parse(req.body);
            
            console.log(`[SuperAdmin] Creating new tenant: ${validatedData.restaurantName} (${validatedData.subdomain})`);

            // Check if subdomain is already taken
            const existingTenant = await storage.getTenantBySubdomain(validatedData.subdomain);
            if (existingTenant) {
                return res.status(409).json({ 
                    message: "Subdomain already exists",
                    field: "subdomain"
                });
            }

            // Check if owner email is already used
            const existingUser = await storage.getUserByEmail(validatedData.ownerEmail);
            if (existingUser) {
                return res.status(409).json({ 
                    message: "Email address already registered",
                    field: "ownerEmail"
                });
            }

            // Create the tenant with owner account
            const tenant = await storage.createTenantWithOwner({
                restaurantName: validatedData.restaurantName,
                subdomain: validatedData.subdomain,
                plan: validatedData.plan,
                timezone: validatedData.timezone,
                ownerName: validatedData.ownerName,
                ownerEmail: validatedData.ownerEmail,
                ownerPhone: validatedData.ownerPhone,
                initialPassword: validatedData.initialPassword,
                features: {
                    enableAiChat: validatedData.enableAiChat,
                    enableTelegramBot: validatedData.enableTelegramBot,
                    enableGuestAnalytics: validatedData.enableGuestAnalytics,
                    enableAdvancedReporting: validatedData.enableAdvancedReporting,
                    enableMenuManagement: validatedData.enableMenuManagement
                },
                limits: {
                    maxTables: validatedData.maxTables,
                    maxUsers: validatedData.maxUsers
                },
                customSettings: validatedData.customSettings
            });

            console.log(`✅ [SuperAdmin] Created tenant: ${tenant.restaurant.name} (ID: ${tenant.restaurant.id})`);

            res.status(201).json({
                tenant: tenant,
                message: "Tenant created successfully",
                loginInstructions: {
                    url: `https://${validatedData.subdomain}.yourdomain.com/login`,
                    email: validatedData.ownerEmail,
                    password: "Use the provided initial password"
                },
                timestamp: new Date().toISOString()
            });

        } catch (error: any) {
            console.error('[SuperAdmin] Error creating tenant:', error);
            if (error instanceof z.ZodError) {
                return res.status(400).json({ 
                    message: "Validation failed", 
                    errors: error.errors 
                });
            }
            next(error);
        }
    });

    // 🔒 SUPER ADMIN: Update tenant configuration
    app.patch("/api/superadmin/tenants/:id", isSuperAdmin, logSuperAdminActivity('update_tenant'), async (req, res, next) => {
        try {
            const tenantId = parseInt(req.params.id);
            
            if (isNaN(tenantId)) {
                return res.status(400).json({ message: "Invalid tenant ID" });
            }

            // Validation schema for tenant updates
            const updateTenantSchema = z.object({
                // Restaurant details
                restaurantName: z.string().min(1).optional(),
                subdomain: z.string().min(2).regex(/^[a-z0-9-]+$/).optional(),
                plan: z.enum(['starter', 'professional', 'enterprise']).optional(),
                status: z.enum(['active', 'suspended', 'terminated']).optional(),
                timezone: z.string().optional(),
                
                // Feature flags
                enableAiChat: z.boolean().optional(),
                enableTelegramBot: z.boolean().optional(),
                enableGuestAnalytics: z.boolean().optional(),
                enableAdvancedReporting: z.boolean().optional(),
                enableMenuManagement: z.boolean().optional(),
                
                // Limits
                maxTables: z.number().optional(),
                maxUsers: z.number().optional(),
                maxReservationsPerMonth: z.number().optional(),
                
                // Settings
                customSettings: z.record(z.any()).optional(),
                adminNotes: z.string().optional()
            });

            const validatedData = updateTenantSchema.parse(req.body);
            
            console.log(`[SuperAdmin] Updating tenant ${tenantId}:`, Object.keys(validatedData));

            // Check if tenant exists
            const existingTenant = await storage.getTenantById(tenantId);
            if (!existingTenant) {
                return res.status(404).json({ message: "Tenant not found" });
            }

            // If subdomain is being changed, check availability
            if (validatedData.subdomain && validatedData.subdomain !== existingTenant.subdomain) {
                const subdomainTaken = await storage.getTenantBySubdomain(validatedData.subdomain);
                if (subdomainTaken) {
                    return res.status(409).json({ 
                        message: "Subdomain already exists",
                        field: "subdomain"
                    });
                }
            }

            // Update tenant
            const updatedTenant = await storage.updateTenant(tenantId, validatedData);

            // If status changed to suspended, log it specifically
            if (validatedData.status === 'suspended') {
                await storage.logTenantAudit(tenantId, 'suspended', 'Tenant suspended by super admin', {
                    adminId: (req.user as SuperAdminUser).id,
                    reason: validatedData.adminNotes || 'No reason provided'
                });
            }

            console.log(`✅ [SuperAdmin] Updated tenant ${tenantId}: ${updatedTenant.name}`);

            res.json({
                tenant: updatedTenant,
                message: "Tenant updated successfully",
                timestamp: new Date().toISOString()
            });

        } catch (error: any) {
            console.error('[SuperAdmin] Error updating tenant:', error);
            if (error instanceof z.ZodError) {
                return res.status(400).json({ 
                    message: "Validation failed", 
                    errors: error.errors 
                });
            }
            next(error);
        }
    });

    // 🔒 SUPER ADMIN: Suspend tenant
    app.post("/api/superadmin/tenants/:id/suspend", isSuperAdmin, logSuperAdminActivity('suspend_tenant'), async (req, res, next) => {
        try {
            const tenantId = parseInt(req.params.id);
            const { reason, notifyOwner = true } = req.body;

            if (isNaN(tenantId)) {
                return res.status(400).json({ message: "Invalid tenant ID" });
            }

            console.log(`[SuperAdmin] Suspending tenant ${tenantId}. Reason: ${reason || 'No reason provided'}`);

            const tenant = await storage.getTenantById(tenantId);
            if (!tenant) {
                return res.status(404).json({ message: "Tenant not found" });
            }

            if (tenant.tenantStatus === 'suspended') {
                return res.status(400).json({ message: "Tenant is already suspended" });
            }

            // Suspend the tenant
            await storage.suspendTenant(tenantId, {
                reason: reason || 'Suspended by administrator',
                suspendedBy: (req.user as SuperAdminUser).id,
                notifyOwner: notifyOwner
            });

            // Log the suspension
            await storage.logTenantAudit(tenantId, 'suspended', reason || 'Suspended by administrator', {
                adminId: (req.user as SuperAdminUser).id,
                adminEmail: (req.user as SuperAdminUser).email,
                notifyOwner: notifyOwner
            });

            console.log(`✅ [SuperAdmin] Tenant ${tenantId} suspended successfully`);

            res.json({
                success: true,
                message: "Tenant suspended successfully",
                tenantId: tenantId,
                suspensionReason: reason || 'Suspended by administrator',
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('[SuperAdmin] Error suspending tenant:', error);
            next(error);
        }
    });

    // 🔒 SUPER ADMIN: Reactivate tenant
    app.post("/api/superadmin/tenants/:id/reactivate", isSuperAdmin, logSuperAdminActivity('reactivate_tenant'), async (req, res, next) => {
        try {
            const tenantId = parseInt(req.params.id);
            const { notes, notifyOwner = true } = req.body;

            if (isNaN(tenantId)) {
                return res.status(400).json({ message: "Invalid tenant ID" });
            }

            console.log(`[SuperAdmin] Reactivating tenant ${tenantId}`);

            const tenant = await storage.getTenantById(tenantId);
            if (!tenant) {
                return res.status(404).json({ message: "Tenant not found" });
            }

            if (tenant.tenantStatus === 'active') {
                return res.status(400).json({ message: "Tenant is already active" });
            }

            // Reactivate the tenant
            await storage.reactivateTenant(tenantId, {
                notes: notes || 'Reactivated by administrator',
                reactivatedBy: (req.user as SuperAdminUser).id,
                notifyOwner: notifyOwner
            });

            // Log the reactivation
            await storage.logTenantAudit(tenantId, 'reactivated', notes || 'Reactivated by administrator', {
                adminId: (req.user as SuperAdminUser).id,
                adminEmail: (req.user as SuperAdminUser).email,
                notifyOwner: notifyOwner
            });

            console.log(`✅ [SuperAdmin] Tenant ${tenantId} reactivated successfully`);

            res.json({
                success: true,
                message: "Tenant reactivated successfully",
                tenantId: tenantId,
                notes: notes || 'Reactivated by administrator',
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('[SuperAdmin] Error reactivating tenant:', error);
            next(error);
        }
    });

    // 🔒 SUPER ADMIN: Get platform metrics and analytics
    app.get("/api/superadmin/metrics", isSuperAdmin, logSuperAdminActivity('view_metrics'), async (req, res, next) => {
        try {
            const { timeframe = '30d', includeDetails = false } = req.query;

            console.log(`[SuperAdmin] Fetching platform metrics: timeframe=${timeframe}`);

            const metrics = await storage.getPlatformMetrics({
                timeframe: timeframe as string,
                includeDetails: includeDetails === 'true'
            });

            res.json({
                metrics: metrics,
                timeframe: timeframe,
                generatedAt: new Date().toISOString()
            });

        } catch (error) {
            console.error('[SuperAdmin] Error fetching platform metrics:', error);
            next(error);
        }
    });

    // 🔒 SUPER ADMIN: Get tenant audit logs
    app.get("/api/superadmin/tenants/:id/audit", isSuperAdmin, logSuperAdminActivity('view_audit_logs'), async (req, res, next) => {
        try {
            const tenantId = parseInt(req.params.id);
            const { limit = 50, offset = 0 } = req.query;

            if (isNaN(tenantId)) {
                return res.status(400).json({ message: "Invalid tenant ID" });
            }

            console.log(`[SuperAdmin] Fetching audit logs for tenant ${tenantId}`);

            const auditLogs = await storage.getTenantAuditLogs(tenantId, {
                limit: Math.min(parseInt(limit as string), 200),
                offset: parseInt(offset as string)
            });

            res.json({
                tenantId: tenantId,
                auditLogs: auditLogs,
                pagination: {
                    limit: parseInt(limit as string),
                    offset: parseInt(offset as string),
                    hasMore: auditLogs.length === parseInt(limit as string)
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('[SuperAdmin] Error fetching audit logs:', error);
            next(error);
        }
    });

    // 🔒 SUPER ADMIN: Super admin profile and settings
    app.get("/api/superadmin/profile", isSuperAdmin, async (req, res) => {
        const user = req.user as SuperAdminUser;
        
        try {
            const profile = await storage.getSuperAdminProfile(user.id);
            
            res.json({
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                profile: profile,
                permissions: ['manage_tenants', 'view_metrics', 'suspend_accounts', 'create_tenants'],
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[SuperAdmin] Error fetching profile:', error);
            res.status(500).json({ message: "Error fetching profile" });
        }
    });

    // ============================================================================
    // 🔒 REGULAR TENANT ROUTES (Enhanced with tenant isolation)
    // ============================================================================

    // 🔒 Restaurant routes with tenant isolation
    app.get("/api/restaurants/profile", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            res.json(context.restaurant);
        } catch (error) {
            next(error);
        }
    });

    app.patch("/api/restaurants/profile", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const validatedData = insertRestaurantSchema.partial().parse(req.body);

            const oldTimezone = context.restaurant.timezone;
            const newTimezone = validatedData.timezone;
            const isTimezoneChanging = newTimezone && oldTimezone !== newTimezone;

            if (isTimezoneChanging) {
                console.log(`🌍 [Profile] Restaurant ${context.restaurant.id} changing timezone: ${oldTimezone} → ${newTimezone}`);
            }

            const updatedRestaurant = await storage.updateRestaurant(context.restaurant.id, validatedData);

            if (isTimezoneChanging) {
                CacheInvalidation.onTimezoneChange(context.restaurant.id, oldTimezone, newTimezone);
                console.log(`✅ [Profile] Timezone change complete for restaurant ${context.restaurant.id}`);
            }

            res.json(updatedRestaurant);
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: "Validation failed", errors: error.errors });
            }
            next(error);
        }
    });

    // ✅ NEW: Restaurant Operating Status (Phase 3 Enhancement)
    app.get("/api/restaurants/:id/status", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const restaurantId = parseInt(req.params.id);
            
            if (context.restaurant.id !== restaurantId) {
                return res.status(403).json({ message: "Access denied" });
            }

            const operatingStatus = getRestaurantOperatingStatus(
                context.restaurant.timezone,
                context.restaurant.openingTime || '10:00:00',
                context.restaurant.closingTime || '22:00:00'
            );

            res.json({
                restaurantId: context.restaurant.id,
                restaurantName: context.restaurant.name,
                timezone: context.restaurant.timezone,
                ...operatingStatus,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[Restaurant Status] Error:', error);
            next(error);
        }
    });

    app.get("/api/timezones", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const timezones = getPopularRestaurantTimezones();
            res.json(timezones);
        } catch (error) {
            console.error('[Timezones] Error fetching timezone list:', error);
            next(error);
        }
    });

    // 🔒 Table routes with tenant isolation and usage tracking
    app.get("/api/tables", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const tables = await storage.getTables(context.restaurant.id);
            console.log(`🔍 [Tables] Found ${tables.length} tables for restaurant ${context.restaurant.id}`);
            res.json(tables);
        } catch (error) {
            console.error('❌ [Tables] Error fetching tables:', error);
            next(error);
        }
    });

    app.post("/api/tables", isAuthenticated, tenantIsolation, trackUsage('table_created'), async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const validatedData = insertTableSchema.parse({
                ...req.body,
                restaurantId: context.restaurant.id,
            });
            
            // 🔒 Pass tenant context for limit checking
            const newTable = await storage.createTable(validatedData, context);
            
            CacheInvalidation.onTableChange(context.restaurant.id);
            
            console.log(`✅ [Tables] Created new table: ${newTable.name} (ID: ${newTable.id})`);
            res.status(201).json(newTable);
        } catch (error: any) {
            console.error('❌ [Tables] Error creating table:', error);
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: "Validation failed", errors: error.errors });
            }
            // Handle tenant limit errors
            if (error.message.includes('limit')) {
                return res.status(402).json({ 
                    message: error.message,
                    code: 'LIMIT_EXCEEDED',
                    upgradeRequired: true
                });
            }
            next(error);
        }
    });

    app.patch("/api/tables/:id", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const tableId = parseInt(req.params.id);
            const table = await storage.getTable(tableId);
            
            if (!table || table.restaurantId !== context.restaurant.id) {
                return res.status(404).json({ message: "Table not found" });
            }
            
            const validatedData = insertTableSchema.partial().parse(req.body);
            const updatedTable = await storage.updateTable(tableId, validatedData);
            
            CacheInvalidation.onTableChange(context.restaurant.id);
            
            res.json(updatedTable);
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: "Validation failed", errors: error.errors });
            }
            next(error);
        }
    });

    app.delete("/api/tables/:id", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const tableId = parseInt(req.params.id);
            const table = await storage.getTable(tableId);
            
            if (!table || table.restaurantId !== context.restaurant.id) {
                return res.status(404).json({ message: "Table not found" });
            }
            
            await storage.deleteTable(tableId);
            
            CacheInvalidation.onTableChange(context.restaurant.id);
            
            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    });

    // 🔒 Guest routes with tenant isolation and analytics feature gating
    app.get("/api/guests", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const guestsData = await storage.getGuests(context.restaurant.id);
            res.json(guestsData);
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/guests", isAuthenticated, tenantIsolation, trackUsage('guest_added'), async (req, res, next) => {
        try {
            const validatedData = insertGuestSchema.parse(req.body);
            let guest: Guest | undefined = await storage.getGuestByPhone(validatedData.phone as string);
            if (guest) {
                guest = await storage.updateGuest(guest.id, validatedData);
            } else {
                guest = await storage.createGuest(validatedData);
            }
            res.status(201).json(guest);
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: "Validation failed", errors: error.errors });
            }
            next(error);
        }
    });

    // 🔒 Guest analytics with feature gate
    app.get("/api/guests/:id/analytics", isAuthenticated, tenantIsolation, requireGuestAnalytics, async (req, res, next) => {
        try {
            const guestId = parseInt(req.params.id);
            const context = getTenantContext(req);

            const guest = await storage.getGuest(guestId);
            if (!guest) {
                return res.status(404).json({ message: "Guest not found" });
            }

            const reservationHistory = await storage.getGuestReservationHistory(guestId, context.restaurant.id);
            
            // Calculate additional analytics
            const completedVisits = reservationHistory.filter(r => r.reservation.status === 'completed');
            const completionRate = reservationHistory.length > 0 ? 
                Math.round((completedVisits.length / reservationHistory.length) * 100) : 100;

            // Calculate loyalty status
            const getLoyaltyStatus = (guest: any): string => {
                const visits = guest.visit_count || 0;
                const reputationScore = guest.reputation_score || 100;
                
                if (visits >= 20 && reputationScore >= 95) return 'VIP';
                if (visits >= 10 && reputationScore >= 90) return 'Frequent';
                if (visits >= 5 && reputationScore >= 85) return 'Regular';
                if (reputationScore < 70) return 'Watch List';
                return 'New';
            };

            // Analyze preferred times
            const analyzePreferredTimes = (reservations: any[]): string[] => {
                const timeSlots = reservations.map(r => {
                    const dateTime = DateTime.fromISO(r.reservation.reservation_utc);
                    const hour = dateTime.hour;
                    if (hour < 12) return 'morning';
                    if (hour < 17) return 'afternoon';
                    if (hour < 21) return 'evening';
                    return 'late';
                });
                
                const counts = timeSlots.reduce((acc, slot) => {
                    acc[slot] = (acc[slot] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>);
                
                return Object.entries(counts)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 2)
                    .map(([slot]) => slot);
            };
            
            const analytics = {
                guest: {
                    ...guest,
                    loyaltyStatus: getLoyaltyStatus(guest)
                },
                visitCount: guest.visit_count || 0,
                noShowCount: guest.no_show_count || 0,
                reputationScore: guest.reputation_score || 100,
                vipLevel: guest.vip_level || 0,
                completionRate,
                averageSpending: guest.total_spent && guest.visit_count ? 
                    (parseFloat(guest.total_spent) / guest.visit_count).toFixed(2) : '0.00',
                totalSpent: guest.total_spent || '0.00',
                lastVisit: guest.last_visit_date,
                averageDuration: guest.average_duration || null,
                preferences: guest.preferences || {},
                preferredTimes: analyzePreferredTimes(reservationHistory),
                recentReservations: reservationHistory.slice(0, 5).map(r => ({
                    id: r.reservation.id,
                    date: r.reservation.reservation_utc,
                    status: r.reservation.status,
                    guests: r.reservation.guests,
                    table: r.table?.name,
                    totalAmount: r.reservation.totalAmount,
                    feedback: r.reservation.staffNotes
                })),
                statistics: {
                    totalReservations: reservationHistory.length,
                    completedReservations: completedVisits.length,
                    cancelledReservations: reservationHistory.filter(r => r.reservation.status === 'canceled').length,
                    noShowReservations: reservationHistory.filter(r => r.reservation.status === 'no_show').length
                },
                recommendations: {
                    approach: (() => {
                        const visits = guest.visit_count || 0;
                        const reputation = guest.reputation_score || 100;
                        
                        if (visits >= 10) return "VIP treatment - recognize their loyalty and offer premium service";
                        if (visits >= 5) return "Regular guest - personalized service based on their history";
                        if (reputation < 80) return "Handle with care - previous issues noted, ensure exceptional service";
                        return "Standard professional service - build positive relationship";
                    })(),
                    notes: `${guest.visit_count || 0} visits, ${guest.reputation_score || 100}% reputation score`
                }
            };

            console.log(`✅ [Guest Analytics] Retrieved analytics for guest ${guestId}: ${analytics.visitCount} visits, ${analytics.reputationScore}% reputation`);

            res.json(analytics);
        } catch (error) {
            console.error('[Guest Analytics] Error:', error);
            next(error);
        }
    });

    // ✅ FIXED: Table Availability with Centralized Logic from Service
    app.get("/api/tables/availability", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const { date, time } = req.query;
            const context = getTenantContext(req);
            
            if (!date || !time) {
                return res.status(400).json({ message: "Date and time are required" });
            }

            console.log(`🔍 [Table Availability] Checking for date=${date}, time=${time} in timezone ${context.restaurant.timezone}`);

            // ✅ DYNAMIC: Check if restaurant operates overnight (works for ANY times)
            const isOvernight = context.restaurant.openingTime && context.restaurant.closingTime && 
                               isOvernightOperation(context.restaurant.openingTime, context.restaurant.closingTime);

            if (isOvernight) {
                console.log(`🌙 [Table Availability] Detected overnight operation: ${context.restaurant.openingTime} to ${context.restaurant.closingTime}`);
            }

            const cacheKey = CacheKeys.tableAvailability(context.restaurant.id, `${date}_${time}`);
            const tableAvailabilityData = await withCache(cacheKey, async () => {
                const tablesData = await storage.getTables(context.restaurant.id);
                
                if (tablesData.length === 0) {
                    console.log(`⚠️ [Table Availability] No tables found for restaurant ${context.restaurant.id} - this might be why frontend shows empty arrays`);
                    return [];
                }
                
                console.log(`📋 [Table Availability] Found ${tablesData.length} tables for restaurant ${context.restaurant.id}`);
                
                // ✅ DYNAMIC: Enhanced reservation fetching for overnight operations
                let reservationsData;
                if (isOvernight) {
                    // Get reservations from current date
                    const currentDateReservations = await storage.getReservations(context.restaurant.id, { 
                        date: date as string,
                        timezone: context.restaurant.timezone
                    });
                    
                    // For overnight operations, also check previous day if checking early morning hours
                    const checkHour = parseInt((time as string).split(':')[0]);
                    const closingHour = parseInt((context.restaurant.closingTime || '0:00').split(':')[0]);
                    
                    if (checkHour < closingHour) { // Early morning hours (before closing time)
                        const previousDate = DateTime.fromISO(date as string, { zone: context.restaurant.timezone })
                            .minus({ days: 1 }).toISODate();
                        const previousDateReservations = await storage.getReservations(context.restaurant.id, { 
                            date: previousDate,
                            timezone: context.restaurant.timezone
                        });
                        
                        reservationsData = [...currentDateReservations, ...previousDateReservations];
                        console.log(`🌙 [Table Availability] Overnight operation: ${currentDateReservations.length} current + ${previousDateReservations.length} previous day reservations`);
                    } else {
                        reservationsData = currentDateReservations;
                    }
                } else {
                    // Standard operation - just get current date reservations
                    reservationsData = await storage.getReservations(context.restaurant.id, { 
                        date: date as string,
                        timezone: context.restaurant.timezone
                    });
                }

                console.log(`📊 [Table Availability] Found ${tablesData.length} tables and ${reservationsData.length} reservations for ${date} (${context.restaurant.timezone})`);

                // ✅ FIXED: Use centralized availability logic from service
                const availabilityResult = tablesData.map(table => {
                    const tableReservations = reservationsData.filter(r => {
                        const actualReservation = r.reservation || r;
                        return actualReservation.tableId === table.id && 
                               ['confirmed', 'created'].includes(actualReservation.status || '');
                    });

                    if (tableReservations.length > 0) {
                        console.log(`🔍 Table ${table.id} (${table.name}) has ${tableReservations.length} reservations`);
                    }

                    // Use a reasonable default for the slot duration check
                    const slotDuration = context.restaurant.avgReservationDuration || 120;

                    // ✅ FIXED: Use centralized function from availability service
                    // isTableAvailableAtTimeSlot returns true if it's FREE
                    // So, we check if ANY reservation makes it UNAVAILABLE
                    const isOccupied = tableReservations.some(r => {
                        const reservationDetails = {
                            reservation_utc: r.reservation?.reservation_utc || r.reservation_utc,
                            duration: r.reservation?.duration || r.duration,
                            id: r.reservation?.id || r.id
                        };
                        
                        // Note the "!" to invert the result
                        // If the table is NOT available, it is occupied
                        return !isTableAvailableAtTimeSlot(
                            table.id,
                            time as string,
                            [reservationDetails], // The function expects an array
                            slotDuration,
                            context.restaurant.timezone,
                            date as string,
                            isOvernight,
                            // Pass opening/closing times for proper overnight calculation
                            context.restaurant.openingTime ? parseInt(context.restaurant.openingTime.split(':')[0]) * 60 + parseInt(context.restaurant.openingTime.split(':')[1] || '0') : 0,
                            context.restaurant.closingTime ? parseInt(context.restaurant.closingTime.split(':')[0]) * 60 + parseInt(context.restaurant.closingTime.split(':')[1] || '0') : 1440
                        );
                    });

                    let conflictingReservationData = null;
                    if (isOccupied) {
                        // Find the specific conflicting reservation for display
                        const conflictingReservation = tableReservations.find(r => {
                            const reservationDetails = {
                                reservation_utc: r.reservation?.reservation_utc || r.reservation_utc,
                                duration: r.reservation?.duration || r.duration,
                                id: r.reservation?.id || r.id
                            };
                            
                            return !isTableAvailableAtTimeSlot(
                                table.id,
                                time as string,
                                [reservationDetails],
                                slotDuration,
                                context.restaurant.timezone,
                                date as string,
                                isOvernight,
                                context.restaurant.openingTime ? parseInt(context.restaurant.openingTime.split(':')[0]) * 60 + parseInt(context.restaurant.openingTime.split(':')[1] || '0') : 0,
                                context.restaurant.closingTime ? parseInt(context.restaurant.closingTime.split(':')[0]) * 60 + parseInt(context.restaurant.closingTime.split(':')[1] || '0') : 1440
                            );
                        });

                        if (conflictingReservation) {
                            const actualReservation = conflictingReservation.reservation || conflictingReservation;
                            const guest = conflictingReservation.guest || {};

                            const reservationDateTime = parsePostgresTimestamp(actualReservation.reservation_utc);
                            
                            if (reservationDateTime.isValid) {
                                const reservationLocal = reservationDateTime.setZone(context.restaurant.timezone);
                                const startTime = reservationLocal.toFormat('HH:mm:ss');
                                const duration = actualReservation.duration || 120;
                                const endTime = reservationLocal.plus({ minutes: duration }).toFormat('HH:mm:ss');

                                conflictingReservationData = {
                                    id: actualReservation.id,
                                    guestName: conflictingReservation.guestName || actualReservation.booking_guest_name || guest.name || 'Guest',
                                    guestCount: actualReservation.guests,
                                    timeSlot: `${startTime}-${endTime}`,
                                    phone: guest.phone || '',
                                    status: actualReservation.status
                                };
                            }
                        }
                    }

                    return { 
                        ...table, 
                        status: isOccupied ? 'reserved' : 'available', 
                        reservation: conflictingReservationData
                    };
                });

                console.log(`✅ [Table Availability] Processed ${availabilityResult.length} tables with timezone ${context.restaurant.timezone} (overnight: ${isOvernight})`);
                
                if (availabilityResult.length === 0) {
                    console.log(`❌ [Table Availability] RETURNING EMPTY ARRAY - Check table creation and restaurant association`);
                } else {
                    console.log(`✅ [Table Availability] Returning ${availabilityResult.length} tables:`, 
                        availabilityResult.map(t => ({ id: t.id, name: t.name, status: t.status })));
                }
                
                return availabilityResult;
            }, 30);

            res.json(tableAvailabilityData);
        } catch (error) {
            console.error('❌ [Table Availability] Error:', error);
            next(error);
        }
    });

    // ✅ ENHANCED: Available Times with Exact Time Support
    app.get("/api/booking/available-times", isAuthenticated, tenantIsolation, async (req: Request, res: Response, next) => {
        try {
            const { restaurantId, date, guests, exactTime } = req.query; // NEW: exactTime param
            const context = getTenantContext(req);
            
            if (parseInt(restaurantId as string) !== context.restaurant.id) {
                return res.status(403).json({ message: "Access denied to this restaurant" });
            }
            
            if (!restaurantId || !date || !guests) {
                return res.status(400).json({ message: "Missing required parameters" });
            }
            
            console.log(`[Routes] Getting available times for restaurant ${restaurantId}, date ${date}, guests ${guests} in timezone ${context.restaurant.timezone}${exactTime ? ` (exact time: ${exactTime})` : ''}`);
            
            // ✅ NEW: Handle exact time checking
            if (exactTime) {
                console.log(`[Routes] 🎯 Exact time check: ${exactTime} for ${guests} guests on ${date}`);
                
                const availableSlots = await getAvailableTimeSlots(
                    parseInt(restaurantId as string),
                    date as string,
                    parseInt(guests as string),
                    { 
                        requestedTime: exactTime as string,
                        exactTimeOnly: true, // NEW: Only check this exact time
                        timezone: context.restaurant.timezone,
                        allowCombinations: true
                    }
                );
                
                return res.json({
                    exactTimeRequested: exactTime,
                    available: availableSlots.length > 0,
                    availableSlots: availableSlots.map(slot => ({
                        time: slot.time,
                        timeDisplay: slot.timeDisplay,
                        available: true,
                        tableName: slot.tableName,
                        tableCapacity: slot.tableCapacity.max,
                        canAccommodate: true,
                        isCombined: slot.isCombined,
                        tablesCount: slot.isCombined ? slot.constituentTables?.length || 1 : 1,
                        message: `${slot.tableName} available at ${slot.timeDisplay}`
                    })),
                    timezone: context.restaurant.timezone,
                    slotInterval: context.restaurant.slotInterval || 30, // NEW: Include restaurant setting
                    allowAnyTime: context.restaurant.allowAnyTime !== false, // NEW: Include restaurant setting
                    minTimeIncrement: context.restaurant.minTimeIncrement || 15 // NEW: Include restaurant setting
                });
            }
            
            // ✅ EXISTING LOGIC (enhanced with restaurant settings):
            const isOvernight = context.restaurant.openingTime && context.restaurant.closingTime && 
                               isOvernightOperation(context.restaurant.openingTime, context.restaurant.closingTime);
            
            // Use restaurant's configured slot interval
            const slotInterval = context.restaurant.slotInterval || 30; // NEW: Use restaurant setting
            
            // ✅ ENHANCED: maxResults calculation for overnight operations
            let maxResults: number;
            let operatingHours: number;
            
            if (isOvernight) {
                // Calculate total operating hours for overnight operations
                const parseTime = (timeStr: string): number => {
                    const parts = timeStr.split(':');
                    return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
                };
                
                const openingMinutes = parseTime(context.restaurant.openingTime || '10:00');
                const closingMinutes = parseTime(context.restaurant.closingTime || '22:00');
                
                // ✅ DYNAMIC: For overnight operations, calculate correctly (works for ANY times)
                operatingHours = (24 * 60 - openingMinutes + closingMinutes) / 60;
                
                // ✅ DYNAMIC: More generous slot calculation for overnight operations
                maxResults = Math.max(80, Math.floor(operatingHours * 2.5)); // Extra buffer for overnight
                
                console.log(`[Routes] 🌙 Overnight operation detected: ${context.restaurant.openingTime}-${context.restaurant.closingTime} (${operatingHours.toFixed(1)} hours), maxResults=${maxResults}`);
            } else {
                // Standard operation
                const parseTime = (timeStr: string): number => {
                    const parts = timeStr.split(':');
                    return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
                };
                
                const openingMinutes = parseTime(context.restaurant.openingTime || '10:00');
                const closingMinutes = parseTime(context.restaurant.closingTime || '22:00');
                operatingHours = (closingMinutes - openingMinutes) / 60;
                
                maxResults = Math.max(30, Math.floor(operatingHours * 2));
                
                console.log(`[Routes] 📅 Standard operation: ${context.restaurant.openingTime}-${context.restaurant.closingTime} (${operatingHours.toFixed(1)} hours), maxResults=${maxResults}`);
            }
            
            // ✅ ENHANCED: Pass restaurant configuration to getAvailableTimeSlots
            const availableSlots = await getAvailableTimeSlots(
                parseInt(restaurantId as string),
                date as string,
                parseInt(guests as string),
                { 
                    maxResults: maxResults,
                    timezone: context.restaurant.timezone,
                    lang: 'en',
                    allowCombinations: true,
                    slotIntervalMinutes: slotInterval, // NEW: Use restaurant setting
                    slotDurationMinutes: context.restaurant.avgReservationDuration || 120,
                    operatingHours: {
                        open: context.restaurant.openingTime || '10:00:00',
                        close: context.restaurant.closingTime || '22:00:00'
                    }
                }
            );
            
            // ✅ ENHANCED: Better slot information with overnight support
            const timeSlots = availableSlots.map(slot => ({
                time: slot.time,
                timeDisplay: slot.timeDisplay,
                available: true,
                tableName: slot.tableName,
                tableCapacity: slot.tableCapacity.max,
                canAccommodate: true,
                tablesCount: slot.isCombined ? (slot.constituentTables?.length || 1) : 1,
                isCombined: slot.isCombined || false,
                message: slot.isCombined 
                    ? `${slot.tableName} available (seats up to ${slot.tableCapacity.max})`
                    : `Table ${slot.tableName} available (seats up to ${slot.tableCapacity.max})`,
                slotType: (() => {
                    const hour = parseInt(slot.time.split(':')[0]);
                    if (isOvernight) {
                        const closingHour = parseInt((context.restaurant.closingTime || '0:00').split(':')[0]);
                        const openingHour = parseInt((context.restaurant.openingTime || '0:00').split(':')[0]);
                        if (hour >= 0 && hour < closingHour) return 'early_morning';
                        if (hour >= openingHour) return 'late_night';
                        return 'day';
                    }
                    return 'standard';
                })()
            }));
            
            console.log(`[Routes] 📊 Found ${timeSlots.length} available time slots for ${context.restaurant.timezone} ${isOvernight ? '(overnight operation)' : '(standard operation)'}`);
            
            // ✅ ENHANCED: Response with restaurant time configuration
            res.json({ 
                availableSlots: timeSlots,
                isOvernightOperation: isOvernight,
                operatingHours: {
                    opening: context.restaurant.openingTime,
                    closing: context.restaurant.closingTime,
                    totalHours: operatingHours
                },
                timezone: context.restaurant.timezone,
                
                // ✅ NEW: Include restaurant's flexible time configuration
                slotInterval: slotInterval, // Restaurant's preferred slot interval
                allowAnyTime: context.restaurant.allowAnyTime !== false, // Whether any time booking is allowed
                minTimeIncrement: context.restaurant.minTimeIncrement || 15, // Minimum time precision
                
                totalSlotsGenerated: timeSlots.length,
                maxSlotsRequested: maxResults,
                reservationDuration: context.restaurant.avgReservationDuration || 120,
                
                debugInfo: {
                    openingTime: context.restaurant.openingTime,
                    closingTime: context.restaurant.closingTime,
                    isOvernight: isOvernight,
                    avgDuration: context.restaurant.avgReservationDuration || 120,
                    requestedDate: date,
                    requestedGuests: guests,
                    operatingHours: operatingHours,
                    calculatedMaxResults: maxResults,
                    actualSlotsReturned: timeSlots.length,
                    
                    // ✅ NEW: Debug info for time configuration
                    restaurantSlotInterval: context.restaurant.slotInterval,
                    restaurantAllowAnyTime: context.restaurant.allowAnyTime,
                    restaurantMinTimeIncrement: context.restaurant.minTimeIncrement
                }
            });
        } catch (error) {
            console.error('❌ [Available Times] Error:', error);
            next(error);
        }
    });

    // 🔒 Reservation routes with tenant isolation and usage tracking
    app.get("/api/reservations", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const filters = {
                date: req.query.date as string,
                status: req.query.status ? (req.query.status as string).split(',') : undefined,
                upcoming: req.query.upcoming === 'true',
                timezone: context.restaurant.timezone,
            };
            const reservationsData = await storage.getReservations(context.restaurant.id, filters);
            res.json(reservationsData);
        } catch (error) {
            next(error);
        }
    });

    app.get("/api/reservations/:id", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const reservationId = parseInt(req.params.id);
            const reservation = await storage.getReservation(reservationId);
            
            if (!reservation || reservation.reservation.restaurantId !== context.restaurant.id) {
                return res.status(404).json({ message: "Reservation not found" });
            }
            res.json(reservation);
        } catch (error) {
            next(error);
        }
    });

    // ✅ CRITICAL SECURITY FIX: Reservation creation with authenticated tenant ID
    app.post("/api/reservations", isAuthenticated, tenantIsolation, trackUsage('reservation_created'), async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const { guestName, guestPhone, date, time, guests: numGuests } = req.body;
            
            if (!guestName || !guestPhone || !date || !time || !numGuests) {
                return res.status(400).json({ message: "Missing required fields: guestName, guestPhone, date, time, guests" });
            }
            
            let guest: Guest | undefined = await storage.getGuestByPhone(guestPhone);
            if (!guest) {
                guest = await storage.createGuest({
                    name: guestName,
                    phone: guestPhone,
                    email: req.body.guestEmail || null,
                });
            }
            if (!guest) {
                return res.status(400).json({ message: "Guest information processing failed." });
            }

            // ✅ DYNAMIC: Convert date/time to UTC timestamp before booking
            const restaurantTimezone = req.body.timezone || context.restaurant.timezone;
            
            let localDateTime: DateTime;
            let reservation_utc: string;
            
            try {
                localDateTime = DateTime.fromISO(`${date}T${time}`, { zone: restaurantTimezone });
                if (!localDateTime.isValid) {
                    throw new Error(`Invalid date/time combination: ${date}T${time} in timezone ${restaurantTimezone}`);
                }
                
                reservation_utc = localDateTime.toUTC().toISO();
                if (!reservation_utc) {
                    throw new Error('Failed to convert to UTC timestamp');
                }
                
                console.log(`📅 [Reservation] Converting ${date}T${time} (${restaurantTimezone}) -> ${reservation_utc} (UTC)`);
            } catch (conversionError) {
                console.error('❌ [Reservation] DateTime conversion failed:', conversionError);
                return res.status(400).json({ 
                    message: "Invalid date/time format or timezone", 
                    details: conversionError instanceof Error ? conversionError.message : 'Unknown conversion error' 
                });
            }

            try {
                // ✅ CRITICAL SECURITY FIX: Pass authenticated tenant ID first, remove restaurantId from request
                const bookingResult = await createReservation(
                    context.restaurant.id, // ✅ Authenticated tenant ID from middleware
                    {
                        // ❌ REMOVED: restaurantId - no longer accepted by booking service
                        guestId: guest.id,
                        reservation_utc: reservation_utc,
                        guests: parseInt(numGuests as string),
                        timezone: restaurantTimezone,
                        comments: req.body.comments || '',
                        source: req.body.source || 'manual',
                        booking_guest_name: guestName,
                        lang: req.body.lang || context.restaurant.languages?.[0] || 'en',
                        tableId: req.body.tableId || undefined,
                    }
                );

                if (!bookingResult.success || !bookingResult.reservation) {
                    let statusCode = 400;
                    let errorType = 'VALIDATION_ERROR';

                    if (bookingResult.conflictType) {
                        switch (bookingResult.conflictType) {
                            case 'AVAILABILITY':
                                statusCode = 409;
                                errorType = 'TABLE_UNAVAILABLE';
                                break;
                            case 'DEADLOCK':
                                statusCode = 503;
                                errorType = 'SYSTEM_BUSY';
                                break;
                            case 'TRANSACTION':
                                statusCode = 409;
                                errorType = 'BOOKING_CONFLICT';
                                break;
                            default:
                                statusCode = 400;
                                errorType = 'VALIDATION_ERROR';
                        }
                    }

                    console.log(`❌ [Reservation Creation] Failed with type ${errorType}:`, bookingResult.message);

                    return res.status(statusCode).json({
                        message: bookingResult.message,
                        details: 'Smart table assignment could not find available slot or booking failed',
                        errorType: errorType,
                        conflictType: bookingResult.conflictType,
                        retryable: statusCode === 503 || statusCode === 409,
                        timestamp: new Date().toISOString()
                    });
                }

                CacheInvalidation.onReservationUtcChange(
                    context.restaurant.id,
                    bookingResult.reservation.reservation_utc,
                    restaurantTimezone,
                    bookingResult.reservation.duration || 120
                );

                console.log(`✅ [Reservation Creation] Success - Reservation ID ${bookingResult.reservation.id} created with UTC-based cache invalidation`);

                return res.status(201).json({
                    ...bookingResult.reservation,
                    guestName: guestName,
                    table: bookingResult.table,
                    smartAssignment: true,
                    allReservationIds: bookingResult.allReservationIds,
                    timestamp: new Date().toISOString()
                });

            } catch (bookingError: any) {
                console.error('❌ [Reservation Creation] Unexpected booking service error:', bookingError);

                // Handle tenant limit errors
                if (bookingError.message.includes('limit exceeded')) {
                    return res.status(402).json({
                        message: bookingError.message,
                        errorType: 'LIMIT_EXCEEDED',
                        upgradeRequired: true,
                        timestamp: new Date().toISOString()
                    });
                }

                if (bookingError.code === '40P01') {
                    return res.status(503).json({
                        message: "System busy - please try your booking again in a moment",
                        errorType: 'SYSTEM_BUSY',
                        conflictType: 'DEADLOCK',
                        retryable: true,
                        timestamp: new Date().toISOString()
                    });
                } else if (bookingError.code?.startsWith('40')) {
                    return res.status(409).json({
                        message: "Booking conflict detected - please try again",
                        errorType: 'BOOKING_CONFLICT',
                        conflictType: 'TRANSACTION',
                        retryable: true,
                        timestamp: new Date().toISOString()
                    });
                } else if (bookingError.message?.includes('no longer available')) {
                    return res.status(409).json({
                        message: bookingError.message,
                        errorType: 'TABLE_UNAVAILABLE',
                        conflictType: 'AVAILABILITY',
                        retryable: true,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    return res.status(500).json({
                        message: "An unexpected error occurred while processing your reservation",
                        errorType: 'INTERNAL_ERROR',
                        retryable: false,
                        timestamp: new Date().toISOString()
                    });
                }
            }

        } catch (error: any) {
            console.error('❌ [Reservation Route] Top-level error:', error);

            if (error instanceof z.ZodError) {
                return res.status(400).json({
                    message: "Validation failed",
                    errors: error.errors,
                    errorType: 'VALIDATION_ERROR',
                    retryable: false,
                    timestamp: new Date().toISOString()
                });
            }

            return res.status(500).json({
                message: "An unexpected error occurred",
                errorType: 'INTERNAL_ERROR',
                retryable: false,
                timestamp: new Date().toISOString()
            });
        }
    });

    app.patch("/api/reservations/:id", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const reservationId = parseInt(req.params.id);
            const existingResult = await storage.getReservation(reservationId);

            if (!existingResult || existingResult.reservation.restaurantId !== context.restaurant.id) {
                return res.status(404).json({ message: "Reservation not found" });
            }

            const existingReservation = existingResult.reservation;
            const validatedData = insertReservationSchema.partial().parse(req.body);

            CacheInvalidation.onReservationUtcChange(
                context.restaurant.id,
                existingReservation.reservation_utc,
                context.restaurant.timezone,
                existingReservation.duration || 120
            );

            // ✅ BUG 3 FIX: REMOVED DEAD CODE BLOCK
            // The dead code that checked for validatedData.date && validatedData.time has been removed
            // because the validation schema only supports reservation_utc, not separate date/time fields

            const updatedReservation = await storage.updateReservation(reservationId, validatedData);

            res.json(updatedReservation);
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: "Validation failed", errors: error.errors });
            }
            next(error);
        }
    });

    // ✅ CRITICAL SECURITY FIX: Reservation cancellation with authenticated tenant ID
    app.delete("/api/reservations/:id", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const reservationId = parseInt(req.params.id);
            const existingResult = await storage.getReservation(reservationId);

            if (!existingResult || existingResult.reservation.restaurantId !== context.restaurant.id) {
                return res.status(404).json({ message: "Reservation not found" });
            }

            const existingReservation = existingResult.reservation;

            // ✅ CRITICAL SECURITY FIX: Pass authenticated tenant ID first
            await cancelReservation(
                context.restaurant.id, // ✅ Authenticated tenant ID from middleware
                reservationId, 
                context.restaurant.languages?.[0] || 'en'
            );

            CacheInvalidation.onReservationUtcChange(
                context.restaurant.id,
                existingReservation.reservation_utc,
                context.restaurant.timezone,
                existingReservation.duration || 120
            );

            res.json({ success: true, message: "Reservation canceled successfully." });

        } catch (error) {
            next(error);
        }
    });

    // ✅ NEW: PHASE 3 - ENHANCED RESERVATION STATUS MANAGEMENT
    
    // Seat guests - transition from confirmed to seated
    app.post("/api/reservations/:id/seat", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const { tableNotes, staffMember } = req.body;
            const reservationId = parseInt(req.params.id);
            const context = getTenantContext(req);
            
            // Validate current status
            const reservation = await storage.getReservation(reservationId);
            if (!reservation || reservation.reservation.restaurantId !== context.restaurant.id) {
                return res.status(404).json({ message: "Reservation not found" });
            }
            
            if (!['confirmed', 'created'].includes(reservation.reservation.status)) {
                return res.status(400).json({ 
                    message: `Cannot seat guests - reservation status is ${reservation.reservation.status}. Only confirmed reservations can be seated.` 
                });
            }

            // Update status with history tracking
            await storage.updateReservationWithHistory(reservationId, {
                status: 'seated',
                staffNotes: tableNotes
            }, {
                changedBy: 'staff',
                changeReason: 'Manual seating by staff',
                metadata: { staffMember: staffMember || 'Unknown staff' }
            });

            // Update table status if there's a table assigned
            if (reservation.reservation.tableId) {
                await storage.updateTable(reservation.reservation.tableId, { 
                    status: 'occupied' 
                });
                
                // Invalidate table cache
                CacheInvalidation.onTableChange(context.restaurant.id);
            }

            console.log(`✅ [Reservation Status] Seated guests for reservation ${reservationId} by ${staffMember || 'Unknown staff'}`);

            res.json({ 
                success: true, 
                message: "Guests have been seated successfully",
                reservationId,
                newStatus: 'seated',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[Reservation Status] Error seating guests:', error);
            next(error);
        }
    });

    // Complete visit - transition from seated/in_progress to completed
    app.post("/api/reservations/:id/complete", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const { feedback, totalAmount, staffMember } = req.body;
            const reservationId = parseInt(req.params.id);
            const context = getTenantContext(req);
            
            const reservation = await storage.getReservation(reservationId);
            if (!reservation || reservation.reservation.restaurantId !== context.restaurant.id) {
                return res.status(404).json({ message: "Reservation not found" });
            }

            if (!['seated', 'in_progress'].includes(reservation.reservation.status)) {
                return res.status(400).json({ 
                    message: `Cannot complete visit - reservation status is ${reservation.reservation.status}. Only seated or in-progress reservations can be completed.` 
                });
            }

            // Calculate visit duration
            const seatedTime = await storage.getStatusChangeTime(reservationId, 'seated');
            const duration = seatedTime ? 
                Math.round((Date.now() - seatedTime.getTime()) / 60000) : 
                reservation.reservation.duration;

            // Update reservation
            await storage.updateReservationWithHistory(reservationId, {
                status: 'completed',
                totalAmount: totalAmount ? parseFloat(totalAmount) : null,
                staffNotes: feedback
            }, {
                changedBy: 'staff',
                changeReason: 'Visit completed by staff',
                metadata: { 
                    staffMember: staffMember || 'Unknown staff', 
                    actualDuration: duration,
                    totalAmount: totalAmount ? parseFloat(totalAmount) : null
                }
            });

            // Update guest analytics
            await storage.updateGuestAnalytics(reservation.reservation.guestId, {
                visitCompleted: true,
                duration,
                totalSpent: totalAmount ? parseFloat(totalAmount) : 0
            });

            // Free up table
            if (reservation.reservation.tableId) {
                await storage.updateTable(reservation.reservation.tableId, { 
                    status: 'free' 
                });
                
                // Invalidate table cache
                CacheInvalidation.onTableChange(context.restaurant.id);
            }

            console.log(`✅ [Reservation Status] Completed visit for reservation ${reservationId}, duration: ${duration}min, amount: $${totalAmount || 0}`);

            res.json({ 
                success: true, 
                message: "Visit completed successfully",
                reservationId,
                newStatus: 'completed',
                duration,
                totalAmount: totalAmount ? parseFloat(totalAmount) : null,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[Reservation Status] Error completing visit:', error);
            next(error);
        }
    });

    // Mark as no-show
    app.post("/api/reservations/:id/no-show", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const { reason, staffMember } = req.body;
            const reservationId = parseInt(req.params.id);
            const context = getTenantContext(req);
            
            const reservation = await storage.getReservation(reservationId);
            if (!reservation || reservation.reservation.restaurantId !== context.restaurant.id) {
                return res.status(404).json({ message: "Reservation not found" });
            }

            if (!['confirmed', 'created'].includes(reservation.reservation.status)) {
                return res.status(400).json({ 
                    message: `Cannot mark as no-show - reservation status is ${reservation.reservation.status}. Only confirmed reservations can be marked as no-show.` 
                });
            }

            await storage.updateReservationWithHistory(reservationId, {
                status: 'no_show',
                staffNotes: reason
            }, {
                changedBy: 'staff',
                changeReason: 'Marked as no-show by staff',
                metadata: { 
                    staffMember: staffMember || 'Unknown staff', 
                    reason: reason || 'No reason provided'
                }
            });

            // Update guest analytics (negative impact)
            await storage.updateGuestAnalytics(reservation.reservation.guestId, {
                noShowOccurred: true
            });

            // Free up table
            if (reservation.reservation.tableId) {
                await storage.updateTable(reservation.reservation.tableId, { 
                    status: 'free' 
                });
                
                // Invalidate table cache
                CacheInvalidation.onTableChange(context.restaurant.id);
            }

            console.log(`⚠️ [Reservation Status] Marked reservation ${reservationId} as no-show: ${reason || 'No reason provided'}`);

            res.json({ 
                success: true, 
                message: "Reservation marked as no-show",
                reservationId,
                newStatus: 'no_show',
                reason: reason || 'No reason provided',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[Reservation Status] Error marking no-show:', error);
            next(error);
        }
    });

    // Get reservation status history
    app.get("/api/reservations/:id/history", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const reservationId = parseInt(req.params.id);
            const context = getTenantContext(req);
            
            // Verify reservation belongs to this restaurant
            const reservation = await storage.getReservation(reservationId);
            if (!reservation || reservation.reservation.restaurantId !== context.restaurant.id) {
                return res.status(404).json({ message: "Reservation not found" });
            }
            
            const history = await storage.getReservationStatusHistory(reservationId);
            
            console.log(`📋 [Reservation History] Retrieved ${history.length} status changes for reservation ${reservationId}`);
            
            res.json({
                reservationId,
                history: history.map(entry => ({
                    id: entry.id,
                    fromStatus: entry.fromStatus,
                    toStatus: entry.toStatus,
                    changedBy: entry.changedBy,
                    changeReason: entry.changeReason,
                    timestamp: entry.timestamp,
                    metadata: entry.metadata
                })),
                totalChanges: history.length
            });
        } catch (error) {
            console.error('[Reservation History] Error:', error);
            next(error);
        }
    });

    // ✅ NEW: PHASE 3 - MENU MANAGEMENT SYSTEM with feature gate

    // Get menu items with advanced filtering
    app.get("/api/menu-items", isAuthenticated, tenantIsolation, requireMenuManagement, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const { category, available, search, popular, limit } = req.query;
            
            const filters = {
                category: category as string,
                availableOnly: available === 'true',
                searchQuery: search as string,
                popularOnly: popular === 'true',
                limit: limit ? parseInt(limit as string) : undefined
            };

            console.log(`🍽️ [Menu Items] Fetching menu items for restaurant ${context.restaurant.id} with filters:`, filters);

            const menuItems = await storage.getMenuItems(context.restaurant.id, filters);
            
            // Group by category for better UI organization
            const groupedItems = menuItems.reduce((acc, item) => {
                const cat = item.category || 'other';
                if (!acc[cat]) acc[cat] = [];
                acc[cat].push(item);
                return acc;
            }, {} as Record<string, any[]>);

            // Calculate summary statistics
            const stats = {
                totalItems: menuItems.length,
                availableItems: menuItems.filter(item => item.isAvailable).length,
                popularItems: menuItems.filter(item => item.isPopular).length,
                newItems: menuItems.filter(item => item.isNew).length,
                categoriesCount: Object.keys(groupedItems).length
            };

            console.log(`✅ [Menu Items] Retrieved ${menuItems.length} items across ${Object.keys(groupedItems).length} categories`);

            res.json({
                items: menuItems,
                groupedItems,
                categories: Object.keys(groupedItems),
                stats,
                filters: filters,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[Menu Items] Error fetching items:', error);
            next(error);
        }
    });

    // ✅ BUG 1 FIX: Create new menu item with category name lookup
    app.post("/api/menu-items", isAuthenticated, tenantIsolation, requireMenuManagement, async (req, res, next) => {
        try {
            const context = getTenantContext(req);

            // Basic validation schema for menu items
            const menuItemSchema = z.object({
                name: z.string().min(1, "Name is required"),
                description: z.string().optional(),
                price: z.string().or(z.number()).transform(val => String(val)),
                category: z.string().min(1, "Category is required"),
                allergens: z.array(z.string()).optional(),
                dietaryTags: z.array(z.string()).optional(),
                isAvailable: z.boolean().default(true),
                isPopular: z.boolean().default(false),
                isNew: z.boolean().default(false),
                preparationTime: z.number().optional(),
                spicyLevel: z.number().min(0).max(5).default(0)
            });

            const validatedData = menuItemSchema.parse(req.body);

            // ✅ BUG 1 FIX: Look up the category ID from the category name
            const category = await storage.getMenuCategoryByName(context.restaurant.id, validatedData.category);

            if (!category) {
                return res.status(400).json({ message: `Category '${validatedData.category}' not found.` });
            }

            const newItem = await storage.createMenuItem({
                name: validatedData.name,
                price: validatedData.price,
                description: validatedData.description,
                isAvailable: validatedData.isAvailable,
                isPopular: validatedData.isPopular,
                isNew: validatedData.isNew,
                preparationTime: validatedData.preparationTime,
                spicyLevel: validatedData.spicyLevel,
                allergens: validatedData.allergens,
                dietaryTags: validatedData.dietaryTags,
                restaurantId: context.restaurant.id,
                categoryId: category.id  // ✅ BUG 1 FIX: Use the correct numeric categoryId
            });
            
            // Invalidate menu cache
            cache.invalidatePattern(`menu_items_${context.restaurant.id}`);
            
            console.log(`✅ [Menu Items] Created new item: ${newItem.name} (${validatedData.category}) - ${newItem.price}`);

            res.status(201).json({
                ...newItem,
                message: "Menu item created successfully"
            });
        } catch (error: any) {
            console.error('[Menu Items] Error creating item:', error);
            if (error instanceof z.ZodError) {
                return res.status(400).json({ 
                    message: "Validation failed", 
                    errors: error.errors 
                });
            }
            next(error);
        }
    });

    // Update menu item
    app.patch("/api/menu-items/:id", isAuthenticated, tenantIsolation, requireMenuManagement, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const itemId = parseInt(req.params.id);
            
            // Verify the item belongs to this restaurant
            const existingItem = await storage.getMenuItem(itemId);
            if (!existingItem || existingItem.restaurantId !== context.restaurant.id) {
                return res.status(404).json({ message: "Menu item not found" });
            }

            const updatedItem = await storage.updateMenuItem(itemId, req.body);
            
            // Invalidate menu cache
            cache.invalidatePattern(`menu_items_${context.restaurant.id}`);
            
            console.log(`✅ [Menu Items] Updated item ${itemId}: ${updatedItem.name}`);

            res.json({
                ...updatedItem,
                message: "Menu item updated successfully"
            });
        } catch (error) {
            console.error('[Menu Items] Error updating item:', error);
            next(error);
        }
    });

    // Delete menu item
    app.delete("/api/menu-items/:id", isAuthenticated, tenantIsolation, requireMenuManagement, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const itemId = parseInt(req.params.id);
            
            // Verify the item belongs to this restaurant
            const existingItem = await storage.getMenuItem(itemId);
            if (!existingItem || existingItem.restaurantId !== context.restaurant.id) {
                return res.status(404).json({ message: "Menu item not found" });
            }

            await storage.deleteMenuItem(itemId);
            
            // Invalidate menu cache
            cache.invalidatePattern(`menu_items_${context.restaurant.id}`);
            
            console.log(`🗑️ [Menu Items] Deleted item ${itemId}: ${existingItem.name}`);

            res.json({ 
                success: true, 
                message: "Menu item deleted successfully",
                deletedItem: { id: itemId, name: existingItem.name }
            });
        } catch (error) {
            console.error('[Menu Items] Error deleting item:', error);
            next(error);
        }
    });

    // Bulk update menu items
    app.put("/api/menu-items/bulk", isAuthenticated, tenantIsolation, requireMenuManagement, async (req, res, next) => {
        try {
            const { items, action } = req.body; // action: 'availability', 'prices', 'categories'
            const context = getTenantContext(req);

            if (!items || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ message: "Items array is required and must not be empty" });
            }

            if (!action || !['availability', 'prices', 'categories', 'delete'].includes(action)) {
                return res.status(400).json({ message: "Valid action is required: availability, prices, categories, or delete" });
            }

            console.log(`🔄 [Menu Items] Bulk ${action} update for ${items.length} items in restaurant ${context.restaurant.id}`);

            const results = await storage.bulkUpdateMenuItems(context.restaurant.id, items, action);
            
            // Invalidate cache
            cache.invalidatePattern(`menu_items_${context.restaurant.id}`);
            
            console.log(`✅ [Menu Items] Bulk ${action} completed: ${results.length} items processed`);
            
            res.json({ 
                success: true, 
                action,
                updatedCount: results.length,
                items: results,
                message: `Bulk ${action} update completed successfully`
            });
        } catch (error) {
            console.error('[Menu Items] Error in bulk update:', error);
            next(error);
        }
    });

    // Search menu items (enhanced search)
    app.get("/api/menu-items/search", isAuthenticated, tenantIsolation, requireMenuManagement, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const { q: query, category, dietary, priceMin, priceMax } = req.query;
            
            if (!query || typeof query !== 'string') {
                return res.status(400).json({ message: "Search query is required" });
            }

            console.log(`🔍 [Menu Search] Searching for "${query}" in restaurant ${context.restaurant.id}`);

            // Enhanced search with multiple strategies
            const searchResults = await storage.searchMenuItems(context.restaurant.id, {
                query: query as string,
                category: category as string,
                dietaryRestrictions: dietary ? (dietary as string).split(',') : undefined,
                priceRange: {
                    min: priceMin ? parseFloat(priceMin as string) : undefined,
                    max: priceMax ? parseFloat(priceMax as string) : undefined
                }
            });

            // Log search for analytics
            await storage.logMenuSearch(context.restaurant.id, query as string, 'staff_search');

            console.log(`✅ [Menu Search] Found ${searchResults.length} results for "${query}"`);

            res.json({
                query,
                results: searchResults,
                resultCount: searchResults.length,
                searchFilters: {
                    category,
                    dietary,
                    priceRange: { min: priceMin, max: priceMax }
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[Menu Search] Error:', error);
            next(error);
        }
    });

    // 🔒 Dashboard data with tenant isolation
    app.get("/api/dashboard/stats", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const stats = await storage.getReservationStatistics(context.restaurant.id, context.restaurant.timezone);
            res.json(stats);
        } catch (error) {
            next(error);
        }
    });

    app.get("/api/dashboard/upcoming", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const hours = parseInt(req.query.hours as string) || 3;
            const upcoming = await storage.getUpcomingReservations(context.restaurant.id, context.restaurant.timezone, hours);
            res.json(upcoming);
        } catch (error) {
            next(error);
        }
    });

    // 🔒 AI Assistant Activity with tenant isolation and usage tracking
    app.get("/api/ai/activities", isAuthenticated, tenantIsolation, requireAiChat, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const limit = parseInt(req.query.limit as string) || 10;
            const activities = await storage.getAiActivities(context.restaurant.id, limit);
            res.json(activities);
        } catch (error) {
            next(error);
        }
    });

    // 🔒 Integration settings with tenant isolation
    app.get("/api/integrations/:type", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const type = req.params.type;
            
            // Check feature access for telegram
            if (type === 'telegram' && !context.features.telegramBot) {
                return res.status(402).json({
                    error: 'Telegram integration not available on your plan',
                    upgradeRequired: true,
                    feature: 'telegramBot'
                });
            }

            const settings = await storage.getIntegrationSettings(context.restaurant.id, type);
            if (!settings) {
                return res.json({ enabled: false });
            }
            res.json(settings);
        } catch (error) {
            next(error);
        }
    });

    app.get("/api/integrations/telegram/test", isAuthenticated, tenantIsolation, requireTelegramBot, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const settings = await storage.getIntegrationSettings(context.restaurant.id, 'telegram');
            
            if (!settings || !settings.enabled || !settings.token) {
                return res.status(400).json({ message: "Telegram bot is not configured or enabled" });
            }
            
            try {
                const TelegramBot = require('node-telegram-bot-api');
                const bot = new TelegramBot(settings.token);
                const botInfo = await bot.getMe();
                const updatedSettingsData = {
                    ...settings,
                    settings: {
                        ...(settings.settings || {}),
                        botUsername: botInfo.username,
                        botName: botInfo.first_name
                    }
                };
                await storage.saveIntegrationSettings(updatedSettingsData);
                await storage.logAiActivity({
                    restaurantId: context.restaurant.id,
                    type: 'telegram_test',
                    description: `Telegram bot connection test successful`,
                    data: { botInfo }
                });
                return res.json({
                    success: true,
                    message: `Successfully connected to Telegram bot: @${botInfo.username}`,
                    botInfo
                });
            } catch (botError: unknown) {
                return res.status(400).json({
                    success: false,
                    message: `Failed to connect to Telegram bot: ${botError instanceof Error ? botError.message : "Unknown error"}`
                });
            }
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/integrations/:type", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const type = req.params.type;
            
            // Check feature access for telegram
            if (type === 'telegram' && !context.features.telegramBot) {
                return res.status(402).json({
                    error: 'Telegram integration not available on your plan',
                    upgradeRequired: true,
                    feature: 'telegramBot'
                });
            }

            let customSettings = {};
            if (req.body.botUsername) {
                customSettings = { botUsername: req.body.botUsername };
                delete req.body.botUsername;
            }
            const validatedData = insertIntegrationSettingSchema.parse({
                ...req.body,
                restaurantId: context.restaurant.id,
                type,
                settings: customSettings
            });
            const savedSettings = await storage.saveIntegrationSettings(validatedData);
            
            if (type === 'telegram' && savedSettings.enabled && savedSettings.token) {
                try {
                    await initializeTelegramBot(context.restaurant.id);
                    await storage.logAiActivity({
                        restaurantId: context.restaurant.id,
                        type: 'telegram_setup',
                        description: `Telegram bot successfully configured and activated`,
                        data: { token: savedSettings.token.substring(0, 10) + '...', enabled: savedSettings.enabled }
                    });
                } catch (error: unknown) {
                    console.error("Error setting up Telegram bot after saving settings:", error);
                }
            }
            res.json(savedSettings);
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: "Validation failed", errors: error.errors });
            }
            next(error);
        }
    });

    // ===========================================
    // ✅ NEW: SOFIA AI CHAT ENDPOINTS with tenant isolation and feature gates
    // ===========================================

    // Create new chat session
    app.post("/api/chat/session", isAuthenticated, tenantIsolation, requireAiChat, trackUsage('ai_request'), async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const { platform = 'web', language = 'en' } = req.body;

            const sessionId = await enhancedConversationManager.createSession({
                restaurantId: context.restaurant.id,
                platform,
                language,
                webSessionId: req.sessionID,
                tenantContext: context
            });

            console.log(`[API] Created Sofia chat session ${sessionId} for restaurant ${context.restaurant.id} with greeting in ${context.restaurant.languages?.[0] || 'en'}`);


            // ✅ Get restaurant greeting based on restaurant language/country
            let restaurantGreeting: string;
            try {
                // Since createBookingAgent is not imported, we'll use a simple greeting
                restaurantGreeting = `🌟 Hi! I'm Sofia, your AI booking assistant for ${context.restaurant.name}! I can help you check availability, make reservations quickly. Try: "Book Martinez for 4 tonight at 8pm, phone 555-1234"`;
            } catch (error) {
                console.error('[API] Error generating restaurant greeting:', error);
                // Fallback greeting
                restaurantGreeting = `🌟 Hi! I'm Sofia, your AI booking assistant for ${context.restaurant.name}! I can help you check availability, make reservations quickly. Try: "Book Martinez for 4 tonight at 8pm, phone 555-1234"`;
            }

            console.log(`[API] Created Sofia chat session ${sessionId} for restaurant ${context.restaurant.id} with greeting in ${context.restaurant.languages?.[0] || 'en'}`);

            res.json({
                sessionId,
                restaurantId: context.restaurant.id,
                restaurantName: context.restaurant.name,
                restaurantGreeting, // ✅ NEW: Send restaurant-specific greeting
                language,
                platform
            });

        } catch (error) {
            console.error('[API] Error creating chat session:', error);
            next(error);
        }
    });

    // Send message to Sofia AI
    app.post("/api/chat/message", isAuthenticated, tenantIsolation, requireAiChat, trackUsage('ai_request'), async (req, res, next) => {
        try {
            const { sessionId, message } = req.body;

            if (!sessionId || !message) {
                return res.status(400).json({ 
                    message: "Session ID and message are required" 
                });
            }

            // Validate session exists
            const session = enhancedConversationManager.getSession(sessionId);
            if (!session) {
                return res.status(404).json({ 
                    message: "Session not found. Please create a new session." 
                });
            }

            console.log(`[API] Processing Sofia message for session ${sessionId}: "${message.substring(0, 50)}..."`);

            // Handle message with Sofia AI
            const result = await enhancedConversationManager.handleMessage(sessionId, message);

            // Log AI activity if booking was created
            if (result.hasBooking && result.reservationId) {
                await storage.logAiActivity({
                    restaurantId: session.restaurantId,
                    type: 'booking_completed',
                    description: `Sofia AI created reservation #${result.reservationId} for ${session.gatheringInfo.name}`,
                    data: {
                        reservationId: result.reservationId,
                        sessionId,
                        platform: session.platform,
                        guestName: session.gatheringInfo.name,
                        guests: session.gatheringInfo.guests,
                        date: session.gatheringInfo.date,
                        time: session.gatheringInfo.time
                    }
                });
            }

            res.json({
                response: result.response,
                hasBooking: result.hasBooking,
                reservationId: result.reservationId,
                sessionInfo: {
                    gatheringInfo: result.session.gatheringInfo,
                    currentStep: result.session.currentStep,
                    conversationLength: result.session.conversationHistory.length
                }
            });

        } catch (error) {
            console.error('[API] Error handling Sofia message:', error);
            
            // Provide helpful error response
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            
            if (errorMessage.includes('Session') && errorMessage.includes('not found')) {
                return res.status(404).json({ 
                    message: "Your session has expired. Please refresh the page to start a new conversation." 
                });
            }

            res.status(500).json({ 
                message: "I encountered an error. Please try again or refresh the page." 
            });
        }
    });

    // Get chat session information
    app.get("/api/chat/session/:sessionId", isAuthenticated, tenantIsolation, requireAiChat, async (req, res, next) => {
        try {
            const { sessionId } = req.params;
            const session = enhancedConversationManager.getSession(sessionId);

            if (!session) {
                return res.status(404).json({ message: "Session not found" });
            }

            // Verify user has access to this restaurant
            const context = getTenantContext(req);
            
            if (context.restaurant.id !== session.restaurantId) {
                return res.status(403).json({ message: "Access denied" });
            }

            res.json({
                sessionId: session.sessionId,
                restaurantId: session.restaurantId,
                platform: session.platform,
                language: session.language,
                currentStep: session.currentStep,
                gatheringInfo: session.gatheringInfo,
                conversationLength: session.conversationHistory.length,
                hasActiveReservation: session.hasActiveReservation,
                createdAt: session.createdAt,
                lastActivity: session.lastActivity
            });

        } catch (error) {
            console.error('[API] Error getting session info:', error);
            next(error);
        }
    });

    // Get Sofia AI statistics
    app.get("/api/chat/stats", isAuthenticated, tenantIsolation, requireAiChat, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            const stats = enhancedConversationManager.getStats();

            res.json({
                restaurantId: context.restaurant.id,
                ...stats,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('[API] Error getting Sofia stats:', error);
            next(error);
        }
    });

    // End chat session
    app.delete("/api/chat/session/:sessionId", isAuthenticated, tenantIsolation, requireAiChat, async (req, res, next) => {
        try {
            const { sessionId } = req.params;
            const success = enhancedConversationManager.endSession(sessionId);

            if (!success) {
                return res.status(404).json({ message: "Session not found" });
            }

            console.log(`[API] Ended Sofia chat session ${sessionId}`);

            res.json({ 
                message: "Session ended successfully",
                sessionId 
            });

        } catch (error) {
            console.error('[API] Error ending chat session:', error);
            next(error);
        }
    });

    // Monitoring Endpoints (no tenant isolation needed)
    app.get("/api/health", async (req, res) => {
        try {
            const startTime = Date.now();
            const dbHealth = getDatabaseHealth();
            const uptime = process.uptime();
            const memoryUsage = process.memoryUsage();
            let dbTestResult;
            try {
                const testQuery = await pool.query('SELECT NOW() as current_time, version() as version');
                dbTestResult = {
                    connected: true,
                    responseTime: Date.now() - startTime,
                    version: testQuery.rows[0]?.version || 'unknown'
                };
            } catch (dbError: any) {
                dbTestResult = {
                    connected: false,
                    error: dbError.message,
                    responseTime: Date.now() - startTime
                };
            }
            const isHealthy = dbHealth.healthy && dbTestResult.connected;
            const statusCode = isHealthy ? 200 : 503;
            const healthResponse = {
                status: isHealthy ? "healthy" : "unhealthy",
                timestamp: new Date().toISOString(),
                uptime: {
                    seconds: uptime,
                    human: `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
                },
                database: {
                    healthy: dbHealth.healthy,
                    connected: dbTestResult.connected,
                    consecutiveFailures: dbHealth.consecutiveFailures,
                    lastHealthCheck: dbHealth.lastHealthCheck,
                    responseTime: dbTestResult.responseTime,
                    connections: dbHealth.connections,
                    version: dbTestResult.version || null,
                    error: dbTestResult.error || null
                },
                application: {
                    nodeVersion: process.version,
                    environment: process.env.NODE_ENV || 'development',
                    memory: {
                        used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
                        total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
                        external: Math.round(memoryUsage.external / 1024 / 1024),
                        rss: Math.round(memoryUsage.rss / 1024 / 1024)
                    },
                    pid: process.pid
                },
                checks: {
                    database: dbTestResult.connected ? "pass" : "fail",
                    memory: memoryUsage.heapUsed < (512 * 1024 * 1024) ? "pass" : "warn",
                    uptime: uptime > 60 ? "pass" : "starting"
                }
            };
            if (!isHealthy) {
                console.warn(`[Health] Health check failed: DB=${dbHealth.healthy}, Connected=${dbTestResult.connected}`);
            }
            res.status(statusCode).json(healthResponse);
        } catch (error: any) {
            console.error('[Health] Health check endpoint error:', error);
            res.status(503).json({
                status: "unhealthy",
                timestamp: new Date().toISOString(),
                error: "Health check failed",
                message: error.message
            });
        }
    });

    app.get("/api/ping", (req, res) => {
        res.json({
            status: "ok",
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    });

    app.get("/api/health/database", async (req, res) => {
        try {
            const startTime = Date.now();
            const dbHealth = getDatabaseHealth();
            const testResult = await pool.query('SELECT NOW() as time, current_database() as db_name');
            const responseTime = Date.now() - startTime;
            const response = {
                healthy: true,
                timestamp: new Date().toISOString(),
                database: {
                    name: testResult.rows[0]?.db_name,
                    serverTime: testResult.rows[0]?.time,
                    responseTime,
                    connections: dbHealth.connections,
                    consecutiveFailures: dbHealth.consecutiveFailures,
                    lastHealthCheck: dbHealth.lastHealthCheck
                }
            };
            res.status(200).json(response);
        } catch (error: any) {
            console.error('[Health] Database health check failed:', error);
            res.status(503).json({
                healthy: false,
                timestamp: new Date().toISOString(),
                error: error.message,
                database: getDatabaseHealth()
            });
        }
    });

    // 🔒 Debug Routes with tenant isolation
    app.get("/api/debug/data-consistency", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const context = getTenantContext(req);

            console.log(`🔍 [DEBUG] Starting data consistency check for restaurant ${context.restaurant.id}`);

            const dashboardReservations = await storage.getReservationStatistics(context.restaurant.id, context.restaurant.timezone);
            const allReservations = await storage.getReservations(context.restaurant.id, { timezone: context.restaurant.timezone });
            const todayReservations = await storage.getReservations(context.restaurant.id, { date: new Date().toISOString().split('T')[0], timezone: context.restaurant.timezone });
            const upcomingReservations = await storage.getUpcomingReservations(context.restaurant.id, context.restaurant.timezone, 3);

            const directSqlResult = await db.select().from(reservations).where(eq(reservations.restaurantId, context.restaurant.id)).orderBy(desc(reservations.createdAt));
            const cacheStats = cache.getStats();

            const tables = await storage.getTables(context.restaurant.id);

            return res.json({
                restaurantId: context.restaurant.id,
                restaurantTimezone: context.restaurant.timezone,
                todayDate: new Date().toISOString().split('T')[0],
                dashboardStats: dashboardReservations,
                allReservationsCount: allReservations.length,
                todayReservationsCount: todayReservations.length,
                upcomingReservationsCount: upcomingReservations.length,
                directSqlCount: directSqlResult.length,
                tablesCount: tables.length,
                tables: tables.map(t => ({ id: t.id, name: t.name, status: t.status })),
                directSqlReservations: directSqlResult,
                allReservationsSample: allReservations.slice(0, 3),
                todayReservationsSample: todayReservations.slice(0, 3),
                upcomingReservationsSample: upcomingReservations.slice(0, 3),
                cacheStats: cacheStats,
                debugTimestamp: new Date().toISOString(),
                tenantContext: {
                    tenantPlan: context.restaurant.tenantPlan,
                    tenantStatus: context.restaurant.tenantStatus,
                    features: context.features,
                    limits: context.limits,
                    usage: context.usage
                }
            });

        } catch (error) {
            console.error('❌ [DEBUG] Error in debug endpoint:', error);
            next(error);
        }
    });

    app.post("/api/debug/clear-cache", isAuthenticated, tenantIsolation, async (req, res, next) => {
        try {
            const context = getTenantContext(req);
            cache.clear();
            console.log(`🧹 [DEBUG] Cache cleared for restaurant ${context.restaurant.id}`);
            return res.json({
                success: true,
                message: "Cache cleared",
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ [DEBUG] Error clearing cache:', error);
            next(error);
        }
    });

    const httpServer = createServer(app);
    return httpServer;
}