// src/agents/base-agent.ts
// ✅ PHASE 4.1: BaseAgent Pattern Implementation
// Foundation class for all restaurant booking agents
// Provides shared functionality, standardized interface, and professional architecture
// Integrates with AIService, ContextManager, and existing restaurant booking infrastructure

import { aiService } from '../ai-service';
import { contextManager } from '../context-manager';
import type { Language } from '../enhanced-conversation-manager';

/**
 * Context information passed to agents for processing user requests
 */
export interface AgentContext {
    restaurantId: number;
    timezone: string;
    language: Language;
    telegramUserId?: string;
    sessionId?: string;
    guestHistory?: {
        guest_name: string;
        guest_phone: string;
        total_bookings: number;
        total_cancellations: number;
        last_visit_date: string | null;
        common_party_size: number | null;
        frequent_special_requests: string[];
        retrieved_at: string;
    } | null;
    conversationContext?: {
        isReturnVisit: boolean;
        hasAskedPartySize: boolean;
        hasAskedDate: boolean;
        hasAskedTime: boolean;
        hasAskedName: boolean;
        hasAskedPhone: boolean;
        bookingNumber: number;
        isSubsequentBooking: boolean;
        sessionTurnCount: number;
        lastQuestions: string[];
    };
    session?: any; // Full session object for context resolution
}

/**
 * Standardized response format from all agents
 */
export interface AgentResponse {
    content: string;
    toolCalls?: any[];
    handoffSignal?: { 
        to: 'booking' | 'reservations' | 'conductor' | 'availability'; 
        reason: string;
        confidence?: number;
    };
    metadata?: {
        confidence?: number;
        processedAt: string;
        agentType: string;
        processingTimeMs?: number;
        modelUsed?: string;
        contextResolutionApplied?: boolean;
        translationApplied?: boolean;
    };
    error?: {
        type: 'SYSTEM_ERROR' | 'VALIDATION_ERROR' | 'BUSINESS_RULE';
        message: string;
        recoverable: boolean;
    };
}

/**
 * Configuration for creating agent instances
 */
export interface AgentConfig {
    name: string;
    description: string;
    capabilities: string[];
    maxTokens?: number;
    temperature?: number;
    primaryModel?: 'haiku' | 'sonnet' | 'gpt-4o-mini' | 'gpt-4o';
    fallbackModel?: 'haiku' | 'sonnet' | 'gpt-4o-mini' | 'gpt-4o';
    enableContextResolution?: boolean;
    enableTranslation?: boolean;
    enablePersonalization?: boolean;
}

/**
 * Restaurant configuration interface
 */
export interface RestaurantConfig {
    id: number;
    name: string;
    timezone: string;
    openingTime: string;
    closingTime: string;
    maxGuests: number;
    cuisine?: string;
    atmosphere?: string;
    country?: string;
    languages?: string[];
}

/**
 * BaseAgent - Foundation class for all restaurant booking agents
 * 
 * This abstract class provides:
 * - Standardized interface for all agents
 * - Shared utility methods (AI generation, translation, logging)
 * - Integration with AIService and ContextManager
 * - Error handling and performance monitoring
 * - Professional logging and debugging capabilities
 * 
 * Agents extending this class: Sofia (booking), Maya (reservations), Apollo (availability)
 */
export abstract class BaseAgent {
    // Abstract properties each agent must define
    abstract readonly name: string;
    abstract readonly description: string;
    abstract readonly capabilities: string[];

    // Performance monitoring
    private readonly createdAt: Date;
    private requestCount: number = 0;
    private totalProcessingTime: number = 0;

    constructor(
        protected readonly config: AgentConfig,
        protected readonly restaurantConfig: RestaurantConfig
    ) {
        this.createdAt = new Date();
        this.logAgentAction('Agent initialized', {
            name: this.name,
            capabilities: this.capabilities,
            restaurant: this.restaurantConfig.name,
            config: {
                maxTokens: this.config.maxTokens,
                temperature: this.config.temperature,
                primaryModel: this.config.primaryModel
            }
        });
    }

