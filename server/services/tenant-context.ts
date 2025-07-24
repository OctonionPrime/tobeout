import {
    restaurants, tables, reservations, guests, planLimits, tenantUsageMetrics, tenantAuditLogs,
    type Restaurant, type PlanLimits, type TenantUsageMetrics, type InsertTenantUsageMetrics,
    type InsertTenantAuditLog
} from "@shared/schema";
import { db } from "../db";
import { eq, and, count, sql, gte } from "drizzle-orm";
import { DateTime } from 'luxon';

// ================================
// TENANT CONTEXT INTERFACES
// ================================

export interface TenantFeatures {
    aiChat: boolean;
    telegramBot: boolean;
    menuManagement: boolean;
    guestAnalytics: boolean;
    advancedReporting: boolean;
    customBranding: boolean;
    apiAccess: boolean;
    prioritySupport: boolean;
}

export interface TenantLimits {
    maxTables: number;
    maxMonthlyReservations: number;
    maxStaffAccounts: number;
    maxStorageMb: number;
}

export interface TenantUsage {
    currentTableCount: number;
    currentMonthReservations: number;
    currentStaffCount: number;
    currentStorageMb: number;
    totalReservationsAllTime: number;
}

export interface TenantContext {
    restaurant: Restaurant;
    features: TenantFeatures;
    limits: TenantLimits;
    usage: TenantUsage;
    planDetails?: PlanLimits;
    isActive: boolean;
    isTrial: boolean;
    trialEndsAt?: Date;
    daysUntilTrialExpiry?: number;
}

export interface TenantLimitCheckResult {
    allowed: boolean;
    reason?: string;
    currentUsage?: number;
    limit?: number;
    upgradeRequired?: boolean;
}

// ================================
// TENANT CONTEXT MANAGER
// ================================

export class TenantContextManager {
    
    /**
     * Load complete tenant context for a restaurant
     */
    async loadContext(restaurantId: number): Promise<TenantContext | null> {
        console.log(`🏢 [TenantContext] Loading context for restaurant ${restaurantId}`);
        
        try {
            // Load restaurant details
            const [restaurant] = await db
                .select()
                .from(restaurants)
                .where(eq(restaurants.id, restaurantId));
            
            if (!restaurant) {
                console.error(`❌ [TenantContext] Restaurant ${restaurantId} not found`);
                return null;
            }
            
            // Check if tenant is active
            const isActive = restaurant.tenantStatus === 'active' || restaurant.tenantStatus === 'trial';
            if (!isActive) {
                console.warn(`⚠️ [TenantContext] Restaurant ${restaurantId} is ${restaurant.tenantStatus}`);
            }
            
            // Load plan details if available
            let planDetails: PlanLimits | undefined;
            if (restaurant.tenantPlan) {
                const [plan] = await db
                    .select()
                    .from(planLimits)
                    .where(eq(planLimits.planName, restaurant.tenantPlan));
                planDetails = plan;
            }
            
            // Calculate current usage
            const usage = await this.calculateCurrentUsage(restaurantId);
            
            // Build tenant context
            const context: TenantContext = {
                restaurant,
                features: this.extractFeatures(restaurant, planDetails),
                limits: this.extractLimits(restaurant, planDetails),
                usage,
                planDetails,
                isActive,
                isTrial: restaurant.tenantStatus === 'trial',
                trialEndsAt: restaurant.trialEndsAt ? new Date(restaurant.trialEndsAt) : undefined,
                daysUntilTrialExpiry: this.calculateTrialDaysRemaining(restaurant.trialEndsAt)
            };
            
            console.log(`✅ [TenantContext] Context loaded for ${restaurant.name} (${restaurant.tenantPlan} plan, ${restaurant.tenantStatus} status)`);
            return context;
            
        } catch (error) {
            console.error(`❌ [TenantContext] Failed to load context for restaurant ${restaurantId}:`, error);
            return null;
        }
    }
    
