// server/services/ai/providers/ai-provider.interface.ts
// ✅ FIXED: Complete AI provider interface with all utilities

import type { AIOptions, ModelInfo } from '../../agents/core/agent.types';

// ===== CORE INTERFACES =====
export interface AIProvider {
    generateCompletion(prompt: string, options?: AIOptions): Promise<string>;
    generateStructuredResponse<T>(prompt: string, schema: any, options?: AIOptions): Promise<T>;
    isAvailable(): Promise<boolean>;
    getModelInfo(): ModelInfo;
    getProviderName(): string;
}

export interface AIFallbackChain {
    primary: AIProvider;
    fallbacks: AIProvider[];
    executeWithFallback<T>(
        operation: (provider: AIProvider) => Promise<T>,
        context: string
    ): Promise<T>;
}

export interface AIProviderFactory {
    createClaudeProvider(config: ClaudeConfig): AIProvider;
    createOpenAIProvider(config: OpenAIConfig): AIProvider;
    createFallbackChain(primary: AIProvider, fallbacks: AIProvider[]): AIFallbackChain;
}

// ===== CONFIGURATION INTERFACES =====
export interface ClaudeConfig {
    apiKey: string;
    models: {
        sonnet: string;
        haiku: string;
    };
    maxTokens: {
        sonnet: number;
        haiku: number;
    };
    timeout?: number;
    maxRetries?: number;
    baseURL?: string;
}

export interface OpenAIConfig {
    apiKey: string;
    models: {
        primary: string;
        secondary: string;
        tertiary: string;
    };
    maxTokens: {
        primary: number;
        secondary: number;
        tertiary: number;
    };
    temperature: {
        complex: number;
        simple: number;
        fallback: number;
    };
    timeout?: number;
    maxRetries?: number;
    baseURL?: string;
}

// ===== RESPONSE INTERFACES =====
export interface AIResponse {
    content: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    model?: string;
    provider?: string;
}

export interface AIError extends Error {
    provider: string;
    errorType: 'RATE_LIMIT' | 'QUOTA' | 'NETWORK' | 'AUTH' | 'SYSTEM_ERROR' | 'TIMEOUT';
    retryable: boolean;
    originalError?: any;
}

// ===== CONTEXT AND STRATEGY INTERFACES =====
export type AIUsageContext = 
    | 'overseer' 
    | 'language-detection' 
    | 'confirmation' 
    | 'booking' 
    | 'reservations' 
    | 'availability' 
    | 'translation' 
    | 'analysis' 
    | 'guardrails';

export interface ProviderSelectionStrategy {
    selectProvider(context: AIUsageContext, availableProviders: AIProvider[]): AIProvider;
    getRecommendedModel(context: AIUsageContext): any;
}

// ===== UTILITY FUNCTIONS =====

/**
 * ✅ FIXED: Categorize AI errors for proper handling
 */
export function categorizeAIError(error: any, provider: string): AIError {
    const message = error.message || error.toString();
    let errorType: AIError['errorType'] = 'SYSTEM_ERROR';
    let retryable = false;

    // Categorize based on error message
    if (message.includes('429') || message.includes('rate limit')) {
        errorType = 'RATE_LIMIT';
        retryable = true;
    } else if (message.includes('quota') || message.includes('billing')) {
        errorType = 'QUOTA';
        retryable = false;
    } else if (message.includes('timeout') || message.includes('ECONNRESET')) {
        errorType = 'TIMEOUT';
        retryable = true;
    } else if (message.includes('401') || message.includes('unauthorized')) {
        errorType = 'AUTH';
        retryable = false;
    } else if (message.includes('network') || message.includes('ENOTFOUND')) {
        errorType = 'NETWORK';
        retryable = true;
    }

    const aiError = new Error(message) as AIError;
    aiError.provider = provider;
    aiError.errorType = errorType;
    aiError.retryable = retryable;
    aiError.originalError = error;

    return aiError;
}

