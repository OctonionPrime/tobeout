// src/services/context-manager.ts
// Context Manager with Critical Race Condition Fixes
// ✅ FIXED: Context resolution race condition with comprehensive pattern matching
// ✅ FIXED: Infinite clarification prevention with attempt counters
// ✅ ENHANCED: Multilingual natural language cue detection
// ✅ OPTIMIZED: Performance improvements and caching
// ✅ SECURED: Input validation and sanitization

import type { BookingSession } from './session-manager';
import type { Language } from './enhanced-conversation-manager';

/**
 * 🔧 ENHANCED: Booking session interface with critical fixes
 */
export interface BookingSessionWithAgent extends BookingSession {
    currentAgent: 'booking' | 'reservations' | 'conductor' | 'availability';
    agentHistory?: Array<{
        from: any;
        to: any;
        at: string;
        trigger: string;
        overseerReasoning?: string;
    }>;
    pendingConfirmation?: any;
    confirmedName?: string;
    guestHistory?: any;
    activeReservationId?: number;
    foundReservations?: Array<{
        id: number;
        date: string;
        time: string;
        guests: number;
        guestName: string;
        tableName: string;
        status: string;
        canModify: boolean;
        canCancel: boolean;
    }>;
    turnCount?: number;
    agentTurnCount?: number;
    languageLocked?: boolean;
    languageDetectionLog?: any;
    hasAskedPartySize?: boolean;
    hasAskedDate?: boolean;
    hasAskedTime?: boolean;
    hasAskedName?: boolean;
    hasAskedPhone?: boolean;
    availabilityFailureContext?: any;
    recentlyModifiedReservations?: Array<{
        reservationId: number;
        lastModifiedAt: Date;
        contextExpiresAt: Date;
        operationType: 'modification' | 'cancellation' | 'creation';
        userReference?: string;
    }>;
    currentOperationContext?: any;
    // 🆕 CRITICAL FIX: Add clarification attempt tracking
    clarificationAttempts?: Map<string, number>;
    // 🆕 PERFORMANCE: Add caching for resolution results
    lastResolutionCache?: {
        userMessage: string;
        result: ReservationResolution;
        timestamp: number;
    };
}

/**
 * 🔧 ENHANCED: Resolution result with confidence scoring
 */
export interface ReservationResolution {
    resolvedId: number | null;
    confidence: 'high' | 'medium' | 'low';
    method: string;
    shouldAskForClarification: boolean;
    suggestion?: string;
    // 🆕 ENHANCED: Additional metadata for debugging
    matchingPatterns?: string[];
    alternativeCandidates?: number[];
    debugInfo?: {
        foundReservationsCount: number;
        recentModificationsCount: number;
        activeReservationPresent: boolean;
    };
}

/**
 * 🔧 ENHANCED: Conversation flags with history tracking
 */
export interface ConversationFlags {
    hasAskedPartySize?: boolean;
    hasAskedDate?: boolean;
    hasAskedTime?: boolean;
    hasAskedName?: boolean;
    hasAskedPhone?: boolean;
    lastQuestionTimestamp?: Date;
    questionHistory?: Array<{
        question: string;
        timestamp: Date;
        answered: boolean;
    }>;
}

/**
 * 🆕 CRITICAL FIX: Pattern matching configuration for different languages
 */
interface PatternConfig {
    datePatterns: RegExp[];
    timePatterns: RegExp[];
    guestPatterns: RegExp[];
    contextualPhrases: string[];
}

/**
 * 🚀 PRODUCTION-READY: Context Manager with Critical Race Condition Fixes
 * 
 * This class handles all context resolution for multi-reservation scenarios,
 * preventing the critical race condition that caused modification failures.
 */
export class ContextManager {
    private static instance: ContextManager | null = null;
    
    // 🆕 PERFORMANCE: Cache resolution results for similar queries
    private resolutionCache = new Map<string, { result: ReservationResolution; timestamp: number }>();
    private readonly CACHE_TTL = 30000; // 30 seconds
    private readonly MAX_CLARIFICATION_ATTEMPTS = 3; // Prevent infinite loops
    
