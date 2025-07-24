// server/middleware/feature-flags.ts
// ✅ Feature access control middleware that uses your tenant-context.ts system

import type { Request, Response, NextFunction } from "express";
import type { TenantFeatures, TenantContext } from "../services/tenant-context";

// ================================
// FEATURE FLAG INTERFACES
// ================================

interface FeatureAccessResult {
    allowed: boolean;
    feature: keyof TenantFeatures;
    currentPlan: string;
    reason?: string;
    upgradeRequired?: boolean;
    suggestedPlan?: string;
}

interface FeaturePlanRequirements {
    [key: string]: {
        requiredPlan: 'free' | 'starter' | 'professional' | 'enterprise';
        description: string;
    };
}

// ================================
// FEATURE PLAN REQUIREMENTS
// ================================

const FEATURE_PLAN_REQUIREMENTS: FeaturePlanRequirements = {
    aiChat: {
        requiredPlan: 'starter',
        description: 'AI-powered chat assistant for automated customer service'
    },
    telegramBot: {
        requiredPlan: 'professional', 
        description: 'Telegram bot integration for reservation management'
    },
    menuManagement: {
        requiredPlan: 'free',
        description: 'Basic menu management and item organization'
    },
    guestAnalytics: {
        requiredPlan: 'starter',
        description: 'Detailed guest analytics and behavior insights'
    },
    advancedReporting: {
        requiredPlan: 'professional',
        description: 'Advanced reporting and business intelligence'
    },
    customBranding: {
        requiredPlan: 'enterprise',
        description: 'Custom branding and white-label options'
    },
    apiAccess: {
        requiredPlan: 'professional',
        description: 'API access for third-party integrations'
    },
    prioritySupport: {
        requiredPlan: 'professional',
        description: 'Priority customer support and dedicated assistance'
    }
};

// ================================
// FEATURE ACCESS CHECKER
// ================================

/**
 * Check if a tenant has access to a specific feature
 */
function checkFeatureAccess(context: TenantContext, feature: keyof TenantFeatures): FeatureAccessResult {
    console.log(`🎯 [FeatureFlags] Checking ${feature} access for ${context.restaurant.name} (${context.restaurant.tenantPlan} plan)`);
    
    const hasFeature = context.features[feature];
    const currentPlan = context.restaurant.tenantPlan || 'free';
    const requirement = FEATURE_PLAN_REQUIREMENTS[feature];
    
    if (hasFeature) {
        console.log(`✅ [FeatureFlags] ${feature} access granted`);
        return {
            allowed: true,
            feature,
            currentPlan
        };
    }
    
    // Feature not available - determine why and suggest upgrade
    let reason = `${feature} feature is not available on your current plan`;
    let upgradeRequired = false;
    let suggestedPlan: string | undefined;
    
    if (requirement) {
        reason = `${requirement.description} requires ${requirement.requiredPlan} plan or higher`;
        upgradeRequired = true;
        suggestedPlan = requirement.requiredPlan;
        
        // If they're on free and need starter, suggest starter
        // If they're on starter and need professional, suggest professional, etc.
        const planHierarchy = ['free', 'starter', 'professional', 'enterprise'];
        const currentPlanIndex = planHierarchy.indexOf(currentPlan);
        const requiredPlanIndex = planHierarchy.indexOf(requirement.requiredPlan);
        
        if (currentPlanIndex < requiredPlanIndex) {
            suggestedPlan = requirement.requiredPlan;
        }
    }
    
    console.log(`❌ [FeatureFlags] ${feature} access denied: ${reason}`);
    
    return {
        allowed: false,
        feature,
        currentPlan,
        reason,
        upgradeRequired,
        suggestedPlan
    };
}

// ================================
// MIDDLEWARE FACTORY FUNCTION
// ================================

/**
 * 🏭 Factory function to create feature-specific middleware
 * 
 * Usage:
 * app.get('/api/chat', requireFeature('aiChat'), handler);
 * app.post('/api/telegram', requireFeature('telegramBot'), handler);
 */
