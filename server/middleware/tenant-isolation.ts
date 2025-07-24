// server/middleware/tenant-isolation.ts
// ✅ HTTP Middleware layer that uses your existing tenant-context.ts service

import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { tenantContextManager, type TenantContext } from "../services/tenant-context";

// Extend Express Request to include tenant context
declare global {
    namespace Express {
        interface Request {
            tenantContext?: TenantContext;
        }
    }
}

/**
 * 🔒 Core tenant isolation middleware
 * 
 * This middleware:
 * 1. Extracts user from authenticated request
 * 2. Loads restaurant for that user
 * 3. Uses TenantContextManager to load full tenant context
 * 4. Validates tenant is active/not suspended
 * 5. Attaches context to req.tenantContext
 * 6. Logs access for audit trail
 */
export const tenantIsolation = async (req: Request, res: Response, next: NextFunction) => {
    try {
        console.log(`🔍 [TenantIsolation] Processing request: ${req.method} ${req.path}`);
        
        // Get authenticated user (assumes isAuthenticated middleware ran first)
        const user = req.user as any;
        if (!user || !user.id) {
            console.error(`❌ [TenantIsolation] No authenticated user found`);
            return res.status(401).json({ 
                error: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }
        
        console.log(`👤 [TenantIsolation] User ID: ${user.id}, Email: ${user.email}`);
        
        // Load restaurant for this user
        const restaurant = await storage.getRestaurantByUserId(user.id);
        if (!restaurant) {
            console.error(`❌ [TenantIsolation] No restaurant found for user ${user.id}`);
            return res.status(404).json({ 
                error: 'Restaurant not found',
                code: 'RESTAURANT_NOT_FOUND',
                message: 'No restaurant associated with your account'
            });
        }
        
        console.log(`🏪 [TenantIsolation] Restaurant: ${restaurant.name} (ID: ${restaurant.id})`);
        
        // Load full tenant context using your service
        const tenantContext = await tenantContextManager.loadContext(restaurant.id);
        if (!tenantContext) {
            console.error(`❌ [TenantIsolation] Failed to load tenant context for restaurant ${restaurant.id}`);
            return res.status(500).json({ 
                error: 'Failed to load tenant context',
                code: 'CONTEXT_LOAD_FAILED'
            });
        }
        
        // ✅ CRITICAL: Check if tenant is active
        if (!tenantContext.isActive) {
            console.warn(`🚫 [TenantIsolation] Tenant ${restaurant.id} is not active: ${tenantContext.restaurant.tenantStatus}`);
            
            let errorMessage = 'Account access restricted';
            let errorCode = 'ACCOUNT_RESTRICTED';
            
            switch (tenantContext.restaurant.tenantStatus) {
                case 'suspended':
                    errorMessage = 'Account suspended';
                    errorCode = 'ACCOUNT_SUSPENDED';
                    break;
                case 'inactive':
                    errorMessage = 'Account inactive';
                    errorCode = 'ACCOUNT_INACTIVE';
                    break;
                default:
                    errorMessage = `Account status: ${tenantContext.restaurant.tenantStatus}`;
                    errorCode = 'ACCOUNT_STATUS_INVALID';
            }
            
            return res.status(403).json({ 
                error: errorMessage,
                code: errorCode,
                status: tenantContext.restaurant.tenantStatus,
                reason: tenantContext.restaurant.suspendedReason,
                contactSupport: true
            });
        }
        
        // ✅ Check trial expiry warning
        if (tenantContext.isTrial && tenantContext.daysUntilTrialExpiry !== undefined) {
            if (tenantContext.daysUntilTrialExpiry <= 3) {
                console.warn(`⏰ [TenantIsolation] Trial expires in ${tenantContext.daysUntilTrialExpiry} days for restaurant ${restaurant.id}`);
                
                // Add warning header (frontend can display notification)
                res.setHeader('X-Trial-Warning', `${tenantContext.daysUntilTrialExpiry}`);
                res.setHeader('X-Trial-Expires', tenantContext.trialEndsAt?.toISOString() || '');
            }
        }
        
        // ✅ Attach tenant context to request
        req.tenantContext = tenantContext;
        
        // ✅ Log access for audit trail (non-blocking)
        tenantContextManager.logAuditEvent({
            restaurantId: restaurant.id,
            action: 'api_access',
            performedBy: user.email || `user_${user.id}`,
            performedByType: 'restaurant_user',
            details: {
                endpoint: req.path,
                method: req.method,
                userAgent: req.headers['user-agent']?.substring(0, 100),
                ip: req.ip || req.connection.remoteAddress
            },
            ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
            userAgent: req.headers['user-agent']?.substring(0, 200)
        }).catch(error => {
            console.warn(`⚠️ [TenantIsolation] Failed to log audit event:`, error);
            // Don't fail the request for audit logging issues
        });
        
        console.log(`✅ [TenantIsolation] Context loaded successfully: ${tenantContext.restaurant.name} (${tenantContext.restaurant.tenantPlan} plan)`);
        console.log(`📊 [TenantIsolation] Usage: ${tenantContext.usage.currentTableCount}/${tenantContext.limits.maxTables} tables, ${tenantContext.usage.currentMonthReservations}/${tenantContext.limits.maxMonthlyReservations} reservations`);
        
        next();
        
    } catch (error) {
        console.error(`❌ [TenantIsolation] Unexpected error:`, error);
        
        // Provide helpful error response
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        return res.status(500).json({
            error: 'Tenant isolation failed',
            code: 'TENANT_ISOLATION_ERROR',
            message: 'Unable to process your request. Please try again.',
            details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
        });
    }
};

/**
 * 🛡️ Optional: Strict tenant validation middleware
 * Use this for endpoints that require extra validation
 */
export const strictTenantValidation = async (req: Request, res: Response, next: NextFunction) => {
    const context = req.tenantContext;
    
    if (!context) {
        return res.status(500).json({
            error: 'Tenant context missing',
            code: 'CONTEXT_MISSING',
            message: 'Please ensure tenant isolation middleware is applied first'
        });
    }
    
    // Additional strict checks
    if (context.isTrial && context.daysUntilTrialExpiry !== undefined && context.daysUntilTrialExpiry <= 0) {
        return res.status(402).json({
            error: 'Trial expired',
            code: 'TRIAL_EXPIRED',
            message: 'Your trial has expired. Please upgrade to continue using this feature.',
            upgradeRequired: true,
            trialEndsAt: context.trialEndsAt
        });
    }
    
    next();
};

/**
 * 🏢 Lightweight tenant context loader (for non-critical endpoints)
 * Use this instead of full tenantIsolation for public/read-only endpoints
 */
export const lightweightTenantContext = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = req.user as any;
        if (!user?.id) {
            return next();
        }
        
        const restaurant = await storage.getRestaurantByUserId(user.id);
        if (!restaurant) {
            return next();
        }
        
        // Load minimal context (cached)
        const tenantContext = await tenantContextManager.loadContext(restaurant.id);
        if (tenantContext) {
            req.tenantContext = tenantContext;
        }
        
        next();
        
    } catch (error) {
        console.error(`⚠️ [LightweightTenantContext] Error loading context:`, error);
        // Continue without context for lightweight middleware
        next();
    }
};

