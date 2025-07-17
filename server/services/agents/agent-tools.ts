// server/services/agents/agent-tools.ts
// ✅ PHASE 1 INTEGRATION COMPLETE: Using centralized AIService
// 🔧 BUG FIX: Fixed cancel_reservation tool definition to make confirmCancellation optional
// ✅ STEP 3A COMPLETE: Context Manager function calls replaced
// ✅ FIXES IMPLEMENTED: Workflow validation + Enhanced tool descriptions
// 🚨 CRITICAL VALIDATION ENHANCEMENT: Comprehensive input validation pipeline as per original plan
// 🚨 NEW: validateBookingInput() function with field-by-field validation
// 🚨 NEW: validateBusinessHours() function with timezone support
// 🚨 NEW: Enhanced past-date validation with grace period
// 🚨 NEW: Complete input sanitization for all booking parameters
// 🐛 BUG FIX: Modified validateBookingInput to conditionally skip name/phone checks for availability calls.
// 🚀 REDIS PHASE 3: Guest history caching with cache invalidation and performance monitoring
// 🐞 BUG FIX (OVERNIGHT BOOKING): Corrected the logic in validateBusinessHours to properly handle overnight operations.

import { aiService } from '../ai-service';
// ✅ STEP 3A: Using ContextManager for all context resolution
import { contextManager } from '../context-manager';
import { getAvailableTimeSlots } from '../availability.service';
import { createTelegramReservation } from '../telegram_booking';
import { storage } from '../../storage';
import type { Restaurant } from '@shared/schema';
import { DateTime } from 'luxon';
import {
    getRestaurantDateTime,
    getRestaurantTimeContext,
    isRestaurantOpen,
    getRestaurantOperatingStatus,
    formatRestaurantTime24Hour,
    isValidTimezone,
    isOvernightOperation
} from '../../utils/timezone-utils';
import type { Language } from '../enhanced-conversation-manager';

// 🚀 REDIS PHASE 3: Import Redis service for guest history caching
import { redisService } from '../redis-service';

// ✅ FIX: Import the Drizzle 'db' instance, schema definitions, and ORM operators
import { db } from '../../db';
import { eq, and, gt, lt, gte, like, inArray, sql, desc, ne } from 'drizzle-orm';
// ✅ FIX: Use the correct camelCase table names from your schema
import {
    reservations,
    guests,
    tables,
    reservationModifications,
    reservationCancellations
} from '@shared/schema';

// =================================================================================
// 🐞 BUG FIX: ADDED HELPER FUNCTION
// The 'parseTimeToMinutes' function was needed by the corrected business hours
// validation but was not available in this file. It has been added here.
// =================================================================================
function parseTimeToMinutes(timeStr: string | null | undefined): number | null {
    if (!timeStr) return null;
    const parts = timeStr.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10) || 0;

    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }
    return hours * 60 + minutes;
}
// =================================================================================
// END OF HELPER FUNCTION
// =================================================================================


/**
 * ✅ PHASE 1 FIX: Extended session interface for context resolution
 */
interface BookingSessionWithAgent {
    telegramUserId?: string;
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
    recentlyModifiedReservations?: Array<{
        reservationId: number;
        lastModifiedAt: Date;
        contextExpiresAt: Date;
        operationType: 'modification' | 'cancellation' | 'creation';
        userReference?: string;
    }>;
    currentOperationContext?: {
        type: 'modification' | 'cancellation' | 'lookup';
        targetReservationId?: number;
        lastUserReference?: string;
        confidenceLevel: 'high' | 'medium' | 'low';
        contextSource: 'explicit_id' | 'recent_modification' | 'found_reservation';
    };
    // ✅ FIX #4: Add conversation history and guest history for validation
    conversationHistory?: Array<{
        role: 'user' | 'assistant';
        content: string;
        timestamp: Date;
    }>;
    guestHistory?: {
        guest_name: string;
        guest_phone: string;
        total_bookings: number;
        frequent_special_requests: string[];
    } | null;
    timezone?: string; // 🚨 NEW: Restaurant timezone for validation
}

/**
 * ✅ PHASE 1 FIX: Translation Service using AIService
 */
class AgentToolTranslationService {
    static async translateToolMessage(
        message: string,
        targetLanguage: Language,
        context: 'error' | 'success' | 'info' = 'info'
    ): Promise<string> {
        if (targetLanguage === 'en' || targetLanguage === 'auto') return message;

        const languageNames: Record<Language, string> = {
            'en': 'English', 'ru': 'Russian', 'sr': 'Serbian', 'hu': 'Hungarian',
            'de': 'German', 'fr': 'French', 'es': 'Spanish', 'it': 'Italian',
            'pt': 'Portuguese', 'nl': 'Dutch', 'auto': 'English'
        };

        const prompt = `Translate this restaurant tool message to ${languageNames[targetLanguage]}:

"${message}"

Context: ${context} message from restaurant booking system tools
Keep the same tone and professional style.
Return only the translation, no explanations.`;

        try {
            // ✅ USE AISERVICE: Fast translation with automatic fallback
            const translation = await aiService.generateContent(prompt, {
                model: 'haiku', // Fast and cost-effective for translation
                maxTokens: 300,
                temperature: 0.2,
                context: `agent-tool-translation-${context}`
            });

            return translation;
        } catch (error) {
            console.error('[AgentToolTranslation] Error:', error);
            return message; // Fallback to original
        }
    }
}

/**
 * ✅ CRITICAL LANGUAGE BUG FIX: AI Analysis Service using AIService with English output enforcement
 */
class AgentAIAnalysisService {
    /**
     * ✅ CRITICAL LANGUAGE BUG FIXED: Enhanced AI analysis that ALWAYS returns English results
     */
    static async analyzeSpecialRequests(
        completedReservations: Array<{ comments: string | null }>,
        guestName: string
    ): Promise<string[]> {
        try {
            // Collect all non-empty comments
            const allComments = completedReservations
                .map(r => r.comments?.trim())
                .filter(Boolean);

            if (allComments.length === 0) {
                return [];
            }

            const prompt = `You are analyzing restaurant reservation comments to identify SPECIFIC recurring special requests patterns for a returning guest.

GUEST: ${guestName}
TOTAL RESERVATIONS: ${completedReservations.length}
COMMENTS TO ANALYZE:
${allComments.map((comment, i) => `${i + 1}. "${comment}"`).join('\n')}

CRITICAL RULES FOR ANALYSIS:
1. ❌ IGNORE generic/obvious patterns like "meal requests", "dinner", "food", "dining" - these are USELESS for personalization
2. ❌ IGNORE single-word generic requests like "meal", "food", "table", "reservation"
3. ✅ ONLY identify SPECIFIC, ACTIONABLE patterns that help restaurant staff provide better service
4. ✅ Must appear in at least 2 different reservations OR represent 30%+ of total reservations
5. ✅ Focus on things that would genuinely be useful for restaurant staff to know in advance

EXAMPLES OF GOOD PATTERNS TO IDENTIFY:
- "window table preferred" (seating preference)
- "vegetarian options needed" (dietary requirement)
- "high chair required" (family needs)
- "quiet corner table" (ambiance preference)
- "celebrates anniversaries here" (special occasions)
- "prefers early dinner timing" (timing preference)
- "requests birthday decorations" (celebration pattern)
- "likes wine pairing suggestions" (service preference)

EXAMPLES OF BAD PATTERNS TO REJECT:
❌ "meal requests" (too generic and useless)
❌ "wants to eat" (obvious and useless)
❌ "dinner reservation" (redundant)
❌ "table booking" (meaningless)
❌ "restaurant visit" (useless)
❌ "food" (generic)
❌ "meal" (generic)

RESPONSE FORMAT: Return ONLY a valid JSON object:
{
  "patterns": ["specific pattern 1", "specific pattern 2"],
  "reasoning": "Brief explanation focusing on why these patterns are useful for staff"
}

✅ CRITICAL LANGUAGE RULE: You MUST return the identified "patterns" in ENGLISH language, regardless of the language of the source comments. This is essential for our translation system to work properly. Even if the input comments are in Russian, Serbian, Hungarian, or any other language, the output patterns must be in English.

If no genuinely useful patterns emerge, return: {"patterns": [], "reasoning": "No actionable recurring patterns found"}`;

            // ✅ USE AISERVICE: Enhanced AI analysis with automatic fallback
            const responseText = await aiService.generateContent(prompt, {
                model: 'haiku', // Fast and cost-effective for analysis
                maxTokens: 1000,
                temperature: 0.2,
                context: 'SpecialRequestAnalysis'
            });

            // Parse the JSON response
            const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            let analysis: { patterns: string[]; reasoning: string };

            try {
                analysis = JSON.parse(cleanJson);
            } catch (parseError) {
                console.warn('[SpecialRequestAnalysis] Failed to parse AIService response, using fallback logic');
                return this.fallbackKeywordAnalysis(allComments);
            }

            // Validate and clean the results
            const validPatterns = Array.isArray(analysis.patterns)
                ? analysis.patterns
                    .filter(p => typeof p === 'string' && p.length > 0 && p.length < 100)
                    .filter(p => !this.isGenericPattern(p)) // ✅ CRITICAL: Filter out generic patterns
                    .slice(0, 3) // Max 3 patterns to keep focused
                : [];

            console.log(`🤖 [SpecialRequestAnalysis] AIService identified ${validPatterns.length} useful patterns for ${guestName}:`, validPatterns);
            console.log(`🤖 [SpecialRequestAnalysis] AIService reasoning: ${analysis.reasoning}`);
            console.log(`✅ [Language Fix] Patterns should now be in English:`, validPatterns);
            return validPatterns;

        } catch (error) {
            console.error('[SpecialRequestAnalysis] AIService analysis failed:', error);
            // Fallback to keyword-based analysis
            return this.fallbackKeywordAnalysis(allComments);
        }
    }

    /**
     * ✅ CRITICAL FIX: Filter out generic/useless patterns
     */
    private static isGenericPattern(pattern: string): boolean {
        const genericTerms = [
            'meal', 'food', 'dinner', 'lunch', 'breakfast', 'dining', 'eat', 'restaurant',
            'table', 'booking', 'reservation', 'visit', 'request', 'service', 'general',
            'requests', 'needs', 'wants', 'order', 'orders'
        ];

        const lowerPattern = pattern.toLowerCase();

        // Reject if it's just a generic term or contains mostly generic terms
        if (genericTerms.some(term => lowerPattern === term)) {
            return true;
        }

        // Reject patterns that are too short and generic
        if (lowerPattern.length < 15 && genericTerms.some(term => lowerPattern.includes(term))) {
            return true;
        }

        return false;
    }

    /**
     * ✅ Enhanced fallback keyword analysis with better patterns (returns English patterns)
     */
    private static fallbackKeywordAnalysis(allComments: string[]): string[] {
        const requestCounts: Record<string, number> = {};

        // Much more specific patterns focused on actionable preferences
        const patterns = [
            { keywords: ['window', 'окно', 'prozor'], request: 'window seating preference' },
            { keywords: ['quiet', 'тихо', 'mirno', 'csendes'], request: 'quiet table preference' },
            { keywords: ['corner', 'угол', 'ćošak', 'sarok'], request: 'corner table preference' },
            { keywords: ['high chair', 'детск', 'deca', 'gyerek'], request: 'family dining needs' },
            { keywords: ['birthday', 'день рождения', 'rođendan', 'születés'], request: 'birthday celebrations' },
            { keywords: ['anniversary', 'годовщина', 'obljetnica', 'évforduló'], request: 'anniversary celebrations' },
            { keywords: ['vegetarian', 'vegan', 'вегетар', 'vegetáriánus'], request: 'vegetarian dietary needs' },
            { keywords: ['allergy', 'allergic', 'аллерг', 'allergiás'], request: 'allergy considerations' },
            { keywords: ['wheelchair', 'accessible', 'инвалид', 'akadálymentes'], request: 'accessibility needs' },
            { keywords: ['business', 'meeting', 'work', 'деловой', 'üzleti'], request: 'business dining atmosphere' },
            { keywords: ['wine', 'вино', 'vino', 'bor'], request: 'wine service preferences' },
            { keywords: ['early', 'рано', 'rano', 'korai'], request: 'early dining preference' }
        ];

        allComments.forEach(comment => {
            const lowerComment = comment.toLowerCase();
            patterns.forEach(pattern => {
                if (pattern.keywords.some(keyword => lowerComment.includes(keyword))) {
                    requestCounts[pattern.request] = (requestCounts[pattern.request] || 0) + 1;
                }
            });
        });

        // Only include requests that appear in at least 2 reservations or 30% of comments
        const minOccurrences = Math.max(2, Math.ceil(allComments.length * 0.3));
        const frequentRequests = Object.entries(requestCounts)
            .filter(([, count]) => count >= minOccurrences)
            .map(([request]) => request);

        console.log(`🔄 [SpecialRequestAnalysis] Fallback analysis found ${frequentRequests.length} useful patterns (English):`, frequentRequests);
        return frequentRequests;
    }
}