    /**
     * Check if tenant can perform an operation based on limits
     */
    async checkLimit(restaurantId: number, limitType: 'tables' | 'reservations' | 'staff' | 'storage'): Promise<TenantLimitCheckResult> {
        console.log(`🔍 [TenantContext] Checking ${limitType} limit for restaurant ${restaurantId}`);
        
        const context = await this.loadContext(restaurantId);
        if (!context) {
            return {
                allowed: false,
                reason: 'Tenant context not found'
            };
        }
        
        if (!context.isActive) {
            return {
                allowed: false,
                reason: `Account is ${context.restaurant.tenantStatus}. Please contact support.`,
                upgradeRequired: context.restaurant.tenantStatus === 'suspended'
            };
        }
        
        let currentUsage: number;
        let limit: number;
        
        switch (limitType) {
            case 'tables':
                currentUsage = context.usage.currentTableCount;
                limit = context.limits.maxTables;
                break;
            case 'reservations':
                currentUsage = context.usage.currentMonthReservations;
                limit = context.limits.maxMonthlyReservations;
                break;
            case 'staff':
                currentUsage = context.usage.currentStaffCount;
                limit = context.limits.maxStaffAccounts;
                break;
            case 'storage':
                currentUsage = context.usage.currentStorageMb;
                limit = context.limits.maxStorageMb;
                break;
            default:
                return {
                    allowed: false,
                    reason: `Unknown limit type: ${limitType}`
                };
        }
        
        const allowed = currentUsage < limit;
        
        console.log(`📊 [TenantContext] ${limitType} check: ${currentUsage}/${limit} - ${allowed ? 'ALLOWED' : 'BLOCKED'}`);
        
        return {
            allowed,
            currentUsage,
            limit,
            reason: allowed ? undefined : `${limitType} limit reached (${currentUsage}/${limit})`,
            upgradeRequired: !allowed && context.restaurant.tenantPlan === 'free'
        };
    }
    
    /**
     * Increment usage metrics for a tenant
     */
    async incrementUsage(restaurantId: number, metricType: 'reservation' | 'guest' | 'aiRequest' | 'storage', amount: number = 1): Promise<void> {
        console.log(`📈 [TenantContext] Incrementing ${metricType} usage by ${amount} for restaurant ${restaurantId}`);
        
        try {
            await db.transaction(async (tx) => {
                // Update restaurant-level counters
                const updates: any = {};
                
                if (metricType === 'reservation') {
                    updates.monthlyReservationCount = sql`${restaurants.monthlyReservationCount} + ${amount}`;
                    updates.totalReservationsAllTime = sql`${restaurants.totalReservationsAllTime} + ${amount}`;
                }
                
                if (Object.keys(updates).length > 0) {
                    await tx
                        .update(restaurants)
                        .set(updates)
                        .where(eq(restaurants.id, restaurantId));
                }
                
                // Update daily usage metrics
                const today = DateTime.now().toISODate();
                if (!today) throw new Error('Failed to get current date');
                
                const metricUpdates: any = {};
                
                switch (metricType) {
                    case 'reservation':
                        metricUpdates.reservationCount = sql`${tenantUsageMetrics.reservationCount} + ${amount}`;
                        break;
                    case 'guest':
                        metricUpdates.guestCount = sql`${tenantUsageMetrics.guestCount} + ${amount}`;
                        break;
                    case 'aiRequest':
                        metricUpdates.aiRequestCount = sql`${tenantUsageMetrics.aiRequestCount} + ${amount}`;
                        break;
                    case 'storage':
                        metricUpdates.storageUsedMb = sql`${tenantUsageMetrics.storageUsedMb} + ${amount}`;
                        break;
                }
                
                // Upsert daily metrics
                await tx
                    .insert(tenantUsageMetrics)
                    .values({
                        restaurantId,
                        metricDate: today,
                        reservationCount: metricType === 'reservation' ? amount : 0,
                        guestCount: metricType === 'guest' ? amount : 0,
                        aiRequestCount: metricType === 'aiRequest' ? amount : 0,
                        storageUsedMb: metricType === 'storage' ? amount.toString() : '0',
                        activeTableCount: 0,
                        activeStaffCount: 0
                    })
                    .onConflictDoUpdate({
                        target: [tenantUsageMetrics.restaurantId, tenantUsageMetrics.metricDate],
                        set: metricUpdates
                    });
                
                console.log(`✅ [TenantContext] ${metricType} usage incremented successfully`);
            });
            
        } catch (error) {
            console.error(`❌ [TenantContext] Failed to increment ${metricType} usage:`, error);
            throw error;
        }
    }
    
