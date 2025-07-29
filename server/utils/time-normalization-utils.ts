// server/utils/time-normalization-utils.ts

/**
 * 🚨 CRITICAL BUG FIX: Smart Time Normalization Utility
 * 
 * Handles the various ways people naturally type times in chat conversations.
 * Fixes the circular loop issue where "19-20" is interpreted as a range instead of "19:20".
 * 
 * This utility normalizes time patterns BEFORE AI processing to prevent ambiguity.
 */

export interface TimeNormalizationResult {
    normalizedMessage: string;
    changesApplied: Array<{
        original: string;
        normalized: string;
        pattern: string;
        confidence: number;
    }>;
    hasTimePatterns: boolean;
}

export interface TimeNormalizationOptions {
    language?: string;
    restaurantContext?: boolean;
    sessionId?: string;
    logChanges?: boolean;
}

/**
 * Main time normalization function that understands natural chat typing patterns
 */
export function normalizeTimePatterns(
    message: string, 
    options: TimeNormalizationOptions = {}
): TimeNormalizationResult {
    const { language = 'en', restaurantContext = true, sessionId, logChanges = true } = options;
    
    let normalizedMessage = message;
    const changes: Array<{
        original: string;
        normalized: string;
        pattern: string;
        confidence: number;
    }> = [];
    
    // Helper function to add change with confidence scoring
    const addChange = (original: string, normalized: string, pattern: string, confidence: number) => {
        changes.push({ original, normalized, pattern, confidence });
    };
    
    // 1. DASH/DOT TYPOS: "19-20" → "19:20", "7.30" → "7:30"
    const dashDotPattern = /\b(\d{1,2})[-.](\d{2})\b/g;
    normalizedMessage = normalizedMessage.replace(dashDotPattern, (match, hours, minutes) => {
        const h = parseInt(hours, 10);
        const m = parseInt(minutes, 10);
        
        // Only normalize valid times
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
            const context = analyzeTimeContext(message, match);
            
            // Skip if it's clearly a date or range
            if (context.isLikelyDate || context.isExplicitRange) {
                return match;
            }
            
            const normalized = `${h.toString().padStart(2, '0')}:${minutes}`;
            addChange(match, normalized, 'dash_dot_typo', context.timeConfidence);
            return normalized;
        }
        return match;
    });
    
    // 2. SPACE TYPOS: "19 30" → "19:30"
    const spacePattern = /\b(\d{1,2})\s+(\d{2})\b/g;
    normalizedMessage = normalizedMessage.replace(spacePattern, (match, hours, minutes) => {
        const h = parseInt(hours, 10);
        const m = parseInt(minutes, 10);
        
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
            const context = analyzeTimeContext(normalizedMessage, match);
            
            // Skip if followed by time units or quantity contexts
            if (context.hasTimeUnits || context.hasQuantityContext) {
                return match;
            }
            
            const normalized = `${h.toString().padStart(2, '0')}:${minutes}`;
            addChange(match, normalized, 'space_typo', context.timeConfidence);
            return normalized;
        }
        return match;
    });
    
    // 3. COMMA TYPOS: "19,30" → "19:30" (common in some regions)
    const commaPattern = /\b(\d{1,2}),(\d{2})\b/g;
    normalizedMessage = normalizedMessage.replace(commaPattern, (match, hours, minutes) => {
        const h = parseInt(hours, 10);
        const m = parseInt(minutes, 10);
        
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
            const normalized = `${h.toString().padStart(2, '0')}:${minutes}`;
            addChange(match, normalized, 'comma_typo', 0.9);
            return normalized;
        }
        return match;
    });
    
    // 4. HOUR MARKERS: "19h30", "7pm", "8 o'clock"
    const hourMarkerPatterns = [
        {
            pattern: /\b(\d{1,2})h(\d{2})?\b/gi,
            name: 'h_marker'
        },
        {
            pattern: /\b(\d{1,2})(?::(\d{2}))?\s*(pm|am)\b/gi,
            name: 'ampm_marker'
        },
        {
            pattern: /\b(\d{1,2})\s*(?:o'?clock|часов|час|óra|Uhr|heure|hora|ora|uur)\b/gi,
            name: 'oclock_marker'
        }
    ];
    
    hourMarkerPatterns.forEach(({ pattern, name }) => {
        normalizedMessage = normalizedMessage.replace(pattern, (match, hours, minutes, ampm) => {
            let h = parseInt(hours, 10);
            let m = minutes ? parseInt(minutes, 10) : 0;
            
            // Handle AM/PM conversion
            if (ampm) {
                const isPM = ampm.toLowerCase().includes('p');
                if (isPM && h < 12) h += 12;
                if (!isPM && h === 12) h = 0;
            }
            
            if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
                const normalized = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                addChange(match, normalized, name, 0.95);
                return normalized;
            }
            return match;
        });
    });
    
    // 5. VOICE-TO-TEXT FIXES: Common transcription mistakes
    const voiceToTextMappings = getVoiceToTextMappings(language);
    voiceToTextMappings.forEach(({ pattern, replacement, confidence }) => {
        const regex = new RegExp(pattern, 'gi');
        if (normalizedMessage.match(regex)) {
            normalizedMessage = normalizedMessage.replace(regex, replacement);
            addChange(pattern, replacement, 'voice_to_text', confidence);
        }
    });
    
    // 6. CASUAL SHORTCUTS: "7.5" → "7:30", "8-ish" → "8:00"
    const halfHourPattern = /\b(\d{1,2})\.5\b/g;
    normalizedMessage = normalizedMessage.replace(halfHourPattern, (match, hours) => {
        const h = parseInt(hours, 10);
        if (h >= 0 && h <= 23) {
            const normalized = `${h.toString().padStart(2, '0')}:30`;
            addChange(match, normalized, 'half_hour_shortcut', 0.8);
            return normalized;
        }
        return match;
    });
    
    // 7. RANGE DISAMBIGUATION: Smart "19-20" handling
    normalizedMessage = disambiguateTimeRanges(normalizedMessage, changes, language);
    
    // 8. INTERNATIONAL FORMATS: Regional preferences
    normalizedMessage = normalizeInternationalFormats(normalizedMessage, changes, language);
    
    const result: TimeNormalizationResult = {
        normalizedMessage,
        changesApplied: changes,
        hasTimePatterns: changes.length > 0
    };
    
    // Log changes if enabled and changes were made
    if (logChanges && changes.length > 0 && sessionId) {
        logNormalizationChanges(sessionId, message, result);
    }
    
    return result;
}