// 🚀 REDIS PHASE 3: Cache invalidation helper function
async function invalidateGuestHistoryCache(
    context: { restaurantId: number; telegramUserId?: string }
): Promise<void> {
    if (context.telegramUserId) {
        const cacheKey = `guest-history:${context.restaurantId}:${context.telegramUserId}`;

        try {
            const deleted = await redisService.del(cacheKey);

            if (deleted) {
                console.log(`🗑️ [Cache Invalidation] Guest history cache invalidated successfully: ${cacheKey}`);
            } else {
                console.log(`🗑️ [Cache Invalidation] Guest history cache key not found or already expired: ${cacheKey}`);
            }
        } catch (error) {
            console.error(`❌ [Cache Invalidation] Failed to invalidate guest history cache: ${cacheKey}`, error);
        }
    }
}

// ✅ NEW: Standardized tool response interface
interface ToolResponse<T = any> {
    tool_status: 'SUCCESS' | 'FAILURE';
    data?: T;
    error?: {
        type: 'BUSINESS_RULE' | 'SYSTEM_ERROR' | 'VALIDATION_ERROR';
        message: string;
        code?: string;
        details?: any;
    };
    metadata?: {
        execution_time_ms?: number;
        fallback_used?: boolean;
        warnings?: string[];
        cached?: boolean; // 🚀 REDIS PHASE 3: Cache status indicator
    };
}

// ✅ NEW: Helper functions for creating standardized responses
const createSuccessResponse = <T>(data: T, metadata?: ToolResponse['metadata']): ToolResponse<T> => ({
    tool_status: 'SUCCESS',
    data,
    metadata
});

const createFailureResponse = (
    type: ToolResponse['error']['type'],
    message: string,
    code?: string,
    details?: any
): ToolResponse => ({
    tool_status: 'FAILURE',
    error: {
        type,
        message,
        code,
        details
    }
});

const createValidationFailure = (message: string, field?: string): ToolResponse =>
    createFailureResponse('VALIDATION_ERROR', message, 'INVALID_INPUT', { field });

const createBusinessRuleFailure = (message: string, code?: string): ToolResponse =>
    createFailureResponse('BUSINESS_RULE', message, code);

const createSystemError = (message: string, originalError?: any): ToolResponse =>
    createFailureResponse('SYSTEM_ERROR', message, 'SYSTEM_FAILURE', { originalError: originalError?.message });

// 🚨 NEW: Validation result interface as per original plan
interface ValidationResult {
    valid: boolean;
    errorMessage?: string;
    field?: string;
    warningMessage?: string;
}

/**
 * 🚨 CRITICAL NEW FUNCTION: Comprehensive input validation as specified in original plan
 * This implements the validateBookingInput() function that was missing
 */
async function validateBookingInput(input: {
    guestName: string;
    guestPhone: string;
    date: string;
    time: string;
    guests: number;
    specialRequests?: string;
    context: any;
}, isAvailabilityCheck: boolean = false): Promise<ValidationResult> { // 🐛 BUG FIX: Add optional flag
    console.log('🛡️ [validateBookingInput] Starting comprehensive validation:', {
        guestName: input.guestName?.substring(0, 10) + '...',
        guestPhone: input.guestPhone?.substring(0, 6) + '...',
        date: input.date,
        time: input.time,
        guests: input.guests,
        isAvailabilityCheck // Log the flag
    });

    // 🐛 BUG FIX: Conditionally skip name and phone validation for availability checks
    if (!isAvailabilityCheck) {
        // 🚨 Name validation (2+ characters)
        if (!input.guestName || typeof input.guestName !== 'string') {
            return {
                valid: false,
                errorMessage: 'Guest name is required',
                field: 'guestName'
            };
        }

        const trimmedName = input.guestName.trim();
        if (trimmedName.length < 2) {
            return {
                valid: false,
                errorMessage: 'Guest name must be at least 2 characters long',
                field: 'guestName'
            };
        }

        if (trimmedName.length > 100) {
            return {
                valid: false,
                errorMessage: 'Guest name is too long (maximum 100 characters)',
                field: 'guestName'
            };
        }

        // 🚨 Phone validation with comprehensive regex
        if (!input.guestPhone || typeof input.guestPhone !== 'string') {
            return {
                valid: false,
                errorMessage: 'Phone number is required',
                field: 'guestPhone'
            };
        }

        const phoneDigits = input.guestPhone.replace(/\D/g, '');
        if (phoneDigits.length < 7 || phoneDigits.length > 20) {
            return {
                valid: false,
                errorMessage: 'Please provide a valid phone number (7-20 digits)',
                field: 'guestPhone'
            };
        }
    }

    // 🚨 Date validation (YYYY-MM-DD format)
    if (!input.date || typeof input.date !== 'string') {
        return {
            valid: false,
            errorMessage: 'Date is required',
            field: 'date'
        };
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(input.date)) {
        return {
            valid: false,
            errorMessage: 'Date must be in YYYY-MM-DD format (e.g., 2025-07-20)',
            field: 'date'
        };
    }

    // Validate date is a real date
    const parsedDate = DateTime.fromFormat(input.date, 'yyyy-MM-dd');
    if (!parsedDate.isValid) {
        return {
            valid: false,
            errorMessage: 'Invalid date. Please provide a valid calendar date',
            field: 'date'
        };
    }

    // 🚨 Time validation (HH:MM format)
    if (!input.time || typeof input.time !== 'string') {
        return {
            valid: false,
            errorMessage: 'Time is required',
            field: 'time'
        };
    }

    const timeRegex = /^\d{2}:\d{2}$/;
    if (!timeRegex.test(input.time)) {
        return {
            valid: false,
            errorMessage: 'Time must be in HH:MM format (e.g., 19:30)',
            field: 'time'
        };
    }

    // Validate time values are within valid ranges
    const [hours, minutes] = input.time.split(':').map(Number);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return {
            valid: false,
            errorMessage: 'Invalid time. Hours must be 00-23, minutes must be 00-59',
            field: 'time'
        };
    }

    // 🚨 Guests validation (1-50 range)
    if (!input.guests || typeof input.guests !== 'number') {
        return {
            valid: false,
            errorMessage: 'Number of guests is required',
            field: 'guests'
        };
    }

    if (input.guests < 1 || input.guests > 50) {
        return {
            valid: false,
            errorMessage: 'Number of guests must be between 1 and 50',
            field: 'guests'
        };
    }

    if (!Number.isInteger(input.guests)) {
        return {
            valid: false,
            errorMessage: 'Number of guests must be a whole number',
            field: 'guests'
        };
    }

    // 🚨 Special requests validation (optional but with limits)
    if (input.specialRequests && typeof input.specialRequests === 'string') {
        if (input.specialRequests.length > 500) {
            return {
                valid: false,
                errorMessage: 'Special requests are too long (maximum 500 characters)',
                field: 'specialRequests'
            };
        }
    }

    // 🚨 Context validation
    if (!input.context || !input.context.restaurantId) {
        return {
            valid: false,
            errorMessage: 'Restaurant context is required',
            field: 'context'
        };
    }

    if (!input.context.timezone) {
        return {
            valid: false,
            errorMessage: 'Restaurant timezone is required',
            field: 'context'
        };
    }

    // Validate timezone is valid
    if (!isValidTimezone(input.context.timezone)) {
        return {
            valid: false,
            errorMessage: 'Invalid restaurant timezone configuration',
            field: 'context'
        };
    }

    console.log('✅ [validateBookingInput] All basic validation passed');
    return { valid: true };
}


/**
 * 🚨 CRITICAL NEW FUNCTION: Business hours validation as specified in original plan
 */
async function validateBusinessHours(
    time: string,
    date: string,
    context: {
        restaurantId: number;
        timezone: string;
        language?: string;
    }
): Promise<ValidationResult> {
    console.log('🕒 [validateBusinessHours] Validating business hours (CORRECTED LOGIC):', {
        time,
        date,
        timezone: context.timezone
    });

    try {
        // Get restaurant configuration
        const restaurant = await storage.getRestaurant(context.restaurantId);

        if (!restaurant || !restaurant.openingTime || !restaurant.closingTime) {
            return {
                valid: false,
                errorMessage: 'Restaurant business hours are not configured correctly.',
                field: 'restaurant'
            };
        }

        const { openingTime, closingTime } = restaurant;

        // Create a full DateTime object for the user's request in the restaurant's timezone
        const requestedDateTime = DateTime.fromFormat(`${date} ${time}`, 'yyyy-MM-dd HH:mm', {
            zone: context.timezone
        });

        if (!requestedDateTime.isValid) {
            return { valid: false, errorMessage: 'Invalid date or time provided.', field: 'datetime' };
        }

        const isOvernightOp = isOvernightOperation(openingTime, closingTime);
        const operatingHours = `${openingTime} - ${closingTime}${isOvernightOp ? ' (next day)' : ''}`;
        let isWithinBusinessHours: boolean;

        // ===================================================================
        // 🐞 BUG FIX: REVISED OVERNIGHT LOGIC
        // This new block correctly handles overnight operations by creating a
        // continuous time window and avoids the "anchor date" complexity.
        // ===================================================================
        if (isOvernightOp) {
            // For overnight operations, a time is valid if it's either:
            // 1. In the "late part" of the day (from opening time until midnight).
            // 2. In the "early part" of the day (from midnight until closing time).
            const requestedTimeMinutes = requestedDateTime.hour * 60 + requestedDateTime.minute;
            const openingTimeMinutes = parseTimeToMinutes(openingTime);
            const closingTimeMinutes = parseTimeToMinutes(closingTime);

            if (openingTimeMinutes !== null && closingTimeMinutes !== null) {
                // The time is valid if it's after opening OR before closing.
                isWithinBusinessHours = (requestedTimeMinutes >= openingTimeMinutes) || (requestedTimeMinutes < closingTimeMinutes);
            } else {
                // Fallback if time parsing fails
                isWithinBusinessHours = false;
            }

            console.log('🌙 [validateBusinessHours] Corrected Overnight Check:', {
                requested: requestedDateTime.toISO(),
                requestedMinutes: requestedTimeMinutes,
                openingMinutes: openingTimeMinutes,
                closingMinutes: closingTimeMinutes,
                isWithin: isWithinBusinessHours
            });

        } else {
            // ---- STANDARD (Non-Overnight) LOGIC (Remains the same) ----
            const openingDateTime = DateTime.fromFormat(`${date} ${openingTime}`, 'yyyy-MM-dd HH:mm', { zone: context.timezone });
            const closingDateTime = DateTime.fromFormat(`${date} ${closingTime}`, 'yyyy-MM-dd HH:mm', { zone: context.timezone });
            isWithinBusinessHours = requestedDateTime >= openingDateTime && requestedDateTime < closingDateTime;

            console.log('🌅 [validateBusinessHours] Standard operation check:', {
                isWithin: isWithinBusinessHours
            });
        }
        // ===================================================================
        // END OF BUG FIX
        // ===================================================================

        if (!isWithinBusinessHours) {
            const errorMessage = `Requested time ${time} is outside business hours (${operatingHours}). Please choose a time during our operating hours.`;
            return {
                valid: false,
                errorMessage,
                field: 'time'
            };
        }

        console.log('✅ [validateBusinessHours] Time is within business hours.');
        return { valid: true };

    } catch (error) {
        console.error('❌ [validateBusinessHours] Validation error:', error);
        return {
            valid: true, // Fail open to avoid blocking legitimate requests
            warningMessage: 'Business hours validation could not be completed due to a system error.'
        };
    }
}


/**
 * 🚨 CRITICAL NEW FUNCTION: Past-date validation with grace period as specified in original plan
 */
async function validatePastDate(
    date: string,
    time: string,
    context: {
        timezone: string;
        language?: string;
    }
): Promise<ValidationResult> {
    console.log('📅 [validatePastDate] Validating against past dates:', {
        date,
        time,
        timezone: context.timezone
    });

    try {
        // Create requested datetime in restaurant timezone
        const requestedDateTime = DateTime.fromFormat(`${date} ${time}`, 'yyyy-MM-dd HH:mm', {
            zone: context.timezone
        });

        if (!requestedDateTime.isValid) {
            return {
                valid: false,
                errorMessage: 'Invalid date/time combination',
                field: 'datetime'
            };
        }

        // Get current time in restaurant timezone
        const nowInRestaurantTz = getRestaurantDateTime(context.timezone);

        // 🚨 Grace period as specified in original plan (5 minutes)
        const gracePeriod = 5; // minutes
        const cutoffTime = nowInRestaurantTz.minus({ minutes: gracePeriod });

        console.log('📅 [validatePastDate] Time comparison:', {
            requestedTime: requestedDateTime.toISO(),
            currentTime: nowInRestaurantTz.toISO(),
            cutoffTime: cutoffTime.toISO(),
            isPastCutoff: requestedDateTime < cutoffTime
        });

        if (requestedDateTime < cutoffTime) {
            const errorMessage = `Cannot create reservation for past date/time: ${date} at ${time}. Please choose a future date and time. Current time: ${nowInRestaurantTz.toFormat('yyyy-MM-dd HH:mm')}`;

            console.error('🚨 [PAST_DATE_BOOKING] Attempt to book in the past:', {
                requestedDateTime: requestedDateTime.toISO(),
                cutoffTime: cutoffTime.toISO(),
                gracePeriodMinutes: gracePeriod
            });

            return {
                valid: false,
                errorMessage,
                field: 'date'
            };
        }

        console.log('✅ [validatePastDate] Date/time is in the future');
        return { valid: true };

    } catch (error) {
        console.error('❌ [validatePastDate] Validation error:', error);
        return {
            valid: false,
            errorMessage: 'Date/time validation failed due to system error',
            field: 'datetime'
        };
    }
}