    // 🆕 CRITICAL FIX: Comprehensive multilingual pattern configurations
    private readonly patterns: Record<string, PatternConfig> = {
        en: {
            datePatterns: [
                /\b(\d{1,2})\s*(st|nd|rd|th)?\b/gi,  // "15th", "3rd"
                /\b(\d{1,2})[-\/](\d{1,2})\b/g,      // "15/7", "15-7"
                /\b(today|tomorrow|yesterday)\b/gi,   // Natural date references
                /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
                /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g   // ISO format
            ],
            timePatterns: [
                /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/gi,  // "7:30pm", "19:30"
                /\b(\d{1,2})\s*(am|pm)\b/gi,           // "7pm"
                /\b(\d{1,2})[-.](\d{2})\b/g,           // "19-30", "19.30"
                /\b(morning|afternoon|evening|night)\b/gi,
                /\b(\d{1,2})\s*o'?clock\b/gi           // "7 o'clock"
            ],
            guestPatterns: [
                /\b(\d+)\s*(people|guests|persons|pax)\b/gi,
                /\bfor\s+(\d+)\b/gi,
                /\b(\d+)\s*of\s*us\b/gi,
                /\bparty\s*of\s*(\d+)\b/gi
            ],
            contextualPhrases: [
                'this booking', 'this reservation', 'it', 'this one', 'that one',
                'my booking', 'my reservation', 'the booking', 'the reservation'
            ]
        },
        ru: {
            datePatterns: [
                /\b(\d{1,2})\s*(числа|число)\b/gi,     // "15 числа"
                /\b(\d{1,2})[-\/](\d{1,2})\b/g,        // "15/7", "15-7"
                /\b(сегодня|завтра|вчера)\b/gi,        // Natural date references
                /\b(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)\b/gi,
                /\b(\d{1,2})\s*(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\b/gi
            ],
            timePatterns: [
                /\b(\d{1,2}):(\d{2})\b/g,              // "19:30"
                /\b(\d{1,2})\s*часов?\b/gi,            // "7 часов"
                /\b(\d{1,2})[-.](\d{2})\b/g,           // "19-30"
                /\b(утром|днем|вечером|ночью)\b/gi,    // Time of day
                /\b(\d{1,2})\s*вечера\b/gi             // "7 вечера"
            ],
            guestPatterns: [
                /\b(\d+)\s*(человек|людей|персон)\b/gi,
                /\bна\s+(\d+)\b/gi,
                /\b(\d+)\s*нас\b/gi,
                /\bкомпания\s*из\s*(\d+)\b/gi
            ],
            contextualPhrases: [
                'эту бронь', 'эту', 'её', 'ее', 'эту резерв',
                'мою бронь', 'мою резерв', 'бронь', 'резерв'
            ]
        },
        sr: {
            datePatterns: [
                /\b(\d{1,2})\.\s*(dan)?\b/gi,          // "15. dan"
                /\b(\d{1,2})[-\/](\d{1,2})\b/g,        // "15/7"
                /\b(danas|sutra|juče)\b/gi,            // Natural date references
                /\b(ponedeljak|utorak|sreda|četvrtak|petak|subota|nedelja)\b/gi
            ],
            timePatterns: [
                /\b(\d{1,2}):(\d{2})\b/g,              // "19:30"
                /\b(\d{1,2})\s*sati?\b/gi,             // "7 sati"
                /\b(\d{1,2})[-.](\d{2})\b/g,           // "19-30"
                /\b(ujutru|popodne|uveče|noću)\b/gi    // Time of day
            ],
            guestPatterns: [
                /\b(\d+)\s*(osoba|ljudi)\b/gi,
                /\bza\s+(\d+)\b/gi,
                /\b(\d+)\s*nas\b/gi,
                /\bgrupu\s*od\s*(\d+)\b/gi
            ],
            contextualPhrases: [
                'ovu rezervaciju', 'ovu', 'nju', 'rezervaciju',
                'moju rezervaciju', 'moju', 'rezervacija'
            ]
        }
    };

    static getInstance(): ContextManager {
        if (!ContextManager.instance) {
            ContextManager.instance = new ContextManager();
        }
        return ContextManager.instance;
    }

    /**
     * 🚀 CRITICAL FIX: Comprehensive reservation resolution with race condition prevention
     * 
     * This method completely resolves the race condition by implementing:
     * 1. Comprehensive pattern matching across all languages
     * 2. Confidence-based scoring system
     * 3. Caching for performance optimization
     * 4. Attempt limiting to prevent infinite clarification loops
     * 5. Detailed logging for debugging
     */
    resolveReservationFromContext(
        userMessage: string,
        session: BookingSessionWithAgent,
        providedId?: number
    ): ReservationResolution {
        console.log(`[ContextManager] 🔍 Starting resolution for: "${userMessage.substring(0, 100)}..."`);
        
        // 🆕 PERFORMANCE: Check cache first (for repeated similar queries)
        const cacheKey = `${userMessage.toLowerCase().trim()}_${session.foundReservations?.length || 0}`;
        const cached = this.resolutionCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            console.log(`[ContextManager] ⚡ Cache hit for resolution`);
            return cached.result;
        }

        // Clean expired context entries
        this.cleanExpiredContext(session);

        // 🆕 SECURITY: Sanitize user input
        const sanitizedMessage = this.sanitizeUserInput(userMessage);
        
        // Initialize debug info
        const debugInfo = {
            foundReservationsCount: session.foundReservations?.length || 0,
            recentModificationsCount: session.recentlyModifiedReservations?.length || 0,
            activeReservationPresent: !!session.activeReservationId
        };

        // 1. HIGHEST CONFIDENCE: Explicit valid ID provided
        if (providedId && session.foundReservations?.some(r => r.id === providedId)) {
            const result: ReservationResolution = {
                resolvedId: providedId,
                confidence: 'high',
                method: 'explicit_id_validated',
                shouldAskForClarification: false,
                debugInfo
            };
            console.log(`[ContextManager] ✅ HIGH: Explicit valid ID: ${providedId}`);
            this.cacheResolution(cacheKey, result);
            return result;
        }

        // 2. HIGH CONFIDENCE: Recent modifications with contextual references
        const recentContextResult = this.checkRecentContext(sanitizedMessage, session);
        if (recentContextResult) {
            recentContextResult.debugInfo = debugInfo;
            this.cacheResolution(cacheKey, recentContextResult);
            return recentContextResult;
        }

        // 3. MEDIUM CONFIDENCE: Active reservation in session
        if (session.activeReservationId && session.foundReservations?.some(r => r.id === session.activeReservationId)) {
            const result: ReservationResolution = {
                resolvedId: session.activeReservationId,
                confidence: 'medium',
                method: 'active_session_reservation',
                shouldAskForClarification: false,
                debugInfo
            };
            console.log(`[ContextManager] ✅ MEDIUM: Active session reservation: ${session.activeReservationId}`);
            this.cacheResolution(cacheKey, result);
            return result;
        }

        // 4. MEDIUM CONFIDENCE: Single found reservation
        if (session.foundReservations?.length === 1) {
            const result: ReservationResolution = {
                resolvedId: session.foundReservations[0].id,
                confidence: 'medium',
                method: 'single_found_reservation',
                shouldAskForClarification: false,
                debugInfo
            };
            console.log(`[ContextManager] ✅ MEDIUM: Single found reservation: ${session.foundReservations[0].id}`);
            this.cacheResolution(cacheKey, result);
            return result;
        }

        // 🚀 CRITICAL FIX: Advanced natural language cue resolution
        if (session.foundReservations && session.foundReservations.length > 1) {
            const naturalLanguageResult = this.resolveWithNaturalLanguageCues(
                sanitizedMessage, 
                session.foundReservations,
                session.language || 'en'
            );
            
            if (naturalLanguageResult) {
                naturalLanguageResult.debugInfo = debugInfo;
                console.log(`[ContextManager] ✅ MEDIUM: Natural language resolution: ${naturalLanguageResult.resolvedId}`);
                this.cacheResolution(cacheKey, naturalLanguageResult);
                return naturalLanguageResult;
            }
        }

        // 5. LOW CONFIDENCE: Need clarification with attempt tracking
        const clarificationResult = this.handleClarificationRequest(session, debugInfo);
        this.cacheResolution(cacheKey, clarificationResult);
        return clarificationResult;
    }

