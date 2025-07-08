// server/services/ai/translation.service.ts
// ✅ PHASE 2: Unified translation service merging all translation logic
// SOURCE: enhanced-conversation-manager.ts TranslationService (lines ~80-140)
// SOURCE: agent-tools.ts AgentToolTranslationService (lines ~50-100)
// SOURCE: guardrails.ts UnifiedGuardrailTranslationService (lines ~40-120)

import type { Language } from '../agents/core/agent.types';
import { AIFallbackService } from './ai-fallback.service';

// ===== TRANSLATION CONTEXT TYPES =====
export type TranslationContext = 
    | 'confirmation'    // Confirmation prompts and responses
    | 'error'          // Error messages and system failures
    | 'success'        // Success messages and completions
    | 'question'       // Questions and prompts to user
    | 'info'           // General information messages
    | 'greeting'       // Welcome and greeting messages
    | 'safety'         // Safety and guardrail messages
    | 'off_topic'      // Off-topic rejection messages
    | 'tool'           // Tool response messages
    | 'general';       // General purpose translation

// ===== TRANSLATION CACHE INTERFACE =====
interface TranslationCacheEntry {
    translation: string;
    timestamp: number;
    context: TranslationContext;
    hitCount: number;
}

// ===== LANGUAGE MAPPINGS =====
// SOURCE: All three translation services had similar mappings
const LANGUAGE_NAMES: Record<Language, string> = {
    'en': 'English',
    'ru': 'Russian', 
    'sr': 'Serbian',
    'hu': 'Hungarian',
    'de': 'German',
    'fr': 'French',
    'es': 'Spanish',
    'it': 'Italian',
    'pt': 'Portuguese',
    'nl': 'Dutch',
    'auto': 'English'
};

// ===== CONTEXT-SPECIFIC PROMPT TEMPLATES =====
const TRANSLATION_PROMPTS: Record<TranslationContext, string> = {
    confirmation: "Translate this restaurant confirmation message to {language}:\n\n\"{text}\"\n\nContext: Booking confirmation for restaurant service\nKeep the same tone, emojis, and professional style.\nReturn only the translation, no explanations.",
    
    error: "Translate this restaurant error message to {language}:\n\n\"{text}\"\n\nContext: Error message from restaurant booking system\nKeep the same tone and professional style.\nReturn only the translation, no explanations.",
    
    success: "Translate this restaurant success message to {language}:\n\n\"{text}\"\n\nContext: Success message for restaurant booking\nKeep the same celebratory tone and emojis.\nReturn only the translation, no explanations.",
    
    question: "Translate this restaurant question to {language}:\n\n\"{text}\"\n\nContext: Question from restaurant staff to guest\nKeep the same polite and helpful tone.\nReturn only the translation, no explanations.",
    
    info: "Translate this restaurant information message to {language}:\n\n\"{text}\"\n\nContext: General information about restaurant service\nKeep the same informative and professional style.\nReturn only the translation, no explanations.",
    
    greeting: "Translate this restaurant greeting message to {language}:\n\n\"{text}\"\n\nContext: Welcome greeting for restaurant guests\nKeep the same warm and welcoming tone.\nReturn only the translation, no explanations.",
    
    safety: "Translate this restaurant safety message to {language}:\n\n\"{text}\"\n\nContext: Safety message from restaurant booking system\nKeep the same tone and professional style.\nReturn only the translation, no explanations.",
    
    off_topic: "Translate this restaurant service boundary message to {language}:\n\n\"{text}\"\n\nContext: Message explaining restaurant service limitations\nKeep the same helpful but firm tone.\nReturn only the translation, no explanations.",
    
    tool: "Translate this restaurant tool message to {language}:\n\n\"{text}\"\n\nContext: Message from restaurant booking system tools\nKeep the same tone and professional style.\nReturn only the translation, no explanations.",
    
    general: "Translate this restaurant service message to {language}:\n\n\"{text}\"\n\nKeep the same tone and professional style.\nReturn only the translation, no explanations."
};

// ===== UNIFIED TRANSLATION SERVICE =====
// Merges functionality from all three existing translation services
export class UnifiedTranslationService {
    private static instance: UnifiedTranslationService;
    private cache = new Map<string, TranslationCacheEntry>();
    private aiService: AIFallbackService;
    
    // Cache configuration
    private readonly CACHE_TTL = 60 * 60 * 1000; // 1 hour (from all services)
    private readonly MAX_CACHE_SIZE = 1000; // Prevent memory issues
    
    constructor(aiService: AIFallbackService) {
        this.aiService = aiService;
        
        // Start cache cleanup interval
        setInterval(() => this.cleanupCache(), 15 * 60 * 1000); // Every 15 minutes
    }

