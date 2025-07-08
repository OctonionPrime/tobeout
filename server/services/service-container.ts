// ✅ NEW FILE: Service container for proper dependency injection
// This replaces manual service initialization in conversation manager

import { ConversationManager } from './conversation/conversation.manager';
import { createDefaultAIFallbackService } from './ai/ai-fallback.service';
import { UnifiedTranslationService } from './ai/translation.service';
import { OverseerAgent } from './agents/meta-agents/overseer.agent';
import { LanguageDetectionAgent } from './agents/meta-agents/language.agent';
import { ConfirmationDetectionAgent } from './agents/meta-agents/confirmation.agent';
import { SofiaAgent } from './agents/specialists/sofia.agent';
import { MayaAgent } from './agents/specialists/maya.agent';
import { ApolloAgent } from './agents/specialists/apollo.agent';
import type { RestaurantConfig } from './agents/core/agent.types';

/**
 * ✅ NEW: Service Container for proper dependency injection
 * Replaces manual initialization scattered throughout the codebase
 */
export class ServiceContainer {
    // Core services
    public readonly aiService: any;
    public readonly translationService: UnifiedTranslationService;
    
    // Meta-agents
    public readonly overseerAgent: OverseerAgent;
    public readonly languageAgent: LanguageDetectionAgent;
    public readonly confirmationAgent: ConfirmationDetectionAgent;
    
    // Specialist agents
    public readonly sofiaAgent: SofiaAgent;
    public readonly mayaAgent: MayaAgent;
    public readonly apolloAgent: ApolloAgent;
    
    // Main conversation manager
    public readonly conversationManager: ConversationManager;

    constructor(defaultRestaurantConfig?: RestaurantConfig) {
        console.log('[ServiceContainer] Initializing with clean architecture...');

        // Initialize core services
        this.aiService = createDefaultAIFallbackService();
        this.translationService = new UnifiedTranslationService(this.aiService);
        
        // Initialize meta-agents
        this.overseerAgent = new OverseerAgent(this.aiService, this.translationService);
        this.languageAgent = new LanguageDetectionAgent(this.aiService);
        this.confirmationAgent = new ConfirmationDetectionAgent(this.aiService);
        
        // Default restaurant config for agent initialization
        const restaurantConfig: RestaurantConfig = defaultRestaurantConfig || {
            id: 1,
            name: 'Restaurant',
            timezone: 'Europe/Belgrade',
            openingTime: '10:00',
            closingTime: '23:00',
            maxGuests: 50,
            cuisine: 'Fine Dining',
            atmosphere: 'Elegant'
        };
        
        // Initialize specialist agents
        this.sofiaAgent = new SofiaAgent(this.aiService, this.translationService, restaurantConfig);
        this.mayaAgent = new MayaAgent(this.aiService, this.translationService, restaurantConfig);
        this.apolloAgent = new ApolloAgent(this.aiService, this.translationService, restaurantConfig);
        
        // Initialize conversation manager with injected dependencies
        this.conversationManager = new ConversationManager(
            this.aiService,
            this.translationService,
            this.overseerAgent,
            this.languageAgent,
            this.confirmationAgent,
            this.sofiaAgent,
            this.mayaAgent,
            this.apolloAgent
        );

        console.log('[ServiceContainer] All services initialized successfully');
    }

    /**
     * Get agent for specific type with proper restaurant configuration
     */
    getAgentForType(agentType: 'booking' | 'reservations' | 'availability' | 'conductor', restaurantConfig?: RestaurantConfig) {
        switch (agentType) {
            case 'booking':
                return restaurantConfig ? 
                    new SofiaAgent(this.aiService, this.translationService, restaurantConfig) : 
                    this.sofiaAgent;
            case 'reservations':
                return restaurantConfig ? 
                    new MayaAgent(this.aiService, this.translationService, restaurantConfig) : 
                    this.mayaAgent;
            case 'availability':
                return restaurantConfig ? 
                    new ApolloAgent(this.aiService, this.translationService, restaurantConfig) : 
                    this.apolloAgent;
            case 'conductor':
            default:
                return restaurantConfig ? 
                    new SofiaAgent(this.aiService, this.translationService, restaurantConfig) : 
                    this.sofiaAgent;
        }
    }

    /**
     * Graceful shutdown of all services
     */
    shutdown(): void {
        console.log('[ServiceContainer] Shutting down all services...');
        this.conversationManager.shutdown();
        console.log('[ServiceContainer] Shutdown completed');
    }
}

// Global service container instance
export const serviceContainer = new ServiceContainer();

// Export for use in integrations
export default serviceContainer;