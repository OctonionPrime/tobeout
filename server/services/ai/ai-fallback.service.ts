// server/services/ai/ai-fallback.service.ts
// ✅ PHASE 2: AI fallback service with FIXED constructor handling
// SOURCE: enhanced-conversation-manager.ts generateContentWithFallback (lines ~200-280)

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type {
    AIProvider,
    AIFallbackChain,
    AIProviderFactory,
    ClaudeConfig,
    OpenAIConfig,
    AIResponse,
    AIError,
    AIUsageContext,
    ProviderSelectionStrategy
} from './ai-provider.interface';
import type { AIOptions, ModelInfo } from '../agents/core/agent.types';
import {
    isRetryableError,
    categorizeAIError,
    generateSafeDefault,
    AI_PROVIDER_DEFAULTS,
    CONTEXT_MODEL_MAPPING
} from './ai-provider.interface';

// ===== CLAUDE PROVIDER IMPLEMENTATION =====
export class ClaudeProvider implements AIProvider {
    private client: Anthropic;
    private config: ClaudeConfig;

    constructor(config: ClaudeConfig) {
        this.config = config;
        this.client = new Anthropic({
            apiKey: config.apiKey,
            ...(config.baseURL && { baseURL: config.baseURL })
        });
    }

    async generateCompletion(prompt: string, options?: AIOptions): Promise<string> {
        const model = options?.model || this.config.models.haiku;
        const maxTokens = options?.maxTokens || 
            (model.includes('sonnet') ? this.config.maxTokens.sonnet : this.config.maxTokens.haiku);
        const temperature = options?.temperature || 0.3;

        try {
            const result = await this.client.messages.create({
                model,
                max_tokens: maxTokens,
                temperature,
                messages: [{ role: 'user', content: prompt }],
                ...(options?.timeout && { timeout: options.timeout })
            });

            const response = result.content[0];
            if (response.type === 'text') {
                return response.text;
            }
            throw new Error("Non-text response from Claude");

        } catch (error: any) {
            throw categorizeAIError(error, 'claude');
        }
    }

    async generateStructuredResponse<T>(prompt: string, schema: any, options?: AIOptions): Promise<T> {
        const responseText = await this.generateCompletion(prompt, options);
        
        try {
            const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            return JSON.parse(cleanJson) as T;
        } catch (parseError) {
            throw new Error(`Failed to parse Claude response as JSON: ${parseError}`);
        }
    }

    async isAvailable(): Promise<boolean> {
        try {
            await this.generateCompletion("Test", { maxTokens: 5, timeout: 5000 });
            return true;
        } catch {
            return false;
        }
    }

    getModelInfo(): ModelInfo {
        return {
            name: this.config.models.haiku,
            provider: 'claude',
            contextWindow: 200000,
            costPer1kTokens: 0.25
        };
    }

    getProviderName(): string {
        return 'claude';
    }
}

// ===== OPENAI PROVIDER IMPLEMENTATION =====
export class OpenAIProvider implements AIProvider {
    private client: OpenAI;
    private config: OpenAIConfig;

    constructor(config: OpenAIConfig) {
        this.config = config;
        this.client = new OpenAI({
            apiKey: config.apiKey,
            ...(config.baseURL && { baseURL: config.baseURL }),
            ...(config.timeout && { timeout: config.timeout })
        });
    }

    async generateCompletion(prompt: string, options?: AIOptions): Promise<string> {
        const model = options?.model || this.config.models.primary;
        const maxTokens = options?.maxTokens || this.getMaxTokensForModel(model);
        const temperature = options?.temperature || this.getTemperatureForModel(model);

        try {
            const completion = await this.client.chat.completions.create({
                model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: maxTokens,
                temperature,
                ...(options?.timeout && { timeout: options.timeout })
            });

            const response = completion.choices[0]?.message?.content?.trim();
            if (!response) {
                throw new Error("Empty response from OpenAI");
            }

            return response;

        } catch (error: any) {
            throw categorizeAIError(error, 'openai');
        }
    }

