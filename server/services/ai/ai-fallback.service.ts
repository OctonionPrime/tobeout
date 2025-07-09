// server/services/ai/ai-fallback.service.ts

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type {
    AIProvider,
    FunctionDefinition,
    FunctionCallingResponse,
    FunctionCall,
    ClaudeConfig,
    OpenAIConfig,
    AIUsageContext
} from './ai-provider.interface';
import type { AIOptions, ModelInfo } from '../agents/core/agent.types';

/**
 * OpenAI Provider Implementation
 * Handles both text completion and function calling capabilities
 */
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

    /**
     * Generate text completion using OpenAI models
     */
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
            throw this.categorizeAIError(error, 'openai');
        }
    }

    /**
     * Generate completion with function calling support
     */
    async generateWithFunctions(
        prompt: string, 
        tools: FunctionDefinition[], 
        options?: AIOptions
    ): Promise<FunctionCallingResponse> {
        const model = options?.model || this.config.models.primary;
        const maxTokens = options?.maxTokens || this.getMaxTokensForModel(model);
        const temperature = options?.temperature || this.getTemperatureForModel(model);

        try {
            const completion = await this.client.chat.completions.create({
                model,
                messages: [{ role: 'user', content: prompt }],
                tools: tools,
                tool_choice: "auto",
                max_tokens: maxTokens,
                temperature,
                ...(options?.timeout && { timeout: options.timeout })
            });

            const message = completion.choices[0]?.message;
            const content = message?.content || null;
            const toolCalls = message?.tool_calls || [];

            // Convert OpenAI tool calls to our interface format
            const functionCalls: FunctionCall[] = toolCalls.map(tc => ({
                id: tc.id,
                function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments
                }
            }));

            return {
                content,
                functionCalls,
                model,
                usage: completion.usage ? {
                    promptTokens: completion.usage.prompt_tokens,
                    completionTokens: completion.usage.completion_tokens,
                    totalTokens: completion.usage.total_tokens
                } : undefined
            };

        } catch (error: any) {
            throw this.categorizeAIError(error, 'openai');
        }
    }

    /**
     * Generate structured JSON response
     */
    async generateStructuredResponse<T>(prompt: string, schema: any, options?: AIOptions): Promise<T> {
        const responseText = await this.generateCompletion(prompt, options);
        try {
            return JSON.parse(responseText) as T;
        } catch (parseError) {
            throw new Error(`Failed to parse OpenAI response as JSON: ${parseError}`);
        }
    }

    /**
     * Check if the provider is available
     */
    async isAvailable(): Promise<boolean> {
        try {
            await this.generateCompletion("Test", { maxTokens: 5, timeout: 5000 });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get model information
     */
    getModelInfo(): ModelInfo {
        const model = this.config.models.primary;
        return {
            name: model,
            provider: 'openai',
            contextWindow: this.getContextWindowForModel(model),
            costPer1kTokens: this.getCostForModel(model)
        };
    }

    /**
     * Get provider name
     */
    getProviderName(): string {
        return 'openai';
    }

    /**
     * Get maximum tokens for specific model
     */
    private getMaxTokensForModel(model: string): number {
        if (model === this.config.models.primary) return this.config.maxTokens.primary;
        if (model === this.config.models.secondary) return this.config.maxTokens.secondary;
        if (model === this.config.models.tertiary) return this.config.maxTokens.tertiary;
        return this.config.maxTokens.primary;
    }

    /**
     * Get temperature setting for specific model
     */
    private getTemperatureForModel(model: string): number {
        if (model === this.config.models.tertiary) return this.config.temperature.fallback;
        if (model === this.config.models.secondary) return this.config.temperature.simple;
        return this.config.temperature.complex;
    }

    /**
     * Get context window size for specific model
     */
    private getContextWindowForModel(model: string): number {
        if (model.includes('gpt-4o')) return 128000;
        if (model.includes('gpt-3.5')) return 16385;
        return 128000;
    }

    /**
     * Get cost per 1k tokens for specific model
     */
    private getCostForModel(model: string): number {
        if (model.includes('gpt-4o-mini')) return 0.15;
        if (model.includes('gpt-4o')) return 2.5;
        if (model.includes('gpt-3.5')) return 0.5;
        return 2.5;
    }

    /**
     * Categorize and format AI errors
     */
    private categorizeAIError(error: any, provider: string): any {
        const message = error.message || error.toString();
        return new Error(`${provider}: ${message}`);
    }
}

/**
 * Claude Provider Implementation
 * Handles Anthropic Claude API interactions
 */
export class ClaudeProvider implements AIProvider {
    private client: Anthropic;
    private config: ClaudeConfig;

    constructor(config: ClaudeConfig) {
        this.config = config;
        this.client = new Anthropic({
            apiKey: config.apiKey,
            ...(config.timeout && { timeout: config.timeout }),
            ...(config.maxRetries && { maxRetries: config.maxRetries })
        });
    }

    /**
     * Generate text completion using Claude models
     */
    async generateCompletion(prompt: string, options?: AIOptions): Promise<string> {
        const model = options?.model || this.config.models.sonnet;
        const maxTokens = options?.maxTokens || this.getMaxTokensForModel(model);

        try {
            const response = await this.client.messages.create({
                model,
                max_tokens: maxTokens,
                messages: [{ role: 'user', content: prompt }],
                ...(options?.timeout && { timeout: options.timeout })
            });

            const content = response.content[0];
            if (content.type === 'text') {
                return content.text;
            }
            throw new Error("Unexpected response format from Claude");
        } catch (error: any) {
            throw this.categorizeAIError(error, 'claude');
        }
    }

    /**
     * Claude doesn't support function calling yet, fallback to text response
     */
    async generateWithFunctions(
        prompt: string, 
        tools: FunctionDefinition[], 
        options?: AIOptions
    ): Promise<FunctionCallingResponse> {
        const textResponse = await this.generateCompletion(prompt, options);
        return {
            content: textResponse,
            functionCalls: [],
            model: this.getModelInfo().name
        };
    }

    /**
     * Generate structured JSON response
     */
    async generateStructuredResponse<T>(prompt: string, schema: any, options?: AIOptions): Promise<T> {
        const responseText = await this.generateCompletion(prompt, options);
        try {
            return JSON.parse(responseText) as T;
        } catch (parseError) {
            throw new Error(`Failed to parse Claude response as JSON: ${parseError}`);
        }
    }

    /**
     * Check if the provider is available
     */
    async isAvailable(): Promise<boolean> {
        try {
            await this.generateCompletion("Test", { maxTokens: 5, timeout: 5000 });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get model information
     */
    getModelInfo(): ModelInfo {
        const model = this.config.models.sonnet;
        return {
            name: model,
            provider: 'claude',
            contextWindow: this.getContextWindowForModel(model),
            costPer1kTokens: this.getCostForModel(model)
        };
    }

    /**
     * Get provider name
     */
    getProviderName(): string {
        return 'claude';
    }

    /**
     * Get maximum tokens for specific model
     */
    private getMaxTokensForModel(model: string): number {
        if (model === this.config.models.sonnet) return this.config.maxTokens.sonnet;
        if (model === this.config.models.haiku) return this.config.maxTokens.haiku;
        return this.config.maxTokens.sonnet;
    }

    /**
     * Get context window size for specific model
     */
    private getContextWindowForModel(model: string): number {
        if (model.includes('claude-3-5-sonnet')) return 200000;
        if (model.includes('claude-3-5-haiku')) return 200000;
        return 200000;
    }

    /**
     * Get cost per 1k tokens for specific model
     */
    private getCostForModel(model: string): number {
        if (model.includes('claude-3-5-sonnet')) return 3.0;
        if (model.includes('claude-3-5-haiku')) return 0.25;
        return 3.0;
    }

    /**
     * Categorize and format AI errors
     */
    private categorizeAIError(error: any, provider: string): any {
        const message = error.message || error.toString();
        return new Error(`${provider}: ${message}`);
    }
}

/**
 * AI Fallback Service
 * Provides intelligent fallback between Claude and OpenAI providers
 */
export class AIFallbackService {
    private claudeProvider: AIProvider;
    private openaiProviders: AIProvider[];
    private fallbackChain: AIProvider[];

    constructor(claudeConfig?: ClaudeConfig, openaiConfig?: OpenAIConfig) {
        const finalClaudeConfig = claudeConfig || this.createDefaultClaudeConfig();
        const finalOpenaiConfig = openaiConfig || this.createDefaultOpenAIConfig();
        
        this.claudeProvider = new ClaudeProvider(finalClaudeConfig);
        this.openaiProviders = [new OpenAIProvider(finalOpenaiConfig)];
        
        // Set up fallback chain: Claude first, then OpenAI
        this.fallbackChain = [this.claudeProvider, ...this.openaiProviders];
    }

    /**
     * Generate content with intelligent fallback
     */
    async generateContent(prompt: string, context: AIUsageContext, options?: AIOptions): Promise<string> {
        let lastError: Error | null = null;

        for (const provider of this.fallbackChain) {
            try {
                console.log(`[AI Fallback] Attempting ${provider.getProviderName()} for context: ${context}`);
                const result = await provider.generateCompletion(prompt, options);
                console.log(`[AI Fallback] Success with ${provider.getProviderName()}`);
                return result;
            } catch (error: any) {
                console.warn(`[AI Fallback] ${provider.getProviderName()} failed for ${context}:`, error.message);
                lastError = error;
                continue;
            }
        }

        throw new Error(`All AI providers failed for context ${context}. Last error: ${lastError?.message}`);
    }

    /**
     * Generate content with function calling support
     */
    async generateWithFunctions(
        prompt: string,
        tools: FunctionDefinition[],
        context: AIUsageContext,
        options?: AIOptions
    ): Promise<FunctionCallingResponse> {
        // Try OpenAI first for function calling (Claude doesn't support tools yet)
        const openaiProvider = this.openaiProviders[0];
        
        try {
            console.log(`[AI FunctionCalling] Using OpenAI for function calling [${context}]`);
            return await openaiProvider.generateWithFunctions(prompt, tools, options);
        } catch (error) {
            console.error(`[AI FunctionCalling] OpenAI function calling failed for [${context}]:`, error);
            
            // Fallback to text generation without function calling
            const textResponse = await this.generateContent(prompt, context, options);
            return {
                content: textResponse,
                functionCalls: [],
                model: 'fallback'
            };
        }
    }

    /**
     * Generate structured response with fallback
     */
    async generateStructuredResponse<T>(
        prompt: string, 
        schema: any, 
        context: AIUsageContext, 
        options?: AIOptions
    ): Promise<T> {
        let lastError: Error | null = null;

        for (const provider of this.fallbackChain) {
            try {
                console.log(`[AI Structured] Attempting ${provider.getProviderName()} for context: ${context}`);
                const result = await provider.generateStructuredResponse<T>(prompt, schema, options);
                console.log(`[AI Structured] Success with ${provider.getProviderName()}`);
                return result;
            } catch (error: any) {
                console.warn(`[AI Structured] ${provider.getProviderName()} failed for ${context}:`, error.message);
                lastError = error;
                continue;
            }
        }

        throw new Error(`All AI providers failed for structured response ${context}. Last error: ${lastError?.message}`);
    }

    /**
     * Check if any provider is available
     */
    async isAvailable(): Promise<boolean> {
        for (const provider of this.fallbackChain) {
            if (await provider.isAvailable()) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get current primary provider info
     */
    getModelInfo(): ModelInfo {
        return this.fallbackChain[0].getModelInfo();
    }

    /**
     * Create default Claude configuration
     */
    private createDefaultClaudeConfig(): ClaudeConfig {
        return {
            apiKey: process.env.ANTHROPIC_API_KEY!,
            models: { 
                sonnet: 'claude-3-5-sonnet-20241022', 
                haiku: 'claude-3-5-haiku-20241022' 
            },
            maxTokens: { sonnet: 4000, haiku: 2000 },
            timeout: 30000,
            maxRetries: 3
        };
    }

    /**
     * Create default OpenAI configuration
     */
    private createDefaultOpenAIConfig(): OpenAIConfig {
        return {
            apiKey: process.env.OPENAI_API_KEY!,
            models: { 
                primary: 'gpt-4o-mini', 
                secondary: 'gpt-4o', 
                tertiary: 'gpt-3.5-turbo' 
            },
            maxTokens: { primary: 2000, secondary: 3000, tertiary: 1500 },
            temperature: { complex: 0.3, simple: 0.2, fallback: 0.1 },
            timeout: 30000,
            maxRetries: 3
        };
    }
}

/**
 * Factory function to create a default AI fallback service instance
 * This is the function that service-container.ts expects to import
 */
export function createDefaultAIFallbackService(): AIFallbackService {
    const claudeConfig: ClaudeConfig = {
        apiKey: process.env.ANTHROPIC_API_KEY!,
        models: { 
            sonnet: 'claude-3-5-sonnet-20241022', 
            haiku: 'claude-3-5-haiku-20241022' 
        },
        maxTokens: { sonnet: 4000, haiku: 2000 },
        timeout: 30000,
        maxRetries: 3
    };

    const openaiConfig: OpenAIConfig = {
        apiKey: process.env.OPENAI_API_KEY!,
        models: { 
            primary: 'gpt-4o-mini', 
            secondary: 'gpt-4o', 
            tertiary: 'gpt-3.5-turbo' 
        },
        maxTokens: { primary: 2000, secondary: 3000, tertiary: 1500 },
        temperature: { complex: 0.3, simple: 0.2, fallback: 0.1 },
        timeout: 30000,
        maxRetries: 3
    };

    return new AIFallbackService(claudeConfig, openaiConfig);
}

/**
 * Default singleton instance for convenience
 */
export const defaultAIFallbackService = createDefaultAIFallbackService();