/**
 * 📊 Usage tracking middleware wrapper
 * Use this to automatically track usage for specific actions
 */
export const trackUsage = (action: 'reservation_created' | 'guest_added' | 'ai_request' | 'storage_used', amount: number = 1) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const originalSend = res.send;
        
        res.send = function(body) {
            // Track usage only on successful responses (2xx)
            if (res.statusCode >= 200 && res.statusCode < 300 && req.tenantContext) {
                tenantContextManager.incrementUsage(
                    req.tenantContext.restaurant.id,
                    action === 'reservation_created' ? 'reservation' :
                    action === 'guest_added' ? 'guest' :
                    action === 'ai_request' ? 'aiRequest' : 'storage',
                    amount
                ).catch(error => {
                    console.warn(`⚠️ [UsageTracking] Failed to track ${action}:`, error);
                });
            }
            
            return originalSend.call(this, body);
        };
        
        next();
    };
};

/**
 * 🎯 Helper function to get tenant context from request
 * Use this in route handlers to access tenant context
 */
export function getTenantContext(req: Request): TenantContext {
    if (!req.tenantContext) {
        throw new Error('Tenant context not available. Ensure tenant isolation middleware is applied.');
    }
    return req.tenantContext;
}

/**
 * 🔍 Helper function to safely get tenant context
 * Returns null if not available instead of throwing
 */
export function getTenantContextSafe(req: Request): TenantContext | null {
    return req.tenantContext || null;
}