    /**
     * Log tenant audit events
     */
    async logAuditEvent(auditData: Omit<InsertTenantAuditLog, 'timestamp'>): Promise<void> {
        console.log(`📝 [TenantContext] Logging audit event: ${auditData.action} for restaurant ${auditData.restaurantId}`);
        
        try {
            await db.insert(tenantAuditLogs).values({
                ...auditData,
                timestamp: new Date()
            });
            
        } catch (error) {
            console.error(`❌ [TenantContext] Failed to log audit event:`, error);
            // Don't throw - audit logging should not break main operations
        }
    }
    
    /**
     * Check if feature is enabled for tenant
     */
    async isFeatureEnabled(restaurantId: number, feature: keyof TenantFeatures): Promise<boolean> {
        const context = await this.loadContext(restaurantId);
        if (!context || !context.isActive) {
            return false;
        }
        
        return context.features[feature];
    }
    
    /**
     * Get tenant usage metrics for a date range
     */
    async getUsageMetrics(restaurantId: number, startDate: string, endDate: string): Promise<TenantUsageMetrics[]> {
        console.log(`📊 [TenantContext] Getting usage metrics for restaurant ${restaurantId} from ${startDate} to ${endDate}`);
        
        return await db
            .select()
            .from(tenantUsageMetrics)
            .where(
                and(
                    eq(tenantUsageMetrics.restaurantId, restaurantId),
                    gte(tenantUsageMetrics.metricDate, startDate),
                    gte(endDate, tenantUsageMetrics.metricDate)
                )
            )
            .orderBy(tenantUsageMetrics.metricDate);
    }
    
    /**
     * Suspend a tenant account
     */
    async suspendTenant(restaurantId: number, reason: string, performedBy: string): Promise<void> {
        console.log(`🚫 [TenantContext] Suspending tenant ${restaurantId} - Reason: ${reason}`);
        
        await db.transaction(async (tx) => {
            // Update restaurant status
            await tx
                .update(restaurants)
                .set({
                    tenantStatus: 'suspended',
                    suspendedAt: new Date(),
                    suspendedReason: reason
                })
                .where(eq(restaurants.id, restaurantId));
            
            // Log audit event
            await tx.insert(tenantAuditLogs).values({
                restaurantId,
                action: 'suspended',
                performedBy,
                performedByType: 'super_admin',
                details: { reason },
                timestamp: new Date()
            });
            
            console.log(`✅ [TenantContext] Tenant ${restaurantId} suspended successfully`);
        });
    }
    
    /**
     * Reactivate a suspended tenant
     */
    async reactivateTenant(restaurantId: number, performedBy: string): Promise<void> {
        console.log(`✅ [TenantContext] Reactivating tenant ${restaurantId}`);
        
        await db.transaction(async (tx) => {
            // Update restaurant status
            await tx
                .update(restaurants)
                .set({
                    tenantStatus: 'active',
                    suspendedAt: null,
                    suspendedReason: null
                })
                .where(eq(restaurants.id, restaurantId));
            
            // Log audit event
            await tx.insert(tenantAuditLogs).values({
                restaurantId,
                action: 'reactivated',
                performedBy,
                performedByType: 'super_admin',
                details: { note: 'Account reactivated' },
                timestamp: new Date()
            });
            
            console.log(`✅ [TenantContext] Tenant ${restaurantId} reactivated successfully`);
        });
    }
    