/**
 * 🚨 NEW: Helper function to convert time string to minutes (as specified in original plan)
 */
function timeToMinutes(timeStr: string): number | null {
    if (!timeStr) return null;

    const parts = timeStr.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10) || 0;

    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }

    return hours * 60 + minutes;
}

/**
 * ✅ CRITICAL FIX: Helper function to normalize database date format for luxon
 */
function normalizeDatabaseTimestamp(dbTimestamp: string): string {
    if (!dbTimestamp) return '';

    let normalized = dbTimestamp.replace(' ', 'T');

    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) {
        normalized += ':00';
    }

    if (normalized.endsWith('+00')) {
        normalized = normalized.replace('+00', '+00:00');
    } else if (normalized.endsWith('-00')) {
        normalized = normalized.replace('-00', '-00:00');
    }

    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)) {
        normalized += '+00:00';
    }

    console.log(`[DateFix] ${dbTimestamp} → ${normalized}`);
    return normalized;
}

// ===== 🚀 REDIS PHASE 3: ENHANCED GUEST HISTORY TOOL WITH CACHING =====

/**
 * 🚀 REDIS PHASE 3: Get guest history with Redis caching and cache invalidation
 * ✅ PHASE 1 FIX: Get guest history with AIService-powered analysis (now returns English patterns)
 * * Features:
 * - Redis caching with 1-hour TTL
 * - Automatic fallback to memory cache when Redis is down
 * - Cache hit/miss logging and performance monitoring
 * - Compression for large objects
 * - Cache invalidation triggered by booking changes
 */
export async function get_guest_history(
    telegramUserId: string,
    context: { restaurantId: number; language?: string }
): Promise<ToolResponse> {
    const startTime = Date.now();
    const cacheKey = `guest-history:${context.restaurantId}:${telegramUserId}`;
    const cacheTTL = 3600; // 1 hour

    console.log(`👤 [Guest History] Getting history for telegram user: ${telegramUserId} at restaurant ${context.restaurantId}`);

    try {
        if (!telegramUserId || !context.restaurantId) {
            return createValidationFailure('Missing required parameters: telegramUserId or restaurantId');
        }

        // 🚀 REDIS PHASE 3: Try to get from Redis cache first
        console.log(`🔍 [Cache] Checking Redis cache for key: ${cacheKey}`);
        const cachedResponse = await redisService.get<ToolResponse>(cacheKey, {
            fallbackToMemory: true
        });

        if (cachedResponse) {
            const cacheAge = cachedResponse.metadata?.execution_time_ms
                ? Date.now() - cachedResponse.metadata.execution_time_ms
                : 'unknown';

            console.log(`✅ [Cache HIT] Guest history retrieved from cache: ${cacheKey} (age: ${cacheAge}ms)`);

            // Update metadata to indicate cache hit
            cachedResponse.metadata = {
                ...cachedResponse.metadata,
                cached: true,
                cache_hit_time_ms: Date.now() - startTime
            };

            return cachedResponse;
        }

        console.log(`❌ [Cache MISS] Guest history not in cache, querying database: ${cacheKey}`);

        // 2. If not in cache, execute the existing database logic
        // 1. Find the guest by telegram user ID
        const [guest] = await db
            .select()
            .from(guests)
            .where(eq(guests.telegram_user_id, telegramUserId));

        if (!guest) {
            console.log(`👤 [Guest History] No guest found for telegram user: ${telegramUserId}`);
            return createBusinessRuleFailure('Guest not found', 'GUEST_NOT_FOUND');
        }

        console.log(`👤 [Guest History] Found guest: ${guest.name} (ID: ${guest.id}) with phone: ${guest.phone}`);

        // 2. Query all reservations for this guest at this restaurant
        const allReservations = await db
            .select({
                id: reservations.id,
                status: reservations.status,
                guests: reservations.guests,
                comments: reservations.comments,
                reservation_utc: reservations.reservation_utc,
                createdAt: reservations.createdAt
            })
            .from(reservations)
            .where(and(
                eq(reservations.guestId, guest.id),
                eq(reservations.restaurantId, context.restaurantId)
            ))
            .orderBy(desc(reservations.reservation_utc));

        console.log(`👤 [Guest History] Found ${allReservations.length} total reservations for guest`);

        if (allReservations.length === 0) {
            const response = createSuccessResponse({
                guest_name: guest.name,
                guest_phone: guest.phone || '',
                total_bookings: 0,
                total_cancellations: 0,
                last_visit_date: null,
                common_party_size: null,
                frequent_special_requests: []
            }, {
                execution_time_ms: Date.now() - startTime,
                cached: false
            });

            // 🚀 REDIS PHASE 3: Cache empty result too (shorter TTL)
            await redisService.set(cacheKey, response, {
                ttl: cacheTTL / 2, // 30 minutes for empty results
                compress: false,
                fallbackToMemory: true
            });

            return response;
        }

        // 3. Analyze reservation data
        const completedReservations = allReservations.filter(r =>
            r.status === 'completed' || r.status === 'confirmed'
        );
        const cancelledReservations = allReservations.filter(r =>
            r.status === 'canceled'
        );

        console.log(`👤 [Guest History] Analysis: ${completedReservations.length} completed, ${cancelledReservations.length} cancelled`);

        // 4. Find most common party size
        let commonPartySize = null;
        if (completedReservations.length > 0) {
            const partySizeCounts = completedReservations.reduce((acc, reservation) => {
                const size = reservation.guests;
                acc[size] = (acc[size] || 0) + 1;
                return acc;
            }, {} as Record<number, number>);

            const mostCommonSize = Object.entries(partySizeCounts)
                .sort(([, a], [, b]) => b - a)[0];

            commonPartySize = mostCommonSize ? parseInt(mostCommonSize[0]) : null;
            console.log(`👤 [Guest History] Most common party size: ${commonPartySize} (from ${JSON.stringify(partySizeCounts)})`);
        }

        // 5. Find last visit date (most recent completed reservation)
        let lastVisitDate = null;
        if (completedReservations.length > 0) {
            const mostRecentCompleted = completedReservations[0]; // Already sorted by desc date
            const normalizedDate = normalizeDatabaseTimestamp(mostRecentCompleted.reservation_utc);
            const reservationDt = DateTime.fromISO(normalizedDate);

            if (reservationDt.isValid) {
                lastVisitDate = reservationDt.toFormat('yyyy-MM-dd');
                console.log(`👤 [Guest History] Last visit: ${lastVisitDate}`);
            }
        }

        // 6. ✅ LANGUAGE BUG FIXED: AIService-powered analysis that returns English patterns
        const englishRequests = await AgentAIAnalysisService.analyzeSpecialRequests(
            completedReservations,
            guest.name
        );

        console.log(`👤 [Guest History] AIService-analyzed frequent requests (English):`, englishRequests);
        console.log(`✅ [Language Fix] Patterns are now guaranteed to be in English, regardless of source comment language`);

        // 7. ✅ PHASE 1 FIX: Translate the English requests to target language using AIService
        let translatedRequests = englishRequests;
        if (context.language && context.language !== 'en' && englishRequests.length > 0) {
            console.log(`👤 [Guest History] Translating English requests to ${context.language}...`);
            translatedRequests = await Promise.all(
                englishRequests.map(request =>
                    AgentToolTranslationService.translateToolMessage(request, context.language as Language)
                )
            );
            console.log(`👤 [Guest History] Translated requests:`, translatedRequests);
        }

        // 8. Return structured response with translated frequent requests
        const historyData = {
            guest_name: guest.name,
            guest_phone: guest.phone || '',
            total_bookings: completedReservations.length,
            total_cancellations: cancelledReservations.length,
            last_visit_date: lastVisitDate,
            common_party_size: commonPartySize,
            frequent_special_requests: translatedRequests // ✅ Now powered by AIService with English-first analysis
        };

        console.log(`👤 [Guest History] Final history data with fixed AIService analysis:`, historyData);

        // 🚀 REDIS PHASE 3: Store result in cache with TTL
        const response = createSuccessResponse(historyData, {
            execution_time_ms: Date.now() - startTime,
            cached: false
        });

        console.log(`💾 [Cache] Storing guest history in Redis cache: ${cacheKey}`);
        const cacheSuccess = await redisService.set(cacheKey, response, {
            ttl: cacheTTL,
            compress: true, // Enable compression for large guest history objects
            fallbackToMemory: true
        });

        if (cacheSuccess) {
            console.log(`✅ [Cache] Guest history cached successfully: ${cacheKey} (TTL: ${cacheTTL}s)`);
        } else {
            console.warn(`⚠️ [Cache] Failed to cache guest history: ${cacheKey}`);
        }

        return response;

    } catch (error) {
        console.error(`❌ [Guest History] Error getting guest history:`, error);
        return createSystemError('Failed to retrieve guest history due to system error', error);
    }
}

/**
 * ✅ MAYA FIX: Check availability for ANY specific time with optional reservation exclusion
 */
export async function check_availability(
    date: string,
    time: string,
    guests: number,
    context: {
        restaurantId: number;
        timezone: string;
        language: string;
        excludeReservationId?: number;
    }
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`🔍 [Agent Tool] check_availability: ${date} ${time} for ${guests} guests (Restaurant: ${context.restaurantId})${context.excludeReservationId ? ` (excluding reservation ${context.excludeReservationId})` : ''}`);

    try {
        const restaurant = await storage.getRestaurant(context.restaurantId);
        // 🚨 ENHANCED: Use comprehensive validation but skip name/phone
        const validation = await validateBookingInput({
            guestName: 'temp-placeholder', // Placeholder that passes length check
            guestPhone: '0000000', // Placeholder that passes length check
            date,
            time,
            guests,
            context
        }, true); // 🐛 BUG FIX: Pass true to indicate this is an availability check

        if (!validation.valid) {
            return createValidationFailure(validation.errorMessage!, validation.field);
        }

        // 🚨 ENHANCED: Business hours validation
        const businessHoursCheck = await validateBusinessHours(time, date, context);
        if (!businessHoursCheck.valid) {
            return createValidationFailure(businessHoursCheck.errorMessage!, businessHoursCheck.field);
        }

        // 🚨 ENHANCED: Past-date validation
        const pastDateCheck = await validatePastDate(date, time, context);
        if (!pastDateCheck.valid) {
            return createValidationFailure(pastDateCheck.errorMessage!, pastDateCheck.field);
        }

        let timeFormatted: string;
        if (/^\d{1,2}:\d{2}$/.test(time)) {
            const [hours, minutes] = time.split(':');
            timeFormatted = `${hours.padStart(2, '0')}:${minutes}:00`;
        } else if (/^\d{1,2}:\d{2}:\d{2}$/.test(time)) {
            timeFormatted = time;
        } else {
            return createValidationFailure('Invalid time format. Expected HH:MM or HH:MM:SS', 'time');
        }

        console.log(`✅ [Agent Tool] Enhanced validation passed. Using exact time checking for: ${timeFormatted}${context.excludeReservationId ? ` (excluding reservation ${context.excludeReservationId})` : ''}...`);

        const slots = await getAvailableTimeSlots(
            context.restaurantId,
            date,
            guests,
            {
                requestedTime: timeFormatted,
                exactTimeOnly: true,
                timezone: context.timezone,
                allowCombinations: true,
                excludeReservationId: context.excludeReservationId
            }
        );

        console.log(`✅ [Agent Tool] Found ${slots.length} slots for exact time ${timeFormatted}${context.excludeReservationId ? ` (excluding reservation ${context.excludeReservationId})` : ''}`);

        const executionTime = Date.now() - startTime;

        if (slots.length > 0) {
            const bestSlot = slots[0];

            // ✅ USE AISERVICE TRANSLATION
            const baseMessage = `Table ${bestSlot.tableName} available for ${guests} guests at ${time}${bestSlot.isCombined ? ' (combined tables)' : ''}${context.excludeReservationId ? ` (reservation ${context.excludeReservationId} excluded from conflict check)` : ''}`;
            const translatedMessage = await AgentToolTranslationService.translateToolMessage(
                baseMessage,
                context.language as Language,
                'success'
            );

            return createSuccessResponse({
                available: true,
                table: bestSlot.tableName,
                capacity: bestSlot.tableCapacity?.max || null,
                isCombined: bestSlot.isCombined || false,
                exactTime: timeFormatted,
                message: translatedMessage,
                constituentTables: bestSlot.constituentTables || null,
                allAvailableSlots: slots.map(s => ({ time: s.time, table: s.tableName })),
                timeSupported: 'exact'
            }, {
                execution_time_ms: executionTime
            });
        } else {
            console.log(`⚠️ [Agent Tool] No tables for ${guests} guests at exact time ${timeFormatted}, checking for smaller party sizes...`);

            let suggestedAlternatives = [];
            for (let altGuests = guests - 1; altGuests >= 1 && suggestedAlternatives.length === 0; altGuests--) {
                const altSlots = await getAvailableTimeSlots(
                    context.restaurantId,
                    date,
                    altGuests,
                    {
                        requestedTime: timeFormatted,
                        exactTimeOnly: true,
                        timezone: context.timezone,
                        allowCombinations: true,
                        excludeReservationId: context.excludeReservationId
                    }
                );

                if (altSlots.length > 0) {
                    suggestedAlternatives = altSlots.slice(0, 3).map(slot => ({
                        time: slot.time,
                        table: slot.tableName,
                        guests: altGuests,
                        capacity: slot.tableCapacity?.max || altGuests
                    }));
                    break;
                }
            }

            if (suggestedAlternatives.length > 0) {
                // ✅ USE AISERVICE TRANSLATION
                const baseMessage = `No tables available for ${guests} guests at ${time} on ${date}. However, I found availability for ${suggestedAlternatives[0].guests} guests at the same time. Would that work?`;
                const translatedMessage = await AgentToolTranslationService.translateToolMessage(
                    baseMessage,
                    context.language as Language,
                    'error'
                );

                return createBusinessRuleFailure(
                    translatedMessage,
                    'NO_AVAILABILITY_SUGGEST_SMALLER'
                );
            } else {
                // ✅ USE AISERVICE TRANSLATION
                const baseMessage = `No tables available for ${guests} guests at ${time} on ${date}${context.excludeReservationId ? ` (even after excluding reservation ${context.excludeReservationId})` : ''}`;
                const translatedMessage = await AgentToolTranslationService.translateToolMessage(
                    baseMessage,
                    context.language as Language,
                    'error'
                );

                return createBusinessRuleFailure(
                    translatedMessage,
                    'NO_AVAILABILITY'
                );
            }
        }

    } catch (error) {
        console.error(`❌ [Agent Tool] check_availability error:`, error);
        return createSystemError('Failed to check availability due to system error', error);
    }
}

