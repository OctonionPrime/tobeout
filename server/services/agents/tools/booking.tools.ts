// server/services/agents/tools/booking.tools.ts
// ✅ PHASE 5: Booking tools extracted from agent-tools.ts
// SOURCE: agent-tools.ts booking-related functions (lines ~200-300, ~350-450, ~500-650, ~700-800)

import { getAvailableTimeSlots } from '../../availability.service';
import { createTelegramReservation } from '../../../integration/telegram_booking';
import { storage } from '../../../storage';
import type { Language } from '../core/agent.types';
import OpenAI from 'openai';
import { DateTime } from 'luxon';

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
class BookingToolTranslationService {
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
        
        const prompt = `Translate this restaurant booking tool message to ${languageNames[targetLanguage]}:

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
            console.error('[BookingToolTranslation] Error:', error);
            return message; // Fallback to original
        }
    }
}

// ===== BOOKING TOOL CONTEXT INTERFACE =====
export interface BookingToolContext {
    restaurantId: number;
    timezone: string;
    language: string;
    telegramUserId?: string;
    sessionId?: string;
    source?: string;
    confirmedName?: string;
    excludeReservationId?: number; // For Maya's modification scenarios
}

// ===== BOOKING TOOLS IMPLEMENTATION =====

/**
 * Check availability for ANY specific time with optional reservation exclusion
 * SOURCE: agent-tools.ts check_availability function (lines ~200-300)
 */
export async function check_availability(
    date: string,
    time: string,
    guests: number,
    context: BookingToolContext
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`🔍 [Booking Tool] check_availability: ${date} ${time} for ${guests} guests (Restaurant: ${context.restaurantId})${context.excludeReservationId ? ` (excluding reservation ${context.excludeReservationId})` : ''}`);

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

        console.log(`✅ [Booking Tool] Validation passed. Using exact time checking for: ${timeFormatted}${context.excludeReservationId ? ` (excluding reservation ${context.excludeReservationId})` : ''}...`);

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

        console.log(`✅ [Booking Tool] Found ${slots.length} slots for exact time ${timeFormatted}${context.excludeReservationId ? ` (excluding reservation ${context.excludeReservationId})` : ''}`);

        const executionTime = Date.now() - startTime;

        if (slots.length > 0) {
            const bestSlot = slots[0];
            
            // ✅ USE TRANSLATION SERVICE
            const baseMessage = `Table ${bestSlot.tableName} available for ${guests} guests at ${time}${bestSlot.isCombined ? ' (combined tables)' : ''}${context.excludeReservationId ? ` (reservation ${context.excludeReservationId} excluded from conflict check)` : ''}`;
            const translatedMessage = await BookingToolTranslationService.translateToolMessage(
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
            console.log(`⚠️ [Booking Tool] No tables for ${guests} guests at exact time ${timeFormatted}, checking for smaller party sizes...`);

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
                const translatedMessage = await BookingToolTranslationService.translateToolMessage(
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
                const translatedMessage = await BookingToolTranslationService.translateToolMessage(
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
        console.error(`❌ [Booking Tool] check_availability error:`, error);
        return createSystemError('Failed to check availability due to system error', error);
    }
}

/**
 * Find alternative time slots around ANY preferred time with excludeReservationId support
 * SOURCE: agent-tools.ts find_alternative_times function (lines ~350-450)
 */
export async function find_alternative_times(
    date: string,
    preferredTime: string,
    guests: number,
    context: BookingToolContext
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`🔍 [Booking Tool] find_alternative_times: ${date} around ${preferredTime} for ${guests} guests${context.excludeReservationId ? ` (excluding reservation ${context.excludeReservationId})` : ''}`);

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

        console.log(`✅ [Booking Tool] Validation passed for alternatives around exact time: ${timeFormatted}${context.excludeReservationId ? ` (excluding reservation ${context.excludeReservationId})` : ''}...`);

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
                excludeReservationId: context.excludeReservationId
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

        console.log(`✅ [Booking Tool] Found ${alternatives.length} alternatives around ${preferredTime}${context.excludeReservationId ? ` (excluding reservation ${context.excludeReservationId})` : ''}`);

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
            const translatedMessage = await BookingToolTranslationService.translateToolMessage(
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
        console.error(`❌ [Booking Tool] find_alternative_times error:`, error);
        return createSystemError('Failed to find alternative times due to system error', error);
    }
}

/**
 * Create a reservation with proper name clarification handling
 * SOURCE: agent-tools.ts create_reservation function (lines ~500-650)
 */
export async function create_reservation(
    guestName: string,
    guestPhone: string,
    date: string,
    time: string,
    guests: number,
    specialRequests: string = '',
    context: BookingToolContext
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`📝 [Booking Tool] create_reservation: ${guestName} (${guestPhone}) for ${guests} guests on ${date} at ${time}`);

    const effectiveGuestName = context.confirmedName || guestName;
    if (context.confirmedName) {
        console.log(`📝 [Booking Tool] Using confirmed name: ${context.confirmedName} (original: ${guestName})`);
    }

    try {
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

        console.log(`✅ [Booking Tool] Validation passed. Creating reservation with exact time:`);
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
            console.log(`⚠️ [Booking Tool] NAME MISMATCH DETECTED: Converting to proper format for conversation manager`);

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

        console.log(`🔍 [Booking Tool] Reservation result:`, {
            success: result.success,
            status: result.status,
            reservationId: result.reservation?.id,
            message: result.message
        });

        if (result.success && result.reservation && result.reservation.id) {
            console.log(`✅ [Booking Tool] Exact time reservation created successfully: #${result.reservation.id} at ${timeFormatted}`);
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
            console.log(`⚠️ [Booking Tool] Exact time reservation failed:`, {
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
            const translatedMessage = await BookingToolTranslationService.translateToolMessage(
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
        console.error(`❌ [Booking Tool] create_reservation error:`, error);

        console.error(`❌ [Booking Tool] Error details:`, {
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
 * SOURCE: agent-tools.ts get_restaurant_info function (lines ~700-800)
 */
export async function get_restaurant_info(
    infoType: 'hours' | 'location' | 'cuisine' | 'contact' | 'features' | 'all',
    context: BookingToolContext
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`ℹ️ [Booking Tool] get_restaurant_info: ${infoType} for restaurant ${context.restaurantId}`);

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

        console.log(`✅ [Booking Tool] Getting restaurant info for ID: ${context.restaurantId}`);

        const restaurant = await storage.getRestaurant(context.restaurantId);
        if (!restaurant) {
            return createBusinessRuleFailure('Restaurant not found', 'RESTAURANT_NOT_FOUND');
        }

        console.log(`✅ [Booking Tool] Found restaurant: ${restaurant.name}`);

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
            message = await BookingToolTranslationService.translateToolMessage(
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
        console.error(`❌ [Booking Tool] get_restaurant_info error:`, error);
        return createSystemError('Failed to retrieve restaurant information due to system error', error);
    }
}

// ===== BOOKING TOOLS EXPORT =====
export const bookingTools = {
    check_availability,
    find_alternative_times,
    create_reservation,
    get_restaurant_info
};

// ===== TOOL DEFINITIONS FOR AGENTS =====
export const bookingToolDefinitions = [
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
    }
];

// ===== DEFAULT EXPORT =====
export default bookingTools;