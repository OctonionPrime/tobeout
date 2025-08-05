// server/services/agents/agent-factory.ts

import { BaseAgent, AgentConfig, RestaurantConfig } from './base-agent';
import { SofiaAgent } from './sofia-agent';
import { MayaAgent } from './maya-agent';
import { ConductorAgent } from './conductor-agent';
import { ApolloAgent } from './apollo-agent';
import { TenantContext } from '../tenant-context';
import { smartLog } from '../smart-logging.service';
import { storage } from '../../storage';

// --- Type Definitions ---

/**
 * Defines the types of agents available in the system.
 */
type AgentType = 'booking' | 'reservations' | 'conductor' | 'availability';

/**
 * Represents an entry in the agent cache registry with tenant isolation.
 */
interface AgentRegistryEntry {
    agent: BaseAgent;
    agentType: AgentType;
    restaurantId: number;
    tenantId: number; 
    tenantContext: TenantContext; 
    createdAt: Date;
    lastUsed: Date;
    requestCount: number;
    healthy: boolean;
    // 🔒 Security metadata
    securityContext: {
        createdBy: 'system' | 'user';
        tenantPlan: string;
        featuresEnabled: string[];
        lastValidation: Date;
    };
}

/**
 * Configuration for the AgentFactory itself.
 */
interface AgentFactoryConfig {
    enableCaching?: boolean;
    maxCacheSize?: number;
    healthCheckInterval?: number; // in milliseconds
    enablePerformanceMonitoring?: boolean;
}

/**
 * 🔒 Agent feature requirements by type
 */
interface AgentFeatureRequirements {
    [key: string]: {
        requiredFeatures: string[];
        planRestrictions?: string[];
        description: string;
    };
}

/**
 * 🔒 Tenant agent usage tracking
 */
interface TenantAgentUsage {
    monthlyAgentCreations: number;
    totalAgentCreations: number;
    lastCreationAt: Date;
    agentTypeUsage: Record<AgentType, number>;
}

/**
 * Manages the loading and caching of restaurant-specific configurations.
 * This decouples the AgentFactory from a single restaurant and enables multi-tenancy.
 */
class RestaurantConfigManager {
    private static configs = new Map<number, RestaurantConfig>();

    /**
     * Retrieves a restaurant's configuration, loading from storage if not already cached.
     * @param restaurantId The ID of the restaurant.
     * @returns A promise that resolves to the RestaurantConfig.
     */
    static async getConfig(restaurantId: number): Promise<RestaurantConfig> {
        if (this.configs.has(restaurantId)) {
            return this.configs.get(restaurantId)!;
        }

        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
            throw new Error(`[RestaurantConfigManager] Restaurant with ID ${restaurantId} not found.`);
        }

        console.log('🔍 [DEBUG] Raw restaurant data from storage:', {
            restaurantId,
            opening_time: restaurant.opening_time,          // snake_case (DB)
            closing_time: restaurant.closing_time,          // snake_case (DB)
            openingTime: restaurant.openingTime,            // camelCase (Drizzle)
            closingTime: restaurant.closingTime,            // camelCase (Drizzle)
            allKeys: Object.keys(restaurant)
        });

        const config: RestaurantConfig = {
            id: restaurant.id,
            name: restaurant.name,
            timezone: restaurant.timezone || 'Europe/Belgrade',
            openingTime: restaurant.openingTime || '09:00:00',
            closingTime: restaurant.closingTime || '23:00:00',
            maxGuests: restaurant.maxGuests || 12,
            cuisine: restaurant.cuisine,
            atmosphere: restaurant.atmosphere,
            country: restaurant.country,
            languages: restaurant.languages,
        };

        console.log('🔍 [DEBUG] Final restaurant config:', {
            restaurantId,
            configOpeningTime: config.openingTime,
            configClosingTime: config.closingTime
        });

        this.configs.set(restaurantId, config);
        smartLog.info('Restaurant configuration loaded and cached', {
            restaurantId,
            restaurantName: config.name,
            cachedConfigs: this.configs.size
        });
        return config;
    }

    /**
     * 🔒 Clear cached config for tenant (used during tenant updates)
     */
    static clearConfigCache(restaurantId: number): void {
        if (this.configs.has(restaurantId)) {
            this.configs.delete(restaurantId);
            smartLog.info('Restaurant configuration cache cleared', { restaurantId });
        }
    }
}