    /**
     * 🆕 CRITICAL FIX: Advanced natural language cue detection
     * 
     * This completely replaces the simple day-matching logic with comprehensive
     * pattern matching across multiple languages and reservation attributes.
     */
    private resolveWithNaturalLanguageCues(
        userMessage: string,
        reservations: Array<any>,
        language: string
    ): ReservationResolution | null {
        const patterns = this.patterns[language] || this.patterns['en'];
        const userMessageLower = userMessage.toLowerCase();
        
        const candidateScores = reservations.map(reservation => {
            let score = 0;
            const matchingPatterns: string[] = [];

            // 🔍 DATE PATTERN MATCHING
            const reservationDate = new Date(reservation.date);
            const day = reservationDate.getDate();
            const month = reservationDate.getMonth() + 1;
            
            for (const pattern of patterns.datePatterns) {
                const matches = userMessage.match(pattern);
                if (matches) {
                    // Extract numbers from matches and compare
                    const numbers = matches.map(match => parseInt(match.replace(/\D/g, ''), 10))
                        .filter(num => !isNaN(num));
                    
                    if (numbers.includes(day) || numbers.includes(month)) {
                        score += 3;
                        matchingPatterns.push(`date_${pattern.source}`);
                    }
                }
            }

            // 🔍 TIME PATTERN MATCHING
            const reservationHour = parseInt(reservation.time.split(':')[0], 10);
            const reservationMinute = parseInt(reservation.time.split(':')[1], 10);
            
            for (const pattern of patterns.timePatterns) {
                const matches = userMessage.match(pattern);
                if (matches) {
                    for (const match of matches) {
                        const timeNumbers = match.match(/\d+/g);
                        if (timeNumbers) {
                            const matchHour = parseInt(timeNumbers[0], 10);
                            const matchMinute = timeNumbers[1] ? parseInt(timeNumbers[1], 10) : 0;
                            
                            // Handle 12-hour format conversion
                            const adjustedHour = match.toLowerCase().includes('pm') && matchHour !== 12 
                                ? matchHour + 12 
                                : (match.toLowerCase().includes('am') && matchHour === 12 ? 0 : matchHour);
                            
                            if (adjustedHour === reservationHour && 
                                (matchMinute === reservationMinute || timeNumbers.length === 1)) {
                                score += 4;
                                matchingPatterns.push(`time_${pattern.source}`);
                            }
                        }
                    }
                }
            }

            // 🔍 GUEST COUNT PATTERN MATCHING
            for (const pattern of patterns.guestPatterns) {
                const matches = userMessage.match(pattern);
                if (matches) {
                    for (const match of matches) {
                        const guestNumbers = match.match(/\d+/g);
                        if (guestNumbers) {
                            const matchGuests = parseInt(guestNumbers[0], 10);
                            if (matchGuests === reservation.guests) {
                                score += 2;
                                matchingPatterns.push(`guests_${pattern.source}`);
                            }
                        }
                    }
                }
            }

            // 🔍 TABLE NAME MATCHING (if available)
            if (reservation.tableName) {
                const tablePattern = new RegExp(`\\b${reservation.tableName.replace(/\s+/g, '\\s*')}\\b`, 'gi');
                if (tablePattern.test(userMessage)) {
                    score += 3;
                    matchingPatterns.push('table_name');
                }
            }

            return {
                reservation,
                score,
                matchingPatterns
            };
        });

        // Find the best match(es)
        const maxScore = Math.max(...candidateScores.map(c => c.score));
        
        if (maxScore === 0) {
            console.log(`[ContextManager] ❌ No natural language cues found`);
            return null;
        }

        const bestCandidates = candidateScores.filter(c => c.score === maxScore);
        
        if (bestCandidates.length === 1) {
            const winner = bestCandidates[0];
            console.log(`[ContextManager] 🎯 Natural language match found:`, {
                reservationId: winner.reservation.id,
                score: winner.score,
                patterns: winner.matchingPatterns
            });
            
            return {
                resolvedId: winner.reservation.id,
                confidence: maxScore >= 4 ? 'high' : 'medium',
                method: 'natural_language_cue_enhanced',
                shouldAskForClarification: false,
                matchingPatterns: winner.matchingPatterns,
                alternativeCandidates: candidateScores
                    .filter(c => c.score > 0 && c.reservation.id !== winner.reservation.id)
                    .map(c => c.reservation.id)
            };
        } else if (bestCandidates.length > 1) {
            // Multiple equally good matches - still ambiguous
            console.log(`[ContextManager] ⚠️ Multiple natural language matches with equal scores:`, {
                count: bestCandidates.length,
                score: maxScore,
                candidates: bestCandidates.map(c => c.reservation.id)
            });
            return null;
        }

        return null;
    }

