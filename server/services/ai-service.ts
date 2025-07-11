// src/services/ai-service.ts
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

export interface AIServiceOptions {
    model: 'haiku' | 'sonnet' | 'gpt-4o-mini' | 'gpt-4o' | 'gpt-3.5-turbo';
    maxTokens?: number;
    temperature?: number;
    context?: string; // For logging purposes
    timeout?: number; // Request timeout in ms
}

export interface AIJSONOptions<T = any> extends AIServiceOptions {
    schema?: any; // Optional JSON schema for validation
    retryOnInvalidJSON?: boolean; // Retry if JSON parsing fails
}

export class AIService {
    private claude: Anthropic;
    private openai: OpenAI;
    private static instance: AIService | null = null;

    constructor() {
        if (!process.env.ANTHROPIC_API_KEY) {
            console.warn('[AIService] Warning: ANTHROPIC_API_KEY not found, Claude will not be available');
        }
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('[AIService] OPENAI_API_KEY is required');
        }

        this.claude = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY!
        });

        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        console.log('[AIService] Initialized with Claude + OpenAI fallback system');
    }

    /**
     * Get singleton instance of AIService
     */
    static getInstance(): AIService {
        if (!AIService.instance) {
            AIService.instance = new AIService();
        }
        return AIService.instance;
    }

    /**
     * Generate text content using specified model with automatic fallback
     */
    async generateContent(prompt: string, options: AIServiceOptions): Promise<string> {
        const {
            model,
            maxTokens = 1000,
            temperature = 0.2,
            context = 'unknown',
            timeout = 30000
        } = options;

        const startTime = Date.now();
        console.log(`[AIService] Generating content with ${model} for [${context}]`);

        // Try Claude first for Claude models
        if (model === 'haiku' || model === 'sonnet') {
            const claudeResult = await this.tryClaudeGeneration(prompt, {
                model,
                maxTokens,
                temperature,
                context,
                timeout
            });

            if (claudeResult.success) {
                const executionTime = Date.now() - startTime;
                console.log(`[AIService] ✅ Claude ${model} succeeded for [${context}] in ${executionTime}ms`);
                return claudeResult.content!;
            }

            // Claude failed, try OpenAI fallback
            console.warn(`[AIService] Claude ${model} failed for [${context}]: ${claudeResult.error}`);
            return await this.fallbackToOpenAI(prompt, options, claudeResult.error!);
        }

        // Direct OpenAI call for OpenAI models
        return await this.callOpenAI(prompt, options);
    }

    /**
     * Generate and parse JSON content using specified model with automatic fallback
     */
    async generateJSON<T = any>(prompt: string, options: AIJSONOptions<T>): Promise<T> {
        const { retryOnInvalidJSON = true, schema, ...baseOptions } = options;

        const maxRetries = retryOnInvalidJSON ? 2 : 0;
        let lastError: string = '';

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const jsonPrompt = attempt > 0
                    ? `${prompt}\n\nIMPORTANT: Return valid JSON only. Previous attempt failed with: ${lastError}`
                    : `${prompt}\n\nReturn valid JSON only, no additional text or formatting.`;

                const response = await this.generateContent(jsonPrompt, {
                    ...baseOptions,
                    context: `${baseOptions.context || 'unknown'}-json-attempt-${attempt + 1}`
                });

                // Clean the response
                const cleanJson = this.cleanJSONResponse(response);

                // Parse JSON
                const parsed = JSON.parse(cleanJson);

                // Validate against schema if provided
                if (schema && !this.validateJSONSchema(parsed, schema)) {
                    throw new Error('Response does not match expected schema');
                }

                console.log(`[AIService] ✅ JSON parsed successfully for [${baseOptions.context}] on attempt ${attempt + 1}`);
                return parsed;

            } catch (error: any) {
                lastError = error.message;
                console.warn(`[AIService] JSON parsing attempt ${attempt + 1} failed for [${baseOptions.context}]: ${lastError}`);

                if (attempt === maxRetries) {
                    // Final attempt failed, return safe default
                    console.error(`[AIService] All JSON parsing attempts failed for [${baseOptions.context}], returning safe default`);
                    return this.getJSONSafeDefault<T>(baseOptions.context || 'unknown');
                }
            }
        }

        // This should never be reached, but TypeScript requires it
        throw new Error('Unexpected error in generateJSON');
    }

    /**
     * Expose the OpenAI client for complex, direct calls (like tool usage)
     * This is used by the EnhancedConversationManager for its main loop.
     */
    getOpenAIClient(): OpenAI {
        return this.openai;
    }

    /**
     * Try Claude generation with proper error handling
     */
    private async tryClaudeGeneration(prompt: string, options: AIServiceOptions): Promise<{
        success: boolean;
        content?: string;
        error?: string;
    }> {
        if (!process.env.ANTHROPIC_API_KEY) {
            return {
                success: false,
                error: 'Claude API key not available'
            };
        }

        try {
            const claudeModel = options.model === 'sonnet'
                ? "claude-3-5-sonnet-20240620"    // Corrected to a valid, recent model
                : "claude-3-haiku-20240307";

            const result = await Promise.race([
                this.claude.messages.create({
                    model: claudeModel,
                    max_tokens: options.maxTokens || 1000,
                    temperature: options.temperature || 0.2,
                    messages: [{ role: 'user', content: prompt }]
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Claude request timeout')), options.timeout || 30000)
                )
            ]) as Anthropic.Messages.Message;

            const response = result.content[0];
            if (response.type === 'text' && response.text.trim()) {
                return {
                    success: true,
                    content: response.text
                };
            }

            return {
                success: false,
                error: 'Non-text or empty response from Claude'
            };

        } catch (error: any) {
            return {
                success: false,
                error: this.extractErrorMessage(error)
            };
        }
    }

    /**
     * Fallback to OpenAI with multiple model attempts
     */
    private async fallbackToOpenAI(prompt: string, options: AIServiceOptions, claudeError: string): Promise<string> {
        const fallbackModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'];
        console.log(`[AIService] Attempting OpenAI fallback for [${options.context}]`);

        for (let i = 0; i < fallbackModels.length; i++) {
            const model = fallbackModels[i];

            try {
                const result = await this.callOpenAI(prompt, {
                    ...options,
                    model: model as any
                });

                console.log(`[AIService] ✅ OpenAI ${model} fallback succeeded for [${options.context}]`);
                return result;

            } catch (error: any) {
                console.warn(`[AIService] OpenAI ${model} fallback failed for [${options.context}]: ${this.extractErrorMessage(error)}`);

                if (i === fallbackModels.length - 1) {
                    console.error(`[AIService] 🚨 ALL AI providers failed for [${options.context}]`);
                    return this.getSafeDefault(options.context || 'unknown');
                }
            }
        }

        return this.getSafeDefault(options.context || 'unknown');
    }

    /**
     * Call OpenAI with proper error handling and corrected parameters
     */
    private async callOpenAI(prompt: string, options: AIServiceOptions): Promise<string> {
        const openaiModel = this.mapToOpenAIModel(options.model);

        // The Promise.race handles the timeout functionality
        const completion = await Promise.race([
            this.openai.chat.completions.create({
                model: openaiModel,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: options.maxTokens || 1000,
                temperature: options.temperature || 0.2
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('OpenAI request timeout')), options.timeout || 30000)
            )
        ]) as OpenAI.Chat.Completions.ChatCompletion;

        const response = completion.choices[0]?.message?.content?.trim();
        if (!response) {
            throw new Error('Empty response from OpenAI');
        }

        return response;
    }

    /**
     * Map internal model names to OpenAI model names
     */
    private mapToOpenAIModel(model: string): string {
        switch (model) {
            case 'haiku':
                return 'gpt-4o-mini';
            case 'sonnet':
                return 'gpt-4o';
            case 'gpt-4o-mini':
            case 'gpt-4o':
            case 'gpt-3.5-turbo':
                return model;
            default:
                return 'gpt-4o-mini';
        }
    }

    /**
     * Clean JSON response by removing markdown formatting and extra text
     */
    private cleanJSONResponse(response: string): string {
        let cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');

        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            cleaned = cleaned.substring(firstBrace, lastBrace + 1);
        }

        return cleaned;
    }

    /**
     * Simple JSON schema validation
     */
    private validateJSONSchema(data: any, schema: any): boolean {
        if (typeof schema.type !== 'undefined') {
            if (schema.type === 'object' && typeof data !== 'object') return false;
            if (schema.type === 'array' && !Array.isArray(data)) return false;
            if (schema.type === 'string' && typeof data !== 'string') return false;
        }

        if (schema.required && Array.isArray(schema.required)) {
            for (const field of schema.required) {
                if (!(field in data)) return false;
            }
        }

        return true;
    }

    /**
     * Extract meaningful error message from various error types
     */
    private extractErrorMessage(error: any): string {
        if (typeof error === 'string') return error;
        if (error.message) return error.message;
        if (error.error?.message) return error.error.message;
        if (error.response?.data?.error?.message) return error.response.data.error.message;
        return 'Unknown error occurred';
    }

    /**
     * Generate context-appropriate safe defaults for text responses
     */
    private getSafeDefault(context: string): string {
        const defaults: Record<string, string> = {
            'Overseer': JSON.stringify({
                reasoning: "AI system unavailable - maintaining current agent for safety",
                agentToUse: "booking",
                isNewBookingRequest: false
            }),
            'LanguageAgent': JSON.stringify({
                detectedLanguage: "en",
                confidence: 0.1,
                reasoning: "AI system unavailable - defaulting to English",
                shouldLock: false
            }),
            'ConfirmationAgent': JSON.stringify({
                confirmationStatus: "unclear",
                reasoning: "AI system unavailable - unable to determine confirmation status"
            }),
            'SpecialRequestAnalysis': JSON.stringify({
                patterns: [],
                reasoning: "AI analysis temporarily unavailable - no recurring patterns identified"
            }),
            'translation': "I apologize, translation service is temporarily unavailable.",
            'relevance': "I can only help with restaurant reservations and dining.",
            'safety': "I'm here to help with restaurant reservations. How can I assist you with booking a table?"
        };

        return defaults[context] || "I apologize, I'm experiencing technical difficulties. Please try again.";
    }

    /**
     * Generate context-appropriate safe defaults for JSON responses
     */
    private getJSONSafeDefault<T>(context: string): T {
        const defaults: Record<string, any> = {
            'Overseer': {
                reasoning: "AI system unavailable - maintaining current agent for safety",
                agentToUse: "booking",
                isNewBookingRequest: false
            },
            'LanguageAgent': {
                detectedLanguage: "en",
                confidence: 0.1,
                reasoning: "AI system unavailable - defaulting to English",
                shouldLock: false
            },
            'ConfirmationAgent': {
                confirmationStatus: "unclear",
                reasoning: "AI system unavailable - unable to determine confirmation status"
            },
            'SpecialRequestAnalysis': {
                patterns: [],
                reasoning: "AI analysis temporarily unavailable - no recurring patterns identified"
            }
        };

        return (defaults[context] || {
            reasoning: "AI system temporarily unavailable",
            error: true,
            fallback: true
        }) as T;
    }

    /**
     * Health check method to verify service status
     */
    async healthCheck(): Promise<{
        claude: boolean;
        openai: boolean;
        overall: 'healthy' | 'degraded' | 'unhealthy';
    }> {
        const results = {
            claude: false,
            openai: false,
            overall: 'unhealthy' as const
        };

        try {
            await this.tryClaudeGeneration("Say 'OK'", {
                model: 'haiku',
                maxTokens: 10,
                context: 'health-check-claude',
                timeout: 5000
            });
            results.claude = true;
        } catch (error) {
            console.warn('[AIService] Claude health check failed:', this.extractErrorMessage(error));
        }

        try {
            await this.callOpenAI("Say 'OK'", {
                model: 'gpt-4o-mini',
                maxTokens: 10,
                context: 'health-check-openai',
                timeout: 5000
            });
            results.openai = true;
        } catch (error) {
            console.warn('[AIService] OpenAI health check failed:', this.extractErrorMessage(error));
        }

        if (results.claude && results.openai) {
            results.overall = 'healthy';
        } else if (results.openai) {
            results.overall = 'degraded';
        }

        return results;
    }
}

// Export singleton instance
export const aiService = AIService.getInstance();