    async generateStructuredResponse<T>(prompt: string, schema: any, options?: AIOptions): Promise<T> {
        const responseText = await this.generateCompletion(prompt, options);
        try {
            return JSON.parse(responseText) as T;
        } catch (parseError) {
            throw new Error(`Failed to parse OpenAI response as JSON: ${parseError}`);
        }
    }

    async isAvailable(): Promise<boolean> {
        try {
            await this.generateCompletion("Test", { maxTokens: 5, timeout: 5000 });
            return true;
        } catch {
            return false;
        }
    }

    getModelInfo(): ModelInfo {
        const model = this.config.models.primary;
        return {
            name: model,
            provider: 'openai',
            contextWindow: this.getContextWindowForModel(model),
            costPer1kTokens: this.getCostForModel(model)
        };
    }

    getProviderName(): string {
        return 'openai';
    }

    private getMaxTokensForModel(model: string): number {
        if (model === this.config.models.primary) return this.config.maxTokens.primary;
        if (model === this.config.models.secondary) return this.config.maxTokens.secondary;
        if (model === this.config.models.tertiary) return this.config.maxTokens.tertiary;
        return this.config.maxTokens.primary;
    }

    private getTemperatureForModel(model: string): number {
        if (model === this.config.models.tertiary) return this.config.temperature.fallback;
        if (model === this.config.models.secondary) return this.config.temperature.simple;
        return this.config.temperature.complex;
    }

    private getContextWindowForModel(model: string): number {
        if (model.includes('gpt-4o')) return 128000;
        if (model.includes('gpt-3.5')) return 16385;
        return 128000;
    }

    private getCostForModel(model: string): number {
        if (model.includes('gpt-4o-mini')) return 0.15;
        if (model.includes('gpt-4o')) return 2.5;
        if (model.includes('gpt-3.5')) return 0.5;
        return 2.5;
    }
}

// ===== ENHANCED FALLBACK CHAIN IMPLEMENTATION =====
export class EnhancedFallbackChain implements AIFallbackChain {
    public primary: AIProvider;
    public fallbacks: AIProvider[];

    constructor(primary: AIProvider, fallbacks: AIProvider[]) {
        this.primary = primary;
        this.fallbacks = fallbacks;
    }

    async executeWithFallback<T>(
        operation: (provider: AIProvider) => Promise<T>,
        context: string
    ): Promise<T> {
        // Try Claude first
        try {
            const result = await operation(this.primary);
            console.log(`[AI Primary] ${this.primary.getProviderName()} succeeded for [${context}]`);
            return result;

        } catch (primaryError: any) {
            const errorMessage = primaryError.message || 'Unknown error';
            console.warn(`[AI Fallback] ${this.primary.getProviderName()} failed for [${context}]. Reason: ${errorMessage.split('\n')[0]}`);

            if (this.isRetryableError(primaryError)) {
                return await this.executeOpenAIFallbackWithRetries(operation, context, errorMessage);
            } else {
                console.error(`[AI Fallback] Non-retryable error for [${context}]: ${errorMessage}`);
                throw new Error(`All AI providers failed for ${context}: ${errorMessage}`);
            }
        }
    }