export const requireFeature = (feature: keyof TenantFeatures) => {
    return (req: Request, res: Response, next: NextFunction) => {
        console.log(`🔍 [FeatureFlags] Checking feature requirement: ${feature}`);
        
        // Ensure tenant context is available (should be loaded by tenant-isolation middleware)
        const context = req.tenantContext;
        if (!context) {
            console.error(`❌ [FeatureFlags] No tenant context found for ${feature} check`);
            return res.status(500).json({
                error: 'Tenant context not available',
                code: 'NO_TENANT_CONTEXT',
                message: 'Please ensure you are properly authenticated and tenant isolation middleware is configured.'
            });
        }
        
        // Check feature access
        const accessResult = checkFeatureAccess(context, feature);
        
        if (accessResult.allowed) {
            // Feature available - continue to route handler
            next();
            return;
        }
        
        // Feature not available - return appropriate error
        const response: any = {
            error: 'Feature not available',
            code: 'FEATURE_NOT_AVAILABLE',
            feature: accessResult.feature,
            currentPlan: accessResult.currentPlan,
            message: accessResult.reason
        };
        
        if (accessResult.upgradeRequired) {
            response.upgradeRequired = true;
            response.suggestedPlan = accessResult.suggestedPlan;
            response.upgradeUrl = `/dashboard/billing?upgrade=${accessResult.suggestedPlan}`;
        }
        
        // Add helpful trial information if applicable
        if (context.isTrial) {
            response.trialInfo = {
                isTrial: true,
                daysRemaining: context.daysUntilTrialExpiry,
                trialEndsAt: context.trialEndsAt
            };
        }
        
        return res.status(402).json(response); // 402 Payment Required
    };
};

// ================================
// SPECIFIC FEATURE MIDDLEWARES
// ================================

/**
 * 🤖 AI Chat feature middleware
 * Use: app.post('/api/chat/message', requireAiChat, handler)
 */
export const requireAiChat = requireFeature('aiChat');

/**
 * 📱 Telegram Bot feature middleware  
 * Use: app.post('/api/integrations/telegram', requireTelegramBot, handler)
 */
export const requireTelegramBot = requireFeature('telegramBot');

/**
 * 🍽️ Menu Management feature middleware
 * Use: app.post('/api/menu-items', requireMenuManagement, handler)
 */
export const requireMenuManagement = requireFeature('menuManagement');

/**
 * 📊 Guest Analytics feature middleware
 * Use: app.get('/api/guests/:id/analytics', requireGuestAnalytics, handler)
 */
export const requireGuestAnalytics = requireFeature('guestAnalytics');

/**
 * 📈 Advanced Reporting feature middleware
 * Use: app.get('/api/analytics/advanced', requireAdvancedReporting, handler)
 */
export const requireAdvancedReporting = requireFeature('advancedReporting');

/**
 * 🎨 Custom Branding feature middleware
 * Use: app.put('/api/branding', requireCustomBranding, handler)
 */
export const requireCustomBranding = requireFeature('customBranding');

/**
 * 🔌 API Access feature middleware
 * Use: app.get('/api/external/*', requireApiAccess, handler)
 */
export const requireApiAccess = requireFeature('apiAccess');

// ================================
// MULTIPLE FEATURES MIDDLEWARE
// ================================

/**
 * 🔄 Require multiple features (ALL must be available)
 * 
 * Usage:
 * app.get('/api/advanced-ai', requireAllFeatures(['aiChat', 'advancedReporting']), handler);
 */
export const requireAllFeatures = (features: (keyof TenantFeatures)[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        console.log(`🔍 [FeatureFlags] Checking multiple feature requirements: ${features.join(', ')}`);
        
        const context = req.tenantContext;
        if (!context) {
            return res.status(500).json({
                error: 'Tenant context not available',
                code: 'NO_TENANT_CONTEXT'
            });
        }
        
        const missingFeatures: string[] = [];
        const upgradeReasons: string[] = [];
        let highestPlanNeeded = 'free';
        
        for (const feature of features) {
            const accessResult = checkFeatureAccess(context, feature);
            
            if (!accessResult.allowed) {
                missingFeatures.push(feature);
                if (accessResult.reason) {
                    upgradeReasons.push(accessResult.reason);
                }
                if (accessResult.suggestedPlan) {
                    const planHierarchy = ['free', 'starter', 'professional', 'enterprise'];
                    if (planHierarchy.indexOf(accessResult.suggestedPlan) > planHierarchy.indexOf(highestPlanNeeded)) {
                        highestPlanNeeded = accessResult.suggestedPlan;
                    }
                }
            }
        }
        
        if (missingFeatures.length > 0) {
            return res.status(402).json({
                error: 'Multiple features required',
                code: 'MULTIPLE_FEATURES_REQUIRED',
                missingFeatures,
                currentPlan: context.restaurant.tenantPlan,
                reasons: upgradeReasons,
                upgradeRequired: true,
                suggestedPlan: highestPlanNeeded,
                upgradeUrl: `/dashboard/billing?upgrade=${highestPlanNeeded}`
            });
        }
        
        next();
    };
};