/**
 * ✅ BUG FIX: Find alternative time slots around ANY preferred time with excludeReservationId support
 */
export async function find_alternative_times(
    date: string,
    preferredTime: string,
    guests: number,
    context: {
        restaurantId: number;
        timezone: string;
        language: string;
        excludeReservationId?: number; // ✅ CRITICAL BUG FIX: Added excludeReservationId parameter
    }
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`🔍 [Agent Tool] find_alternative_times: ${date} around ${preferredTime} for ${guests} guests${context.excludeReservationId ? ` (excluding reservation ${context.excludeReservationId})` : ''}`);

    try {
        // 🚨 ENHANCED: Use comprehensive validation
        const validation = await validateBookingInput({
            guestName: 'temp-placeholder', // Placeholder
            guestPhone: '0000000',      // Placeholder
            date,
            time: preferredTime,
            guests,
            context
        }, true); // 🐛 BUG FIX: Pass true to skip name/phone validation

        if (!validation.valid) {
            return createValidationFailure(validation.errorMessage!, validation.field);
        }

        // 🚨 ENHANCED: Past-date validation
        const pastDateCheck = await validatePastDate(date, preferredTime, context);
        if (!pastDateCheck.valid) {
            return createValidationFailure(pastDateCheck.errorMessage!, pastDateCheck.field);
        }

        let timeFormatted: string;
        if (/^\d{1,2}:\d{2}$/.test(preferredTime)) {
            const [hours, minutes] = preferredTime.split(':');
            timeFormatted = `${hours.padStart(2, '0')}:${minutes}:00`;
        } else if (/^\d{1,2}:\d{2}:\d{2}$/.test(preferredTime)) {
            timeFormatted = preferredTime;
        } else {
            return createValidationFailure('Invalid time format. Expected HH:MM or HH:MM:SS', 'preferredTime');
        }

        console.log(`✅ [Agent Tool] Enhanced validation passed for alternatives around exact time: ${timeFormatted}${context.excludeReservationId ? ` (excluding reservation ${context.excludeReservationId})` : ''}...`);

        const slots = await getAvailableTimeSlots(
            context.restaurantId,
            date,
            guests,
            {
                requestedTime: timeFormatted,
                exactTimeOnly: false,
                maxResults: 8,
                timezone: context.timezone,
                allowCombinations: true,
                excludeReservationId: context.excludeReservationId // ✅ CRITICAL BUG FIX: Pass excludeReservationId to availability service
            }
        );

        const preferredTimeMinutes = (() => {
            const [hours, minutes] = timeFormatted.split(':').map(Number);
            return hours * 60 + minutes;
        })();

        const alternatives = slots.map(slot => {
            const [slotHours, slotMinutes] = slot.time.split(':').map(Number);
            const slotTimeMinutes = slotHours * 60 + slotMinutes;
            const timeDifference = Math.abs(slotTimeMinutes - preferredTimeMinutes);

            return {
                time: slot.timeDisplay,
                timeInternal: slot.time,
                table: slot.tableName,
                capacity: slot.tableCapacity?.max || 0,
                isCombined: slot.isCombined || false,
                proximityMinutes: timeDifference,
                message: `${slot.timeDisplay || slot.time} - ${slot.tableName}${slot.isCombined ? ' (combined)' : ''}`
            };
        }).sort((a, b) => a.proximityMinutes - b.proximityMinutes);

        const executionTime = Date.now() - startTime;

        console.log(`✅ [Agent Tool] Found ${alternatives.length} alternatives around ${preferredTime}${context.excludeReservationId ? ` (excluding reservation ${context.excludeReservationId})` : ''}`);

        if (alternatives.length > 0) {
            return createSuccessResponse({
                alternatives,
                count: alternatives.length,
                date: date,
                preferredTime: preferredTime,
                exactTimeRequested: timeFormatted,
                closestAlternative: alternatives[0]
            }, {
                execution_time_ms: executionTime
            });
        } else {
            // ✅ USE AISERVICE TRANSLATION
            const baseMessage = `No alternative times available for ${guests} guests on ${date} near ${preferredTime}${context.excludeReservationId ? ` (even after excluding reservation ${context.excludeReservationId})` : ''}`;
            const translatedMessage = await AgentToolTranslationService.translateToolMessage(
                baseMessage,
                context.language as Language,
                'error'
            );

            return createBusinessRuleFailure(
                translatedMessage,
                'NO_ALTERNATIVES'
            );
        }

    } catch (error) {
        console.error(`❌ [Agent Tool] find_alternative_times error:`, error);
        return createSystemError('Failed to find alternative times due to system error', error);
    }
}

/**
 * 🚨 COMPLETELY ENHANCED: Create reservation with comprehensive validation pipeline as per original plan
 * 🚀 REDIS PHASE 3: Now includes cache invalidation after successful booking
 * This implements ALL the validation enhancements specified in the original plan
 */
export async function create_reservation(
    guestName: string,
    guestPhone: string,
    date: string,
    time: string,
    guests: number,
    specialRequests: string = '',
    context: {
        restaurantId: number;
        timezone: string;
        telegramUserId?: string;
        source: string;
        sessionId?: string;
        language: string;
        confirmedName?: string;
        // ✅ FIX #4: Add session context for validation
        session?: BookingSessionWithAgent;
    }
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`📝 [Agent Tool] create_reservation ENHANCED: ${guestName} (${guestPhone}) for ${guests} guests on ${date} at ${time}`);

    const effectiveGuestName = context.confirmedName || guestName;
    if (context.confirmedName) {
        console.log(`📝 [Agent Tool] Using confirmed name: ${context.confirmedName} (original: ${guestName})`);
    }

    try {
        // 🚨 STEP 1: COMPREHENSIVE PRE-VALIDATION as specified in original plan
        console.log('🛡️ [Agent Tool] Starting comprehensive pre-validation pipeline...');

        const validation = await validateBookingInput({
            guestName: effectiveGuestName,
            guestPhone,
            date,
            time,
            guests,
            specialRequests,
            context
        });

        if (!validation.valid) {
            console.error('❌ [Agent Tool] Basic input validation failed:', validation.errorMessage);
            return createValidationFailure(validation.errorMessage!, validation.field);
        }

        console.log('✅ [Agent Tool] Basic input validation passed');

        // 🚨 STEP 2: PAST-DATE VALIDATION with grace period as specified in original plan
        const pastDateValidation = await validatePastDate(date, time, context);
        if (!pastDateValidation.valid) {
            console.error('❌ [Agent Tool] Past-date validation failed:', pastDateValidation.errorMessage);
            return createValidationFailure(pastDateValidation.errorMessage!, pastDateValidation.field);
        }

        console.log('✅ [Agent Tool] Past-date validation passed');

        // 🚨 STEP 3: BUSINESS HOURS VALIDATION as specified in original plan
        const businessHoursValidation = await validateBusinessHours(time, date, context);
        if (!businessHoursValidation.valid) {
            console.error('❌ [Agent Tool] Business hours validation failed:', businessHoursValidation.errorMessage);
            return createValidationFailure(businessHoursValidation.errorMessage!, businessHoursValidation.field);
        }

        console.log('✅ [Agent Tool] Business hours validation passed');

        // 🚨 STEP 4: INPUT SANITIZATION as specified in original plan
        const cleanPhone = guestPhone.replace(/[^\d+\-\s()]/g, '').trim();
        const cleanName = effectiveGuestName.trim();

        let timeFormatted: string;
        if (/^\d{1,2}:\d{2}$/.test(time)) {
            const [hours, minutes] = time.split(':');
            timeFormatted = `${hours.padStart(2, '0')}:${minutes}`;
        } else if (/^\d{1,2}:\d{2}:\d{2}$/.test(time)) {
            timeFormatted = time.substring(0, 5);
        } else {
            return createValidationFailure(`Invalid time format: ${time}. Expected HH:MM or HH:MM:SS`, 'time');
        }

        console.log('✅ [Agent Tool] Input sanitization completed');

        // ✅ FIX #4: WORKFLOW VALIDATION FOR SPECIAL REQUESTS
        let validatedSpecialRequests = specialRequests;
        if (specialRequests && context.session?.guestHistory?.frequent_special_requests?.includes(specialRequests)) {
            console.log(`🚨 [WORKFLOW_VALIDATION] Special request "${specialRequests}" detected from guest history. Checking for explicit confirmation...`);

            // Check if this was explicitly confirmed in current conversation
            const recentMessages = context.session.conversationHistory?.slice(-5) || [];

            // Look for explicit confirmation pattern
            let hasExplicitConfirmation = false;
            for (let i = 0; i < recentMessages.length - 1; i++) {
                const assistantMsg = recentMessages[i];
                const userMsg = recentMessages[i + 1];

                if (assistantMsg.role === 'assistant' && userMsg.role === 'user') {
                    // Check if assistant mentioned the specific request
                    const assistantMentionsRequest = assistantMsg.content.includes(specialRequests) ||
                        assistantMsg.content.toLowerCase().includes('special request') ||
                        assistantMsg.content.toLowerCase().includes('add that') ||
                        assistantMsg.content.toLowerCase().includes('добавить это') ||
                        assistantMsg.content.toLowerCase().includes('add this');

                    // Check if user explicitly confirmed
                    const userConfirms = /\b(yes|да|confirm|add|добавить|sure|good|ok)\b/i.test(userMsg.content);

                    if (assistantMentionsRequest && userConfirms) {
                        hasExplicitConfirmation = true;
                        console.log(`✅ [WORKFLOW_VALIDATION] Found explicit confirmation pattern:`, {
                            assistantMessage: assistantMsg.content.substring(0, 100),
                            userResponse: userMsg.content,
                            requestMentioned: assistantMentionsRequest,
                            userConfirmed: userConfirms
                        });
                        break;
                    }
                }
            }

            if (!hasExplicitConfirmation) {
                console.warn(`🚨 [WORKFLOW_VIOLATION] Special request "${specialRequests}" appears to be auto-added without explicit confirmation`);
                console.warn(`🚨 [WORKFLOW_VIOLATION] Recent conversation:`, recentMessages.map(m => `${m.role}: ${m.content.substring(0, 50)}...`));

                // Remove unauthorized special request
                validatedSpecialRequests = '';
                console.log(`🔧 [WORKFLOW_FIX] Removed unauthorized special request. Clean booking will proceed.`);

                // Optional: Add warning to metadata
                console.log(`⚠️ [WORKFLOW_WARNING] Special request "${specialRequests}" was removed due to lack of explicit confirmation in current conversation`);
            } else {
                console.log(`✅ [WORKFLOW_VALIDATION] Special request "${specialRequests}" confirmed - proceeding with inclusion`);
            }
        } else if (specialRequests) {
            console.log(`✅ [WORKFLOW_VALIDATION] Special request "${specialRequests}" is new (not from history) - proceeding normally`);
        }

        console.log(`✅ [Agent Tool] ALL VALIDATION LAYERS PASSED. Creating reservation with enhanced validation:`);
        console.log(`   - Restaurant ID: ${context.restaurantId}`);
        console.log(`   - Guest: ${cleanName} (${cleanPhone})`);
        console.log(`   - Date/Time: ${date} ${timeFormatted} (enhanced validation complete)`);
        console.log(`   - Guests: ${guests}`);
        console.log(`   - Special Requests: "${validatedSpecialRequests}" (workflow validated)`);
        console.log(`   - Timezone: ${context.timezone}`);
        console.log(`   - Confirmed Name: ${context.confirmedName || 'none'}`);

        // 🚨 STEP 5: PROCEED WITH RESERVATION CREATION
        const result = await createTelegramReservation(
            context.restaurantId,
            date,
            timeFormatted,
            guests,
            cleanName,
            cleanPhone,
            context.telegramUserId || context.sessionId || 'web_chat_user',
            validatedSpecialRequests, // ✅ FIX #4: Use validated special requests
            context.language as any,
            context.confirmedName,
            undefined,
            context.timezone
        );

        const executionTime = Date.now() - startTime;

        if (!result.success && result.status === 'name_mismatch_clarification_needed' && result.nameConflict) {
            console.log(`⚠️ [Agent Tool] NAME MISMATCH DETECTED: Converting to proper format for conversation manager`);

            const { dbName, requestName } = result.nameConflict;

            return createFailureResponse(
                'BUSINESS_RULE',
                `Name mismatch detected: database has '${dbName}' but booking requests '${requestName}'`,
                'NAME_CLARIFICATION_NEEDED',
                {
                    dbName: dbName,
                    requestName: requestName,
                    guestId: result.nameConflict.guestId,
                    phone: result.nameConflict.phone,
                    telegramUserId: result.nameConflict.telegramUserId,
                    originalMessage: result.message
                }
            );
        }

        console.log(`🔍 [Agent Tool] Reservation result:`, {
            success: result.success,
            status: result.status,
            reservationId: result.reservation?.id,
            message: result.message
        });

        if (result.success && result.reservation && result.reservation.id) {
            console.log(`✅ [Agent Tool] ENHANCED VALIDATION reservation created successfully: #${result.reservation.id} at ${timeFormatted}`);

            // 🚀 REDIS PHASE 3: Invalidate guest history cache after successful booking
            await invalidateGuestHistoryCache({
                restaurantId: context.restaurantId,
                telegramUserId: context.telegramUserId
            });

            // ✅ FIX #4: Add comprehensive validation metadata to response
            const metadata: any = {
                execution_time_ms: executionTime,
                validationLayers: [
                    'basic_input_validation',
                    'past_date_validation',
                    'business_hours_validation',
                    'input_sanitization',
                    'workflow_validation'
                ],
                cacheInvalidated: !!context.telegramUserId // 🚀 REDIS PHASE 3: Indicate cache invalidation
            };

            if (specialRequests !== validatedSpecialRequests) {
                metadata.warnings = [`Special request workflow validation applied: "${specialRequests}" → "${validatedSpecialRequests}"`];
                metadata.workflowValidationApplied = true;
            }

            if (validation.warningMessage) {
                metadata.warnings = metadata.warnings || [];
                metadata.warnings.push(validation.warningMessage);
            }

            if (businessHoursValidation.warningMessage) {
                metadata.warnings = metadata.warnings || [];
                metadata.warnings.push(businessHoursValidation.warningMessage);
            }

            return createSuccessResponse({
                reservationId: result.reservation.id,
                confirmationNumber: result.reservation.id,
                table: result.table,
                guestName: cleanName,
                guestPhone: cleanPhone,
                date: date,
                time: timeFormatted,
                exactTime: timeFormatted,
                guests: guests,
                specialRequests: validatedSpecialRequests, // ✅ FIX #4: Return validated special requests
                message: result.message,
                success: true,
                timeSupported: 'exact'
            }, metadata);
        } else {
            console.log(`⚠️ [Agent Tool] Enhanced validation reservation failed:`, {
                success: result.success,
                status: result.status,
                message: result.message,
                reservation: result.reservation
            });

            let errorCode = 'BOOKING_FAILED';
            if (result.message?.toLowerCase().includes('no table')) {
                errorCode = 'NO_TABLE_AVAILABLE';
            } else if (result.message?.toLowerCase().includes('time')) {
                errorCode = 'INVALID_TIME';
            } else if (result.message?.toLowerCase().includes('capacity')) {
                errorCode = 'CAPACITY_EXCEEDED';
            }

            // ✅ USE AISERVICE TRANSLATION
            const translatedMessage = await AgentToolTranslationService.translateToolMessage(
                result.message || 'Could not complete reservation due to business constraints',
                context.language as Language,
                'error'
            );

            return createBusinessRuleFailure(
                translatedMessage,
                errorCode
            );
        }

    } catch (error) {
        console.error(`❌ [Agent Tool] create_reservation ENHANCED VALIDATION error:`, error);

        console.error(`❌ [Agent Tool] Enhanced validation error details:`, {
            guestName: effectiveGuestName,
            guestPhone,
            date,
            time,
            guests,
            contextExists: !!context,
            contextRestaurantId: context?.restaurantId,
            contextTimezone: context?.timezone,
            confirmedName: context?.confirmedName,
            errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });

        return createSystemError('Failed to create reservation due to system error in enhanced validation pipeline', error);
    }
}

