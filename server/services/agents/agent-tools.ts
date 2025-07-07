// server/services/agents/agent-tools.ts
// ✅ PHASE 1 FIXES APPLIED:
// 1. Enhanced modify_reservation with smart context resolution
// 2. Optional reservationId parameter with context awareness
// 3. Integration with context preservation system
// 4. Removed state cleanup logic that was causing context loss

import { getAvailableTimeSlots } from '../availability.service';
import { createTelegramReservation } from '../telegram_booking';
import { storage } from '../../storage';
import type { Restaurant } from '@shared/schema';
import { DateTime } from 'luxon';
import { getRestaurantDateTime } from '../../utils/timezone-utils';
import type { Language } from '../enhanced-conversation-manager';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

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
}

/**
 * ✅ CRITICAL FIX: Translation Service for Agent Tool Messages
 */
class AgentToolTranslationService {
    private static client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
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
            const completion = await this.client.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 300,
                temperature: 0.2
            });
            
            return completion.choices[0]?.message?.content?.trim() || message;
        } catch (error) {
            console.error('[AgentToolTranslation] Error:', error);
            return message; // Fallback to original
        }
    }
}

/**
 * ✅ CRITICAL FIX: Enhanced AI Analysis Service with much better prompts and no generic patterns
 */
class AgentAIAnalysisService {
    private static openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    private static claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

    /**
     * ✅ ENHANCED: AI Abstraction Layer with Robust OpenAI Fallbacks (matching conversation manager)
     */
    private static async generateContentWithFallback(prompt: string, agentContext: string): Promise<string> {
        // --- Primary Model: Claude Haiku ---
        try {
            const result = await this.claude.messages.create({
                model: "claude-3-haiku-20240307", // Fast and cost-effective for analysis tasks
                max_tokens: 1000,
                temperature: 0.2,
                messages: [{ role: 'user', content: prompt }]
            });

            const response = result.content[0];
            if (response.type === 'text') {
                console.log(`[AI Primary] Claude Haiku succeeded for [${agentContext}]`);
                return response.text;
            }
            throw new Error("Non-text response from Claude");

        } catch (error: any) {
            const errorMessage = error.message || 'Unknown error';
            console.warn(`[AI Fallback] Claude Haiku failed for [${agentContext}]. Reason: ${errorMessage.split('\n')[0]}`);

            // ✅ ENHANCED: Always attempt OpenAI fallback for critical analysis components
            return await this.openAIFallbackWithRetries(prompt, agentContext, errorMessage);
        }
    }

    /**
     * ✅ NEW: Enhanced OpenAI Fallback System with Multiple Model Options and Retries
     */
    private static async openAIFallbackWithRetries(
        prompt: string,
        agentContext: string,
        claudeError: string
    ): Promise<string> {
        // Define fallback models in order of preference for analysis tasks
        const fallbackModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'];

        for (let i = 0; i < fallbackModels.length; i++) {
            const model = fallbackModels[i];
            
            try {
                console.log(`[AI Fallback] Attempting OpenAI ${model} (attempt ${i + 1}/${fallbackModels.length}) for [${agentContext}]`);
                
                const maxTokens = 1000;
                const temperature = model === 'gpt-3.5-turbo' ? 0.3 : 0.4; // Lower temp for less capable models
                
                const gptCompletion = await this.openaiClient.chat.completions.create({
                    model: model,
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: maxTokens,
                    temperature: temperature,
                    timeout: 30000 // 30 second timeout
                });
                
                const gptResponse = gptCompletion.choices[0]?.message?.content?.trim();
                if (gptResponse && gptResponse.length > 10) { // Basic content validation
                    console.log(`[AI Fallback] ✅ Successfully used OpenAI ${model} as fallback for [${agentContext}]`);
                    return gptResponse;
                }
                
                throw new Error(`Empty or invalid response from ${model}`);
                
            } catch (gptError: any) {
                const gptErrorMessage = gptError.message || 'Unknown error';
                console.warn(`[AI Fallback] OpenAI ${model} failed for [${agentContext}]: ${gptErrorMessage.split('\n')[0]}`);
                
                // If this was the last model, we'll fall through to the safe default
                if (i === fallbackModels.length - 1) {
                    console.error(`[AI Fallback] 🚨 CRITICAL: All AI models failed for [${agentContext}]. Claude: ${claudeError}, Final OpenAI: ${gptErrorMessage}`);
                }
                
                // Continue to next model
                continue;
            }
        }
        
        // ✅ ENHANCED: Context-aware safe defaults for analysis
        return this.generateAnalysisSafeDefault(agentContext);
    }