/**
 * 🔀 Require any one of multiple features (OR logic)
 * 
 * Usage:
 * app.get('/api/analytics', requireAnyFeature(['guestAnalytics', 'advancedReporting']), handler);
 */
export const requireAnyFeature = (features: (keyof TenantFeatures)[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        console.log(`🔍 [FeatureFlags] Checking any feature requirement: ${features.join(' OR ')}`);
        
        const context = req.tenantContext;
        if (!context) {
            return res.status(500).json({
                error: 'Tenant context not available',
                code: 'NO_TENANT_CONTEXT'
            });
        }
        
        // Check if ANY feature is available
        for (const feature of features) {
            const accessResult = checkFeatureAccess(context, feature);
            if (accessResult.allowed) {
                console.log(`✅ [FeatureFlags] ${feature} available, allowing access`);
                next();
                return;
            }
        }
        
        // None of the features are available
        const lowestPlanNeeded = features.reduce((lowest, feature) => {
            const requirement = FEATURE_PLAN_REQUIREMENTS[feature];
            if (!requirement) return lowest;
            
            const planHierarchy = ['free', 'starter', 'professional', 'enterprise'];
            const requiredIndex = planHierarchy.indexOf(requirement.requiredPlan);
            const lowestIndex = planHierarchy.indexOf(lowest);
            
            return requiredIndex < lowestIndex ? requirement.requiredPlan : lowest;
        }, 'enterprise');
        
        return res.status(402).json({
            error: 'No available features',
            code: 'NO_AVAILABLE_FEATURES',
            requiredFeatures: features,
            currentPlan: context.restaurant.tenantPlan,
            message: `This endpoint requires one of: ${features.join(', ')}`,
            upgradeRequired: true,
            suggestedPlan: lowestPlanNeeded,
            upgradeUrl: `/dashboard/billing?upgrade=${lowestPlanNeeded}`
        });
    };
};

// ================================
// HELPER FUNCTIONS
// ================================

/**
 * 🔍 Get available features for current tenant
 * Use this in route handlers to conditionally show UI elements
 */
export function getAvailableFeatures(req: Request): TenantFeatures | null {
    return req.tenantContext?.features || null;
}

/**
 * 🎯 Check if specific feature is available (non-middleware version)
 * Use this in route handlers for conditional logic
 */
export function hasFeature(req: Request, feature: keyof TenantFeatures): boolean {
    const context = req.tenantContext;
    if (!context) return false;
    
    return checkFeatureAccess(context, feature).allowed;
}

/**
 * 📊 Get feature usage summary for dashboard
 */
export function getFeatureSummary(req: Request): {
    currentPlan: string;
    availableFeatures: string[];
    unavailableFeatures: string[];
    upgradeRecommendations: string[];
} | null {
    const context = req.tenantContext;
    if (!context) return null;
    
    const availableFeatures: string[] = [];
    const unavailableFeatures: string[] = [];
    const upgradeRecommendations: string[] = [];
    
    const allFeatures: (keyof TenantFeatures)[] = [
        'aiChat', 'telegramBot', 'menuManagement', 'guestAnalytics',
        'advancedReporting', 'customBranding', 'apiAccess', 'prioritySupport'
    ];
    
    for (const feature of allFeatures) {
        const accessResult = checkFeatureAccess(context, feature);
        
        if (accessResult.allowed) {
            availableFeatures.push(feature);
        } else {
            unavailableFeatures.push(feature);
            if (accessResult.suggestedPlan) {
                upgradeRecommendations.push(`Upgrade to ${accessResult.suggestedPlan} for ${feature}`);
            }
        }
    }
    
    return {
        currentPlan: context.restaurant.tenantPlan || 'free',
        availableFeatures,
        unavailableFeatures,
        upgradeRecommendations
    };
}

/**
 * 🚨 Soft feature check (logs warning but doesn't block)
 * Use this for gradual feature rollouts or optional enhancements
 */
export const softFeatureCheck = (feature: keyof TenantFeatures) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const context = req.tenantContext;
        if (!context) {
            next();
            return;
        }
        
        const accessResult = checkFeatureAccess(context, feature);
        if (!accessResult.allowed) {
            console.warn(`⚠️ [FeatureFlags] Soft check failed for ${feature}: ${accessResult.reason}`);
            
            // Add header to indicate feature unavailability
            res.setHeader('X-Feature-Limited', feature);
            res.setHeader('X-Upgrade-Suggested', accessResult.suggestedPlan || 'unknown');
        }
        
        next();
    };
};