/**
 * A singleton factory for creating and managing AI agent instances with complete tenant isolation.
 * It handles dynamic configuration loading, caching, health monitoring, and security validation.
 */
export class AgentFactory {
    private static instance: AgentFactory | null = null;
    private readonly agentRegistry = new Map<string, AgentRegistryEntry>();
    private readonly factoryConfig: Required<AgentFactoryConfig>;
    private healthCheckTimer?: NodeJS.Timeout;
    private readonly createdAt: Date;

    // 🔒 Tenant usage tracking for billing
    private static tenantUsage = new Map<number, TenantAgentUsage>();

    // 🔒 Agent feature requirements
    private static readonly agentFeatureRequirements: AgentFeatureRequirements = {
        booking: {
            requiredFeatures: [], // Basic feature - available to all plans
            description: 'Basic booking agent - available on all plans'
        },
        reservations: {
            requiredFeatures: ['advancedReporting'], // Requires advanced features
            planRestrictions: ['professional', 'enterprise'],
            description: 'Advanced reservation management - Professional+ plans only'
        },
        conductor: {
            requiredFeatures: ['aiChat', 'advancedReporting'], // Requires AI and advanced features
            planRestrictions: ['professional', 'enterprise'],
            description: 'AI conversation conductor - Professional+ plans only'
        },
        availability: {
            requiredFeatures: ['advancedReporting'], // Requires advanced analytics
            planRestrictions: ['starter', 'professional', 'enterprise'],
            description: 'Advanced availability analysis - Starter+ plans only'
        }
    };

    /**
     * The constructor is private to enforce the singleton pattern.
     * @param config - Optional configuration for the factory.
     */
    private constructor(config?: AgentFactoryConfig) {
        this.factoryConfig = {
            enableCaching: config?.enableCaching ?? true,
            maxCacheSize: config?.maxCacheSize ?? 50,
            healthCheckInterval: config?.healthCheckInterval ?? 300000,
            enablePerformanceMonitoring: config?.enablePerformanceMonitoring ?? true,
        };

        this.createdAt = new Date();

        if (this.factoryConfig.healthCheckInterval > 0) {
            this.startHealthMonitoring();
        }

        smartLog.info('AgentFactory initialized with tenant isolation', {
            config: this.factoryConfig,
            securityLevel: 'HIGH',
            tenantIsolationEnabled: true,
            featureValidationEnabled: true
        });
    }

    /**
     * Retrieves the singleton instance of the AgentFactory.
     * @param config - Optional configuration, applied only on first instantiation.
     * @returns The singleton AgentFactory instance.
     */
    static getInstance(config?: AgentFactoryConfig): AgentFactory {
        if (!AgentFactory.instance) {
            AgentFactory.instance = new AgentFactory(config);
        }
        return AgentFactory.instance;
    }

    // ===== 🔒 TENANT VALIDATION AND SECURITY =====

    /**
     * 🔒 Validates tenant has access to create the requested agent type
     */
    private validateTenantAgentAccess(
        type: AgentType,
        tenantContext: TenantContext,
        operation: string
    ): boolean {
        if (!tenantContext) {
            smartLog.error('Agent creation attempted without tenant context', new Error('MISSING_TENANT_CONTEXT'), {
                agentType: type,
                operation,
                securityViolation: true,
                critical: true
            });
            return false;
        }

        // Check if tenant is active
        if (tenantContext.restaurant.tenantStatus !== 'active' && tenantContext.restaurant.tenantStatus !== 'trial') {
            smartLog.warn('Agent creation denied - tenant not active', {
                tenantId: tenantContext.restaurant.id,
                tenantStatus: tenantContext.restaurant.tenantStatus,
                agentType: type,
                operation,
                securityViolation: true
            });
            return false;
        }

        // Get agent requirements
        const requirements = AgentFactory.agentFeatureRequirements[type];
        if (!requirements) {
            smartLog.error('Unknown agent type requested', new Error('UNKNOWN_AGENT_TYPE'), {
                agentType: type,
                tenantId: tenantContext.restaurant.id,
                operation,
                securityViolation: true
            });
            return false;
        }

        // Check plan restrictions
        if (requirements.planRestrictions && requirements.planRestrictions.length > 0) {
            if (!requirements.planRestrictions.includes(tenantContext.restaurant.tenantPlan)) {
                smartLog.warn('Agent creation denied - plan restriction', {
                    tenantId: tenantContext.restaurant.id,
                    tenantPlan: tenantContext.restaurant.tenantPlan,
                    agentType: type,
                    requiredPlans: requirements.planRestrictions,
                    operation,
                    securityViolation: true
                });
                return false;
            }
        }

        // Check feature requirements
        for (const requiredFeature of requirements.requiredFeatures) {
            if (!tenantContext.features[requiredFeature as keyof typeof tenantContext.features]) {
                smartLog.warn('Agent creation denied - missing required feature', {
                    tenantId: tenantContext.restaurant.id,
                    tenantPlan: tenantContext.restaurant.tenantPlan,
                    agentType: type,
                    requiredFeature,
                    operation,
                    securityViolation: true
                });
                return false;
            }
        }

        return true;
    }