    private async executeOpenAIFallbackWithRetries<T>(
        operation: (provider: AIProvider) => Promise<T>,
        context: string,
        primaryError: string
    ): Promise<T> {
        const fallbackModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'];

        for (let i = 0; i < Math.min(this.fallbacks.length, fallbackModels.length); i++) {
            const provider = this.fallbacks[i];
            const model = fallbackModels[i];
            
            try {
                console.log(`[AI Fallback] Attempting ${provider.getProviderName()} ${model} (attempt ${i + 1}/${fallbackModels.length}) for [${context}]`);
                
                const result = await operation(provider);
                
                if (this.isValidResult(result)) {
                    console.log(`[AI Fallback] ✅ Successfully used ${provider.getProviderName()} ${model} as fallback for [${context}]`);
                    return result;
                }
                
                throw new Error(`Invalid result from ${model}`);
                
            } catch (fallbackError: any) {
                const fallbackErrorMessage = fallbackError.message || 'Unknown error';
                console.warn(`[AI Fallback] ${provider.getProviderName()} ${model} failed for [${context}]: ${fallbackErrorMessage.split('\n')[0]}`);
                
                if (i === fallbackModels.length - 1) {
                    console.error(`[AI Fallback] 🚨 CRITICAL: All AI models failed for [${context}]. Primary: ${primaryError}, Final: ${fallbackErrorMessage}`);
                }
                
                continue;
            }
        }
        
        // Safe default when all AI fails
        const safeDefault = this.generateContextAwareSafeDefault(context);
        console.warn(`[AI Fallback] Using safe default for [${context}]: ${safeDefault}`);
        return safeDefault as T;
    }

    private isRetryableError(error: any): boolean {
        const errorMessage = error.message || 'Unknown error';
        const retryablePatterns = [
            '429', '500', '503', 'timeout', 'rate limit', 'quota',
            'overloaded', 'network', '401', '403'
        ];
        
        return retryablePatterns.some(pattern => 
            errorMessage.toLowerCase().includes(pattern)
        );
    }

    private isValidResult(result: any): boolean {
        if (typeof result === 'string') {
            return result.length > 10;
        }
        return result !== null && result !== undefined;
    }

    private generateContextAwareSafeDefault(context: string): string {
        const contextType = this.extractContextType(context);
        return generateSafeDefault(contextType);
    }

    private extractContextType(context: string): AIUsageContext {
        const lowerContext = context.toLowerCase();
        
        if (lowerContext.includes('overseer')) return 'overseer';
        if (lowerContext.includes('language')) return 'language-detection';
        if (lowerContext.includes('confirmation')) return 'confirmation';
        if (lowerContext.includes('translation')) return 'translation';
        if (lowerContext.includes('analysis')) return 'analysis';
        if (lowerContext.includes('guardrail')) return 'guardrails';
        
        return 'overseer';
    }
}

// ===== PROVIDER SELECTION STRATEGY =====
export class ContextBasedProviderStrategy implements ProviderSelectionStrategy {
    selectProvider(context: AIUsageContext, availableProviders: AIProvider[]): AIProvider {
        const mapping = CONTEXT_MODEL_MAPPING[context];
        const preferredModel = mapping.preferred;
        
        for (const provider of availableProviders) {
            const modelInfo = provider.getModelInfo();
            if (this.modelMatches(modelInfo.name, preferredModel)) {
                return provider;
            }
        }
        
        return availableProviders[0];
    }

    getRecommendedModel(context: AIUsageContext): any {
        return CONTEXT_MODEL_MAPPING[context]?.preferred || 'haiku';
    }

    private modelMatches(modelName: string, targetType: string): boolean {
        const lowerModel = modelName.toLowerCase();
        const lowerTarget = targetType.toLowerCase();
        
        if (lowerTarget === 'sonnet') return lowerModel.includes('sonnet');
        if (lowerTarget === 'haiku') return lowerModel.includes('haiku');
        if (lowerTarget.startsWith('gpt')) return lowerModel.includes(lowerTarget);
        
        return false;
    }
}

// ===== AI PROVIDER FACTORY =====
export class AIProviderFactory implements AIProviderFactory {
    createClaudeProvider(config: ClaudeConfig): AIProvider {
        return new ClaudeProvider(config);
    }

    createOpenAIProvider(config: OpenAIConfig): AIProvider {
        return new OpenAIProvider(config);
    }

    createFallbackChain(primary: AIProvider, fallbacks: AIProvider[]): AIFallbackChain {
        return new EnhancedFallbackChain(primary, fallbacks);
    }
}