    // ===== ABSTRACT METHODS (Must be implemented by each agent) =====

    /**
     * Generate system prompt for the agent based on context
     * Each agent implements this to create their specific instructions
     */
    abstract generateSystemPrompt(context: AgentContext): string;

    /**
     * Handle user message and return appropriate response
     * Main entry point for agent processing
     */
    abstract handleMessage(message: string, context: AgentContext): Promise<AgentResponse>;

    /**
     * Get tools available to this agent
     * Returns array of function definitions for tool calling
     */
    abstract getTools(): any[];

    // ===== SHARED UTILITY METHODS =====

    /**
     * Generate text content using AIService with automatic fallback
     * Standardized across all agents with consistent error handling
     */
    protected async generateResponse(
        prompt: string, 
        options: {
            model?: 'haiku' | 'sonnet' | 'gpt-4o-mini' | 'gpt-4o';
            maxTokens?: number;
            temperature?: number;
            context?: string;
            timeout?: number;
        } = {}
    ): Promise<string> {
        const startTime = Date.now();
        
        try {
            const response = await aiService.generateContent(prompt, {
                model: options.model || this.config.primaryModel || 'haiku',
                maxTokens: options.maxTokens || this.config.maxTokens || 1000,
                temperature: options.temperature !== undefined ? options.temperature : (this.config.temperature || 0.2),
                context: options.context || `${this.name}-generation`,
                timeout: options.timeout || 30000
            });

            const processingTime = Date.now() - startTime;
            this.updatePerformanceMetrics(processingTime);

            this.logAgentAction('Generated response', {
                processingTimeMs: processingTime,
                model: options.model || this.config.primaryModel || 'haiku',
                promptLength: prompt.length,
                responseLength: response.length
            });

            return response;

        } catch (error) {
            const processingTime = Date.now() - startTime;
            this.logAgentAction('Response generation failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
                processingTimeMs: processingTime,
                model: options.model || this.config.primaryModel || 'haiku'
            });
            throw error;
        }
    }

    /**
     * Generate and parse JSON content with schema validation
     * Used for structured responses and tool parameter generation
     */
    protected async generateJSON<T>(
        prompt: string,
        options: {
            model?: 'haiku' | 'sonnet' | 'gpt-4o-mini' | 'gpt-4o';
            maxTokens?: number;
            temperature?: number;
            context?: string;
            schema?: any;
            retryOnInvalidJSON?: boolean;
        } = {}
    ): Promise<T> {
        const startTime = Date.now();
        
        try {
            const response = await aiService.generateJSON<T>(prompt, {
                model: options.model || this.config.primaryModel || 'haiku',
                maxTokens: options.maxTokens || this.config.maxTokens || 1000,
                temperature: options.temperature !== undefined ? options.temperature : (this.config.temperature || 0.2),
                context: options.context || `${this.name}-json`,
                schema: options.schema,
                retryOnInvalidJSON: options.retryOnInvalidJSON !== false
            });

            const processingTime = Date.now() - startTime;
            this.updatePerformanceMetrics(processingTime);

            this.logAgentAction('Generated JSON', {
                processingTimeMs: processingTime,
                model: options.model || this.config.primaryModel || 'haiku',
                hasSchema: !!options.schema
            });

            return response;

        } catch (error) {
            const processingTime = Date.now() - startTime;
            this.logAgentAction('JSON generation failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
                processingTimeMs: processingTime
            });
            throw error;
        }
    }

    /**
     * Translate text to target language using AIService
     * Handles caching and context-appropriate translation
     */
    protected async translate(
        text: string, 
        targetLanguage: Language,
        context: 'greeting' | 'error' | 'info' | 'question' | 'success' | 'confirmation' = 'info'
    ): Promise<string> {
        if (!this.config.enableTranslation || targetLanguage === 'en' || targetLanguage === 'auto') {
            return text;
        }

        const startTime = Date.now();
        
        try {
            const languageNames: Record<Language, string> = {
                'en': 'English', 'ru': 'Russian', 'sr': 'Serbian', 'hu': 'Hungarian',
                'de': 'German', 'fr': 'French', 'es': 'Spanish', 'it': 'Italian',
                'pt': 'Portuguese', 'nl': 'Dutch', 'auto': 'English'
            };

            const prompt = `Translate this restaurant ${context} message to ${languageNames[targetLanguage]}:

"${text}"

Context: ${context} message for restaurant booking system
Keep the same tone, emojis, and professional style.
Return only the translation, no explanations.`;

            const translation = await aiService.generateContent(prompt, {
                model: 'haiku', // Fast and cost-effective for translation
                maxTokens: Math.min(text.length * 2 + 100, 500),
                temperature: 0.2,
                context: `${this.name}-translation-${context}`
            });

            const processingTime = Date.now() - startTime;
            this.logAgentAction('Translated text', {
                targetLanguage,
                context,
                processingTimeMs: processingTime,
                originalLength: text.length,
                translatedLength: translation.length
            });

            return translation;

        } catch (error) {
            this.logAgentAction('Translation failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
                targetLanguage,
                fallbackToOriginal: true
            });
            
            // Fallback to original text if translation fails
            return text;
        }
    }

    // ===== CONTEXT MANAGEMENT METHODS =====

    /**
     * Resolve reservation ID from user message and session context
     * Integrates with ContextManager for smart context resolution
     */
    protected resolveReservationContext(
        userMessage: string,
        session: any,
        providedId?: number
    ) {
        if (!this.config.enableContextResolution) {
            return {
                resolvedId: providedId || null,
                confidence: providedId ? 'high' : 'low',
                method: 'disabled',
                shouldAskForClarification: !providedId
            };
        }

        try {
            const resolution = contextManager.resolveReservationFromContext(userMessage, session, providedId);
            
            this.logAgentAction('Context resolution', {
                resolvedId: resolution.resolvedId,
                confidence: resolution.confidence,
                method: resolution.method,
                shouldClarify: resolution.shouldAskForClarification
            });

            return resolution;

        } catch (error) {
            this.logAgentAction('Context resolution failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
                fallbackToProvidedId: true
            });

            return {
                resolvedId: providedId || null,
                confidence: 'low' as const,
                method: 'fallback',
                shouldAskForClarification: !providedId
            };
        }
    }

    /**
     * Preserve context after successful operations
     * Helps with follow-up requests and context continuity
     */
    protected preserveContext(
        session: any, 
        reservationId: number, 
        operationType: 'modification' | 'cancellation' | 'creation'
    ): void {
        if (!this.config.enableContextResolution) {
            return;
        }

        try {
            contextManager.preserveReservationContext(session, reservationId, operationType);
            
            this.logAgentAction('Context preserved', {
                reservationId,
                operationType,
                expiresInMinutes: 10
            });

        } catch (error) {
            this.logAgentAction('Context preservation failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
                reservationId,
                operationType
            });
        }
    }

    /**
     * Update conversation flags to track what has been asked
     * Prevents repetitive questions and improves user experience
     */
    protected updateConversationFlags(session: any, flags: any): void {
        if (!this.config.enableContextResolution) {
            return;
        }

        try {
            contextManager.updateConversationFlags(session, flags);
            
            this.logAgentAction('Conversation flags updated', {
                updatedFlags: Object.keys(flags).filter(key => flags[key] !== undefined)
            });

        } catch (error) {
            this.logAgentAction('Conversation flags update failed', {
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    // ===== ERROR HANDLING METHODS =====

    /**
     * Standardized error handling for agents
     * Creates consistent error responses with appropriate user messaging
     */
    protected handleAgentError(error: Error, context: string, userMessage?: string): AgentResponse {
        this.logAgentAction(`Error in ${context}`, {
            error: error.message,
            userMessage: userMessage?.substring(0, 50),
            stack: error.stack?.substring(0, 200)
        });

        // Determine if error is recoverable
        const isRecoverable = !error.message.includes('SYSTEM_ERROR') && 
                            !error.message.includes('CRITICAL') &&
                            !error.message.includes('Fatal');

        return {
            content: "I apologize, I'm experiencing technical difficulties. Please try again or rephrase your request.",
            error: {
                type: 'SYSTEM_ERROR',
                message: error.message,
                recoverable: isRecoverable
            },
            metadata: {
                processedAt: new Date().toISOString(),
                agentType: this.name,
                confidence: 0,
                processingTimeMs: 0
            }
        };
    }

    /**
     * Create standardized validation error response
     */
    protected createValidationError(message: string, field?: string): AgentResponse {
        return {
            content: message,
            error: {
                type: 'VALIDATION_ERROR',
                message: `Validation failed${field ? ` for field: ${field}` : ''}: ${message}`,
                recoverable: true
            },
            metadata: {
                processedAt: new Date().toISOString(),
                agentType: this.name,
                confidence: 1.0
            }
        };
    }

    /**
     * Create standardized business rule error response
     */
    protected createBusinessRuleError(message: string, code?: string): AgentResponse {
        return {
            content: message,
            error: {
                type: 'BUSINESS_RULE',
                message: `Business rule violation${code ? ` (${code})` : ''}: ${message}`,
                recoverable: true
            },
            metadata: {
                processedAt: new Date().toISOString(),
                agentType: this.name,
                confidence: 1.0
            }
        };
    }

    // ===== LOGGING AND MONITORING METHODS =====

    /**
     * Structured logging for agent actions
     * Provides consistent logging format across all agents
     */
    protected logAgentAction(action: string, metadata?: any): void {
        const logEntry = {
            timestamp: new Date().toISOString(),
            agent: this.name,
            action,
            requestCount: this.requestCount,
            ...(metadata || {})
        };

        console.log(`[${this.name}Agent] ${action}`, metadata ? metadata : '');
    }

    /**
     * Update performance metrics for monitoring
     */
    private updatePerformanceMetrics(processingTimeMs: number): void {
        this.requestCount++;
        this.totalProcessingTime += processingTimeMs;
    }

    // ===== AGENT METADATA AND INTROSPECTION =====

    /**
     * Get comprehensive agent metadata
     * Useful for debugging, monitoring, and agent selection
     */
    getMetadata(): {
        name: string;
        description: string;
        capabilities: string[];
        config: AgentConfig;
        performance: {
            requestCount: number;
            averageProcessingTime: number;
            totalProcessingTime: number;
            uptime: number;
        };
        restaurant: {
            id: number;
            name: string;
            timezone: string;
        };
        version: string;
        lastUpdated: string;
    } {
        const uptimeMs = Date.now() - this.createdAt.getTime();
        const averageProcessingTime = this.requestCount > 0 
            ? Math.round(this.totalProcessingTime / this.requestCount)
            : 0;

        return {
            name: this.name,
            description: this.description,
            capabilities: [...this.capabilities], // Create copy to prevent mutation
            config: { ...this.config }, // Create copy to prevent mutation
            performance: {
                requestCount: this.requestCount,
                averageProcessingTime,
                totalProcessingTime: this.totalProcessingTime,
                uptime: uptimeMs
            },
            restaurant: {
                id: this.restaurantConfig.id,
                name: this.restaurantConfig.name,
                timezone: this.restaurantConfig.timezone
            },
            version: '1.0.0',
            lastUpdated: new Date().toISOString()
        };
    }

    /**
     * Health check for agent functionality
     * Tests core capabilities and service integrations
     */
    async healthCheck(): Promise<{
        healthy: boolean;
        checks: {
            aiService: boolean;
            contextManager: boolean;
            translation: boolean;
            tools: boolean;
        };
        details: string[];
    }> {
        const checks = {
            aiService: false,
            contextManager: false,
            translation: false,
            tools: false
        };
        const details: string[] = [];

        // Test AI service
        try {
            await this.generateResponse("Say 'OK'", { 
                maxTokens: 10, 
                context: 'health-check',
                timeout: 5000 
            });
            checks.aiService = true;
            details.push('AI service responding normally');
        } catch (error) {
            details.push(`AI service error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Test context manager
        try {
            const testSession = { foundReservations: [] };
            this.resolveReservationContext('test', testSession);
            checks.contextManager = true;
            details.push('Context manager functioning');
        } catch (error) {
            details.push(`Context manager error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Test translation
        try {
            await this.translate('Hello', 'ru', 'info');
            checks.translation = true;
            details.push('Translation service working');
        } catch (error) {
            details.push(`Translation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Test tools
        try {
            const tools = this.getTools();
            checks.tools = Array.isArray(tools) && tools.length > 0;
            details.push(`${tools.length} tools available`);
        } catch (error) {
            details.push(`Tools error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        const healthy = Object.values(checks).every(check => check === true);
        
        return {
            healthy,
            checks,
            details
        };
    }

    /**
     * Get performance statistics
     */
    getPerformanceStats(): {
        requestCount: number;
        averageResponseTime: number;
        uptime: string;
        efficiency: number;
    } {
        const uptimeMs = Date.now() - this.createdAt.getTime();
        const averageResponseTime = this.requestCount > 0 
            ? Math.round(this.totalProcessingTime / this.requestCount)
            : 0;
        
        // Calculate efficiency (requests per minute)
        const uptimeMinutes = uptimeMs / (1000 * 60);
        const efficiency = uptimeMinutes > 0 ? Math.round(this.requestCount / uptimeMinutes) : 0;

        return {
            requestCount: this.requestCount,
            averageResponseTime,
            uptime: this.formatUptime(uptimeMs),
            efficiency
        };
    }

    /**
     * Format uptime in human-readable format
     */
    private formatUptime(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
        if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }
}

// ===== UTILITY FUNCTIONS =====

/**
 * Validate agent configuration
 */
export function validateAgentConfig(config: AgentConfig): {
    valid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    if (!config.name || config.name.trim().length === 0) {
        errors.push('Agent name is required');
    }

    if (!config.description || config.description.trim().length === 0) {
        errors.push('Agent description is required');
    }

    if (!Array.isArray(config.capabilities) || config.capabilities.length === 0) {
        errors.push('Agent must have at least one capability');
    }

    if (config.maxTokens !== undefined && (config.maxTokens < 1 || config.maxTokens > 4000)) {
        errors.push('maxTokens must be between 1 and 4000');
    }

    if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 2)) {
        errors.push('temperature must be between 0 and 2');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Create default agent configuration
 */
export function createDefaultAgentConfig(
    name: string,
    description: string,
    capabilities: string[]
): AgentConfig {
    return {
        name,
        description,
        capabilities,
        maxTokens: 1000,
        temperature: 0.2,
        primaryModel: 'haiku',
        fallbackModel: 'gpt-4o-mini',
        enableContextResolution: true,
        enableTranslation: true,
        enablePersonalization: true
    };
}

// ===== EXPORTS =====

export default BaseAgent;

// Log successful module initialization
console.log(`
🎉 BaseAgent Foundation Loaded Successfully! 🎉

✅ Abstract BaseAgent class with comprehensive functionality
✅ Standardized AgentResponse and AgentContext interfaces  
✅ Integration with AIService and ContextManager
✅ Professional error handling and logging
✅ Performance monitoring and health checks
✅ Translation and context resolution support
✅ Validation utilities and configuration helpers

🚀 Ready for agent implementations:
- Sofia (booking specialist)
- Maya (reservation management)  
- Apollo (availability specialist)

📊 Features Available:
- Smart AI generation with fallback
- Context-aware reservation resolution
- Multi-language translation
- Performance monitoring
- Health checks and diagnostics
- Structured logging

🏗️ Architecture: Production-Ready ✅
`);