/**
 * Get restaurant information
 */
export async function get_restaurant_info(
    infoType: 'hours' | 'location' | 'cuisine' | 'contact' | 'features' | 'all',
    context: { restaurantId: number; language?: string }
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`ℹ️ [Agent Tool] get_restaurant_info: ${infoType} for restaurant ${context.restaurantId}`);

    try {
        if (!context || !context.restaurantId) {
            return createValidationFailure('Context with restaurantId is required');
        }

        const validInfoTypes = ['hours', 'location', 'cuisine', 'contact', 'features', 'all'];
        if (!validInfoTypes.includes(infoType)) {
            return createValidationFailure(
                `Invalid infoType: ${infoType}. Must be one of: ${validInfoTypes.join(', ')}`,
                'infoType'
            );
        }

        console.log(`✅ [Agent Tool] Getting restaurant info for ID: ${context.restaurantId}`);

        const restaurant = await storage.getRestaurant(context.restaurantId);
        if (!restaurant) {
            return createBusinessRuleFailure('Restaurant not found', 'RESTAURANT_NOT_FOUND');
        }

        console.log(`✅ [Agent Tool] Found restaurant: ${restaurant.name}`);

        const formatTime = (time: string | null) => {
            if (!time) return 'Not specified';
            const [hours, minutes] = time.split(':');
            const hour = parseInt(hours);
            const ampm = hour >= 12 ? 'PM' : 'AM';
            const displayHour = hour % 12 || 12;
            return `${displayHour}:${minutes} ${ampm}`;
        };

        const executionTime = Date.now() - startTime;
        let responseData: any;
        let message: string;

        switch (infoType) {
            case 'hours':
                responseData = {
                    openingTime: formatTime(restaurant.openingTime),
                    closingTime: formatTime(restaurant.closingTime),
                    timezone: restaurant.timezone,
                    rawOpeningTime: restaurant.openingTime,
                    rawClosingTime: restaurant.closingTime,
                    slotInterval: restaurant.slotInterval || 30,
                    allowAnyTime: restaurant.allowAnyTime !== false,
                    minTimeIncrement: restaurant.minTimeIncrement || 15
                };
                message = `We're open from ${formatTime(restaurant.openingTime)} to ${formatTime(restaurant.closingTime)}${restaurant.allowAnyTime ? '. You can book at any time during our hours!' : ''}`;
                break;

            case 'location':
                responseData = {
                    name: restaurant.name,
                    address: restaurant.address,
                    city: restaurant.city,
                    country: restaurant.country
                };
                message = `${restaurant.name} is located at ${restaurant.address}, ${restaurant.city}${restaurant.country ? `, ${restaurant.country}` : ''}`;
                break;

            case 'cuisine':
                responseData = {
                    cuisine: restaurant.cuisine,
                    atmosphere: restaurant.atmosphere,
                    features: restaurant.features
                };
                message = `We specialize in ${restaurant.cuisine || 'excellent cuisine'} with a ${restaurant.atmosphere || 'wonderful'} atmosphere.`;
                break;

            case 'contact':
                responseData = {
                    name: restaurant.name,
                    phone: restaurant.phone
                };
                message = `You can reach ${restaurant.name}${restaurant.phone ? ` at ${restaurant.phone}` : ''}`;
                break;

            default: // 'all'
                responseData = {
                    name: restaurant.name,
                    cuisine: restaurant.cuisine,
                    atmosphere: restaurant.atmosphere,
                    address: restaurant.address,
                    city: restaurant.city,
                    country: restaurant.country,
                    phone: restaurant.phone,
                    openingTime: formatTime(restaurant.openingTime),
                    closingTime: formatTime(restaurant.closingTime),
                    features: restaurant.features,
                    timezone: restaurant.timezone,
                    slotInterval: restaurant.slotInterval || 30,
                    allowAnyTime: restaurant.allowAnyTime !== false,
                    minTimeIncrement: restaurant.minTimeIncrement || 15
                };
                message = `${restaurant.name} serves ${restaurant.cuisine || 'excellent cuisine'} in a ${restaurant.atmosphere || 'wonderful'} atmosphere. We're open ${formatTime(restaurant.openingTime)} to ${formatTime(restaurant.closingTime)}${restaurant.allowAnyTime ? ' You can book at any exact time during our operating hours!' : ''}`;
                break;
        }

        // ✅ USE AISERVICE TRANSLATION if language context provided
        if (context.language && context.language !== 'en') {
            message = await AgentToolTranslationService.translateToolMessage(
                message,
                context.language as Language,
                'info'
            );
        }

        responseData.message = message;

        return createSuccessResponse(responseData, {
            execution_time_ms: executionTime
        });

    } catch (error) {
        console.error(`❌ [Agent Tool] get_restaurant_info error:`, error);
        return createSystemError('Failed to retrieve restaurant information due to system error', error);
    }
}

// ===== 🆕 MAYA'S RESERVATION MANAGEMENT TOOLS =====

/**
 * ✅ RESERVATION SEARCH ENHANCEMENT: Find existing reservations with time range and status filtering
 * ✅ FIXED: Find existing reservations for a guest using Drizzle ORM with timezone utils
 * ✅ CRITICAL FIX: Now properly returns reservation details with correct confirmation formatting
 */