    /**
     * Get singleton instance
     */
    static getInstance(aiService?: AIFallbackService): UnifiedTranslationService {
        if (!UnifiedTranslationService.instance) {
            if (!aiService) {
                throw new Error('AIFallbackService required for first initialization');
            }
            UnifiedTranslationService.instance = new UnifiedTranslationService(aiService);
        }
        return UnifiedTranslationService.instance;
    }

    /**
     * Main translation method - replaces all existing translate methods
     * SOURCE: Enhanced from all three services
     */
    async translate(
        text: string,
        targetLanguage: Language,
        context: TranslationContext = 'general'
    ): Promise<string> {
        // Skip translation for English or auto
        if (targetLanguage === 'en' || targetLanguage === 'auto') {
            return text;
        }

        // Validate input
        if (!text || text.trim().length === 0) {
            return text;
        }

        if (!LANGUAGE_NAMES[targetLanguage]) {
            console.warn(`[Translation] Unsupported language: ${targetLanguage}, using English`);
            return text;
        }

        // Check cache first
        const cacheKey = this.generateCacheKey(text, targetLanguage, context);
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            // Translate using AI service with fallback
            const translation = await this.translateWithFallback(text, targetLanguage, context);
            
            // Cache the result
            this.addToCache(cacheKey, translation, context);
            
            return translation;
            
        } catch (error) {
            console.error(`[Translation] Error translating to ${targetLanguage}:`, error);
            return text; // Fallback to original text
        }
    }

    /**
     * Batch translation for multiple texts
     * NEW: More efficient than individual calls
     */
    async translateBatch(
        texts: string[],
        targetLanguage: Language,
        context: TranslationContext = 'general'
    ): Promise<string[]> {
        if (targetLanguage === 'en' || targetLanguage === 'auto') {
            return texts;
        }

        const promises = texts.map(text => this.translate(text, targetLanguage, context));
        return Promise.all(promises);
    }

    /**
     * Translation with AI fallback chain
     * SOURCE: Combines logic from all three services
     */
    private async translateWithFallback(
        text: string,
        targetLanguage: Language,
        context: TranslationContext
    ): Promise<string> {
        const prompt = this.buildTranslationPrompt(text, targetLanguage, context);
        
        try {
            // Use AI fallback service for translation (fast models preferred)
            const response = await this.aiService.generateContent(
                prompt,
                'translation',
                {
                    maxTokens: 300,
                    temperature: 0.2 // Low temperature for consistent translations
                }
            );
            
            return this.cleanTranslationResponse(response);
            
        } catch (error) {
            console.error(`[Translation] AI translation failed for ${targetLanguage}:`, error);
            throw error;
        }
    }

    /**
     * Build context-specific translation prompt
     */
    private buildTranslationPrompt(
        text: string,
        targetLanguage: Language,
        context: TranslationContext
    ): string {
        const template = TRANSLATION_PROMPTS[context] || TRANSLATION_PROMPTS.general;
        const languageName = LANGUAGE_NAMES[targetLanguage];
        
        return template
            .replace('{language}', languageName)
            .replace('{text}', text);
    }

    /**
     * Clean AI response to extract just the translation
     */
    private cleanTranslationResponse(response: string): string {
        // Remove common AI response artifacts
        const cleaned = response
            .replace(/^Translation:\s*/i, '')
            .replace(/^Here's the translation:\s*/i, '')
            .replace(/^The translation is:\s*/i, '')
            .replace(/^\"/g, '')
            .replace(/\"$/g, '')
            .trim();
        
        return cleaned || response; // Fallback to original if cleaning failed
    }

    /**
     * Cache management methods
     * SOURCE: Enhanced from all three services
     */
    private generateCacheKey(text: string, language: Language, context: TranslationContext): string {
        // Use a hash-like key to handle long texts
        const textKey = text.length > 100 ? 
            text.substring(0, 50) + '_' + text.length + '_' + text.substring(text.length - 50) :
            text;
        
        return `${textKey}:${language}:${context}`;
    }

    private getFromCache(cacheKey: string): string | null {
        const entry = this.cache.get(cacheKey);
        
        if (!entry) return null;
        
        // Check if entry is expired
        if (Date.now() - entry.timestamp > this.CACHE_TTL) {
            this.cache.delete(cacheKey);
            return null;
        }
        
        // Update hit count for LRU eviction
        entry.hitCount++;
        return entry.translation;
    }

    private addToCache(cacheKey: string, translation: string, context: TranslationContext): void {
        // Prevent cache from growing too large
        if (this.cache.size >= this.MAX_CACHE_SIZE) {
            this.evictLeastUsed();
        }
        
        this.cache.set(cacheKey, {
            translation,
            timestamp: Date.now(),
            context,
            hitCount: 1
        });
    }

    private evictLeastUsed(): void {
        // Remove 20% of least used entries
        const entries = Array.from(this.cache.entries());
        entries.sort(([, a], [, b]) => a.hitCount - b.hitCount);
        
        const toRemove = Math.floor(entries.length * 0.2);
        for (let i = 0; i < toRemove; i++) {
            this.cache.delete(entries[i][0]);
        }
        
        console.log(`[Translation] Evicted ${toRemove} cache entries`);
    }

    private cleanupCache(): void {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.CACHE_TTL) {
                this.cache.delete(key);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            console.log(`[Translation] Cleaned ${cleanedCount} expired cache entries`);
        }
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): {
        size: number;
        maxSize: number;
        hitRate: number;
        contextBreakdown: Record<TranslationContext, number>;
    } {
        const contexts: Record<TranslationContext, number> = {
            confirmation: 0, error: 0, success: 0, question: 0, info: 0,
            greeting: 0, safety: 0, off_topic: 0, tool: 0, general: 0
        };
        
        let totalHits = 0;
        
        for (const entry of this.cache.values()) {
            contexts[entry.context]++;
            totalHits += entry.hitCount;
        }
        
        return {
            size: this.cache.size,
            maxSize: this.MAX_CACHE_SIZE,
            hitRate: this.cache.size > 0 ? totalHits / this.cache.size : 0,
            contextBreakdown: contexts
        };
    }

    /**
     * Clear cache (for testing or memory management)
     */
    clearCache(): void {
        this.cache.clear();
        console.log('[Translation] Cache cleared');
    }
}

// ===== CONVENIENCE METHODS =====
// These replace the static methods from the original services

/**
 * Quick translation method for backward compatibility
 * SOURCE: Replaces TranslationService.translateMessage from enhanced-conversation-manager.ts
 */
export async function translateMessage(
    message: string,
    targetLanguage: Language,
    context: TranslationContext = 'general'
): Promise<string> {
    // This will be initialized by the main application
    const service = UnifiedTranslationService.getInstance();
    return service.translate(message, targetLanguage, context);
}

/**
 * Tool message translation (replaces AgentToolTranslationService.translateToolMessage)
 * SOURCE: agent-tools.ts AgentToolTranslationService.translateToolMessage
 */
export async function translateToolMessage(
    message: string,
    targetLanguage: Language,
    context: 'error' | 'success' | 'info' = 'info'
): Promise<string> {
    const service = UnifiedTranslationService.getInstance();
    return service.translate(message, targetLanguage, context === 'info' ? 'tool' : context);
}

/**
 * Guardrail message translation (replaces UnifiedGuardrailTranslationService.translate)
 * SOURCE: guardrails.ts UnifiedGuardrailTranslationService.translate
 */
export async function translateGuardrailMessage(
    message: string,
    targetLanguage: Language,
    context: 'error' | 'safety' | 'off_topic' = 'error'
): Promise<string> {
    const service = UnifiedTranslationService.getInstance();
    return service.translate(message, targetLanguage, context);
}

// ===== LANGUAGE DETECTION HELPERS =====
// SOURCE: Some detection logic from enhanced-conversation-manager.ts

/**
 * Simple language detection for common patterns
 */
export function detectLanguageFromText(text: string): Language {
    const lowerText = text.toLowerCase();
    
    // Cyrillic script - likely Russian
    if (/[\u0400-\u04FF]/.test(text)) {
        return 'ru';
    }
    
    // Common Hungarian words
    if (lowerText.includes('szia') || lowerText.includes('szeretnék') || 
        lowerText.includes('foglalni') || lowerText.includes('asztal')) {
        return 'hu';
    }
    
    // Common Serbian words  
    if (lowerText.includes('zdravo') || lowerText.includes('rezervacija') ||
        lowerText.includes('restoran') || lowerText.includes('stolova')) {
        return 'sr';
    }
    
    // Common German words
    if (lowerText.includes('hallo') || lowerText.includes('reservierung') ||
        lowerText.includes('restaurant') || lowerText.includes('tisch')) {
        return 'de';
    }
    
    // Default to English
    return 'en';
}

/**
 * Check if text needs translation
 */
export function needsTranslation(text: string, targetLanguage: Language): boolean {
    if (targetLanguage === 'en' || targetLanguage === 'auto') {
        return false;
    }
    
    // Don't translate very short texts
    if (text.length < 3) {
        return false;
    }
    
    // Don't translate if already in target language (basic check)
    const detectedLang = detectLanguageFromText(text);
    return detectedLang !== targetLanguage;
}

// ===== INITIALIZATION HELPER =====
export function initializeTranslationService(aiService: AIFallbackService): UnifiedTranslationService {
    return UnifiedTranslationService.getInstance(aiService);
}

// ===== DEFAULT EXPORT =====
export default UnifiedTranslationService;