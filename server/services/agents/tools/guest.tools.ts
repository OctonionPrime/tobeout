// server/services/agents/tools/guest.tools.ts
// ✅ PHASE 5: Guest history and AI analysis tools extracted from agent-tools.ts
// SOURCE: agent-tools.ts get_guest_history function (lines ~150-200)
// SOURCE: agent-tools.ts AgentAIAnalysisService class (lines ~100-150)

import { DateTime } from 'luxon';
import type { Language } from '../core/agent.types';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// ✅ FIX: Import the Drizzle 'db' instance, schema definitions, and ORM operators
import { db } from '../../../db';
import { eq, and, desc } from 'drizzle-orm';
// ✅ FIX: Use the correct camelCase table names from your schema
import {
    reservations,
    guests
} from '@shared/schema';

// ===== TOOL RESPONSE INTERFACES =====
// SOURCE: agent-tools.ts standardized response interface
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

// ===== RESPONSE CREATION HELPERS =====
// SOURCE: agent-tools.ts helper functions
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

// ===== TRANSLATION SERVICE =====
// SOURCE: agent-tools.ts AgentToolTranslationService class
class GuestToolTranslationService {
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
        
        const prompt = `Translate this restaurant guest service message to ${languageNames[targetLanguage]}:

"${message}"

Context: ${context} message from restaurant guest service tools
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
            console.error('[GuestToolTranslation] Error:', error);
            return message; // Fallback to original
        }
    }
}

// ===== GUEST TOOL CONTEXT INTERFACE =====
export interface GuestToolContext {
    restaurantId: number;
    language?: string;
    telegramUserId?: string;
    sessionId?: string;
}

// ===== AI ANALYSIS SERVICE =====
// SOURCE: agent-tools.ts AgentAIAnalysisService class (lines ~100-150)

/**
 * Enhanced AI Analysis Service with much better prompts and no generic patterns
 * SOURCE: agent-tools.ts AgentAIAnalysisService class
 */
export class GuestAIAnalysisService {
    private static openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    private static claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

    /**
     * AI Abstraction Layer with Robust OpenAI Fallbacks (matching conversation manager)
     * SOURCE: agent-tools.ts generateContentWithFallback method
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
     * Enhanced OpenAI Fallback System with Multiple Model Options and Retries
     * SOURCE: agent-tools.ts openAIFallbackWithRetries method
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
     * Generate context-aware safe defaults for analysis when all AI models fail
     * SOURCE: agent-tools.ts generateAnalysisSafeDefault method
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
     * Much improved AI prompt to avoid generic "meal requests"
     * SOURCE: agent-tools.ts analyzeSpecialRequests method
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
     * Filter out generic/useless patterns
     * SOURCE: agent-tools.ts isGenericPattern method
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
     * Enhanced fallback keyword analysis with better patterns
     * SOURCE: agent-tools.ts fallbackKeywordAnalysis method
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

// ===== DATABASE HELPERS =====

/**
 * Normalize database timestamp for luxon parsing
 * SOURCE: agent-tools.ts normalizeDatabaseTimestamp function
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

// ===== GUEST HISTORY TOOL =====

/**
 * Get guest history with TRANSLATED frequent requests
 * SOURCE: agent-tools.ts get_guest_history function (lines ~150-200)
 */
export async function get_guest_history(
    telegramUserId: string,
    context: GuestToolContext
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`👤 [Guest Tool] Getting history for telegram user: ${telegramUserId} at restaurant ${context.restaurantId}`);

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
            console.log(`👤 [Guest Tool] No guest found for telegram user: ${telegramUserId}`);
            return createBusinessRuleFailure('Guest not found', 'GUEST_NOT_FOUND');
        }

        console.log(`👤 [Guest Tool] Found guest: ${guest.name} (ID: ${guest.id}) with phone: ${guest.phone}`);

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

        console.log(`👤 [Guest Tool] Found ${allReservations.length} total reservations for guest`);

        if (allReservations.length === 0) {
            return createSuccessResponse({
                guest_name: guest.name,
                guest_phone: guest.phone || '',
                total_bookings: 0,
                total_cancellations: 0,
                last_visit_date: null,
                common_party_size: null,
                frequent_special_requests: [],
                retrieved_at: new Date().toISOString()
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

        console.log(`👤 [Guest Tool] Analysis: ${completedReservations.length} completed, ${cancelledReservations.length} cancelled`);

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
            console.log(`👤 [Guest Tool] Most common party size: ${commonPartySize} (from ${JSON.stringify(partySizeCounts)})`);
        }

        // 5. Find last visit date (most recent completed reservation)
        let lastVisitDate = null;
        if (completedReservations.length > 0) {
            const mostRecentCompleted = completedReservations[0]; // Already sorted by desc date
            const normalizedDate = normalizeDatabaseTimestamp(mostRecentCompleted.reservation_utc);
            const reservationDt = DateTime.fromISO(normalizedDate);

            if (reservationDt.isValid) {
                lastVisitDate = reservationDt.toFormat('yyyy-MM-dd');
                console.log(`👤 [Guest Tool] Last visit: ${lastVisitDate}`);
            }
        }

        // 6. ✅ CRITICAL FIX: Enhanced AI-powered analysis that avoids generic patterns
        const englishRequests = await GuestAIAnalysisService.analyzeSpecialRequests(
            completedReservations,
            guest.name
        );

        console.log(`👤 [Guest Tool] Enhanced AI-analyzed frequent requests (English):`, englishRequests);

        // 7. ✅ CRITICAL FIX: Translate the requests to target language
        let translatedRequests = englishRequests;
        if (context.language && context.language !== 'en' && englishRequests.length > 0) {
            console.log(`👤 [Guest Tool] Translating requests to ${context.language}...`);
            translatedRequests = await Promise.all(
                englishRequests.map(request => 
                    GuestToolTranslationService.translateToolMessage(request, context.language as Language)
                )
            );
            console.log(`👤 [Guest Tool] Translated requests:`, translatedRequests);
        }

        // 8. Return structured response with translated frequent requests
        const historyData = {
            guest_name: guest.name,
            guest_phone: guest.phone || '',
            total_bookings: completedReservations.length,
            total_cancellations: cancelledReservations.length,
            last_visit_date: lastVisitDate,
            common_party_size: commonPartySize,
            frequent_special_requests: translatedRequests, // ✅ Now properly translated
            retrieved_at: new Date().toISOString()
        };

        console.log(`👤 [Guest Tool] Final history data with translations:`, historyData);

        return createSuccessResponse(historyData, {
            execution_time_ms: Date.now() - startTime
        });

    } catch (error) {
        console.error(`❌ [Guest Tool] Error getting guest history:`, error);
        return createSystemError('Failed to retrieve guest history due to system error', error);
    }
}

// ===== GUEST TOOLS EXPORT =====
export const guestTools = {
    get_guest_history
};

// ===== TOOL DEFINITIONS FOR AGENTS =====
export const guestToolDefinitions = [
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
    }
];

// ===== EXPORTS =====
export {
    GuestToolTranslationService
};

// ===== DEFAULT EXPORT =====
export default guestTools;