    /**
     * ✅ NEW: Generate context-aware safe defaults for analysis when all AI models fail
     */
    private static generateAnalysisSafeDefault(agentContext: string): string {
        console.warn(`[AI Fallback] Using safe default for [${agentContext}]`);
        
        if (agentContext === 'SpecialRequestAnalysis') {
            return JSON.stringify({
                patterns: [],
                reasoning: "AI analysis temporarily unavailable - no recurring patterns identified"
            });
        }
        
        // Generic fallback for other analysis contexts
        return JSON.stringify({
            patterns: [],
            reasoning: "AI analysis system temporarily unavailable",
            confidence: 0.0,
            fallback: true
        });
    }

    /**
     * ✅ CRITICAL FIX: Much improved AI prompt to avoid generic "meal requests"
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

If no genuinely useful patterns emerge, return: {"patterns": [], "reasoning": "No actionable recurring patterns found"}`;

            // ✅ USE CLAUDE HAIKU: AI analysis with fallback system
            const responseText = await this.generateContentWithFallback(prompt, 'SpecialRequestAnalysis');
            
            // Parse the JSON response
            const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            let analysis: { patterns: string[]; reasoning: string };
            
            try {
                analysis = JSON.parse(cleanJson);
            } catch (parseError) {
                console.warn('[SpecialRequestAnalysis] Failed to parse AI response, using fallback logic');
                return this.fallbackKeywordAnalysis(allComments);
            }

            // Validate and clean the results
            const validPatterns = Array.isArray(analysis.patterns) 
                ? analysis.patterns
                    .filter(p => typeof p === 'string' && p.length > 0 && p.length < 100)
                    .filter(p => !this.isGenericPattern(p)) // ✅ CRITICAL: Filter out generic patterns
                    .slice(0, 3) // Max 3 patterns to keep focused
                : [];

            console.log(`🤖 [SpecialRequestAnalysis] Enhanced AI identified ${validPatterns.length} useful patterns for ${guestName}:`, validPatterns);
            console.log(`🤖 [SpecialRequestAnalysis] AI reasoning: ${analysis.reasoning}`);
            return validPatterns;

        } catch (error) {
            console.error('[SpecialRequestAnalysis] AI analysis failed:', error);
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
     * ✅ Enhanced fallback keyword analysis with better patterns
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

        console.log(`🔄 [SpecialRequestAnalysis] Fallback analysis found ${frequentRequests.length} useful patterns`);
        return frequentRequests;
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

/**
 * ✅ PHASE 1 FIX: Smart Context Preservation and Resolution Functions
 */
function cleanExpiredContext(session: BookingSessionWithAgent): void {
    if (!session.recentlyModifiedReservations) return;
    
    const now = new Date();
    const beforeCount = session.recentlyModifiedReservations.length;
    
    session.recentlyModifiedReservations = session.recentlyModifiedReservations
        .filter(r => r.contextExpiresAt > now);
    
    const afterCount = session.recentlyModifiedReservations.length;
    
    if (beforeCount > afterCount) {
        console.log(`[ContextManager] Cleaned ${beforeCount - afterCount} expired context entries`);
    }
}

function resolveReservationFromContext(
    userMessage: string,
    session: BookingSessionWithAgent,
    providedId?: number
): {
    resolvedId: number | null;
    confidence: 'high' | 'medium' | 'low';
    method: string;
    shouldAskForClarification: boolean;
} {
    
    // Clean expired context first
    cleanExpiredContext(session);
    
    // 1. If explicit ID provided and valid, use it
    if (providedId) {
        if (session.foundReservations?.some(r => r.id === providedId)) {
            return {
                resolvedId: providedId,
                confidence: 'high',
                method: 'explicit_id_validated',
                shouldAskForClarification: false
            };
        }
    }
    
    // 2. Check for recent modifications (high confidence)
    if (session.recentlyModifiedReservations?.length > 0) {
        const recentReservation = session.recentlyModifiedReservations[0];
        if (recentReservation.contextExpiresAt > new Date()) {
            // Check for contextual references
            const contextualPhrases = ['эту бронь', 'this booking', 'it', 'её', 'эту', 'this one', 'that one'];
            const userMessageLower = userMessage.toLowerCase();
            
            if (contextualPhrases.some(phrase => userMessageLower.includes(phrase))) {
                return {
                    resolvedId: recentReservation.reservationId,
                    confidence: 'high',
                    method: 'recent_modification_context',
                    shouldAskForClarification: false
                };
            }
        }
    }
    
    // 3. Check active reservation (medium confidence)
    if (session.activeReservationId) {
        return {
            resolvedId: session.activeReservationId,
            confidence: 'medium',
            method: 'active_session_reservation',
            shouldAskForClarification: false
        };
    }
    
    // 4. Single found reservation (medium confidence)
    if (session.foundReservations?.length === 1) {
        return {
            resolvedId: session.foundReservations[0].id,
            confidence: 'medium',
            method: 'single_found_reservation',
            shouldAskForClarification: false
        };
    }
    
    // 5. Multiple reservations - need clarification
    return {
        resolvedId: null,
        confidence: 'low',
        method: 'ambiguous_context',
        shouldAskForClarification: true
    };
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

// ===== 🆕 NEW: GUEST HISTORY TOOL =====

/**
 * ✅ CRITICAL FIX: Get guest history with TRANSLATED frequent requests
 */
export async function get_guest_history(
    telegramUserId: string,
    context: { restaurantId: number; language?: string }
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`👤 [Guest History] Getting history for telegram user: ${telegramUserId} at restaurant ${context.restaurantId}`);

    try {
        if (!telegramUserId || !context.restaurantId) {
            return createValidationFailure('Missing required parameters: telegramUserId or restaurantId');
        }

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
            return createSuccessResponse({
                guest_name: guest.name,
                guest_phone: guest.phone || '',
                total_bookings: 0,
                total_cancellations: 0,
                last_visit_date: null,
                common_party_size: null,
                frequent_special_requests: []
            }, {
                execution_time_ms: Date.now() - startTime
            });
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

        // 6. ✅ CRITICAL FIX: Enhanced AI-powered analysis that avoids generic patterns
        const englishRequests = await AgentAIAnalysisService.analyzeSpecialRequests(
            completedReservations,
            guest.name
        );

        console.log(`👤 [Guest History] Enhanced AI-analyzed frequent requests (English):`, englishRequests);

        // 7. ✅ CRITICAL FIX: Translate the requests to target language
        let translatedRequests = englishRequests;
        if (context.language && context.language !== 'en' && englishRequests.length > 0) {
            console.log(`👤 [Guest History] Translating requests to ${context.language}...`);
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
            frequent_special_requests: translatedRequests // ✅ Now properly translated
        };

        console.log(`👤 [Guest History] Final history data with translations:`, historyData);

        return createSuccessResponse(historyData, {
            execution_time_ms: Date.now() - startTime
        });

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
        if (!date || !time || !guests || !context.restaurantId) {
            return createValidationFailure('Missing required parameters: date, time, guests, or restaurantId');
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return createValidationFailure('Invalid date format. Expected yyyy-MM-dd', 'date');
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

        if (guests <= 0 || guests > 50) {
            return createValidationFailure('Invalid number of guests. Must be between 1 and 50', 'guests');
        }

        console.log(`✅ [Agent Tool] Validation passed. Using exact time checking for: ${timeFormatted}${context.excludeReservationId ? ` (excluding reservation ${context.excludeReservationId})` : ''}...`);

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
            
            // ✅ USE TRANSLATION SERVICE
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
                // ✅ USE TRANSLATION SERVICE
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
                // ✅ USE TRANSLATION SERVICE
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
        if (!date || !preferredTime || !guests || !context.restaurantId) {
            return createValidationFailure('Missing required parameters: date, preferredTime, guests, or restaurantId');
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return createValidationFailure('Invalid date format. Expected yyyy-MM-dd', 'date');
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

        if (guests <= 0 || guests > 50) {
            return createValidationFailure('Invalid number of guests. Must be between 1 and 50', 'guests');
        }

        console.log(`✅ [Agent Tool] Validation passed for alternatives around exact time: ${timeFormatted}${context.excludeReservationId ? ` (excluding reservation ${context.excludeReservationId})` : ''}...`);

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
            // ✅ USE TRANSLATION SERVICE
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
 * ✅ CRITICAL FIX: Create a reservation with proper name clarification handling
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
    }
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`📝 [Agent Tool] create_reservation: ${guestName} (${guestPhone}) for ${guests} guests on ${date} at ${time}`);

    const effectiveGuestName = context.confirmedName || guestName;
    if (context.confirmedName) {
        console.log(`📝 [Agent Tool] Using confirmed name: ${context.confirmedName} (original: ${guestName})`);
    }

    try {
        if (!context) {
            return createValidationFailure('Context object is required but undefined');
        }

        if (!effectiveGuestName || !guestPhone || !date || !time || !guests) {
            return createValidationFailure('Missing required parameters: guestName, guestPhone, date, time, or guests');
        }

        if (!context.restaurantId) {
            return createValidationFailure('Context missing restaurantId');
        }

        if (!context.timezone) {
            return createValidationFailure('Context missing timezone');
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return createValidationFailure(`Invalid date format: ${date}. Expected yyyy-MM-dd`, 'date');
        }

        let timeFormatted: string;
        if (/^\d{1,2}:\d{2}$/.test(time)) {
            const [hours, minutes] = time.split(':');
            timeFormatted = `${hours.padStart(2, '0')}:${minutes}`;
        } else if (/^\d{1,2}:\d{2}:\d{2}$/.test(time)) {
            timeFormatted = time.substring(0, 5);
        } else {
            return createValidationFailure(`Invalid time format: ${time}. Expected HH:MM or HH:MM:SS`, 'time');
        }

        if (guests <= 0 || guests > 50) {
            return createValidationFailure(`Invalid number of guests: ${guests}. Must be between 1 and 50`, 'guests');
        }

        const cleanPhone = guestPhone.replace(/[^\d+\-\s()]/g, '').trim();
        if (!cleanPhone) {
            return createValidationFailure('Invalid phone number format', 'guestPhone');
        }

        const cleanName = effectiveGuestName.trim();
        if (cleanName.length < 2) {
            return createValidationFailure('Guest name must be at least 2 characters', 'guestName');
        }

        console.log(`✅ [Agent Tool] Validation passed. Creating reservation with exact time:`);
        console.log(`   - Restaurant ID: ${context.restaurantId}`);
        console.log(`   - Guest: ${cleanName} (${cleanPhone})`);
        console.log(`   - Date/Time: ${date} ${timeFormatted} (exact time support)`);
        console.log(`   - Guests: ${guests}`);
        console.log(`   - Timezone: ${context.timezone}`);
        console.log(`   - Confirmed Name: ${context.confirmedName || 'none'}`);

        const result = await createTelegramReservation(
            context.restaurantId,
            date,
            timeFormatted,
            guests,
            cleanName,
            cleanPhone,
            context.telegramUserId || context.sessionId || 'web_chat_user',
            specialRequests,
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
            console.log(`✅ [Agent Tool] Exact time reservation created successfully: #${result.reservation.id} at ${timeFormatted}`);
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
                specialRequests: specialRequests,
                message: result.message,
                success: true,
                timeSupported: 'exact'
            }, {
                execution_time_ms: executionTime
            });
        } else {
            console.log(`⚠️ [Agent Tool] Exact time reservation failed:`, {
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

            // ✅ USE TRANSLATION SERVICE
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
        console.error(`❌ [Agent Tool] create_reservation error:`, error);

        console.error(`❌ [Agent Tool] Error details:`, {
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

        return createSystemError('Failed to create reservation due to system error', error);
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

        // ✅ USE TRANSLATION SERVICE if language context provided
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
                    // ✅ USE TRANSLATION SERVICE
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
            // ✅ USE TRANSLATION SERVICE
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

        // ✅ USE TRANSLATION SERVICE
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
 * ✅ PHASE 1 FIX: Enhanced modify_reservation with smart context resolution
 * This is the CRITICAL function that was causing the context loss problem
 */
export async function modify_reservation(
    reservationIdHint: number | undefined, // ✅ PHASE 1 FIX: Made optional
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
        // ✅ PHASE 1 FIX: Added new context parameters
        userMessage?: string;
        session?: BookingSessionWithAgent;
    }
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`✏️ [Maya Tool] Modifying reservation ${reservationIdHint || 'TBD'}:`, modifications);

    try {
        // ✅ PHASE 1 FIX: Smart reservation ID resolution with context awareness
        let targetReservationId: number;
        
        if (context.session && context.userMessage) {
            console.log(`[SmartContext] Using context resolution for reservation ID...`);
            
            const resolution = resolveReservationFromContext(
                context.userMessage,
                context.session,
                reservationIdHint
            );

            if (resolution.shouldAskForClarification) {
                const availableIds = context.session.foundReservations?.map(r => `#${r.id}`) || [];
                const errorMessage = await AgentToolTranslationService.translateToolMessage(
                    `I need to know which reservation to modify. Available reservations: ${availableIds.join(', ')}. Please specify the reservation number.`,
                    context.language as Language,
                    'question'
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
            console.log(`[SmartContext] Resolved reservation ID: ${targetReservationId} (method: ${resolution.method}, confidence: ${resolution.confidence})`);
        } else {
            // Fallback to traditional approach if no context
            if (!reservationIdHint) {
                return createValidationFailure('Reservation ID is required when context resolution is not available');
            }
            targetReservationId = reservationIdHint;
            console.log(`[SmartContext] Using provided reservation ID: ${targetReservationId} (no context available)`);
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

        // ✅ PHASE 1 FIX: Return success with reservation ID for context preservation
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
            execution_time_ms: Date.now() - startTime
        });

    } catch (error) {
        console.error(`❌ [Maya Tool] Error modifying reservation:`, error);
        return createSystemError('Failed to modify reservation', error);
    }
}

/**
 * ✅ COMPLETE IMPLEMENTATION: Enhanced cancel_reservation with ownership validation and proper database operations
 */
export async function cancel_reservation(
    reservationId: number,
    reason: string = 'Guest requested cancellation',
    confirmCancellation: boolean = false,
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
        if (!confirmCancellation) {
            // ✅ USE TRANSLATION SERVICE
            const baseMessage = `Are you sure you want to cancel your reservation? This action cannot be undone. Please confirm if you want to proceed.`;
            const translatedMessage = await AgentToolTranslationService.translateToolMessage(
                baseMessage,
                context.language as Language,
                'question'
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
                // ✅ USE TRANSLATION SERVICE
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

                // ✅ USE TRANSLATION SERVICE
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
            execution_time_ms: Date.now() - startTime
        });

    } catch (error) {
        console.error(`❌ [Maya Tool] Error cancelling reservation:`, error);
        return createSystemError('Failed to cancel reservation', error);
    }
}

// ✅ ENHANCED: Export agent tools configuration with guest history tool and enhanced reservation search
export const agentTools = [
    {
        type: "function" as const,
        function: {
            name: "get_guest_history",
            description: "Get guest's booking history for personalized service. Use this to welcome returning guests and suggest their usual preferences.",
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
            description: "Check if tables are available for ANY specific time (supports exact times like 16:15, 19:43, 8:30). Returns standardized response with tool_status and detailed data or error information.",
            parameters: {
                type: "object",
                properties: {
                    date: {
                        type: "string",
                        description: "Date in yyyy-MM-dd format (e.g., 2025-06-27)"
                    },
                    time: {
                        type: "string",
                        description: "Time in HH:MM format (24-hour) - supports ANY exact time like 16:15, 19:43, 8:30, etc."
                    },
                    guests: {
                        type: "number",
                        description: "Number of guests (1-50)"
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
            description: "Find alternative time slots around ANY preferred time (supports exact times like 16:15, 19:43). Returns standardized response with available alternatives sorted by proximity to preferred time.",
            parameters: {
                type: "object",
                properties: {
                    date: {
                        type: "string",
                        description: "Date in yyyy-MM-dd format (e.g., 2025-06-27)"
                    },
                    preferredTime: {
                        type: "string",
                        description: "Preferred time in HH:MM format (24-hour) - supports ANY exact time like 16:15, 19:43"
                    },
                    guests: {
                        type: "number",
                        description: "Number of guests (1-50)"
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
            description: "Create a new reservation at ANY exact time (supports times like 16:15, 19:43, 8:30). Returns standardized response indicating success with reservation details or failure with categorized error.",
            parameters: {
                type: "object",
                properties: {
                    guestName: {
                        type: "string",
                        description: "Guest's full name"
                    },
                    guestPhone: {
                        type: "string",
                        description: "Guest's phone number"
                    },
                    date: {
                        type: "string",
                        description: "Date in yyyy-MM-dd format (e.g., 2025-06-27)"
                    },
                    time: {
                        type: "string",
                        description: "Time in HH:MM format (24-hour) - supports ANY exact time like 16:15, 19:43, 8:30"
                    },
                    guests: {
                        type: "number",
                        description: "Number of guests (1-50)"
                    },
                    specialRequests: {
                        type: "string",
                        description: "Special requests or comments",
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
    // ===== 🆕 MAYA'S TOOLS WITH ENHANCED SEARCH =====
    {
        type: "function" as const,
        function: {
            name: "find_existing_reservation",
            description: "Find guest's reservations across different time periods. Use 'upcoming' for future bookings, 'past' for history, 'all' for complete record. Automatically detects user intent from queries like 'do I have bookings?' (upcoming) vs 'were there any?' (past).",
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
                        description: "Type of identifier being used. Defaults to 'auto' to let the system intelligently decide."
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
            description: "✅ PHASE 1 FIX: Modify details of an existing reservation with smart context resolution. AUTOMATICALLY REASSIGNS TABLES when needed to ensure capacity requirements are met. SECURITY VALIDATED: Only allows guests to modify their own reservations. NOW SUPPORTS OPTIONAL RESERVATION ID with context-aware resolution.",
            parameters: {
                type: "object",
                properties: {
                    reservationId: {
                        type: "number",
                        description: "✅ PHASE 1 FIX: ID of the reservation to modify (now OPTIONAL - can be resolved from context)"
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
            description: "Cancel an existing reservation. Always ask for confirmation before proceeding. SECURITY VALIDATED: Only allows guests to cancel their own reservations.",
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
                        description: "Explicit confirmation from guest that they want to cancel"
                    }
                },
                required: ["reservationId", "confirmCancellation"]
            }
        }
    }
];

// ✅ PHASE 1 FIX: Export function implementations with enhanced context resolution
export const agentFunctions = {
    // ✅ CRITICAL FIX: Guest memory tool with enhanced AI analysis and translation support
    get_guest_history,

    // Sofia's tools (existing)
    check_availability,
    find_alternative_times,
    create_reservation,
    get_restaurant_info,

    // ✅ PHASE 1 FIX: Maya's tools with smart context resolution and state preservation
    find_existing_reservation,
    modify_reservation, // ✅ Now supports optional reservationId with context resolution
    cancel_reservation
};