export async function find_existing_reservation(
    identifier: string,
    identifierType: 'phone' | 'telegram' | 'name' | 'confirmation' | 'auto' = 'auto',
    context: {
        restaurantId: number;
        timezone: string;
        language: string;
        telegramUserId?: string;
        sessionId?: string;
        // ✅ NEW PARAMETERS: Enhanced search capabilities
        timeRange?: 'upcoming' | 'past' | 'all';
        includeStatus?: string[];
    }
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`🔍 [Maya Tool] Finding reservations for: "${identifier}" (Type: ${identifierType})`);

    try {
        let finalIdentifierType = identifierType;

        // ✅ FIX: Improved auto-detection logic
        if (finalIdentifierType === 'auto') {
            const numericOnly = identifier.replace(/\D/g, '');
            if (/^\d{1,4}$/.test(numericOnly) && numericOnly.length < 5) {
                finalIdentifierType = 'confirmation';
            } else if (/^\d{7,}$/.test(numericOnly)) {
                finalIdentifierType = 'phone';
            } else {
                finalIdentifierType = 'name';
            }
            console.log(`[Maya Tool] Auto-detected identifier type as '${finalIdentifierType}' for "${identifier}"`);
        }

        // ✅ ENHANCEMENT: Process new parameters with smart defaults
        const nowUtc = getRestaurantDateTime(context.timezone).toUTC().toISO();
        const timeRange = context.timeRange || 'upcoming';
        const includeStatus = context.includeStatus || (
            timeRange === 'past'
                ? ['completed', 'canceled']
                : ['created', 'confirmed']
        );

        // ✅ ENHANCEMENT: Validate includeStatus parameter
        const validStatuses = ['created', 'confirmed', 'completed', 'canceled'];
        if (includeStatus.some(status => !validStatuses.includes(status))) {
            return createValidationFailure('Invalid status in includeStatus array');
        }

        const conditions = [eq(reservations.restaurantId, context.restaurantId)];

        // Add status filter
        if (includeStatus.length > 0) {
            conditions.push(inArray(reservations.status, includeStatus));
        }

        // ✅ ENHANCEMENT: Add time filter based on range WITH SMART LOGIC
        switch (timeRange) {
            case 'upcoming':
                conditions.push(gt(reservations.reservation_utc, nowUtc));
                break;
            case 'past':
                // ✅ FIX: For 'past' + 'completed'/'canceled' statuses,
                // user wants to see their booking history, not just time-filtered results
                const hasCompletedOrCanceled = includeStatus.some(status =>
                    ['completed', 'canceled'].includes(status)
                );

                if (hasCompletedOrCanceled) {
                    // Show ALL completed/canceled reservations (user's booking history)
                    console.log(`[Maya Tool] Showing all completed/canceled reservations (booking history mode)`);
                } else {
                    // Only apply time filter for other statuses
                    conditions.push(lt(reservations.reservation_utc, nowUtc));
                }
                break;
            case 'all':
                // No time filter - search all dates
                break;
        }

        console.log(`[Maya Tool] Searching ${timeRange} reservations with status: ${includeStatus.join(', ')}${timeRange === 'past' && includeStatus.some(s => ['completed', 'canceled'].includes(s)) ? ' (history mode)' : ''}`);

        switch (finalIdentifierType) {
            case 'phone':
                conditions.push(eq(guests.phone, identifier));
                break;
            case 'telegram':
                if (context.telegramUserId) {
                    conditions.push(eq(guests.telegram_user_id, context.telegramUserId));
                }
                break;
            case 'name':
                conditions.push(like(guests.name, `%${identifier}%`));
                break;
            case 'confirmation':
                const numericIdentifier = parseInt(identifier.replace(/\D/g, ''), 10);
                if (isNaN(numericIdentifier)) {
                    // ✅ USE AISERVICE TRANSLATION
                    const baseMessage = `"${identifier}" is not a valid confirmation number. It must be a number.`;
                    const translatedMessage = await AgentToolTranslationService.translateToolMessage(
                        baseMessage,
                        context.language as Language,
                        'error'
                    );
                    return createBusinessRuleFailure(translatedMessage, 'INVALID_CONFIRMATION');
                }
                conditions.push(eq(reservations.id, numericIdentifier));
                break;
        }

        console.log(`[Maya Tool] Executing Drizzle query with type '${finalIdentifierType}'...`);

        const results = await db
            .select({
                id: reservations.id,
                reservation_utc: reservations.reservation_utc,
                guests: reservations.guests,
                booking_guest_name: reservations.booking_guest_name,
                comments: reservations.comments,
                status: reservations.status,
                guest_name: guests.name,
                guest_phone: guests.phone,
                table_name: tables.name,
                table_id: tables.id,
                table_capacity: tables.maxGuests
            })
            .from(reservations)
            .innerJoin(guests, eq(reservations.guestId, guests.id))
            .leftJoin(tables, eq(reservations.tableId, tables.id))
            .where(and(...conditions))
            .orderBy(desc(reservations.reservation_utc))
            .limit(10);

        if (!results || results.length === 0) {
            // ✅ USE AISERVICE TRANSLATION
            const baseMessage = timeRange === 'past'
                ? `I couldn't find any past reservations for "${identifier}". Please check the information or try a different way to identify your booking.`
                : timeRange === 'upcoming'
                    ? `I couldn't find any upcoming reservations for "${identifier}". Please check the information or try a different way to identify your booking.`
                    : `I couldn't find any reservations for "${identifier}". Please check the information or try a different way to identify your booking.`;

            const translatedMessage = await AgentToolTranslationService.translateToolMessage(
                baseMessage,
                context.language as Language,
                'error'
            );

            return createBusinessRuleFailure(
                translatedMessage,
                'NO_RESERVATIONS_FOUND'
            );
        }

        const formattedReservations = results.map((r: any) => {
            const normalizedDateString = normalizeDatabaseTimestamp(r.reservation_utc);
            const reservationUtcDt = DateTime.fromISO(normalizedDateString);

            if (!reservationUtcDt.isValid) {
                console.error(`[Maya Tool] Invalid date format: ${r.reservation_utc} → ${normalizedDateString}`);
                return {
                    id: r.id,
                    confirmationNumber: r.id,
                    date: 'Invalid Date',
                    time: 'Invalid Time',
                    guests: r.guests,
                    guestName: r.booking_guest_name || r.guest_name || 'Unknown Guest',
                    guestPhone: r.guest_phone || '',
                    tableName: r.table_name || 'Table TBD',
                    tableId: r.table_id,
                    tableCapacity: r.table_capacity,
                    comments: r.comments || '',
                    status: r.status,
                    canModify: true,
                    canCancel: true,
                    hoursUntil: 48,
                    dateParsingError: true
                };
            }

            const nowUtcDt = getRestaurantDateTime(context.timezone).toUTC();
            const hoursUntilReservation = reservationUtcDt.diff(nowUtcDt, 'hours').hours;

            console.log(`[Maya Tool] DIAGNOSTICS FOR RESERVATION #${r.id}:`);
            console.log(`  - Original DB Date: ${r.reservation_utc}`);
            console.log(`  - Normalized Date:  ${normalizedDateString}`);
            console.log(`  - Parsed DateTime:  ${reservationUtcDt.toISO()}`);
            console.log(`  - Current UTC:      ${nowUtcDt.toISO()}`);
            console.log(`  - Hours Until:      ${hoursUntilReservation}`);
            console.log(`  - Table ID:         ${r.table_id}`);
            console.log(`  - Table Capacity:   ${r.table_capacity}`);

            const localDateTime = reservationUtcDt.setZone(context.timezone);
            const canModify = hoursUntilReservation >= 4;
            const canCancel = hoursUntilReservation >= 2;

            return {
                id: r.id,
                confirmationNumber: r.id,
                date: localDateTime.toFormat('yyyy-MM-dd'),
                time: localDateTime.toFormat('HH:mm'),
                guests: r.guests,
                guestName: r.booking_guest_name || r.guest_name || 'Unknown Guest',
                guestPhone: r.guest_phone || '',
                tableName: r.table_name || 'Table TBD',
                tableId: r.table_id,
                tableCapacity: r.table_capacity,
                comments: r.comments || '',
                status: r.status,
                canModify,
                canCancel,
                hoursUntil: Math.round(hoursUntilReservation * 10) / 10,
            };
        });

        // ✅ USE AISERVICE TRANSLATION
        const baseMessage = timeRange === 'past'
            ? `Found ${formattedReservations.length} past reservation(s) for you. Let me show you the details.`
            : timeRange === 'upcoming'
                ? `Found ${formattedReservations.length} upcoming reservation(s) for you. Let me show you the details.`
                : `Found ${formattedReservations.length} reservation(s) for you. Let me show you the details.`;

        const translatedMessage = await AgentToolTranslationService.translateToolMessage(
            baseMessage,
            context.language as Language,
            'success'
        );

        // ✅ CRITICAL FIX: Store reservation details in response data for proper access
        const responseData = {
            reservations: formattedReservations,
            count: formattedReservations.length,
            searchedBy: finalIdentifierType,
            timeRange: timeRange,
            includeStatus: includeStatus,
            message: translatedMessage,
            // ✅ NEW: Add primary reservation for easy access
            primaryReservation: formattedReservations[0] // Most recent reservation
        };

        console.log(`🔍 [Maya Tool] Returning reservation data:`, {
            reservationCount: formattedReservations.length,
            timeRange: timeRange,
            statusFilter: includeStatus,
            primaryReservationId: formattedReservations[0]?.id,
            allReservationIds: formattedReservations.map(r => r.id)
        });

        return createSuccessResponse(responseData, {
            execution_time_ms: Date.now() - startTime
        });

    } catch (error) {
        console.error(`❌ [Maya Tool] Error finding reservations:`, error);
        return createSystemError('Failed to search for reservations', error);
    }
}

/**
 * ✅ STEP 3A COMPLETE: Enhanced modify_reservation with ContextManager integration
 * 🚀 REDIS PHASE 3: Now includes cache invalidation after successful modification
 * This is the CRITICAL function that was causing the context loss problem
 */
