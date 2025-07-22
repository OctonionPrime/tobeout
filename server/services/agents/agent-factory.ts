// server/services/agents/agent-factory.ts

/**
 * @file agent-factory.ts
 * @description This file contains the implementation of the AgentFactory, a singleton class
 * responsible for creating, managing, and caching different types of AI agents (Sofia, Maya, etc.)
 * for multiple restaurants. It dynamically loads restaurant-specific configurations,
 * handles agent caching to improve performance, and includes health monitoring for reliability.
 *
 * @version 2.1.0
 * @date 2025-07-21
 *
 * @changelog
 * - v2.1.0 (2025-07-21):
 * - ADDED: Full implementation for the ConductorAgent to handle post-task conversation flow.
 * - FIXED: Replaced the placeholder implementation for 'conductor' agent with the new ConductorAgent class.
 * - v2.0.0 (2025-07-21):
 * - FIXED: Added missing startHealthMonitoring and registerAgent methods to resolve critical runtime error.
 * - ADDED: Defined AgentType and AgentRegistryEntry types for proper type safety.
 * - REFACTORED: Now supports multiple restaurants by dynamically loading configurations via RestaurantConfigManager.
 * - ENHANCED: Caching mechanism is now restaurant-specific for better performance and context separation.
 */

import { BaseAgent, AgentConfig, RestaurantConfig } from './base-agent';
import { SofiaAgent } from './sofia-agent';
import { MayaAgent } from './maya-agent';
import { ConductorAgent } from './conductor-agent'; // Import the new ConductorAgent
import { storage } from '../../storage';

// --- Type Definitions ---

/**
 * Defines the types of agents available in the system.
 */
type AgentType = 'booking' | 'reservations' | 'conductor' | 'availability';

/**
 * Represents an entry in the agent cache registry.
 */
interface AgentRegistryEntry {
    agent: BaseAgent;
    agentType: AgentType;
    restaurantId: number;
    createdAt: Date;
    lastUsed: Date;
    requestCount: number;
    healthy: boolean;
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

        this.configs.set(restaurantId, config);
        console.log(`[RestaurantConfigManager] Loaded and cached configuration for restaurant: ${config.name} (ID: ${restaurantId})`);
        return config;
    }
}

/**
 * A singleton factory for creating and managing AI agent instances.
 * It handles dynamic configuration loading, caching, and health monitoring.
 */
export class AgentFactory {
    private static instance: AgentFactory | null = null;
    private readonly agentRegistry = new Map<string, AgentRegistryEntry>();
    private readonly factoryConfig: Required<AgentFactoryConfig>;
    private healthCheckTimer?: NodeJS.Timeout;
    private readonly createdAt: Date;

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

        console.log('[AgentFactory] Singleton instance initialized for multi-restaurant support.', this.factoryConfig);
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