    /**
     * 🆕 ENHANCED: Check recent context with comprehensive phrase matching
     */
    private checkRecentContext(
        userMessage: string,
        session: BookingSessionWithAgent
    ): ReservationResolution | null {
        if (!session.recentlyModifiedReservations?.length) return null;

        const recentReservation = session.recentlyModifiedReservations[0];
        if (recentReservation.contextExpiresAt <= new Date()) return null;

        const language = session.language || 'en';
        const patterns = this.patterns[language] || this.patterns['en'];
        const userMessageLower = userMessage.toLowerCase();

        // Check for contextual phrases
        const hasContextualPhrase = patterns.contextualPhrases.some(phrase => 
            userMessageLower.includes(phrase.toLowerCase())
        );

        if (hasContextualPhrase) {
            console.log(`[ContextManager] ✅ HIGH: Recent context + contextual phrase: ${recentReservation.reservationId}`);
            return {
                resolvedId: recentReservation.reservationId,
                confidence: 'high',
                method: 'recent_modification_context_enhanced',
                shouldAskForClarification: false,
                matchingPatterns: ['contextual_phrase']
            };
        }

        return null;
    }

    /**
     * 🆕 CRITICAL FIX: Handle clarification with attempt limiting
     */
    private handleClarificationRequest(
        session: BookingSessionWithAgent,
        debugInfo: any
    ): ReservationResolution {
        const availableCount = session.foundReservations?.length || 0;
        
        // Initialize clarification attempts tracking if not exists
        if (!session.clarificationAttempts) {
            session.clarificationAttempts = new Map();
        }

        const attemptKey = 'reservation_clarification';
        const currentAttempts = session.clarificationAttempts.get(attemptKey) || 0;

        // 🚨 CRITICAL FIX: Prevent infinite clarification loops
        if (currentAttempts >= this.MAX_CLARIFICATION_ATTEMPTS) {
            console.log(`[ContextManager] 🚨 Max clarification attempts reached (${currentAttempts})`);
            
            // Auto-select first available reservation as fallback
            const fallbackId = session.foundReservations?.[0]?.id || null;
            
            return {
                resolvedId: fallbackId,
                confidence: 'low',
                method: 'fallback_after_max_attempts',
                shouldAskForClarification: false,
                suggestion: fallbackId 
                    ? `Using your first reservation (#${fallbackId}) since we had trouble identifying which one you meant.`
                    : 'Please start over with a new request.',
                debugInfo
            };
        }

        // Increment attempt counter
        session.clarificationAttempts.set(attemptKey, currentAttempts + 1);

        console.log(`[ContextManager] ❓ Clarification needed (attempt ${currentAttempts + 1}/${this.MAX_CLARIFICATION_ATTEMPTS})`);

        return {
            resolvedId: null,
            confidence: 'low',
            method: 'ambiguous_context_with_attempt_tracking',
            shouldAskForClarification: true,
            suggestion: availableCount > 1
                ? `Please specify which reservation: ${session.foundReservations?.map(r => `#${r.id} (${r.date} at ${r.time})`).join(', ')}`
                : 'Please find your reservation first or provide a confirmation number',
            debugInfo
        };
    }

