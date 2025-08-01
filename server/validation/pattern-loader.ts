// server/validation/pattern-loader.ts

import guestPatterns from './patterns/guest-patterns-all.json';
import { smartLog } from '../services/smart-logging.service';

/**
 * Interface for guest validation patterns per language
 */
interface GuestValidationPatterns {
    collectiveNumerals: { [key: string]: number };
    phrases: string[];
    regexPatterns: string[];
}

/**
 * Complete language patterns loaded from JSON
 */
interface AllLanguagePatterns {
    [languageCode: string]: GuestValidationPatterns;
}

/**
 * Validation result with detailed information
 */
export interface ValidationMatch {
    isValid: boolean;
    confidence: number;
    matchType: 'collective_numeral' | 'phrase' | 'regex' | 'fallback';
    matchedPattern?: string;
    extractedValue?: number;
    language: string;
    reasoning: string;
}

/**
 * 🚀 PRODUCTION-READY: Validation Pattern Loader with comprehensive multilingual support
 * 
 * This class handles dynamic loading of guest validation patterns for all supported languages,
 * fixing the critical Russian collective numerals bug and providing scalable multilingual support.
 * 
 * Features:
 * - Dynamic pattern loading with caching
 * - Fallback to English for unsupported languages
 * - Comprehensive validation with confidence scoring
 * - Performance optimized with smart caching
 * - Debug logging for troubleshooting
 * - Support for 10 languages with extensible architecture
 */
export class ValidationPatternLoader {
    private static cache = new Map<string, GuestValidationPatterns>();
    private static allPatterns: AllLanguagePatterns | null = null;
    private static readonly SUPPORTED_LANGUAGES = [
        'en', 'ru', 'sr', 'hu', 'de', 'fr', 'es', 'it', 'pt', 'nl'
    ];
    
    /**
     * Load guest validation patterns for a specific language
     * @param language - Language code (en, ru, sr, hu, etc.)
     * @returns Validation patterns for the language
     */
    static loadGuestPatterns(language: string): GuestValidationPatterns {
        const timerId = smartLog.startTimer(`pattern_load_${language}`);
        const cacheKey = `guest-${language}`;
        
        try {
            // Check cache first for performance
            if (this.cache.has(cacheKey)) {
                smartLog.endTimer(timerId);
                smartLog.info('Guest patterns loaded from cache', {
                    language,
                    cacheHit: true,
                    cacheSize: this.cache.size
                });
                return this.cache.get(cacheKey)!;
            }
            
            // Load all patterns if not already loaded
            if (!this.allPatterns) {
                this.allPatterns = guestPatterns as AllLanguagePatterns;
                smartLog.info('All guest patterns loaded from JSON', {
                    supportedLanguages: this.SUPPORTED_LANGUAGES,
                    totalPatterns: Object.keys(this.allPatterns).length
                });
            }
            
            // Get patterns for requested language or fallback to English
            const patterns = this.allPatterns[language] || this.allPatterns['en'];
            
            if (!this.allPatterns[language]) {
                smartLog.warn('Language not supported, using English fallback', {
                    requestedLanguage: language,
                    fallbackUsed: 'en',
                    supportedLanguages: this.SUPPORTED_LANGUAGES
                });
            }
            
            // Validate pattern structure
            const validatedPatterns = this.validatePatternStructure(patterns, language);
            
            // Cache the result
            this.cache.set(cacheKey, validatedPatterns);
            
            smartLog.info('Guest patterns loaded successfully', {
                language,
                fallbackUsed: !this.allPatterns[language],
                collectiveNumeralsCount: Object.keys(validatedPatterns.collectiveNumerals).length,
                phrasesCount: validatedPatterns.phrases.length,
                regexPatternsCount: validatedPatterns.regexPatterns.length,
                processingTime: smartLog.endTimer(timerId)
            });
            
            return validatedPatterns;
            
        } catch (error) {
            smartLog.endTimer(timerId);
            smartLog.error('Failed to load guest patterns', error as Error, {
                language,
                fallbackToEnglish: true
            });
            
            // Emergency fallback to basic English patterns
            const emergencyPatterns: GuestValidationPatterns = {
                collectiveNumerals: {
                    "two of us": 2, "three of us": 3, "four of us": 4, "party of two": 2
                },
                phrases: ["party of", "table for", "group of"],
                regexPatterns: ["\\d+\\s*(people|person|guests|pax)"]
            };
            
            this.cache.set(cacheKey, emergencyPatterns);
            return emergencyPatterns;
        }
    }
    