    /**
     * Creates or retrieves a cached agent of a specific type for a given restaurant.
     * @param type - The type of agent to create ('booking', 'reservations', etc.).
     * @param restaurantId - The ID of the restaurant for which the agent is being created.
     * @param customConfig - Optional custom configuration to override defaults for this agent instance.
     * @returns A promise that resolves to an instance of a BaseAgent.
     */
    async createAgent(
        type: AgentType,
        restaurantId: number,
        customConfig?: Partial<AgentConfig>
    ): Promise<BaseAgent> {
        const agentId = this.generateAgentId(type, restaurantId);

        if (this.factoryConfig.enableCaching) {
            const cachedEntry = this.agentRegistry.get(agentId);
            if (cachedEntry && cachedEntry.healthy) {
                cachedEntry.lastUsed = new Date();
                cachedEntry.requestCount++;
                console.log(`[AgentFactory] Retrieved cached '${type}' agent for restaurant ${restaurantId}.`);
                return cachedEntry.agent;
            }
        }

        console.log(`[AgentFactory] Creating new '${type}' agent for restaurant ${restaurantId}.`);
        const restaurantConfig = await RestaurantConfigManager.getConfig(restaurantId);
        const agent = await this.instantiateAgent(type, restaurantConfig, customConfig);

        if (this.factoryConfig.enableCaching) {
            this.registerAgent(agentId, agent, type, restaurantId);
        }

        return agent;
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
                    return new ConductorAgent(defaultConfig, restaurantConfig); // Use the real ConductorAgent
                case 'availability':
                    console.warn(`[AgentFactory] Agent type '${type}' is not fully implemented. Using a placeholder.`);
                    // You would replace this with `new ApolloAgent(...)` etc.
                    return new (class extends BaseAgent {
                        name = type;
                        description = `Placeholder for ${type} agent`;
                        capabilities = [];
                        generateSystemPrompt = () => `You are a placeholder ${type} agent.`;
                        handleMessage = async (message: string) => ({ content: `Placeholder response for: ${message}`, metadata: { processedAt: new Date().toISOString(), agentType: this.name } });
                        getTools = () => [];
                    })(defaultConfig, restaurantConfig);
                default:
                    throw new Error(`Unknown agent type: ${type}`);
            }
        } catch (error) {
            console.error(`[AgentFactory] Failed to instantiate '${type}' agent for restaurant ${restaurantConfig.id}:`, error);
            throw error;
        }
    }

    /**
     * Generates a unique identifier for an agent instance based on its type and restaurant.
     * @param type - The agent's type.
     * @param restaurantId - The restaurant's ID.
     * @returns A unique string identifier.
     */
    private generateAgentId(type: AgentType, restaurantId: number): string {
        return `${type}_${restaurantId}`;
    }

    /**
     * Registers a new agent in the cache and handles cache eviction if necessary.
     * @param agentId - The unique ID for the agent.
     * @param agent - The agent instance to cache.
     * @param type - The type of the agent.
     * @param restaurantId - The restaurant ID associated with the agent.
     */
    private registerAgent(agentId: string, agent: BaseAgent, type: AgentType, restaurantId: number): void {
        const entry: AgentRegistryEntry = {
            agent,
            agentType: type,
            restaurantId,
            createdAt: new Date(),
            lastUsed: new Date(),
            requestCount: 1,
            healthy: true, // Assume healthy on creation
        };
        this.agentRegistry.set(agentId, entry);
        console.log(`[AgentFactory] Cached new agent: ${agentId}`);

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
                console.log(`[AgentFactory] Cache limit reached. Evicted least recently used agent: ${lruEntry[0]}`);
            }
        }
    }

    /**
     * Starts a periodic timer to run health checks on all cached agents.
     * This method resolves the original `this.startHealthMonitoring is not a function` error.
     */
    private startHealthMonitoring(): void {
        console.log(`[AgentFactory] Starting periodic health monitoring. Interval: ${this.factoryConfig.healthCheckInterval}ms`);

        this.healthCheckTimer = setInterval(async () => {
            if (this.agentRegistry.size === 0) return;

            console.log('[AgentFactory] Running scheduled agent health check...');
            for (const [agentId, entry] of this.agentRegistry.entries()) {
                try {
                    const health = await entry.agent.healthCheck();
                    entry.healthy = health.healthy;
                    if (!health.healthy) {
                        console.warn(`[AgentFactory] Agent ${agentId} is UNHEALTHY`, { details: health.details });
                    }
                } catch (error) {
                    entry.healthy = false;
                    console.error(`[AgentFactory] Error during health check for agent ${agentId}:`, error);
                }
            }
        }, this.factoryConfig.healthCheckInterval);

        // Allows the Node.js process to exit even if this timer is active.
        this.healthCheckTimer.unref();
    }

    /**
     * Retrieves statistics about the factory's operation.
     * @returns An object containing factory usage and performance metrics.
     */
    getFactoryStats(): {
        totalAgents: number;
        agentsByType: Partial<Record<AgentType, number>>;
        agentsByRestaurant: Record<number, number>;
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

        const uptimeMs = Date.now() - this.createdAt.getTime();

        return {
            totalAgents: agents.length,
            agentsByType,
            agentsByRestaurant,
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