    /**
     * 🔒 Track agent usage for billing and analytics
     */
    private trackTenantAgentUsage(tenantContext: TenantContext, agentType: AgentType): void {
        const tenantId = tenantContext.restaurant.id;
        const current = AgentFactory.tenantUsage.get(tenantId) || {
            monthlyAgentCreations: 0,
            totalAgentCreations: 0,
            lastCreationAt: new Date(),
            agentTypeUsage: {
                booking: 0,
                reservations: 0,
                conductor: 0,
                availability: 0
            }
        };

        // Reset monthly counters if it's a new month
        const now = new Date();
        const lastCreation = new Date(current.lastCreationAt);
        if (now.getMonth() !== lastCreation.getMonth() || now.getFullYear() !== lastCreation.getFullYear()) {
            current.monthlyAgentCreations = 0;
        }

        current.monthlyAgentCreations++;
        current.totalAgentCreations++;
        current.agentTypeUsage[agentType]++;
        current.lastCreationAt = now;

        AgentFactory.tenantUsage.set(tenantId, current);

        smartLog.info('Agent usage tracked', {
            tenantId,
            agentType,
            monthlyCreations: current.monthlyAgentCreations,
            totalCreations: current.totalCreations,
            agentTypeUsage: current.agentTypeUsage
        });

        smartLog.businessEvent('agent_created', {
            tenantId,
            tenantPlan: tenantContext.restaurant.tenantPlan,
            agentType,
            monthlyCreations: current.monthlyCreations,
            totalCreations: current.totalCreations
        });
    }

    /**
     * 🔒 Generate tenant-scoped agent ID
     */
    private generateTenantScopedAgentId(type: AgentType, tenantId: number): string {
        return `t${tenantId}_${type}_${Date.now()}`;
    }

    // ===== 🔒 SECURE AGENT CREATION WITH TENANT VALIDATION =====

    /**
     * 🔒 Creates or retrieves a cached agent of a specific type for a given restaurant with complete tenant validation.
     * @param type - The type of agent to create ('booking', 'reservations', etc.).
     * @param tenantContext - Required tenant context for security validation.
     * @param customConfig - Optional custom configuration to override defaults for this agent instance.
     * @returns A promise that resolves to an instance of a BaseAgent.
     */
    async createAgent(
        type: AgentType,
        tenantContext: TenantContext,
        customConfig?: Partial<AgentConfig>
    ): Promise<BaseAgent> {
        // 🔒 Security validation
        if (!this.validateTenantAgentAccess(type, tenantContext, 'createAgent')) {
            const requirements = AgentFactory.agentFeatureRequirements[type];
            throw new Error(
                `Agent type '${type}' not available on your plan. ` +
                `Required: ${requirements?.description || 'Unknown requirements'}. ` +
                `Please upgrade to access this feature.`
            );
        }

        const restaurantId = tenantContext.restaurant.id;
        const tenantId = tenantContext.restaurant.id;
        const agentId = this.generateTenantScopedAgentId(type, tenantId);

        // Check for cached agent (tenant-scoped)
        if (this.factoryConfig.enableCaching) {
            const cachedEntry = this.findCachedAgentForTenant(type, tenantId);
            if (cachedEntry && cachedEntry.healthy) {
                cachedEntry.lastUsed = new Date();
                cachedEntry.requestCount++;
                cachedEntry.securityContext.lastValidation = new Date();
                cachedEntry.tenantContext = tenantContext;

                smartLog.info('Retrieved cached agent with tenant validation', {
                    agentType: type,
                    tenantId,
                    agentId: cachedEntry.agent.name,
                    requestCount: cachedEntry.requestCount,
                    cacheHit: true
                });

                return cachedEntry.agent;
            }
        }

        smartLog.info('Creating new agent with tenant validation', {
            agentType: type,
            tenantId,
            tenantPlan: tenantContext.restaurant.tenantPlan,
            restaurantId,
            hasCustomConfig: !!customConfig
        });

        const restaurantConfig = await RestaurantConfigManager.getConfig(restaurantId);
        const agent = await this.instantiateAgent(type, restaurantConfig, customConfig);

        // 🔒 Track usage for billing
        this.trackTenantAgentUsage(tenantContext, type);

        if (this.factoryConfig.enableCaching) {
            this.registerSecureAgent(agentId, agent, type, tenantContext);
        }

        return agent;
    }