export async function modify_reservation(
    reservationIdHint: number | undefined, // ✅ Made optional
    modifications: {
        newDate?: string;
        newTime?: string;
        newGuests?: number;
        newSpecialRequests?: string;
    },
    reason: string = 'Guest requested change',
    context: {
        restaurantId: number;
        timezone: string;
        language: string;
        telegramUserId?: string;
        sessionId?: string;
        // ✅ STEP 3A: Added new context parameters
        userMessage?: string;
        session?: BookingSessionWithAgent;
    }
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`✏️ [Maya Tool] Modifying reservation ${reservationIdHint || 'TBD'}:`, modifications);

    try {
        // ✅ STEP 3A: Use ContextManager for smart reservation ID resolution
        let targetReservationId: number;

        if (context.session && context.userMessage) {
            console.log(`[ContextManager] Using ContextManager for reservation ID resolution...`);

            // ✅ STEP 3A: Replace with contextManager call
            const resolution = contextManager.resolveReservationFromContext(
                context.userMessage,
                context.session,
                reservationIdHint
            );

            if (resolution.shouldAskForClarification) {
                const availableIds = context.session.foundReservations?.map(r => `#${r.id}`) || [];
                const errorMessage = await AgentToolTranslationService.translateToolMessage(
                    `I need to know which reservation to modify. Available reservations: ${availableIds.join(', ')}. Please specify the reservation number.`,
                    context.language as Language,
                    'error'
                );

                return createBusinessRuleFailure(
                    errorMessage,
                    'RESERVATION_ID_REQUIRED'
                );
            }

            if (!resolution.resolvedId) {
                const errorMessage = await AgentToolTranslationService.translateToolMessage(
                    "I need the reservation number to make changes. Please provide your confirmation number.",
                    context.language as Language,
                    'error'
                );

                return createBusinessRuleFailure(
                    errorMessage,
                    'RESERVATION_ID_REQUIRED'
                );
            }

            targetReservationId = resolution.resolvedId;
            console.log(`[ContextManager] ✅ Resolved reservation ID: ${targetReservationId} (method: ${resolution.method}, confidence: ${resolution.confidence})`);
        } else {
            // Fallback to traditional approach if no context
            if (!reservationIdHint) {
                return createValidationFailure('Reservation ID is required when context resolution is not available');
            }
            targetReservationId = reservationIdHint;
            console.log(`[ContextManager] Using provided reservation ID: ${targetReservationId} (no context available)`);
        }

        // ✅ SECURITY ENHANCEMENT: Validate ownership before modification
        if (context.telegramUserId) {
            console.log(`🔒 [Security] Validating reservation ownership for telegram user: ${context.telegramUserId}`);

            const [ownershipCheck] = await db
                .select({
                    reservationId: reservations.id,
                    guestId: reservations.guestId,
                    telegramUserId: guests.telegram_user_id
                })
                .from(reservations)
                .innerJoin(guests, eq(reservations.guestId, guests.id))
                .where(and(
                    eq(reservations.id, targetReservationId),
                    eq(reservations.restaurantId, context.restaurantId)
                ));

            if (!ownershipCheck) {
                const baseMessage = 'Reservation not found. Please provide the correct confirmation number.';
                const translatedMessage = await AgentToolTranslationService.translateToolMessage(
                    baseMessage,
                    context.language as Language,
                    'error'
                );

                return createBusinessRuleFailure(
                    translatedMessage,
                    'RESERVATION_NOT_FOUND'
                );
            }

            if (ownershipCheck.telegramUserId !== context.telegramUserId) {
                console.warn(`🚨 [Security] UNAUTHORIZED MODIFICATION ATTEMPT: Telegram user ${context.telegramUserId} tried to modify reservation ${targetReservationId} owned by ${ownershipCheck.telegramUserId}`);

                const baseMessage = 'For security, you can only modify reservations linked to your own account. Please provide the confirmation number for the correct booking.';
                const translatedMessage = await AgentToolTranslationService.translateToolMessage(
                    baseMessage,
                    context.language as Language,
                    'error'
                );

                return createBusinessRuleFailure(
                    translatedMessage,
                    'UNAUTHORIZED_MODIFICATION'
                );
            }
            console.log(`✅ [Security] Ownership validated for reservation ${targetReservationId}`);
        }

        // ✅ STEP 1: Get current reservation details
        const [currentReservation] = await db
            .select({
                id: reservations.id,
                reservation_utc: reservations.reservation_utc,
                guests: reservations.guests,
                comments: reservations.comments,
                status: reservations.status,
                tableId: reservations.tableId,
                guestId: reservations.guestId,
                booking_guest_name: reservations.booking_guest_name
            })
            .from(reservations)
            .where(and(
                eq(reservations.id, targetReservationId),
                eq(reservations.restaurantId, context.restaurantId)
            ));

        if (!currentReservation) {
            const baseMessage = 'Reservation not found.';
            const translatedMessage = await AgentToolTranslationService.translateToolMessage(
                baseMessage,
                context.language as Language,
                'error'
            );
            return createBusinessRuleFailure(translatedMessage, 'RESERVATION_NOT_FOUND');
        }

        // ✅ NEW: Check if reservation is already canceled
        if (currentReservation.status === 'canceled') {
            const baseMessage = 'Cannot modify a canceled reservation. Please create a new booking instead.';
            const translatedMessage = await AgentToolTranslationService.translateToolMessage(
                baseMessage,
                context.language as Language,
                'error'
            );
            return createBusinessRuleFailure(translatedMessage, 'RESERVATION_ALREADY_CANCELED');
        }

        console.log(`📋 [Maya Tool] Current reservation details:`, {
            id: currentReservation.id,
            currentGuests: currentReservation.guests,
            currentTable: currentReservation.tableId,
            status: currentReservation.status
        });

        // ✅ STEP 2: Parse current reservation date/time
        const normalizedTimestamp = normalizeDatabaseTimestamp(currentReservation.reservation_utc);
        const currentReservationDt = DateTime.fromISO(normalizedTimestamp);

        if (!currentReservationDt.isValid) {
            console.error(`❌ [Maya Tool] Invalid reservation timestamp: ${currentReservation.reservation_utc}`);
            return createSystemError('Invalid reservation timestamp format');
        }

        const currentLocalDt = currentReservationDt.setZone(context.timezone);
        const currentDate = currentLocalDt.toFormat('yyyy-MM-dd');
        const currentTime = currentLocalDt.toFormat('HH:mm');

        // ✅ NEW: NO-OP MODIFICATION VALIDATION
        const hasDateChange = modifications.newDate && modifications.newDate !== currentDate;
        const hasTimeChange = modifications.newTime && modifications.newTime !== currentTime;
        const hasGuestChange = modifications.newGuests && modifications.newGuests !== currentReservation.guests;
        const hasRequestChange = modifications.newSpecialRequests !== undefined && modifications.newSpecialRequests !== (currentReservation.comments || '');

        if (!hasDateChange && !hasTimeChange && !hasGuestChange && !hasRequestChange) {
            console.warn(`[Maya Tool] 🚨 NO-OP MODIFICATION DETECTED for reservation #${targetReservationId}. No changes were requested.`);

            const baseMessage = `No changes were requested. Your reservation is still confirmed for ${currentDate} at ${currentTime} for ${currentReservation.guests} guests. Did you want to make a specific change?`;
            const translatedMessage = await AgentToolTranslationService.translateToolMessage(
                baseMessage,
                context.language as Language,
                'error'
            );

            return createBusinessRuleFailure(
                translatedMessage,
                'NO_OP_MODIFICATION'
            );
        }

        console.log(`📅 [Maya Tool] Current reservation time: ${currentDate} ${currentTime} (${context.timezone})`);

        // ✅ STEP 3: Determine new values (keep current if not changing)
        const newDate = modifications.newDate || currentDate;
        const newTime = modifications.newTime || currentTime;
        const newGuests = modifications.newGuests || currentReservation.guests;
        const newSpecialRequests = modifications.newSpecialRequests !== undefined
            ? modifications.newSpecialRequests
            : currentReservation.comments || '';

        console.log(`🔄 [Maya Tool] Modification plan:`, {
            date: `${currentDate} → ${newDate}`,
            time: `${currentTime} → ${newTime}`,
            guests: `${currentReservation.guests} → ${newGuests}`,
            requests: `"${currentReservation.comments || ''}" → "${newSpecialRequests}"`
        });

        // ✅ STEP 4: Check if we need to find a new table (guest count changed)
        let newTableId = currentReservation.tableId;
        let availabilityMessage = '';

        if (newGuests !== currentReservation.guests || newDate !== currentDate || newTime !== currentTime) {
            console.log(`🔍 [Maya Tool] Guest count, date, or time changed - checking availability for ${newGuests} guests on ${newDate} at ${newTime}`);

            // Check availability excluding current reservation
            const availabilityResult = await check_availability(
                newDate,
                newTime,
                newGuests,
                {
                    ...context,
                    excludeReservationId: targetReservationId // Exclude current reservation from conflict check
                }
            );

            if (availabilityResult.tool_status === 'FAILURE') {
                console.log(`❌ [Maya Tool] No availability for modification:`, availabilityResult.error?.message);

                // Try to suggest alternatives
                const baseMessage = `I'm sorry, but I can't change your reservation to ${newGuests} guests on ${newDate} at ${newTime} because no tables are available. ${availabilityResult.error?.message || ''} Would you like me to suggest alternative times?`;
                const translatedMessage = await AgentToolTranslationService.translateToolMessage(
                    baseMessage,
                    context.language as Language,
                    'error'
                );

                return createBusinessRuleFailure(
                    translatedMessage,
                    'NO_AVAILABILITY_FOR_MODIFICATION'
                );
            }

            if (availabilityResult.tool_status === 'SUCCESS' && availabilityResult.data) {
                // Get new table from availability result
                const newTableName = availabilityResult.data.table;

                // Get table ID from table name
                const [tableRecord] = await db
                    .select({ id: tables.id, name: tables.name, maxGuests: tables.maxGuests })
                    .from(tables)
                    .where(and(
                        eq(tables.restaurantId, context.restaurantId),
                        eq(tables.name, newTableName)
                    ));

                if (tableRecord) {
                    newTableId = tableRecord.id;
                    availabilityMessage = availabilityResult.data.message || '';
                    console.log(`✅ [Maya Tool] Found suitable table: ${newTableName} (ID: ${newTableId}, capacity: ${tableRecord.maxGuests})`);
                } else {
                    console.error(`❌ [Maya Tool] Table not found: ${newTableName}`);
                    return createSystemError(`Table ${newTableName} not found in database`);
                }
            }
        }

        // ✅ STEP 5: Update the reservation in database
        console.log(`💾 [Maya Tool] Updating reservation ${targetReservationId} in database...`);

        // Create new UTC timestamp if date/time changed
        let newReservationUtc = currentReservation.reservation_utc;
        if (newDate !== currentDate || newTime !== currentTime) {
            const newLocalDateTime = DateTime.fromFormat(`${newDate} ${newTime}`, 'yyyy-MM-dd HH:mm', { zone: context.timezone });
            newReservationUtc = newLocalDateTime.toUTC().toISO();
            console.log(`📅 [Maya Tool] New UTC timestamp: ${newReservationUtc}`);
        }

        const updateData: any = {
            guests: newGuests,
            comments: newSpecialRequests,
            lastModifiedAt: new Date()
        };

        if (newReservationUtc !== currentReservation.reservation_utc) {
            updateData.reservation_utc = newReservationUtc;
        }

        if (newTableId !== currentReservation.tableId) {
            updateData.tableId = newTableId;
        }

        await db
            .update(reservations)
            .set(updateData)
            .where(eq(reservations.id, targetReservationId));

        // ✅ STEP 6: Log the modification (CORRECTED LOGIC)
        console.log(`✍️ [Maya Tool] Logging individual modifications...`);
        const modificationLogs: any[] = [];
        const modificationDate = new Date();

        // Check for guest count change
        if (newGuests !== currentReservation.guests) {
            modificationLogs.push({
                reservationId: targetReservationId,
                modifiedBy: 'guest',
                fieldChanged: 'guests',
                oldValue: currentReservation.guests.toString(),
                newValue: newGuests.toString(),
                reason: reason,
                modifiedAt: modificationDate,
                source: context.telegramUserId ? 'telegram' : 'web'
            });
        }

        // Check for date or time change
        if (newDate !== currentDate || newTime !== currentTime) {
            modificationLogs.push({
                reservationId: targetReservationId,
                modifiedBy: 'guest',
                fieldChanged: 'datetime',
                oldValue: `${currentDate} ${currentTime}`,
                newValue: `${newDate} ${newTime}`,
                reason: reason,
                modifiedAt: modificationDate,
                source: context.telegramUserId ? 'telegram' : 'web'
            });
        }

        // Check for table change
        if (newTableId !== currentReservation.tableId) {
            modificationLogs.push({
                reservationId: targetReservationId,
                modifiedBy: 'guest',
                fieldChanged: 'tableId',
                oldValue: currentReservation.tableId?.toString() || 'N/A',
                newValue: newTableId.toString(),
                reason: 'Table reassigned due to modification',
                modifiedAt: modificationDate,
                source: context.telegramUserId ? 'telegram' : 'web'
            });
        }

        // Check for special requests change
        const oldRequests = currentReservation.comments || '';
        if (newSpecialRequests !== oldRequests) {
            modificationLogs.push({
                reservationId: targetReservationId,
                modifiedBy: 'guest',
                fieldChanged: 'special_requests',
                oldValue: oldRequests,
                newValue: newSpecialRequests,
                reason: reason,
                modifiedAt: modificationDate,
                source: context.telegramUserId ? 'telegram' : 'web'
            });
        }

        // Insert all collected log entries into the database
        if (modificationLogs.length > 0) {
            await db.insert(reservationModifications).values(modificationLogs);
        }

        console.log(`✅ [Maya Tool] Successfully modified reservation ${targetReservationId} and logged ${modificationLogs.length} changes.`);

        // 🚀 REDIS PHASE 3: Invalidate guest history cache after successful modification
        await invalidateGuestHistoryCache({
            restaurantId: context.restaurantId,
            telegramUserId: context.telegramUserId
        });

        // ✅ STEP 7: Return success response (NO STATE CLEANUP - this was the bug!)
        const changes = [];
        if (newGuests !== currentReservation.guests) {
            changes.push(`party size changed from ${currentReservation.guests} to ${newGuests}`);
        }
        if (newDate !== currentDate) {
            changes.push(`date changed from ${currentDate} to ${newDate}`);
        }
        if (newTime !== currentTime) {
            changes.push(`time changed from ${currentTime} to ${newTime}`);
        }
        if (newTableId !== currentReservation.tableId) {
            changes.push(`table reassigned`);
        }
        if (newSpecialRequests !== (currentReservation.comments || '')) {
            changes.push(`special requests updated`);
        }

        const baseMessage = `Perfect! I've successfully updated your reservation. ${changes.join(', ')}. ${availabilityMessage}`;
        const translatedMessage = await AgentToolTranslationService.translateToolMessage(
            baseMessage,
            context.language as Language,
            'success'
        );

        // ✅ STEP 3A: Return success with reservation ID for context preservation
        return createSuccessResponse({
            reservationId: targetReservationId, // ✅ CRITICAL: Include reservation ID for context preservation
            previousValues: {
                guests: currentReservation.guests,
                date: currentDate,
                time: currentTime,
                tableId: currentReservation.tableId
            },
            newValues: {
                guests: newGuests,
                date: newDate,
                time: newTime,
                tableId: newTableId
            },
            changes: changes,
            message: translatedMessage
        }, {
            execution_time_ms: Date.now() - startTime,
            cacheInvalidated: !!context.telegramUserId // 🚀 REDIS PHASE 3: Indicate cache invalidation
        });

    } catch (error) {
        console.error(`❌ [Maya Tool] Error modifying reservation:`, error);
        return createSystemError('Failed to modify reservation', error);
    }
}

/**
 * ✅ BUG FIX: Enhanced cancel_reservation with optional confirmCancellation parameter
 * 🚀 REDIS PHASE 3: Now includes cache invalidation after successful cancellation
 */