/**
 * Analyzes context around a potential time match to determine confidence
 */
function analyzeTimeContext(message: string, match: string): {
    timeConfidence: number;
    isLikelyDate: boolean;
    isExplicitRange: boolean;
    hasTimeUnits: boolean;
    hasQuantityContext: boolean;
} {
    const matchIndex = message.indexOf(match);
    const beforeMatch = message.substring(0, matchIndex).toLowerCase();
    const afterMatch = message.substring(matchIndex + match.length).toLowerCase();
    
    // Check for explicit range indicators
    const rangeIndicators = [
        'between', 'from', 'to', 'until', 'or', 
        'между', 'от', 'до', 'или',
        'između', 'od', 'do',
        'között', 'től', 'ig',
        'zwischen', 'von', 'bis',
        'entre', 'de', 'à', 'hasta'
    ];
    const isExplicitRange = rangeIndicators.some(word => 
        beforeMatch.includes(word) || afterMatch.includes(word)
    );
    
    // Check for time units that suggest it's not a time
    const timeUnits = ['minutes?', 'mins?', 'минут', 'мин', 'часов', 'hours?', 'perc', 'minuta', 'Minuten', 'Stunden'];
    const hasTimeUnits = timeUnits.some(unit => afterMatch.match(new RegExp(`^\\s*${unit}`, 'i')));
    
    // Check for quantity contexts
    const quantityWords = ['for', 'на', 'за', 'table', 'столик', 'sto', 'asztal', 'tisch', 'mesa', 'tavolo'];
    const hasQuantityContext = quantityWords.some(word => beforeMatch.includes(word));
    
    // Check for date patterns (DD-MM, MM-DD)
    const numbers = match.match(/\d+/g) || [];
    const isLikelyDate = numbers.length === 2 && 
        (parseInt(numbers[0]) > 12 || parseInt(numbers[1]) > 12) &&
        (parseInt(numbers[0]) <= 31 && parseInt(numbers[1]) <= 12);
    
    // Check for time indicators
    const timeIndicators = [
        'at', 'time', 'clock', 'в', 'время', 'часов',
        'u', 'um', 'à', 'a las', 'alle', 'в', 'når'
    ];
    const hasTimeIndicators = timeIndicators.some(word => beforeMatch.includes(word));
    
    // Calculate confidence based on context
    let timeConfidence = 0.5; // baseline
    
    if (hasTimeIndicators) timeConfidence += 0.3;
    if (isExplicitRange) timeConfidence -= 0.4;
    if (hasTimeUnits) timeConfidence -= 0.5;
    if (hasQuantityContext) timeConfidence -= 0.3;
    if (isLikelyDate) timeConfidence -= 0.4;
    
    // Restaurant context bonus (reasonable dinner hours)
    const hour = parseInt(numbers[0] || '0');
    if (hour >= 17 && hour <= 23) timeConfidence += 0.2;
    
    return {
        timeConfidence: Math.max(0, Math.min(1, timeConfidence)),
        isLikelyDate,
        isExplicitRange,
        hasTimeUnits,
        hasQuantityContext
    };
}

/**
 * Smart disambiguation of time ranges vs. times
 */