    /**
     * Update tenant plan
     */
    async updateTenantPlan(restaurantId: number, newPlan: 'free' | 'starter' | 'professional' | 'enterprise', performedBy: string): Promise<void> {
        console.log(`📋 [TenantContext] Updating tenant ${restaurantId} plan to ${newPlan}`);
        
        const [planLimitData] = await db
            .select()
            .from(planLimits)
            .where(eq(planLimits.planName, newPlan));
        
        if (!planLimitData) {
            throw new Error(`Plan ${newPlan} not found in plan_limits table`);
        }
        
        await db.transaction(async (tx) => {
            // Get current plan for audit
            const [currentRestaurant] = await tx
                .select({ tenantPlan: restaurants.tenantPlan })
                .from(restaurants)
                .where(eq(restaurants.id, restaurantId));
            
            // Update restaurant plan and limits
            await tx
                .update(restaurants)
                .set({
                    tenantPlan: newPlan,
                    tenantStatus: newPlan === 'free' ? 'active' : 'active', // Remove trial status
                    maxTablesAllowed: planLimitData.maxTables,
                    maxMonthlyReservations: planLimitData.maxMonthlyReservations,
                    maxStaffAccounts: planLimitData.maxStaffAccounts,
                    // Update feature flags based on plan
                    enableAiChat: planLimitData.features.aiChat,
                    enableTelegramBot: planLimitData.features.telegramBot,
                    enableAdvancedReporting: planLimitData.features.advancedAnalytics,
                    trialEndsAt: null // Clear trial end date
                })
                .where(eq(restaurants.id, restaurantId));
            
            // Log audit event
            await tx.insert(tenantAuditLogs).values({
                restaurantId,
                action: 'plan_updated',
                performedBy,
                performedByType: 'super_admin',
                details: {
                    oldPlan: currentRestaurant?.tenantPlan,
                    newPlan,
                    limits: {
                        maxTables: planLimitData.maxTables,
                        maxMonthlyReservations: planLimitData.maxMonthlyReservations,
                        maxStaffAccounts: planLimitData.maxStaffAccounts
                    }
                },
                timestamp: new Date()
            });
            
            console.log(`✅ [TenantContext] Tenant ${restaurantId} plan updated to ${newPlan}`);
        });
    }
    
    // ================================
    // PRIVATE HELPER METHODS
    // ================================
    
    private extractFeatures(restaurant: Restaurant, planDetails?: PlanLimits): TenantFeatures {
        // Use restaurant-level settings first, fall back to plan defaults
        return {
            aiChat: restaurant.enableAiChat ?? planDetails?.features?.aiChat ?? false,
            telegramBot: restaurant.enableTelegramBot ?? planDetails?.features?.telegramBot ?? false,
            menuManagement: restaurant.enableMenuManagement ?? true,
            guestAnalytics: restaurant.enableGuestAnalytics ?? planDetails?.features?.advancedAnalytics ?? false,
            advancedReporting: restaurant.enableAdvancedReporting ?? planDetails?.features?.advancedAnalytics ?? false,
            customBranding: planDetails?.features?.customBranding ?? false,
            apiAccess: planDetails?.features?.apiAccess ?? false,
            prioritySupport: planDetails?.features?.prioritySupport ?? false
        };
    }
    
    private extractLimits(restaurant: Restaurant, planDetails?: PlanLimits): TenantLimits {
        return {
            maxTables: restaurant.maxTablesAllowed ?? planDetails?.maxTables ?? 10,
            maxMonthlyReservations: restaurant.maxMonthlyReservations ?? planDetails?.maxMonthlyReservations ?? 1000,
            maxStaffAccounts: restaurant.maxStaffAccounts ?? planDetails?.maxStaffAccounts ?? 5,
            maxStorageMb: planDetails?.maxStorageMb ?? 1000
        };
    }
    