/**
 * ✅ FIXED: Check if error should trigger retry
 */
export function isRetryableError(error: any): boolean {
    if (error.retryable !== undefined) {
        return error.retryable;
    }
    
    const message = error.message || error.toString();
    const retryablePatterns = [
        '429', '500', '503', 'timeout', 'rate limit', 'quota',
        'overloaded', 'network', 'ECONNRESET', 'ENOTFOUND'
    ];
    
    return retryablePatterns.some(pattern => 
        message.toLowerCase().includes(pattern)
    );
}

/**
 * ✅ FIXED: Generate safe default responses when AI fails
 */
export function generateSafeDefault(context: AIUsageContext): string {
    const defaults = {
        'overseer': JSON.stringify({
            agentToUse: 'booking',
            reasoning: 'Fallback to booking agent due to AI unavailability',
            isNewBookingRequest: false,
            intervention: null
        }),
        'language-detection': JSON.stringify({
            detectedLanguage: 'en',
            confidence: 0.5,
            reasoning: 'Default to English due to AI unavailability',
            shouldLock: false
        }),
        'confirmation': JSON.stringify({
            confirmationStatus: 'unclear',
            reasoning: 'Cannot analyze confirmation due to AI unavailability'
        }),
        'booking': 'I apologize, but I\'m experiencing technical difficulties. Please try again in a moment.',
        'reservations': 'I\'m having trouble processing your reservation request. Please try again.',
        'availability': 'I cannot check availability right now. Please try again shortly.',
        'translation': 'Translation service unavailable',
        'analysis': 'Analysis unavailable due to technical issues',
        'guardrails': JSON.stringify({
            allowed: true,
            category: 'safe',
            reason: 'Default allow due to AI unavailability'
        })
    };

    return defaults[context] || defaults['booking'];
}

// ===== PROVIDER DEFAULTS =====
export const AI_PROVIDER_DEFAULTS = {
    CLAUDE: {
        MODELS: {
            SONNET: 'claude-3-5-sonnet-20241022',
            HAIKU: 'claude-3-5-haiku-20241022'
        },
        MAX_TOKENS: {
            SONNET: 4000,
            HAIKU: 2000
        },
        TEMPERATURE: 0.3,
        TIMEOUT: 30000,
        MAX_RETRIES: 3
    },
    OPENAI: {
        MODELS: {
            PRIMARY: 'gpt-4o-mini',
            SECONDARY: 'gpt-4o',
            TERTIARY: 'gpt-3.5-turbo'
        },
        MAX_TOKENS: {
            PRIMARY: 2000,
            SECONDARY: 3000,
            TERTIARY: 1500
        },
        TEMPERATURE: {
            COMPLEX: 0.3,
            SIMPLE: 0.2,
            FALLBACK: 0.1
        },
        TIMEOUT: 30000,
        MAX_RETRIES: 3
    }
};

// ===== CONTEXT MODEL MAPPING =====
export const CONTEXT_MODEL_MAPPING: Record<AIUsageContext, { preferred: string; fallback: string }> = {
    'overseer': { preferred: 'sonnet', fallback: 'gpt-4o' },
    'language-detection': { preferred: 'haiku', fallback: 'gpt-4o-mini' },
    'confirmation': { preferred: 'haiku', fallback: 'gpt-4o-mini' },
    'booking': { preferred: 'haiku', fallback: 'gpt-4o-mini' },
    'reservations': { preferred: 'haiku', fallback: 'gpt-4o-mini' },
    'availability': { preferred: 'haiku', fallback: 'gpt-4o-mini' },
    'translation': { preferred: 'haiku', fallback: 'gpt-4o-mini' },
    'analysis': { preferred: 'sonnet', fallback: 'gpt-4o' },
    'guardrails': { preferred: 'haiku', fallback: 'gpt-4o-mini' }
};

// ===== EXPORTS =====
export default AIProvider;