export async function cancel_reservation(
    reservationId: number,
    reason: string = 'Guest requested cancellation',
    confirmCancellation?: boolean, // 🔧 BUG FIX: Made optional
    context: {
        restaurantId: number;
        timezone: string;
        language: string;
        telegramUserId?: string;
        sessionId?: string;
    }
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`❌ [Maya Tool] Cancelling reservation ${reservationId}, confirmed: ${confirmCancellation}`);

    try {
        // 🔧 BUG FIX: If confirmCancellation is not provided, ask for confirmation
        if (confirmCancellation !== true) {
            // ✅ USE AISERVICE TRANSLATION
            const baseMessage = `Are you sure you want to cancel your reservation? This action cannot be undone. Please confirm if you want to proceed.`;
            const translatedMessage = await AgentToolTranslationService.translateToolMessage(
                baseMessage,
                context.language as Language,
                'error'
            );

            return createBusinessRuleFailure(
                translatedMessage,
                'CANCELLATION_NOT_CONFIRMED'
            );
        }

        // ✅ SECURITY ENHANCEMENT: Validate ownership before cancellation
        if (context.telegramUserId) {
            console.log(`🔒 [Security] Validating reservation ownership for cancellation by telegram user: ${context.telegramUserId}`);

            const [ownershipCheck] = await db
                .select({
                    reservationId: reservations.id,
                    guestId: reservations.guestId,
                    telegramUserId: guests.telegram_user_id
                })
                .from(reservations)
                .innerJoin(guests, eq(reservations.guestId, guests.id))
                .where(and(
                    eq(reservations.id, reservationId),
                    eq(reservations.restaurantId, context.restaurantId)
                ));

            if (!ownershipCheck) {
                // ✅ USE AISERVICE TRANSLATION
                const baseMessage = 'Reservation not found. Please provide the correct confirmation number.';
                const translatedMessage = await AgentToolTranslationService.translateToolMessage(
                    baseMessage,
                    context.language as Language,
                    'error'
                );

                return createBusinessRuleFailure(
                    translatedMessage,
                    'RESERVATION_NOT_FOUND'
                );
            }

            if (ownershipCheck.telegramUserId !== context.telegramUserId) {
                console.warn(`🚨 [Security] UNAUTHORIZED CANCELLATION ATTEMPT: Telegram user ${context.telegramUserId} tried to cancel reservation ${reservationId} owned by ${ownershipCheck.telegramUserId}`);

                // ✅ USE AISERVICE TRANSLATION
                const baseMessage = 'For security, you can only cancel reservations linked to your own account. Please provide the confirmation number for the correct booking.';
                const translatedMessage = await AgentToolTranslationService.translateToolMessage(
                    baseMessage,
                    context.language as Language,
                    'error'
                );

                return createBusinessRuleFailure(
                    translatedMessage,
                    'UNAUTHORIZED_CANCELLATION'
                );
            }

            console.log(`✅ [Security] Ownership validated for cancellation of reservation ${reservationId}`);
        }

        // ✅ STEP 1: Get current reservation details before cancellation
        const [currentReservation] = await db
            .select({
                id: reservations.id,
                reservation_utc: reservations.reservation_utc,
                guests: reservations.guests,
                booking_guest_name: reservations.booking_guest_name,
                comments: reservations.comments,
                status: reservations.status,
                tableId: reservations.tableId,
                guestId: reservations.guestId
            })
            .from(reservations)
            .where(and(
                eq(reservations.id, reservationId),
                eq(reservations.restaurantId, context.restaurantId)
            ));

        if (!currentReservation) {
            const baseMessage = 'Reservation not found.';
            const translatedMessage = await AgentToolTranslationService.translateToolMessage(
                baseMessage,
                context.language as Language,
                'error'
            );
            return createBusinessRuleFailure(translatedMessage, 'RESERVATION_NOT_FOUND');
        }

        if (currentReservation.status === 'canceled') {
            const baseMessage = 'This reservation has already been cancelled.';
            const translatedMessage = await AgentToolTranslationService.translateToolMessage(
                baseMessage,
                context.language as Language,
                'error'
            );
            return createBusinessRuleFailure(translatedMessage, 'ALREADY_CANCELLED');
        }

        console.log(`📋 [Maya Tool] Cancelling reservation details:`, {
            id: currentReservation.id,
            guests: currentReservation.guests,
            guestName: currentReservation.booking_guest_name,
            status: currentReservation.status,
            tableId: currentReservation.tableId
        });

        // ✅ STEP 2: Update reservation status to cancelled
        await db
            .update(reservations)
            .set({
                status: 'canceled',
                cancelledAt: new Date()
            })
            .where(eq(reservations.id, reservationId));

        // ✅ STEP 3: Log the cancellation
        await db.insert(reservationCancellations).values({
            reservationId: reservationId,
            cancelledBy: 'guest',
            reason: reason,
            cancellationDate: new Date(),
            originalReservationData: JSON.stringify({
                guests: currentReservation.guests,
                guestName: currentReservation.booking_guest_name,
                tableId: currentReservation.tableId,
                originalStatus: currentReservation.status,
                reservationUtc: currentReservation.reservation_utc
            })
        });

        console.log(`✅ [Maya Tool] Successfully cancelled reservation ${reservationId}`);

        // 🚀 REDIS PHASE 3: Invalidate guest history cache after successful cancellation
        await invalidateGuestHistoryCache({
            restaurantId: context.restaurantId,
            telegramUserId: context.telegramUserId
        });

        // ✅ STEP 4: Calculate refund eligibility (basic logic)
        const normalizedTimestamp = normalizeDatabaseTimestamp(currentReservation.reservation_utc);
        const reservationDt = DateTime.fromISO(normalizedTimestamp);
        const now = DateTime.now().setZone(context.timezone);
        const hoursUntilReservation = reservationDt.diff(now, 'hours').hours;

        // Simple refund policy: full refund if cancelled more than 24 hours in advance
        const refundEligible = hoursUntilReservation >= 24;
        const refundPercentage = hoursUntilReservation >= 24 ? 100 : hoursUntilReservation >= 2 ? 50 : 0;

        // ✅ STEP 5: Return success response
        const baseSuccessMessage = `Your reservation has been successfully cancelled. We're sorry to see you go and hope to serve you again in the future!${refundEligible ? ' You are eligible for a full refund.' : refundPercentage > 0 ? ` You are eligible for a ${refundPercentage}% refund.` : ''}`;
        const translatedSuccessMessage = await AgentToolTranslationService.translateToolMessage(
            baseSuccessMessage,
            context.language as Language,
            'success'
        );

        return createSuccessResponse({
            reservationId: reservationId,
            previousStatus: currentReservation.status,
            newStatus: 'canceled',
            reason: reason,
            message: translatedSuccessMessage,
            cancelledAt: new Date().toISOString(),
            refundEligible: refundEligible,
            refundPercentage: refundPercentage,
            hoursUntilReservation: Math.round(hoursUntilReservation * 10) / 10
        }, {
            execution_time_ms: Date.now() - startTime,
            cacheInvalidated: !!context.telegramUserId // 🚀 REDIS PHASE 3: Indicate cache invalidation
        });

    } catch (error) {
        console.error(`❌ [Maya Tool] Error cancelling reservation:`, error);
        return createSystemError('Failed to cancel reservation', error);
    }
}

// ✅ FIX #6: Enhanced agent tools configuration with improved tool descriptions
export const agentTools = [
    {
        type: "function" as const,
        function: {
            name: "get_guest_history",
            description: "🚀 REDIS CACHED: Get guest's booking history for personalized service with 1-hour Redis caching. Use this to welcome returning guests and suggest their usual preferences. Cache automatically invalidated when bookings change.",
            parameters: {
                type: "object",
                properties: {
                    telegramUserId: {
                        type: "string",
                        description: "Guest's telegram user ID"
                    }
                },
                required: ["telegramUserId"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "check_availability",
            description: "🚨 ENHANCED VALIDATION: Check if tables are available for ANY specific time (supports exact times like 16:15, 19:43, 8:30) with comprehensive validation pipeline including business hours, past-date prevention, and timezone awareness. Returns standardized response with tool_status and detailed data or error information.",
            parameters: {
                type: "object",
                properties: {
                    date: {
                        type: "string",
                        description: "Date in yyyy-MM-dd format (e.g., 2025-06-27) - validated against past dates"
                    },
                    time: {
                        type: "string",
                        description: "Time in HH:MM format (24-hour) - supports ANY exact time like 16:15, 19:43, 8:30 - validated against business hours"
                    },
                    guests: {
                        type: "number",
                        description: "Number of guests (1-50) - comprehensive validation applied"
                    }
                },
                required: ["date", "time", "guests"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "find_alternative_times",
            description: "🚨 ENHANCED VALIDATION: Find alternative time slots around ANY preferred time (supports exact times like 16:15, 19:43) with comprehensive validation pipeline. Returns standardized response with available alternatives sorted by proximity to preferred time.",
            parameters: {
                type: "object",
                properties: {
                    date: {
                        type: "string",
                        description: "Date in yyyy-MM-dd format (e.g., 2025-06-27) - validated against past dates"
                    },
                    preferredTime: {
                        type: "string",
                        description: "Preferred time in HH:MM format (24-hour) - supports ANY exact time like 16:15, 19:43 - validated comprehensively"
                    },
                    guests: {
                        type: "number",
                        description: "Number of guests (1-50) - comprehensive validation applied"
                    }
                },
                required: ["date", "preferredTime", "guests"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "create_reservation",
            description: "🚨 COMPLETELY ENHANCED + 🚀 REDIS CACHED: Create a new reservation at ANY exact time (supports times like 16:15, 19:43, 8:30) with COMPREHENSIVE 5-LAYER VALIDATION PIPELINE: (1) Basic input validation with field-by-field checks, (2) Past-date validation with 5-minute grace period using restaurant timezone, (3) Business hours validation supporting overnight operations, (4) Input sanitization for all parameters, (5) Workflow validation for special requests. Automatically invalidates guest history cache after successful booking. Returns standardized response indicating success with reservation details or failure with categorized error.",
            parameters: {
                type: "object",
                properties: {
                    guestName: {
                        type: "string",
                        description: "Guest's full name (2-100 characters, validated and sanitized)"
                    },
                    guestPhone: {
                        type: "string",
                        description: "Guest's phone number (7-20 digits with optional formatting, validated with regex)"
                    },
                    date: {
                        type: "string",
                        description: "Date in yyyy-MM-dd format (e.g., 2025-06-27) - ENHANCED: validated against past dates with timezone awareness"
                    },
                    time: {
                        type: "string",
                        description: "Time in HH:MM format (24-hour) - ENHANCED: supports ANY exact time like 16:15, 19:43, 8:30 with business hours validation"
                    },
                    guests: {
                        type: "number",
                        description: "Number of guests (1-50, integer validation applied)"
                    },
                    specialRequests: {
                        type: "string",
                        description: "Special requests or comments (optional, max 500 characters, workflow validation applied)",
                        default: ""
                    }
                },
                required: ["guestName", "guestPhone", "date", "time", "guests"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "get_restaurant_info",
            description: "Get information about the restaurant including flexible time booking capabilities. Returns standardized response with requested information or error details.",
            parameters: {
                type: "object",
                properties: {
                    infoType: {
                        type: "string",
                        enum: ["hours", "location", "cuisine", "contact", "features", "all"],
                        description: "Type of information to retrieve (hours includes flexible time booking settings)"
                    }
                },
                required: ["infoType"]
            }
        }
    },
    // ===== 🆕 MAYA'S TOOLS WITH ENHANCED SEARCH + 🚀 REDIS CACHE INVALIDATION =====
    {
        type: "function" as const,
        function: {
            name: "find_existing_reservation",
            description: "🎯 PRIMARY RESERVATION DISCOVERY TOOL: Use this to ESTABLISH context when you don't have a clear reservation reference. After calling this, immediately use the results for modifications/cancellations - don't ask the user to re-specify what you just found. Sets activeReservationId automatically for single results. Find guest's reservations across different time periods. Use 'upcoming' for future bookings, 'past' for history, 'all' for complete record. Automatically detects user intent from queries like 'do I have bookings?' (upcoming) vs 'were there any?' (past).",
            parameters: {
                type: "object",
                properties: {
                    identifier: {
                        type: "string",
                        description: "Phone number, guest name, or confirmation number to search by"
                    },
                    identifierType: {
                        type: "string",
                        enum: ["phone", "telegram", "name", "confirmation", "auto"],
                        description: "Type of identifier being used. Use 'auto' to let the system decide."
                    },
                    timeRange: {
                        type: "string",
                        enum: ["upcoming", "past", "all"],
                        description: "Time range to search: 'upcoming' for future reservations (default), 'past' for historical reservations, 'all' for complete history"
                    },
                    includeStatus: {
                        type: "array",
                        items: {
                            type: "string",
                            enum: ["created", "confirmed", "completed", "canceled"]
                        },
                        description: "Reservation statuses to include. Defaults: ['created', 'confirmed'] for upcoming, ['completed', 'canceled'] for past"
                    }
                },
                required: ["identifier"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "modify_reservation",
            description: "🎯 PRIMARY MODIFICATION TOOL + 🚀 REDIS CACHED: Your FIRST choice for any reservation modification. AUTOMATICALLY resolves reservation ID from recent context (e.g., 'this booking', recent search results). Call this DIRECTLY when user intent is clear - don't search first. The ContextManager handles ambiguity resolution internally. SECURITY VALIDATED: Only allows guests to modify their own reservations. AUTOMATICALLY REASSIGNS TABLES when needed to ensure capacity requirements are met. NOW SUPPORTS OPTIONAL RESERVATION ID with context-aware resolution. Automatically invalidates guest history cache after successful modification.",
            parameters: {
                type: "object",
                properties: {
                    reservationId: {
                        type: "number",
                        description: "✅ STEP 3A: ID of the reservation to modify (now OPTIONAL - can be resolved from context using ContextManager)"
                    },
                    modifications: {
                        type: "object",
                        properties: {
                            newDate: {
                                type: "string",
                                description: "New date in yyyy-MM-dd format (optional)"
                            },
                            newTime: {
                                type: "string",
                                description: "New time in HH:MM format (optional) - for relative changes, leave empty and specify in reason"
                            },
                            newGuests: {
                                type: "number",
                                description: "New number of guests (optional) - will automatically find suitable table"
                            },
                            newSpecialRequests: {
                                type: "string",
                                description: "Updated special requests (optional)"
                            }
                        }
                    },
                    reason: {
                        type: "string",
                        description: "Reason for the modification - can include relative time changes like 'move 30 minutes later' or 'change to 1 hour earlier'",
                        default: "Guest requested change"
                    }
                },
                required: ["modifications"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "cancel_reservation",
            description: "🔧 BUG FIX + 🚀 REDIS CACHED: Cancel an existing reservation. The system will prompt for confirmation if not provided. SECURITY VALIDATED: Only allows guests to cancel their own reservations. Automatically invalidates guest history cache after successful cancellation.",
            parameters: {
                type: "object",
                properties: {
                    reservationId: {
                        type: "number",
                        description: "ID of the reservation to cancel"
                    },
                    reason: {
                        type: "string",
                        description: "Reason for cancellation",
                        default: "Guest requested cancellation"
                    },
                    confirmCancellation: {
                        type: "boolean",
                        description: "🔧 BUG FIX: Explicit confirmation from guest that they want to cancel. Omit this to have the system prompt the user for confirmation."
                    }
                },
                required: ["reservationId"]
            }
        }
    }
];

// ✅ STEP 3A COMPLETE: Export function implementations with ContextManager integration
// 🚨 COMPLETELY ENHANCED: All functions now include comprehensive validation pipeline
// 🚀 REDIS PHASE 3: All booking functions now include guest history cache invalidation
export const agentFunctions = {
    // 🚀 REDIS PHASE 3: Guest memory tool with Redis caching, cache invalidation, and performance monitoring
    get_guest_history,

    // 🚨 ENHANCED: Sofia's tools with comprehensive validation pipeline
    check_availability, // ✅ Now includes: basic validation + business hours + past-date validation
    find_alternative_times, // ✅ Now includes: basic validation + past-date validation
    create_reservation, // 🚨 COMPLETELY ENHANCED: 5-layer validation pipeline + Redis cache invalidation
    get_restaurant_info,

    // ✅ STEP 3A COMPLETE: Maya's tools with ContextManager integration + Redis cache invalidation
    find_existing_reservation,
    modify_reservation, // ✅ Now uses ContextManager for optional reservationId with context resolution + Redis cache invalidation
    cancel_reservation // 🔧 BUG FIX: Now has optional confirmCancellation parameter + Redis cache invalidation
};