    private async calculateCurrentUsage(restaurantId: number): Promise<TenantUsage> {
        console.log(`📊 [TenantContext] Calculating current usage for restaurant ${restaurantId}`);
        
        // Get table count
        const [tableCount] = await db
            .select({ count: count() })
            .from(tables)
            .where(eq(tables.restaurantId, restaurantId));
        
        // Get monthly reservation count from restaurant record
        const [restaurant] = await db
            .select({
                monthlyReservationCount: restaurants.monthlyReservationCount,
                totalReservationsAllTime: restaurants.totalReservationsAllTime
            })
            .from(restaurants)
            .where(eq(restaurants.id, restaurantId));
        
        // Get staff count (currently just the restaurant owner, would expand later)
        const currentStaffCount = 1; // TODO: Implement staff table and count
        
        // Get storage usage from latest metrics
        const today = DateTime.now().toISODate();
        let currentStorageMb = 0;
        
        if (today) {
            const [storageMetric] = await db
                .select({ storageUsedMb: tenantUsageMetrics.storageUsedMb })
                .from(tenantUsageMetrics)
                .where(
                    and(
                        eq(tenantUsageMetrics.restaurantId, restaurantId),
                        eq(tenantUsageMetrics.metricDate, today)
                    )
                );
            
            if (storageMetric?.storageUsedMb) {
                currentStorageMb = parseFloat(storageMetric.storageUsedMb);
            }
        }
        
        const usage: TenantUsage = {
            currentTableCount: tableCount?.count ?? 0,
            currentMonthReservations: restaurant?.monthlyReservationCount ?? 0,
            currentStaffCount,
            currentStorageMb,
            totalReservationsAllTime: restaurant?.totalReservationsAllTime ?? 0
        };
        
        console.log(`📊 [TenantContext] Current usage calculated:`, usage);
        return usage;
    }
    
    private calculateTrialDaysRemaining(trialEndsAt?: string | null): number | undefined {
        if (!trialEndsAt) return undefined;
        
        const trialEnd = DateTime.fromISO(trialEndsAt);
        const now = DateTime.now();
        const diff = trialEnd.diff(now, 'days');
        
        return Math.max(0, Math.ceil(diff.days));
    }
}

// ================================
// SINGLETON INSTANCE
// ================================

export const tenantContextManager = new TenantContextManager();

// ================================
// HELPER FUNCTIONS FOR MIDDLEWARE
// ================================

/**
 * Helper function to validate tenant can perform an action
 */
export async function validateTenantAction(
    restaurantId: number, 
    action: 'create_table' | 'create_reservation' | 'add_staff' | 'use_ai',
    context?: TenantContext
): Promise<{ allowed: boolean; reason?: string; upgradeRequired?: boolean }> {
    
    const tenantContext = context || await tenantContextManager.loadContext(restaurantId);
    if (!tenantContext) {
        return { allowed: false, reason: 'Tenant not found' };
    }
    
    if (!tenantContext.isActive) {
        return { 
            allowed: false, 
            reason: `Account is ${tenantContext.restaurant.tenantStatus}`,
            upgradeRequired: tenantContext.restaurant.tenantStatus === 'suspended'
        };
    }
    
    switch (action) {
        case 'create_table':
            return await tenantContextManager.checkLimit(restaurantId, 'tables');
            
        case 'create_reservation':
            return await tenantContextManager.checkLimit(restaurantId, 'reservations');
            
        case 'add_staff':
            return await tenantContextManager.checkLimit(restaurantId, 'staff');
            
        case 'use_ai':
            if (!tenantContext.features.aiChat) {
                return { 
                    allowed: false, 
                    reason: 'AI chat feature not available on your plan',
                    upgradeRequired: true
                };
            }
            return { allowed: true };
            
        default:
            return { allowed: false, reason: `Unknown action: ${action}` };
    }
}

/**
 * Helper function to track usage after successful operations
 */
export async function trackTenantUsage(
    restaurantId: number,
    action: 'reservation_created' | 'guest_added' | 'ai_request' | 'storage_used',
    amount: number = 1
): Promise<void> {
    try {
        let metricType: 'reservation' | 'guest' | 'aiRequest' | 'storage';
        
        switch (action) {
            case 'reservation_created':
                metricType = 'reservation';
                break;
            case 'guest_added':
                metricType = 'guest';
                break;
            case 'ai_request':
                metricType = 'aiRequest';
                break;
            case 'storage_used':
                metricType = 'storage';
                break;
            default:
                console.warn(`Unknown tracking action: ${action}`);
                return;
        }
        
        await tenantContextManager.incrementUsage(restaurantId, metricType, amount);
        
    } catch (error) {
        console.error(`Failed to track usage for action ${action}:`, error);
        // Don't throw - usage tracking should not break main operations
    }
}