    /**
     * 🎯 ENHANCED: Comprehensive validation with confidence scoring
     * @param input - User input message
     * @param extractedValue - Extracted guest count from AI
     * @param language - Language code
     * @returns Detailed validation result with confidence
     */
    static validateGuestCountWithConfidence(
        input: string, 
        extractedValue: number, 
        language: string
    ): ValidationMatch {
        const timerId = smartLog.startTimer('comprehensive_validation');
        
        try {
            const patterns = this.loadGuestPatterns(language);
            const cleanInput = input.toLowerCase().trim();
            
            // 1. HIGHEST CONFIDENCE: Collective numerals (exact match)
            for (const [term, expectedValue] of Object.entries(patterns.collectiveNumerals)) {
                if (cleanInput.includes(term.toLowerCase()) && extractedValue === expectedValue) {
                    const result: ValidationMatch = {
                        isValid: true,
                        confidence: 0.98,
                        matchType: 'collective_numeral',
                        matchedPattern: term,
                        extractedValue: expectedValue,
                        language,
                        reasoning: `Exact collective numeral match: "${term}" = ${expectedValue}`
                    };
                    
                    smartLog.info('Validation: Collective numeral match', {
                        input: input.substring(0, 100),
                        matchedTerm: term,
                        expectedValue,
                        language,
                        processingTime: smartLog.endTimer(timerId)
                    });
                    
                    return result;
                }
            }
            
            // 2. HIGH CONFIDENCE: Phrase patterns with number validation
            const hasPhrase = patterns.phrases.find(phrase => 
                cleanInput.includes(phrase.toLowerCase())
            );
            
            if (hasPhrase && extractedValue >= 1 && extractedValue <= 50) {
                const result: ValidationMatch = {
                    isValid: true,
                    confidence: 0.85,
                    matchType: 'phrase',
                    matchedPattern: hasPhrase,
                    extractedValue,
                    language,
                    reasoning: `Phrase pattern match: "${hasPhrase}" with valid guest count ${extractedValue}`
                };
                
                smartLog.info('Validation: Phrase pattern match', {
                    input: input.substring(0, 100),
                    matchedPhrase: hasPhrase,
                    extractedValue,
                    language,
                    processingTime: smartLog.endTimer(timerId)
                });
                
                return result;
            }
            
            // 3. MEDIUM CONFIDENCE: Regex patterns
            for (const regexPattern of patterns.regexPatterns) {
                const regex = new RegExp(regexPattern, 'gi');
                if (regex.test(input)) {
                    const result: ValidationMatch = {
                        isValid: true,
                        confidence: 0.75,
                        matchType: 'regex',
                        matchedPattern: regexPattern,
                        extractedValue,
                        language,
                        reasoning: `Regex pattern match: ${regexPattern}`
                    };
                    
                    smartLog.info('Validation: Regex pattern match', {
                        input: input.substring(0, 100),
                        regexPattern,
                        extractedValue,
                        language,
                        processingTime: smartLog.endTimer(timerId)
                    });
                    
                    return result;
                }
            }
            
            // 4. LOW CONFIDENCE: Fallback for reasonable numbers
            if (extractedValue >= 1 && extractedValue <= 20) {
                const result: ValidationMatch = {
                    isValid: true,
                    confidence: 0.40,
                    matchType: 'fallback',
                    extractedValue,
                    language,
                    reasoning: `Fallback validation for reasonable guest count: ${extractedValue}`
                };
                
                smartLog.warn('Validation: Fallback used', {
                    input: input.substring(0, 100),
                    extractedValue,
                    language,
                    reason: 'No specific patterns matched but number is reasonable',
                    processingTime: smartLog.endTimer(timerId)
                });
                
                return result;
            }
            
            // 5. VALIDATION FAILED
            const result: ValidationMatch = {
                isValid: false,
                confidence: 0.0,
                matchType: 'fallback',
                extractedValue,
                language,
                reasoning: `No valid patterns found for input with ${extractedValue} guests`
            };
            
            smartLog.warn('Validation failed: No patterns matched', {
                input: input.substring(0, 100),
                extractedValue,
                language,
                hallucinationPrevented: true,
                processingTime: smartLog.endTimer(timerId)
            });
            
            return result;
            
        } catch (error) {
            smartLog.endTimer(timerId);
            smartLog.error('Validation error', error as Error, {
                input: input.substring(0, 100),
                extractedValue,
                language
            });
            
            return {
                isValid: false,
                confidence: 0.0,
                matchType: 'fallback',
                extractedValue,
                language,
                reasoning: 'Validation error occurred'
            };
        }
    }
    