    /**
     * 🔒 Find cached agent for specific tenant (prevents cross-tenant sharing)
     */
    private findCachedAgentForTenant(type: AgentType, tenantId: number): AgentRegistryEntry | null {
        for (const [agentId, entry] of this.agentRegistry.entries()) {
            if (entry.agentType === type && 
                entry.tenantId === tenantId && 
                entry.healthy &&
                !this.isEntryStale(entry)) { 
                
                entry.lastUsed = new Date();
                entry.requestCount++;
                
                smartLog.info('Found cached agent for tenant', {
                    agentType: type,
                    tenantId,
                    agentId,
                    cacheHit: true,
                    requestCount: entry.requestCount
                });
                return entry;
            }
        }

        smartLog.info('No cached agent found for tenant', {
            agentType: type,
            tenantId,
            cacheMiss: true
        });
        return null;
    }

  
    private isEntryStale(entry: AgentRegistryEntry): boolean {
        const maxAge = 30 * 60 * 1000; // 30 minutes
        const isStale = Date.now() - entry.lastUsed.getTime() > maxAge;
        
        if (isStale) {
            smartLog.info('Cache entry marked as stale', {
                agentType: entry.agentType,
                tenantId: entry.tenantId,
                lastUsed: entry.lastUsed,
                maxAgeMinutes: maxAge / 60000
            });
        }
        
        return isStale;
    }

  
    private shouldClearCacheForReset(resetReason: string): boolean {
        const validReasons = ['new_booking_request', 'agent_handoff'];
        return !validReasons.includes(resetReason);
    }

    /**
     * 🔒 Register agent with complete security context
     */
    private registerSecureAgent(
        agentId: string,
        agent: BaseAgent,
        type: AgentType,
        tenantContext: TenantContext
    ): void {
        const entry: AgentRegistryEntry = {
            agent,
            agentType: type,
            restaurantId: tenantContext.restaurant.id,
            tenantId: tenantContext.restaurant.id,
            tenantContext, 
            createdAt: new Date(),
            lastUsed: new Date(),
            requestCount: 1,
            healthy: true,
            securityContext: {
                createdBy: 'system',
                tenantPlan: tenantContext.restaurant.tenantPlan,
                featuresEnabled: Object.entries(tenantContext.features)
                    .filter(([_, enabled]) => enabled)
                    .map(([feature, _]) => feature),
                lastValidation: new Date()
            }
        };

        this.agentRegistry.set(agentId, entry);

        smartLog.info('Agent registered with security context', {
            agentId,
            agentType: type,
            tenantId: tenantContext.restaurant.id,
            tenantPlan: tenantContext.restaurant.tenantPlan,
            featuresEnabled: entry.securityContext.featuresEnabled,
            cacheSize: this.agentRegistry.size
        });

        // Evict the least recently used agent if the cache is full
        if (this.agentRegistry.size > this.factoryConfig.maxCacheSize) {
            let lruEntry: [string, AgentRegistryEntry] | null = null;
            for (const currentEntry of this.agentRegistry.entries()) {
                if (!lruEntry || currentEntry[1].lastUsed < lruEntry[1].lastUsed) {
                    lruEntry = currentEntry;
                }
            }
            if (lruEntry) {
                this.agentRegistry.delete(lruEntry[0]);
                smartLog.info('Agent cache eviction performed', {
                    evictedAgentId: lruEntry[0],
                    evictedTenantId: lruEntry[1].tenantId,
                    reason: 'cache_size_limit',
                    newCacheSize: this.agentRegistry.size
                });
            }
        }
    }