function disambiguateTimeRanges(
    message: string, 
    changes: Array<any>, 
    language: string
): string {
    const ambiguousRangePattern = /\b(\d{1,2})-(\d{1,2})\b/g;
    
    return message.replace(ambiguousRangePattern, (match, start, end) => {
        const startNum = parseInt(start, 10);
        const endNum = parseInt(end, 10);
        
        // Pattern: 19-20 (likely 19:20 if start > end and both are reasonable time components)
        if (start.length >= 2 && end.length === 2 && startNum > endNum && 
            startNum >= 0 && startNum <= 23 && endNum >= 0 && endNum <= 59) {
            
            const context = analyzeTimeContext(message, match);
            if (context.timeConfidence > 0.6) {
                const normalized = `${start}:${end}`;
                changes.push({
                    original: match,
                    normalized,
                    pattern: 'range_disambiguation',
                    confidence: context.timeConfidence
                });
                return normalized;
            }
        }
        
        return match; // Keep as range
    });
}

/**
 * Handle international time formats
 */
function normalizeInternationalFormats(
    message: string, 
    changes: Array<any>, 
    language: string
): string {
    // European format: 20.30 (German/Dutch style)
    if (['de', 'nl'].includes(language)) {
        const europeanPattern = /\b(\d{1,2})\.(\d{2})\b/g;
        return message.replace(europeanPattern, (match, hours, minutes) => {
            const h = parseInt(hours, 10);
            const m = parseInt(minutes, 10);
            
            if (h >= 6 && h <= 23 && m >= 0 && m <= 59) {
                const normalized = `${h.toString().padStart(2, '0')}:${minutes}`;
                changes.push({
                    original: match,
                    normalized,
                    pattern: 'european_format',
                    confidence: 0.85
                });
                return normalized;
            }
            return match;
        });
    }
    
    return message;
}

/**
 * Get voice-to-text error mappings based on language
 */
function getVoiceToTextMappings(language: string): Array<{
    pattern: string;
    replacement: string;
    confidence: number;
}> {
    const commonMappings = [
        { pattern: 'half past (\\d+)', replacement: '$1:30', confidence: 0.9 },
        { pattern: 'quarter past (\\d+)', replacement: '$1:15', confidence: 0.9 },
        { pattern: 'quarter to (\\d+)', replacement: '$1:45', confidence: 0.8 },
        { pattern: '(\\d+) thirty', replacement: '$1:30', confidence: 0.85 }
    ];
    
    const languageSpecific: Record<string, Array<any>> = {
        'ru': [
            { pattern: 'половина (\\d+)', replacement: '$1:30', confidence: 0.9 },
            { pattern: 'пол (\\d+)', replacement: '$1:30', confidence: 0.8 },
            { pattern: '(\\d+) тридцать', replacement: '$1:30', confidence: 0.85 }
        ],
        'de': [
            { pattern: 'halb (\\d+)', replacement: '$1:30', confidence: 0.9 },
            { pattern: 'viertel nach (\\d+)', replacement: '$1:15', confidence: 0.9 }
        ],
        'fr': [
            { pattern: '(\\d+) heures trente', replacement: '$1:30', confidence: 0.9 },
            { pattern: '(\\d+) heures et quart', replacement: '$1:15', confidence: 0.9 }
        ]
    };
    
    return [...commonMappings, ...(languageSpecific[language] || [])];
}

/**
 * Log normalization changes for monitoring and debugging
 */
function logNormalizationChanges(
    sessionId: string, 
    originalMessage: string, 
    result: TimeNormalizationResult
): void {
    // Only log if there's a logging service available (avoiding import dependency)
    if (typeof global !== 'undefined' && (global as any).smartLog) {
        const smartLog = (global as any).smartLog;
        
        smartLog.info('Time normalization applied', {
            sessionId,
            originalMessage: originalMessage.substring(0, 100),
            normalizedMessage: result.normalizedMessage.substring(0, 100),
            changesCount: result.changesApplied.length,
            changes: result.changesApplied.map(c => ({
                pattern: c.pattern,
                confidence: c.confidence,
                change: `${c.original} → ${c.normalized}`
            })),
            highConfidenceChanges: result.changesApplied.filter(c => c.confidence > 0.8).length
        });
    }
}

/**
 * Utility function to check if a message likely contains time patterns
 */
export function hasTimePatterns(message: string): boolean {
    const timePatterns = [
        /\b\d{1,2}[-.:,]\d{2}\b/,     // HH-MM, HH:MM, HH.MM, HH,MM
        /\b\d{1,2}\s+\d{2}\b/,        // HH MM
        /\b\d{1,2}[hH]\d{0,2}\b/,     // HH or HHhMM
        /\b\d{1,2}\s*(pm|am)\b/i,     // HH pm/am
        /\b\d{1,2}\s*o'?clock\b/i,    // HH o'clock
        /(half|quarter)\s*past/i,      // half past, quarter past
        /\b\d{1,2}\.5\b/              // HH.5 (half hour)
    ];
    
    return timePatterns.some(pattern => pattern.test(message));
}

/**
 * Quick validation that a normalized time is reasonable for restaurant context
 */
export function isReasonableRestaurantTime(timeString: string): boolean {
    const timeMatch = timeString.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) return false;
    
    const hour = parseInt(timeMatch[1], 10);
    const minute = parseInt(timeMatch[2], 10);
    
    // Basic validation
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return false;
    
    // Restaurant context: reasonable dining hours (6 AM to midnight)
    if (hour < 6 || hour > 23) return false;
    
    return true;
}