    /**
     * 🔍 ENHANCED: Get detailed pattern statistics for debugging
     * @param language - Language code
     * @returns Pattern statistics
     */
    static getPatternStatistics(language: string): {
        language: string;
        collectiveNumeralsCount: number;
        phrasesCount: number;
        regexPatternsCount: number;
        supportedGuestRanges: { min: number; max: number };
        sampleCollectiveNumerals: string[];
        cacheStatus: 'hit' | 'miss' | 'loaded';
    } {
        const cacheKey = `guest-${language}`;
        const cacheStatus = this.cache.has(cacheKey) ? 'hit' : 'miss';
        
        const patterns = this.loadGuestPatterns(language);
        const guestCounts = Object.values(patterns.collectiveNumerals);
        
        return {
            language,
            collectiveNumeralsCount: Object.keys(patterns.collectiveNumerals).length,
            phrasesCount: patterns.phrases.length,
            regexPatternsCount: patterns.regexPatterns.length,
            supportedGuestRanges: {
                min: Math.min(...guestCounts),
                max: Math.max(...guestCounts)
            },
            sampleCollectiveNumerals: Object.keys(patterns.collectiveNumerals).slice(0, 5),
            cacheStatus: cacheStatus === 'miss' ? 'loaded' : cacheStatus
        };
    }
    
    /**
     * 🔧 UTILITY: Get all supported languages
     * @returns Array of supported language codes
     */
    static getSupportedLanguages(): string[] {
        return [...this.SUPPORTED_LANGUAGES];
    }
    
    /**
     * 🔧 UTILITY: Check if language is supported
     * @param language - Language code to check
     * @returns True if language is supported
     */
    static isLanguageSupported(language: string): boolean {
        return this.SUPPORTED_LANGUAGES.includes(language);
    }
    
    /**
     * 🧹 MAINTENANCE: Clear pattern cache
     * @param language - Optional specific language to clear, or all if not provided
     */
    static clearCache(language?: string): void {
        if (language) {
            const cacheKey = `guest-${language}`;
            this.cache.delete(cacheKey);
            smartLog.info('Pattern cache cleared for language', { language });
        } else {
            const cacheSize = this.cache.size;
            this.cache.clear();
            this.allPatterns = null;
            smartLog.info('All pattern caches cleared', { previousCacheSize: cacheSize });
        }
    }
    