// ===== AI FALLBACK SERVICE (MAIN SERVICE) =====
export class AIFallbackService {
    private claudeProvider: AIProvider;
    private openaiProviders: AIProvider[];
    private fallbackChain: AIFallbackChain;
    private strategy: ProviderSelectionStrategy;

    constructor(
        claudeConfig?: ClaudeConfig,
        openaiConfig?: OpenAIConfig
    ) {
        const factory = new AIProviderFactory();
        
        // ✅ FIXED: Use provided configs or create defaults
        const finalClaudeConfig = claudeConfig || this.createDefaultClaudeConfig();
        const finalOpenaiConfig = openaiConfig || this.createDefaultOpenAIConfig();
        
        // Initialize providers
        this.claudeProvider = factory.createClaudeProvider(finalClaudeConfig);
        this.openaiProviders = [
            factory.createOpenAIProvider(finalOpenaiConfig)
        ];
        
        // Create fallback chain
        this.fallbackChain = factory.createFallbackChain(
            this.claudeProvider,
            this.openaiProviders
        );
        
        this.strategy = new ContextBasedProviderStrategy();
    }

    /**
     * ✅ FIXED: Create default Claude config from environment
     */
    private createDefaultClaudeConfig(): ClaudeConfig {
        return {
            apiKey: process.env.ANTHROPIC_API_KEY!,
            models: {
                sonnet: 'claude-3-5-sonnet-20241022',
                haiku: 'claude-3-5-haiku-20241022'
            },
            maxTokens: {
                sonnet: 4000,
                haiku: 2000
            },
            timeout: 30000,
            maxRetries: 3
        };
    }

    /**
     * ✅ FIXED: Create default OpenAI config from environment
     */
    private createDefaultOpenAIConfig(): OpenAIConfig {
        return {
            apiKey: process.env.OPENAI_API_KEY!,
            models: {
                primary: 'gpt-4o-mini',
                secondary: 'gpt-4o',
                tertiary: 'gpt-3.5-turbo'
            },
            maxTokens: {
                primary: 2000,
                secondary: 3000,
                tertiary: 1500
            },
            temperature: {
                complex: 0.3,
                simple: 0.2,
                fallback: 0.1
            },
            timeout: 30000,
            maxRetries: 3
        };
    }

    /**
     * Main method for generating content with full fallback support
     */
    async generateContent(
        prompt: string,
        context: AIUsageContext,
        options?: AIOptions
    ): Promise<string> {
        return this.fallbackChain.executeWithFallback(
            async (provider) => provider.generateCompletion(prompt, options),
            context
        );
    }

    /**
     * Generate structured responses (JSON) with fallback
     */
    async generateStructuredContent<T>(
        prompt: string,
        schema: any,
        context: AIUsageContext,
        options?: AIOptions
    ): Promise<T> {
        return this.fallbackChain.executeWithFallback(
            async (provider) => provider.generateStructuredResponse<T>(prompt, schema, options),
            context
        );
    }

    /**
     * Check availability of AI services
     */
    async checkAvailability(): Promise<{
        claude: boolean;
        openai: boolean;
        anyAvailable: boolean;
    }> {
        const [claudeAvailable, openaiAvailable] = await Promise.all([
            this.claudeProvider.isAvailable(),
            this.openaiProviders[0]?.isAvailable() || false
        ]);

        return {
            claude: claudeAvailable,
            openai: openaiAvailable,
            anyAvailable: claudeAvailable || openaiAvailable
        };
    }

    /**
     * Get provider for specific context
     */
    getProviderForContext(context: AIUsageContext): AIProvider {
        const allProviders = [this.claudeProvider, ...this.openaiProviders];
        return this.strategy.selectProvider(context, allProviders);
    }
}

// ===== DEFAULT FACTORY FUNCTION =====
/**
 * ✅ FIXED: Create default AI service with automatic config
 */
export function createDefaultAIFallbackService(): AIFallbackService {
    // Constructor now handles creating defaults internally
    return new AIFallbackService();
}

export default AIFallbackService;