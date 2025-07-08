// server/services/agents/tools/reservation.tools.ts
// ✅ PHASE 5: Reservation management tools extracted from agent-tools.ts
// SOURCE: agent-tools.ts reservation functions (lines ~850-950, ~1000-1200, ~1250-1350)

import { DateTime } from 'luxon';
import { getRestaurantDateTime } from '../../../utils/timezone-utils';
import type { Language } from '../core/agent.types';
import OpenAI from 'openai';

// ✅ FIX: Import the Drizzle 'db' instance, schema definitions, and ORM operators
import { db } from '../../../db';
import { eq, and, gt, lt, gte, like, inArray, sql, desc, ne } from 'drizzle-orm';
// ✅ FIX: Use the correct camelCase table names from your schema
import {
    reservations,
    guests,
    tables,
    reservationModifications,
    reservationCancellations
} from '@shared/schema';

// Import booking tools for availability checking in modifications
import { check_availability } from './booking.tools';

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
class ReservationToolTranslationService {
    private static client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    static async translateToolMessage(
        message: string, 
        targetLanguage: Language,
        context: 'error' | 'success' | 'info' | 'question' = 'info'
    ): Promise<string> {
        if (targetLanguage === 'en' || targetLanguage === 'auto') return message;
        
        const languageNames: Record<Language, string> = {
            'en': 'English', 'ru': 'Russian', 'sr': 'Serbian', 'hu': 'Hungarian',
            'de': 'German', 'fr': 'French', 'es': 'Spanish', 'it': 'Italian',
            'pt': 'Portuguese', 'nl': 'Dutch', 'auto': 'English'
        };
        
        const prompt = `Translate this restaurant reservation management message to ${languageNames[targetLanguage]}:

"${message}"

Context: ${context} message from restaurant reservation management tools
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
            console.error('[ReservationToolTranslation] Error:', error);
            return message; // Fallback to original
        }
    }
}

// ===== RESERVATION TOOL CONTEXT INTERFACE =====
export interface ReservationToolContext {
    restaurantId: number;
    timezone: string;
    language: string;
    telegramUserId?: string;
    sessionId?: string;
    timeRange?: 'upcoming' | 'past' | 'all';
    includeStatus?: string[];
    userMessage?: string; // For context resolution
    session?: BookingSessionWithAgent; // For smart context resolution
}

// ===== CONTEXT RESOLUTION INTERFACES =====
// SOURCE: agent-tools.ts BookingSessionWithAgent interface
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

// ===== CONTEXT RESOLUTION FUNCTIONS =====
// SOURCE: agent-tools.ts smart context preservation functions

/**
 * Clean expired context entries from session
 * SOURCE: agent-tools.ts cleanExpiredContext function
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

/**
 * Resolve reservation ID from context with smart logic
 * SOURCE: agent-tools.ts resolveReservationFromContext function
 */
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

// ===== RESERVATION MANAGEMENT TOOLS =====

/**
 * Find existing reservations with enhanced search capabilities
 * SOURCE: agent-tools.ts find_existing_reservation function (lines ~850-950)
 */
export async function find_existing_reservation(
    identifier: string,
    identifierType: 'phone' | 'telegram' | 'name' | 'confirmation' | 'auto' = 'auto',
    context: ReservationToolContext
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`🔍 [Reservation Tool] Finding reservations for: "${identifier}" (Type: ${identifierType})`);

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
            console.log(`[Reservation Tool] Auto-detected identifier type as '${finalIdentifierType}' for "${identifier}"`);
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
                    console.log(`[Reservation Tool] Showing all completed/canceled reservations (booking history mode)`);
                } else {
                    // Only apply time filter for other statuses
                    conditions.push(lt(reservations.reservation_utc, nowUtc));
                }
                break;
            case 'all':
                // No time filter - search all dates
                break;
        }

        console.log(`[Reservation Tool] Searching ${timeRange} reservations with status: ${includeStatus.join(', ')}${timeRange === 'past' && includeStatus.some(s => ['completed', 'canceled'].includes(s)) ? ' (history mode)' : ''}`);

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
                    const translatedMessage = await ReservationToolTranslationService.translateToolMessage(
                        baseMessage,
                        context.language as Language,
                        'error'
                    );
                    return createBusinessRuleFailure(translatedMessage, 'INVALID_CONFIRMATION');
                }
                conditions.push(eq(reservations.id, numericIdentifier));
                break;
        }

        console.log(`[Reservation Tool] Executing Drizzle query with type '${finalIdentifierType}'...`);

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
            
            const translatedMessage = await ReservationToolTranslationService.translateToolMessage(
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
                console.error(`[Reservation Tool] Invalid date format: ${r.reservation_utc} → ${normalizedDateString}`);
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

            console.log(`[Reservation Tool] DIAGNOSTICS FOR RESERVATION #${r.id}:`);
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
        
        const translatedMessage = await ReservationToolTranslationService.translateToolMessage(
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

        console.log(`🔍 [Reservation Tool] Returning reservation data:`, {
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
        console.error(`❌ [Reservation Tool] Error finding reservations:`, error);
        return createSystemError('Failed to search for reservations', error);
    }
}

/**
 * Enhanced modify_reservation with smart context resolution
 * SOURCE: agent-tools.ts modify_reservation function (lines ~1000-1200)
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
    context: ReservationToolContext
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`✏️ [Reservation Tool] Modifying reservation ${reservationIdHint || 'TBD'}:`, modifications);

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
                const errorMessage = await ReservationToolTranslationService.translateToolMessage(
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
                const errorMessage = await ReservationToolTranslationService.translateToolMessage(
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
                const translatedMessage = await ReservationToolTranslationService.translateToolMessage(
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
                const translatedMessage = await ReservationToolTranslationService.translateToolMessage(
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
            const translatedMessage = await ReservationToolTranslationService.translateToolMessage(
                baseMessage,
                context.language as Language,
                'error'
            );
            return createBusinessRuleFailure(translatedMessage, 'RESERVATION_NOT_FOUND');
        }

        // ✅ NEW: Check if reservation is already canceled
        if (currentReservation.status === 'canceled') {
            const baseMessage = 'Cannot modify a canceled reservation. Please create a new booking instead.';
            const translatedMessage = await ReservationToolTranslationService.translateToolMessage(
                baseMessage,
                context.language as Language,
                'error'
            );
            return createBusinessRuleFailure(translatedMessage, 'RESERVATION_ALREADY_CANCELED');
        }

        console.log(`📋 [Reservation Tool] Current reservation details:`, {
            id: currentReservation.id,
            currentGuests: currentReservation.guests,
            currentTable: currentReservation.tableId,
            status: currentReservation.status
        });

        // ✅ STEP 2: Parse current reservation date/time
        const normalizedTimestamp = normalizeDatabaseTimestamp(currentReservation.reservation_utc);
        const currentReservationDt = DateTime.fromISO(normalizedTimestamp);

        if (!currentReservationDt.isValid) {
            console.error(`❌ [Reservation Tool] Invalid reservation timestamp: ${currentReservation.reservation_utc}`);
            return createSystemError('Invalid reservation timestamp format');
        }

        const currentLocalDt = currentReservationDt.setZone(context.timezone);
        const currentDate = currentLocalDt.toFormat('yyyy-MM-dd');
        const currentTime = currentLocalDt.toFormat('HH:mm');

        console.log(`📅 [Reservation Tool] Current reservation time: ${currentDate} ${currentTime} (${context.timezone})`);

        // ✅ STEP 3: Determine new values (keep current if not changing)
        const newDate = modifications.newDate || currentDate;
        const newTime = modifications.newTime || currentTime;
        const newGuests = modifications.newGuests || currentReservation.guests;
        const newSpecialRequests = modifications.newSpecialRequests !== undefined
            ? modifications.newSpecialRequests
            : currentReservation.comments || '';

        console.log(`🔄 [Reservation Tool] Modification plan:`, {
            date: `${currentDate} → ${newDate}`,
            time: `${currentTime} → ${newTime}`,
            guests: `${currentReservation.guests} → ${newGuests}`,
            requests: `"${currentReservation.comments || ''}" → "${newSpecialRequests}"`
        });

        // ✅ STEP 4: Check if we need to find a new table (guest count changed)
        let newTableId = currentReservation.tableId;
        let availabilityMessage = '';

        if (newGuests !== currentReservation.guests || newDate !== currentDate || newTime !== currentTime) {
            console.log(`🔍 [Reservation Tool] Guest count, date, or time changed - checking availability for ${newGuests} guests on ${newDate} at ${newTime}`);

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
                console.log(`❌ [Reservation Tool] No availability for modification:`, availabilityResult.error?.message);

                // Try to suggest alternatives
                const baseMessage = `I'm sorry, but I can't change your reservation to ${newGuests} guests on ${newDate} at ${newTime} because no tables are available. ${availabilityResult.error?.message || ''} Would you like me to suggest alternative times?`;
                const translatedMessage = await ReservationToolTranslationService.translateToolMessage(
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
                    console.log(`✅ [Reservation Tool] Found suitable table: ${newTableName} (ID: ${newTableId}, capacity: ${tableRecord.maxGuests})`);
                } else {
                    console.error(`❌ [Reservation Tool] Table not found: ${newTableName}`);
                    return createSystemError(`Table ${newTableName} not found in database`);
                }
            }
        }

        // ✅ STEP 5: Update the reservation in database
        console.log(`💾 [Reservation Tool] Updating reservation ${targetReservationId} in database...`);

        // Create new UTC timestamp if date/time changed
        let newReservationUtc = currentReservation.reservation_utc;
        if (newDate !== currentDate || newTime !== currentTime) {
            const newLocalDateTime = DateTime.fromFormat(`${newDate} ${newTime}`, 'yyyy-MM-dd HH:mm', { zone: context.timezone });
            newReservationUtc = newLocalDateTime.toUTC().toISO();
            console.log(`📅 [Reservation Tool] New UTC timestamp: ${newReservationUtc}`);
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

        // ✅ STEP 6: Log the modification
        console.log(`✍️ [Reservation Tool] Logging individual modifications...`);
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

        console.log(`✅ [Reservation Tool] Successfully modified reservation ${targetReservationId} and logged ${modificationLogs.length} changes.`);

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
        const translatedMessage = await ReservationToolTranslationService.translateToolMessage(
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
        console.error(`❌ [Reservation Tool] Error modifying reservation:`, error);
        return createSystemError('Failed to modify reservation', error);
    }
}

/**
 * Enhanced cancel_reservation with ownership validation and proper database operations
 * SOURCE: agent-tools.ts cancel_reservation function (lines ~1250-1350)
 */
export async function cancel_reservation(
    reservationId: number,
    reason: string = 'Guest requested cancellation',
    confirmCancellation: boolean = false,
    context: ReservationToolContext
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`❌ [Reservation Tool] Cancelling reservation ${reservationId}, confirmed: ${confirmCancellation}`);

    try {
        if (!confirmCancellation) {
            // ✅ USE TRANSLATION SERVICE
            const baseMessage = `Are you sure you want to cancel your reservation? This action cannot be undone. Please confirm if you want to proceed.`;
            const translatedMessage = await ReservationToolTranslationService.translateToolMessage(
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
                const translatedMessage = await ReservationToolTranslationService.translateToolMessage(
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
                const translatedMessage = await ReservationToolTranslationService.translateToolMessage(
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
            const translatedMessage = await ReservationToolTranslationService.translateToolMessage(
                baseMessage,
                context.language as Language,
                'error'
            );
            return createBusinessRuleFailure(translatedMessage, 'RESERVATION_NOT_FOUND');
        }

        if (currentReservation.status === 'canceled') {
            const baseMessage = 'This reservation has already been cancelled.';
            const translatedMessage = await ReservationToolTranslationService.translateToolMessage(
                baseMessage,
                context.language as Language,
                'error'
            );
            return createBusinessRuleFailure(translatedMessage, 'ALREADY_CANCELLED');
        }

        console.log(`📋 [Reservation Tool] Cancelling reservation details:`, {
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

        console.log(`✅ [Reservation Tool] Successfully cancelled reservation ${reservationId}`);

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
        const translatedSuccessMessage = await ReservationToolTranslationService.translateToolMessage(
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
        console.error(`❌ [Reservation Tool] Error cancelling reservation:`, error);
        return createSystemError('Failed to cancel reservation', error);
    }
}

// ===== RESERVATION TOOLS EXPORT =====
export const reservationTools = {
    find_existing_reservation,
    modify_reservation,
    cancel_reservation
};

// ===== TOOL DEFINITIONS FOR AGENTS =====
export const reservationToolDefinitions = [
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

// ===== DEFAULT EXPORT =====
export default reservationTools;