    /**
     * Instantiates the correct agent class based on the requested type.
     * @param type - The type of agent.
     * @param restaurantConfig - The configuration for the specific restaurant.
     * @param customConfig - Optional overrides for the agent's configuration.
     * @returns A promise resolving to the new agent instance.
     */
    private async instantiateAgent(
        type: AgentType,
        restaurantConfig: RestaurantConfig,
        customConfig?: Partial<AgentConfig>
    ): Promise<BaseAgent> {
        // A default config can be created here or within each agent class
        const defaultConfig: AgentConfig = {
            name: type,
            description: `Default ${type} agent`,
            capabilities: [],
            ...customConfig
        };

        try {
            switch (type) {
                case 'booking':
                    return new SofiaAgent(defaultConfig, restaurantConfig);
                case 'reservations':
                    return new MayaAgent(defaultConfig, restaurantConfig);
                case 'conductor':
                    return new ConductorAgent(defaultConfig, restaurantConfig);

                case 'availability':
                    smartLog.info('Instantiating production-ready ApolloAgent', {
                        agentType: type,
                        restaurantId: restaurantConfig.id,
                        status: 'COMPLETE'
                    });
                    return new ApolloAgent(defaultConfig, restaurantConfig);

                default:
                    throw new Error(`Unknown agent type: ${type}`);
            }
        } catch (error) {
            smartLog.error('Failed to instantiate agent', error as Error, {
                agentType: type,
                restaurantId: restaurantConfig.id,
                hasCustomConfig: !!customConfig
            });
            throw error;
        }
    }

    // ===== 🔒 TENANT USAGE AND ANALYTICS =====

    /**
     * 🔒 Get tenant agent usage statistics
     */
    getTenantUsage(tenantId: number): TenantAgentUsage | null {
        return AgentFactory.tenantUsage.get(tenantId) || null;
    }

    /**
     * 🔒 Get all tenants usage for super admin
     */
    getAllTenantsUsage(): Map<number, TenantAgentUsage> {
        return new Map(AgentFactory.tenantUsage);
    }

    /**
     * 🔒 Reset monthly usage for a tenant (for billing cycles)
     */
    resetTenantMonthlyUsage(tenantId: number): void {
        const usage = AgentFactory.tenantUsage.get(tenantId);
        if (usage) {
            usage.monthlyAgentCreations = 0;
            AgentFactory.tenantUsage.set(tenantId, usage);

            smartLog.info('Tenant monthly agent usage reset', {
                tenantId,
                resetDate: new Date().toISOString()
            });
        }
    }

    /**
     * 🔒 Invalidate all cached agents for a tenant (suspension/plan change)
     */
    invalidateTenantagents(tenantId: number): number {
        let invalidatedCount = 0;
        const agentsToRemove: string[] = [];

        for (const [agentId, entry] of this.agentRegistry.entries()) {
            if (entry.tenantId === tenantId) {
                agentsToRemove.push(agentId);
                invalidatedCount++;
            }
        }

        for (const agentId of agentsToRemove) {
            this.agentRegistry.delete(agentId);
        }

        if (invalidatedCount > 0) {
            smartLog.info('Tenant agents cache invalidated', {
                tenantId,
                invalidatedCount,
                reason: 'tenant_plan_change_or_suspension'
            });

            smartLog.businessEvent('tenant_agents_invalidated', {
                tenantId,
                invalidatedCount
            });
        }

        // Also clear restaurant config cache
        RestaurantConfigManager.clearConfigCache(tenantId);

        return invalidatedCount;
    }

    /**
     * 🔒 Get agent feature requirements (for UI display)
     */
    static getAgentFeatureRequirements(): AgentFeatureRequirements {
        return { ...AgentFactory.agentFeatureRequirements };
    }

    // ===== ENHANCED HEALTH MONITORING WITH TENANT CONTEXT =====