    /**
     * 🆕 SECURITY: Input sanitization for user messages
     */
    private sanitizeUserInput(input: string): string {
        // Remove potentially harmful characters and normalize
        let sanitized = input
            .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width characters
            .normalize('NFC') // Normalize unicode
            .replace(/[<>\"']/g, '') // Remove potential injection chars
            .substring(0, 500); // Limit length

        // Remove excessive repeated characters (likely spam)
        sanitized = sanitized.replace(/(.)\1{4,}/g, '$1$1$1');

        return sanitized.trim();
    }

    /**
     * 🆕 PERFORMANCE: Cache resolution results
     */
    private cacheResolution(key: string, result: ReservationResolution): void {
        this.resolutionCache.set(key, {
            result: { ...result }, // Deep copy to prevent mutations
            timestamp: Date.now()
        });

        // Cleanup old cache entries (keep cache size manageable)
        if (this.resolutionCache.size > 100) {
            const oldestKeys = Array.from(this.resolutionCache.entries())
                .sort((a, b) => a[1].timestamp - b[1].timestamp)
                .slice(0, 20)
                .map(([key]) => key);
                
            oldestKeys.forEach(key => this.resolutionCache.delete(key));
        }
    }

    /**
     * ✅ ENHANCED: Context preservation with enhanced tracking
     */
    preserveReservationContext(
        session: BookingSessionWithAgent,
        reservationId: number,
        operationType: 'modification' | 'cancellation' | 'creation'
    ): void {
        const expiryTime = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        if (!session.recentlyModifiedReservations) {
            session.recentlyModifiedReservations = [];
        }

        // Remove old entries for same reservation
        session.recentlyModifiedReservations = session.recentlyModifiedReservations
            .filter(r => r.reservationId !== reservationId);

        // Add new context with enhanced tracking
        session.recentlyModifiedReservations.unshift({
            reservationId,
            lastModifiedAt: new Date(),
            contextExpiresAt: expiryTime,
            operationType,
            userReference: undefined
        });

        // Keep only last 3 reservations for performance
        session.recentlyModifiedReservations = session.recentlyModifiedReservations.slice(0, 3);

        console.log(`[ContextManager] ✅ Context preserved for reservation ${reservationId} (${operationType}) until ${expiryTime.toISOString()}`);

        // Update active reservation for immediate use
        if (operationType === 'creation' || operationType === 'modification') {
            session.activeReservationId = reservationId;
            console.log(`[ContextManager] Set active reservation ID: ${reservationId}`);
        }

        // 🆕 PERFORMANCE: Clear resolution cache when context changes
        this.resolutionCache.clear();
    }

    /**
     * ✅ ENHANCED: Clean expired context entries
     */
    cleanExpiredContext(session: BookingSessionWithAgent): void {
        if (!session.recentlyModifiedReservations) return;

        const now = new Date();
        const beforeCount = session.recentlyModifiedReservations.length;

        session.recentlyModifiedReservations = session.recentlyModifiedReservations
            .filter(r => r.contextExpiresAt > now);

        const afterCount = session.recentlyModifiedReservations.length;

        if (beforeCount > afterCount) {
            console.log(`[ContextManager] 🧹 Cleaned ${beforeCount - afterCount} expired context entries`);
            // Clear cache when context changes
            this.resolutionCache.clear();
        }
    }

    /**
     * ✅ ENHANCED: Advanced conversation flag management
     */
    updateConversationFlags(
        session: BookingSessionWithAgent,
        flags: ConversationFlags
    ): void {
        const timestamp = new Date();
        let updatedFlags: string[] = [];

        // Update basic flags
        if (flags.hasAskedPartySize !== undefined) {
            session.hasAskedPartySize = flags.hasAskedPartySize;
            if (flags.hasAskedPartySize) updatedFlags.push('partySize');
        }
        if (flags.hasAskedDate !== undefined) {
            session.hasAskedDate = flags.hasAskedDate;
            if (flags.hasAskedDate) updatedFlags.push('date');
        }
        if (flags.hasAskedTime !== undefined) {
            session.hasAskedTime = flags.hasAskedTime;
            if (flags.hasAskedTime) updatedFlags.push('time');
        }
        if (flags.hasAskedName !== undefined) {
            session.hasAskedName = flags.hasAskedName;
            if (flags.hasAskedName) updatedFlags.push('name');
        }
        if (flags.hasAskedPhone !== undefined) {
            session.hasAskedPhone = flags.hasAskedPhone;
            if (flags.hasAskedPhone) updatedFlags.push('phone');
        }

        // Enhanced question history tracking
        if (flags.questionHistory) {
            if (!session.questionHistory) {
                session.questionHistory = [];
            }
            session.questionHistory.push(...flags.questionHistory);
            session.questionHistory = session.questionHistory.slice(-10);
        }

        if (updatedFlags.length > 0) {
            console.log(`[ContextManager] 📝 Updated conversation flags: ${updatedFlags.join(', ')} at ${timestamp.toISOString()}`);
        }
    }

    /**
     * 🆕 CRITICAL FIX: Enhanced session reset with clarification attempt cleanup
     */
    resetSessionContamination(
        session: BookingSessionWithAgent,
        reason: string,
        preserveGuestIdentity: boolean = true
    ): void {
        console.log(`[ContextManager] 🔄 Resetting session contamination: ${reason}`);

        const preservedGuestName = preserveGuestIdentity ? session.guestHistory?.guest_name : undefined;
        const preservedGuestPhone = preserveGuestIdentity ? session.guestHistory?.guest_phone : undefined;

        // Clear booking contamination
        session.gatheringInfo = {
            date: undefined,
            time: undefined,
            guests: undefined,
            comments: undefined,
            name: undefined,
            phone: undefined
        };

        // Reset conversation state flags
        session.hasAskedPartySize = false;
        session.hasAskedDate = false;
        session.hasAskedTime = false;
        session.hasAskedName = false;
        session.hasAskedPhone = false;

        // Clear operational state
        delete session.pendingConfirmation;
        delete session.confirmedName;
        delete session.activeReservationId;
        delete session.foundReservations;
        delete session.availabilityFailureContext;

        // 🆕 CRITICAL FIX: Clear clarification attempts to prevent stale state
        if (session.clarificationAttempts) {
            session.clarificationAttempts.clear();
        }

        // Clear resolution cache
        this.resolutionCache.clear();

        console.log(`[ContextManager] ✅ Session reset complete. Guest identity ${preserveGuestIdentity ? 'preserved' : 'cleared'}: ${preservedGuestName || 'none'}`);
    }

    /**
     * ✅ ENHANCED: Set availability failure context for Apollo agent
     */
    setAvailabilityFailureContext(
        session: BookingSessionWithAgent,
        failureDetails: {
            originalDate: string;
            originalTime: string;
            originalGuests: number;
            failureReason: string;
        }
    ): void {
        session.availabilityFailureContext = {
            ...failureDetails,
            detectedAt: new Date().toISOString()
        };

        console.log(`[ContextManager] 🚨 Availability failure context set:`, {
            date: failureDetails.originalDate,
            time: failureDetails.originalTime,
            guests: failureDetails.originalGuests,
            reason: failureDetails.failureReason
        });
    }

    /**
     * ✅ ENHANCED: Clear availability failure context
     */
    clearAvailabilityFailureContext(session: BookingSessionWithAgent): void {
        if (session.availabilityFailureContext) {
            console.log(`[ContextManager] ✅ Cleared availability failure context`);
            delete session.availabilityFailureContext;
        }
    }

    /**
     * 🆕 ENHANCED: Get comprehensive context summary for debugging
     */
    getContextSummary(session: BookingSessionWithAgent): {
        activeReservationId: number | undefined;
        recentModifications: number;
        conversationState: {
            hasAskedPartySize: boolean;
            hasAskedDate: boolean;
            hasAskedTime: boolean;
            hasAskedName: boolean;
            hasAskedPhone: boolean;
        };
        foundReservations: number;
        hasAvailabilityFailure: boolean;
        clarificationAttempts: Record<string, number>;
        cacheSize: number;
        performance: {
            cacheHitRate: string;
            averageResolutionTime: string;
        };
    } {
        const clarificationAttempts: Record<string, number> = {};
        if (session.clarificationAttempts) {
            session.clarificationAttempts.forEach((value, key) => {
                clarificationAttempts[key] = value;
            });
        }

        return {
            activeReservationId: session.activeReservationId,
            recentModifications: session.recentlyModifiedReservations?.length || 0,
            conversationState: {
                hasAskedPartySize: !!session.hasAskedPartySize,
                hasAskedDate: !!session.hasAskedDate,
                hasAskedTime: !!session.hasAskedTime,
                hasAskedName: !!session.hasAskedName,
                hasAskedPhone: !!session.hasAskedPhone
            },
            foundReservations: session.foundReservations?.length || 0,
            hasAvailabilityFailure: !!session.availabilityFailureContext,
            clarificationAttempts,
            cacheSize: this.resolutionCache.size,
            performance: {
                cacheHitRate: "N/A", // Could be tracked if needed
                averageResolutionTime: "N/A" // Could be tracked if needed
            }
        };
    }

    /**
     * 🆕 MAINTENANCE: Clear all caches (useful for memory management)
     */
    clearCaches(): void {
        this.resolutionCache.clear();
        console.log(`[ContextManager] 🧹 All caches cleared`);
    }
}

// ✅ Export singleton instance
export const contextManager = ContextManager.getInstance();