    /**
     * 📊 MONITORING: Get cache statistics
     * @returns Cache performance statistics
     */
    static getCacheStats(): {
        cacheSize: number;
        cachedLanguages: string[];
        hitRate: string;
        memoryUsage: string;
    } {
        const cachedLanguages = Array.from(this.cache.keys())
            .map(key => key.replace('guest-', ''))
            .sort();
            
        return {
            cacheSize: this.cache.size,
            cachedLanguages,
            hitRate: 'N/A', // Could be implemented with hit/miss counters
            memoryUsage: `~${this.cache.size * 2}KB` // Rough estimate
        };
    }
    
    /**
     * 🔧 PRIVATE: Validate pattern structure to ensure data integrity
     * @param patterns - Patterns to validate
     * @param language - Language code for logging
     * @returns Validated patterns
     */
    private static validatePatternStructure(
        patterns: GuestValidationPatterns, 
        language: string
    ): GuestValidationPatterns {
        const issues: string[] = [];
        
        // Validate collective numerals
        if (!patterns.collectiveNumerals || typeof patterns.collectiveNumerals !== 'object') {
            issues.push('Missing or invalid collectiveNumerals');
            patterns.collectiveNumerals = {};
        }
        
        // Validate phrases
        if (!Array.isArray(patterns.phrases)) {
            issues.push('Missing or invalid phrases array');
            patterns.phrases = [];
        }
        
        // Validate regex patterns
        if (!Array.isArray(patterns.regexPatterns)) {
            issues.push('Missing or invalid regexPatterns array');
            patterns.regexPatterns = [];
        }
        
        // Test regex patterns for validity
        const validRegexPatterns: string[] = [];
        for (const regexPattern of patterns.regexPatterns) {
            try {
                new RegExp(regexPattern, 'gi');
                validRegexPatterns.push(regexPattern);
            } catch (error) {
                issues.push(`Invalid regex pattern: ${regexPattern}`);
            }
        }
        patterns.regexPatterns = validRegexPatterns;
        
        if (issues.length > 0) {
            smartLog.warn('Pattern validation issues found', {
                language,
                issues,
                autoFixed: true
            });
        }
        
        return patterns;
    }
    
    /**
     * 🎯 UTILITY: Find best matching pattern for debugging
     * @param input - User input
     * @param language - Language code
     * @returns Best matching pattern information
     */
    static findBestMatchingPattern(input: string, language: string): {
        bestMatch: string | null;
        matchType: string;
        confidence: number;
        allMatches: Array<{ pattern: string; type: string; score: number }>;
    } {
        const patterns = this.loadGuestPatterns(language);
        const cleanInput = input.toLowerCase();
        const allMatches: Array<{ pattern: string; type: string; score: number }> = [];
        
        // Check collective numerals
        for (const [term, value] of Object.entries(patterns.collectiveNumerals)) {
            if (cleanInput.includes(term.toLowerCase())) {
                allMatches.push({
                    pattern: `${term} (${value})`,
                    type: 'collective_numeral',
                    score: 0.98
                });
            }
        }
        
        // Check phrases
        for (const phrase of patterns.phrases) {
            if (cleanInput.includes(phrase.toLowerCase())) {
                allMatches.push({
                    pattern: phrase,
                    type: 'phrase',
                    score: 0.85
                });
            }
        }
        
        // Check regex patterns
        for (const regexPattern of patterns.regexPatterns) {
            try {
                const regex = new RegExp(regexPattern, 'gi');
                if (regex.test(input)) {
                    allMatches.push({
                        pattern: regexPattern,
                        type: 'regex',
                        score: 0.75
                    });
                }
            } catch (error) {
                // Skip invalid regex
            }
        }
        
        // Sort by score (highest first)
        allMatches.sort((a, b) => b.score - a.score);
        
        const bestMatch = allMatches.length > 0 ? allMatches[0] : null;
        
        return {
            bestMatch: bestMatch?.pattern || null,
            matchType: bestMatch?.type || 'none',
            confidence: bestMatch?.score || 0,
            allMatches
        };
    }
}