    /**
     * Starts a periodic timer to run health checks on all cached agents.
     */
    private startHealthMonitoring(): void {
        smartLog.info('Agent factory health monitoring started', {
            interval: this.factoryConfig.healthCheckInterval,
            tenantIsolationEnabled: true,
            tenantContextEnabled: true 
        });

        this.healthCheckTimer = setInterval(async () => {
            if (this.agentRegistry.size === 0) return;

            smartLog.info('Running agent health check with tenant context', {
                totalAgents: this.agentRegistry.size,
                tenantContextSupport: true 
            });

            for (const [agentId, entry] of this.agentRegistry.entries()) {
                try {
                    const health = await entry.agent.healthCheck(entry.tenantContext);
                    
                    entry.healthy = health.healthy;
                    entry.securityContext.lastValidation = new Date();

                    if (!health.healthy) {
                        smartLog.warn('Agent health check failed', {
                            agentId,
                            tenantId: entry.tenantId,
                            agentType: entry.agentType,
                            details: health.details,
                            tenantContextPassed: true 
                        });
                    } else {                        
                        // Log successful health check with tenant context
                        smartLog.info('Agent health check passed', {
                            agentId,
                            tenantId: entry.tenantId,
                            agentType: entry.agentType,
                            tenantContextPassed: true 
                        });
                    }
                } catch (error) {
                    entry.healthy = false;
                    smartLog.error('Agent health check error', error as Error, {
                        agentId,
                        tenantId: entry.tenantId,
                        agentType: entry.agentType,
                        errorType: 'HEALTH_CHECK_FAILURE',
                        tenantContextPassed: !!entry.tenantContext 
                    });
                }
            }

            
            this.cleanupStaleEntries();
        }, this.factoryConfig.healthCheckInterval);

        // Allows the Node.js process to exit even if this timer is active.
        this.healthCheckTimer.unref();
    }


    private cleanupStaleEntries(): void {
        const staleEntries: string[] = [];
        
        for (const [agentId, entry] of this.agentRegistry.entries()) {
            if (this.isEntryStale(entry)) {
                staleEntries.push(agentId);
            }
        }

        for (const agentId of staleEntries) {
            const entry = this.agentRegistry.get(agentId);
            this.agentRegistry.delete(agentId);
            
            if (entry) {
                smartLog.info('Stale cache entry removed', {
                    agentId,
                    tenantId: entry.tenantId,
                    agentType: entry.agentType,
                    lastUsed: entry.lastUsed,
                    reason: 'STALE_CACHE_CLEANUP'
                });
            }
        }

        if (staleEntries.length > 0) {
            smartLog.info('Cache cleanup completed', {
                removedEntries: staleEntries.length,
                remainingEntries: this.agentRegistry.size
            });
        }
    }

    /**
     * Retrieves statistics about the factory's operation with tenant breakdown.
     * @returns An object containing factory usage and performance metrics.
     */
    getFactoryStats(): {
        totalAgents: number;
        agentsByType: Partial<Record<AgentType, number>>;
        agentsByRestaurant: Record<number, number>;
        agentsByTenant: Record<number, number>;
        securityStats: {
            totalTenants: number;
            avgAgentsPerTenant: number;
            mostUsedAgentType: string;
        };
        uptime: string;
    } {
        const agents = Array.from(this.agentRegistry.values());

        const agentsByType = agents.reduce((acc, entry) => {
            acc[entry.agentType] = (acc[entry.agentType] || 0) + 1;
            return acc;
        }, {} as Partial<Record<AgentType, number>>);

        const agentsByRestaurant = agents.reduce((acc, entry) => {
            acc[entry.restaurantId] = (acc[entry.restaurantId] || 0) + 1;
            return acc;
        }, {} as Record<number, number>);

        const agentsByTenant = agents.reduce((acc, entry) => {
            acc[entry.tenantId] = (acc[entry.tenantId] || 0) + 1;
            return acc;
        }, {} as Record<number, number>);

        const totalTenants = Object.keys(agentsByTenant).length;
        const avgAgentsPerTenant = totalTenants > 0 ? Math.round(agents.length / totalTenants * 100) / 100 : 0;

        const mostUsedAgentType = Object.entries(agentsByType)
            .sort(([, a], [, b]) => b - a)[0]?.[0] || 'none';

        const uptimeMs = Date.now() - this.createdAt.getTime();

        return {
            totalAgents: agents.length,
            agentsByType,
            agentsByRestaurant,
            agentsByTenant,
            securityStats: {
                totalTenants,
                avgAgentsPerTenant,
                mostUsedAgentType
            },
            uptime: this.formatUptime(uptimeMs),
        };
    }

    /**
     * Formats a duration in milliseconds to a human-readable string.
     * @param ms - The duration in milliseconds.
     * @returns A formatted string (e.g., "1d 2h 3m").
     */
    private formatUptime(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        return `${minutes % 60}m ${seconds % 60}s`;
    }
}