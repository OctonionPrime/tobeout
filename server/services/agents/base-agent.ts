// src/agents/base-agent.ts
// This version resolves the MISSING_TENANT_CONTEXT bug by correctly propagating
// the tenant context from the agent's execution context to the underlying AIService.

import { aiService } from '../ai-service';
import { contextManager } from '../context-manager';
import type { Language } from '../enhanced-conversation-manager';
// ✅ BUG-B-1 FIX: Import TenantContext to use in the AgentContext interface
import type { TenantContext } from '../tenant-context';

/**
 * Context information passed to agents for processing user requests.
 * ✅ BUG-B-1 FIX: Added the required 'tenantContext' property.
 */
export interface AgentContext {
    restaurantId: number;
    timezone: string;
    language: Language;
    tenantContext: TenantContext; // This is the critical addition.
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
 */
export abstract class BaseAgent {
    abstract readonly name: string;
    abstract readonly description: string;
    abstract readonly capabilities: string[];

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

    abstract generateSystemPrompt(context: AgentContext): string;
    abstract handleMessage(message: string, context: AgentContext): Promise<AgentResponse>;
    abstract getTools(): any[];

    /**
     * ✅ BUG-B-1 FIX: Updated signature to accept AgentContext for tenant validation.
     * Generate text content using AIService with automatic fallback.
     */
    protected async generateResponse(
        prompt: string,
        message: string, // Kept for potential future use, though prompt is primary
        context: AgentContext, // This is the key change
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
            // ✅ BUG-B-1 FIX: Pass the tenantContext from the AgentContext to the AIService.
            const response = await aiService.generateContent(prompt, {
                model: options.model || this.config.primaryModel || 'haiku',
                maxTokens: options.maxTokens || this.config.maxTokens || 1000,
                temperature: options.temperature !== undefined ? options.temperature : (this.config.temperature || 0.2),
                context: options.context || `${this.name}-generation`,
                timeout: options.timeout || 30000
            }, context.tenantContext); // This is the critical fix.

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
     * ✅ BUG-B-1 FIX: Updated signature to accept AgentContext for tenant validation.
     * Generate and parse JSON content with schema validation.
     */
    protected async generateJSON<T>(
        prompt: string,
        context: AgentContext, // This is the key change
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
            // ✅ BUG-B-1 FIX: Pass the tenantContext from the AgentContext to the AIService.
            const response = await aiService.generateJSON<T>(prompt, {
                model: options.model || this.config.primaryModel || 'haiku',
                maxTokens: options.maxTokens || this.config.maxTokens || 1000,
                temperature: options.temperature !== undefined ? options.temperature : (this.config.temperature || 0.2),
                context: options.context || `${this.name}-json`,
                schema: options.schema,
                retryOnInvalidJSON: options.retryOnInvalidJSON !== false
            }, context.tenantContext); // This is the critical fix.

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
     * ✅ BUG-B-1 FIX: Updated signature to accept AgentContext for tenant validation.
     * Translate text to target language using AIService.
     */
    protected async translate(
        text: string,
        targetLanguage: Language,
        context: AgentContext, // This is the key change
        translationContext: 'greeting' | 'error' | 'info' | 'question' | 'success' | 'confirmation' = 'info'
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

            const prompt = `Translate this restaurant ${translationContext} message to ${languageNames[targetLanguage]}:

"${text}"

Context: ${translationContext} message for restaurant booking system
Keep the same tone, emojis, and professional style.
Return only the translation, no explanations.`;

            // ✅ BUG-B-1 FIX: Pass the tenantContext from the AgentContext to the AIService.
            const translation = await aiService.generateContent(prompt, {
                model: 'haiku',
                maxTokens: Math.min(text.length * 2 + 100, 500),
                temperature: 0.2,
                context: `${this.name}-translation-${translationContext}`
            }, context.tenantContext); // This is the critical fix.

            const processingTime = Date.now() - startTime;
            this.logAgentAction('Translated text', {
                targetLanguage,
                context: translationContext,
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

            return text;
        }
    }

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

    protected handleAgentError(error: Error, context: string, userMessage?: string): AgentResponse {
        this.logAgentAction(`Error in ${context}`, {
            error: error.message,
            userMessage: userMessage?.substring(0, 50),
            stack: error.stack?.substring(0, 200)
        });

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

    private updatePerformanceMetrics(processingTimeMs: number): void {
        this.requestCount++;
        this.totalProcessingTime += processingTimeMs;
    }

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
            capabilities: [...this.capabilities],
            config: { ...this.config },
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
     * ✅ BUG-B-1 FIX: Updated signature to accept TenantContext for AI operations.
     * Health check for agent functionality.
     */
    async healthCheck(tenantContext: TenantContext): Promise<{
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

        // Create a mock AgentContext to pass to internal methods
        const mockAgentContext: AgentContext = {
            restaurantId: this.restaurantConfig.id,
            timezone: this.restaurantConfig.timezone,
            language: 'en',
            tenantContext: tenantContext // Use the provided context
        };

        // Test AI service
        try {
            // ✅ BUG-B-1 FIX: Pass the mock AgentContext to generateResponse.
            await this.generateResponse("Say 'OK'", "health check", mockAgentContext, {
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
            // ✅ BUG-B-1 FIX: Pass the mock AgentContext to translate.
            await this.translate('Hello', 'ru', mockAgentContext, 'info');
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

        const uptimeMinutes = uptimeMs / (1000 * 60);
        const efficiency = uptimeMinutes > 0 ? Math.round(this.requestCount / uptimeMinutes) : 0;

        return {
            requestCount: this.requestCount,
            averageResponseTime,
            uptime: this.formatUptime(uptimeMs),
            efficiency
        };
    }

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

export default BaseAgent;

