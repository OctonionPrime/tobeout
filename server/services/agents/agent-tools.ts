// server/services/agents/agent-tools.ts

import { getAvailableTimeSlots } from '../availability.service';
import { createTelegramReservation } from '../telegram_booking';
import { storage } from '../../storage';
import type { Restaurant } from '@shared/schema';

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
 * Check availability for a specific date, time, and party size
 * ✅ ENHANCED: Standardized response format with detailed error categorization + suggests smaller party sizes
 */
export async function check_availability(
    date: string,
    time: string,
    guests: number,
    context: { restaurantId: number; timezone: string; language: string }
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`🔍 [Agent Tool] check_availability: ${date} ${time} for ${guests} guests (Restaurant: ${context.restaurantId})`);

    try {
        // ✅ VALIDATION: Check required parameters
        if (!date || !time || !guests || !context.restaurantId) {
            return createValidationFailure('Missing required parameters: date, time, guests, or restaurantId');
        }

        // ✅ VALIDATION: Check date format (YYYY-MM-DD)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return createValidationFailure('Invalid date format. Expected YYYY-MM-DD', 'date');
        }

        // ✅ VALIDATION: Check time format (HH:MM or HH:MM:SS)
        const timeFormatted = time.length === 5 ? time + ":00" : time;
        if (!/^\d{2}:\d{2}:\d{2}$/.test(timeFormatted)) {
            return createValidationFailure('Invalid time format. Expected HH:MM or HH:MM:SS', 'time');
        }

        // ✅ VALIDATION: Check guests is positive number
        if (guests <= 0 || guests > 50) {
            return createValidationFailure('Invalid number of guests. Must be between 1 and 50', 'guests');
        }

        console.log(`✅ [Agent Tool] Validation passed. Calling getAvailableTimeSlots with formatted time: ${timeFormatted}...`);

        // Use availability service
        const slots = await getAvailableTimeSlots(
            context.restaurantId,
            date,
            guests,
            {
                requestedTime: timeFormatted,
                maxResults: 5,
                lang: context.language as any,
                timezone: context.timezone,
                allowCombinations: true
            }
        );

        console.log(`✅ [Agent Tool] getAvailableTimeSlots returned ${slots.length} slots`);

        // Find the best matching slot
        let requestedSlot = null;

        // First, try exact time match
        requestedSlot = slots.find(slot => slot.time === timeFormatted);

        if (!requestedSlot) {
            // Try time without seconds (HH:MM format)
            const timeWithoutSeconds = timeFormatted.substring(0, 5);
            requestedSlot = slots.find(slot => slot.time.substring(0, 5) === timeWithoutSeconds);
        }

        if (!requestedSlot && slots.length > 0) {
            // If we still don't find exact match but have slots, take the first available slot
            requestedSlot = slots[0];
            console.log(`⚠️ [Agent Tool] No exact time match found, using first available slot: ${requestedSlot.time}`);
        }

        const executionTime = Date.now() - startTime;

        if (requestedSlot) {
            return createSuccessResponse({
                available: true,
                table: requestedSlot.tableName,
                capacity: requestedSlot.tableCapacity?.max || null,
                isCombined: requestedSlot.isCombined || false,
                message: `Table ${requestedSlot.tableName} available for ${guests} guests${requestedSlot.isCombined ? ' (combined tables)' : ''} at ${requestedSlot.timeDisplay || requestedSlot.time}`,
                constituentTables: requestedSlot.constituentTables || null,
                allAvailableSlots: slots.map(s => ({ time: s.time, table: s.tableName })),
                exactMatch: requestedSlot.time === timeFormatted
            }, {
                execution_time_ms: executionTime,
                fallback_used: requestedSlot.time !== timeFormatted
            });
        } else {
            // ✅ NEW LOGIC: If no tables, check for smaller party sizes
            console.log(`⚠️ [Agent Tool] No tables for ${guests} guests, checking for smaller party sizes...`);

            let suggestedAlternatives = [];

            // Check for smaller number of guests (from guests-1 to 1)
            for (let altGuests = guests - 1; altGuests >= 1 && suggestedAlternatives.length === 0; altGuests--) {
                console.log(`🔍 [Agent Tool] Checking availability for ${altGuests} guests...`);

                const altSlots = await getAvailableTimeSlots(
                    context.restaurantId,
                    date,
                    altGuests,
                    {
                        requestedTime: timeFormatted,
                        maxResults: 3,
                        lang: context.language as any,
                        timezone: context.timezone,
                        allowCombinations: true
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
                return createBusinessRuleFailure(
                    `No tables available for ${guests} guests at ${time} on ${date}. However, I found availability for ${suggestedAlternatives[0].guests} guests. Would you like me to check that option?`,
                    'NO_AVAILABILITY_SUGGEST_SMALLER'
                );
            } else {
                return createBusinessRuleFailure(
                    `No tables available for ${guests} guests at ${time} on ${date}`,
                    'NO_AVAILABILITY'
                );
            }
        }

    } catch (error) {
        console.error(`❌ [Agent Tool] check_availability error:`, error);
        return createSystemError(
            'Failed to check availability due to system error',
            error
        );
    }
}

/**
 * Find alternative time slots around a preferred time
 * ✅ ENHANCED: Standardized response format
 */
export async function find_alternative_times(
    date: string,
    preferredTime: string,
    guests: number,
    context: { restaurantId: number; timezone: string; language: string }
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`🔍 [Agent Tool] find_alternative_times: ${date} around ${preferredTime} for ${guests} guests`);

    try {
        // ✅ VALIDATION: Check required parameters
        if (!date || !preferredTime || !guests || !context.restaurantId) {
            return createValidationFailure('Missing required parameters: date, preferredTime, guests, or restaurantId');
        }

        // ✅ VALIDATION: Check date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return createValidationFailure('Invalid date format. Expected YYYY-MM-DD', 'date');
        }

        // ✅ VALIDATION: Check time format
        const timeFormatted = preferredTime.length === 5 ? preferredTime + ":00" : preferredTime;
        if (!/^\d{2}:\d{2}:\d{2}$/.test(timeFormatted)) {
            return createValidationFailure('Invalid time format. Expected HH:MM or HH:MM:SS', 'preferredTime');
        }

        // ✅ VALIDATION: Check guests
        if (guests <= 0 || guests > 50) {
            return createValidationFailure('Invalid number of guests. Must be between 1 and 50', 'guests');
        }

        console.log(`✅ [Agent Tool] Validation passed for alternatives. Calling getAvailableTimeSlots...`);

        // Use availability service for alternatives
        const slots = await getAvailableTimeSlots(
            context.restaurantId,
            date,
            guests,
            {
                requestedTime: timeFormatted,
                maxResults: 8,
                lang: context.language as any,
                timezone: context.timezone,
                allowCombinations: true
            }
        );

        const alternatives = slots.map(slot => ({
            time: slot.timeDisplay,
            timeInternal: slot.time,
            table: slot.tableName,
            capacity: slot.tableCapacity?.max || 0,
            isCombined: slot.isCombined || false,
            message: `${slot.timeDisplay || slot.time} - ${slot.tableName}${slot.isCombined ? ' (combined)' : ''}`
        }));

        const executionTime = Date.now() - startTime;

        console.log(`✅ [Agent Tool] Found ${alternatives.length} alternatives`);

        if (alternatives.length > 0) {
            return createSuccessResponse({
                alternatives,
                count: alternatives.length,
                date: date,
                preferredTime: preferredTime
            }, {
                execution_time_ms: executionTime
            });
        } else {
            return createBusinessRuleFailure(
                `No alternative times available for ${guests} guests on ${date}`,
                'NO_ALTERNATIVES'
            );
        }

    } catch (error) {
        console.error(`❌ [Agent Tool] find_alternative_times error:`, error);
        return createSystemError(
            'Failed to find alternative times due to system error',
            error
        );
    }
}

/**
 * Create a reservation using existing booking system
 * ✅ ENHANCED: Comprehensive error categorization and standardized responses + better success detection + confirmed name handling
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
        confirmedName?: string; // ✅ NEW: Support confirmed name
    }
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`📝 [Agent Tool] create_reservation: ${guestName} (${guestPhone}) for ${guests} guests on ${date} at ${time}`);

    // ✅ CRITICAL: Use confirmed name if provided
    const effectiveGuestName = context.confirmedName || guestName;
    if (context.confirmedName) {
        console.log(`📝 [Agent Tool] Using confirmed name: ${context.confirmedName} (original: ${guestName})`);
    }

    try {
        // ✅ VALIDATION: Check context object exists
        if (!context) {
            return createValidationFailure('Context object is required but undefined');
        }

        // ✅ VALIDATION: Check required parameters
        if (!effectiveGuestName || !guestPhone || !date || !time || !guests) {
            return createValidationFailure('Missing required parameters: guestName, guestPhone, date, time, or guests');
        }

        // ✅ VALIDATION: Check context has required fields
        if (!context.restaurantId) {
            return createValidationFailure('Context missing restaurantId');
        }

        if (!context.timezone) {
            return createValidationFailure('Context missing timezone');
        }

        // ✅ VALIDATION: Check date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return createValidationFailure(`Invalid date format: ${date}. Expected YYYY-MM-DD`, 'date');
        }

        // ✅ VALIDATION: Check time format and convert to HH:MM
        let timeFormatted: string;
        if (/^\d{1,2}:\d{2}$/.test(time)) {
            const [hours, minutes] = time.split(':');
            timeFormatted = `${hours.padStart(2, '0')}:${minutes}`;
        } else if (/^\d{1,2}:\d{2}:\d{2}$/.test(time)) {
            timeFormatted = time.substring(0, 5);
        } else {
            return createValidationFailure(`Invalid time format: ${time}. Expected HH:MM or HH:MM:SS`, 'time');
        }

        // ✅ VALIDATION: Check guests
        if (guests <= 0 || guests > 50) {
            return createValidationFailure(`Invalid number of guests: ${guests}. Must be between 1 and 50`, 'guests');
        }

        // ✅ VALIDATION: Clean phone number
        const cleanPhone = guestPhone.replace(/[^\d+\-\s()]/g, '').trim();
        if (!cleanPhone) {
            return createValidationFailure('Invalid phone number format', 'guestPhone');
        }

        // ✅ VALIDATION: Clean guest name
        const cleanName = effectiveGuestName.trim();
        if (cleanName.length < 2) {
            return createValidationFailure('Guest name must be at least 2 characters', 'guestName');
        }

        console.log(`✅ [Agent Tool] Validation passed. Creating reservation with:`);
        console.log(`   - Restaurant ID: ${context.restaurantId}`);
        console.log(`   - Guest: ${cleanName} (${cleanPhone})`);
        console.log(`   - Date/Time: ${date} ${timeFormatted}`);
        console.log(`   - Guests: ${guests}`);
        console.log(`   - Timezone: ${context.timezone}`);
        console.log(`   - Confirmed Name: ${context.confirmedName || 'none'}`);

        // ✅ CRITICAL: Use existing createTelegramReservation function with confirmed name
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
            context.confirmedName, // ✅ CRITICAL: Pass confirmed name
            undefined, // selected_slot_info
            context.timezone
        );

        const executionTime = Date.now() - startTime;

        // ✅ ENHANCED: More thorough success checking
        console.log(`🔍 [Agent Tool] Reservation result:`, {
            success: result.success,
            status: result.status,
            reservationId: result.reservation?.id,
            message: result.message
        });

        if (result.success && result.reservation && result.reservation.id) {
            console.log(`✅ [Agent Tool] Reservation created successfully: #${result.reservation.id}`);
            return createSuccessResponse({
                reservationId: result.reservation.id,
                confirmationNumber: result.reservation.id,
                table: result.table,
                guestName: cleanName,
                guestPhone: cleanPhone,
                date: date,
                time: timeFormatted,
                guests: guests,
                specialRequests: specialRequests,
                message: result.message,
                success: true // ✅ Add explicit success flag
            }, {
                execution_time_ms: executionTime
            });
        } else {
            console.log(`⚠️ [Agent Tool] Reservation failed:`, {
                success: result.success,
                status: result.status,
                message: result.message,
                reservation: result.reservation
            });

            // ✅ ENHANCED: Handle the specific name mismatch clarification case
            if (result.status === 'name_mismatch_clarification_needed' && result.nameConflict) {
                const { dbName, requestName } = result.nameConflict;
                return createFailureResponse(
                    'BUSINESS_RULE',
                    `The user has booked before as '${dbName}' but is now using '${requestName}'. Clarification is required.`,
                    'NAME_CLARIFICATION_NEEDED', // A new, specific error code for the agent
                    {
                        dbName: dbName,
                        requestName: requestName,
                        originalMessage: result.message
                    }
                );
            }

            // Categorize other business rule failures based on the message
            let errorCode = 'BOOKING_FAILED';
            if (result.message?.toLowerCase().includes('no table')) {
                errorCode = 'NO_TABLE_AVAILABLE';
            } else if (result.message?.toLowerCase().includes('time')) {
                errorCode = 'INVALID_TIME';
            } else if (result.message?.toLowerCase().includes('capacity')) {
                errorCode = 'CAPACITY_EXCEEDED';
            }

            return createBusinessRuleFailure(
                result.message || 'Could not complete reservation due to business constraints',
                errorCode
            );
        }

    } catch (error) {
        console.error(`❌ [Agent Tool] create_reservation error:`, error);

        // Enhanced error logging for debugging
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

        return createSystemError(
            'Failed to create reservation due to system error',
            error
        );
    }
}

/**
 * Get restaurant information
 * ✅ ENHANCED: Standardized response format
 */
export async function get_restaurant_info(
    infoType: 'hours' | 'location' | 'cuisine' | 'contact' | 'features' | 'all',
    context: { restaurantId: number }
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`ℹ️ [Agent Tool] get_restaurant_info: ${infoType} for restaurant ${context.restaurantId}`);

    try {
        // ✅ VALIDATION: Check context exists
        if (!context || !context.restaurantId) {
            return createValidationFailure('Context with restaurantId is required');
        }

        // ✅ VALIDATION: Check infoType is valid
        const validInfoTypes = ['hours', 'location', 'cuisine', 'contact', 'features', 'all'];
        if (!validInfoTypes.includes(infoType)) {
            return createValidationFailure(
                `Invalid infoType: ${infoType}. Must be one of: ${validInfoTypes.join(', ')}`,
                'infoType'
            );
        }

        console.log(`✅ [Agent Tool] Getting restaurant info for ID: ${context.restaurantId}`);

        // Use existing storage.getRestaurant method
        const restaurant = await storage.getRestaurant(context.restaurantId);
        if (!restaurant) {
            return createBusinessRuleFailure('Restaurant not found', 'RESTAURANT_NOT_FOUND');
        }

        console.log(`✅ [Agent Tool] Found restaurant: ${restaurant.name}`);

        const formatTime = (time: string) => {
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
                    rawClosingTime: restaurant.closingTime
                };
                message = `We're open from ${formatTime(restaurant.openingTime)} to ${formatTime(restaurant.closingTime)}`;
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
                    timezone: restaurant.timezone
                };
                message = `${restaurant.name} serves ${restaurant.cuisine || 'excellent cuisine'} in a ${restaurant.atmosphere || 'wonderful'} atmosphere. We're open ${formatTime(restaurant.openingTime)} to ${formatTime(restaurant.closingTime)}.`;
                break;
        }

        responseData.message = message;

        return createSuccessResponse(responseData, {
            execution_time_ms: executionTime
        });

    } catch (error) {
        console.error(`❌ [Agent Tool] get_restaurant_info error:`, error);
        return createSystemError(
            'Failed to retrieve restaurant information due to system error',
            error
        );
    }
}

// ✅ ENHANCED: Export agent tools configuration for OpenAI function calling
export const agentTools = [
    {
        type: "function" as const,
        function: {
            name: "check_availability",
            description: "Check if tables are available for a specific date, time, and party size. Returns standardized response with tool_status and detailed data or error information.",
            parameters: {
                type: "object",
                properties: {
                    date: {
                        type: "string",
                        description: "Date in YYYY-MM-DD format (e.g., 2025-06-27)"
                    },
                    time: {
                        type: "string",
                        description: "Time in HH:MM format (24-hour) (e.g., 19:00)"
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
            description: "Find alternative time slots around a preferred time. Returns standardized response with available alternatives or business rule explanation.",
            parameters: {
                type: "object",
                properties: {
                    date: {
                        type: "string",
                        description: "Date in YYYY-MM-DD format (e.g., 2025-06-27)"
                    },
                    preferredTime: {
                        type: "string",
                        description: "Preferred time in HH:MM format (24-hour) (e.g., 19:00)"
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
            description: "Create a new reservation. Returns standardized response indicating success with reservation details or failure with categorized error.",
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
                        description: "Date in YYYY-MM-DD format (e.g., 2025-06-27)"
                    },
                    time: {
                        type: "string",
                        description: "Time in HH:MM format (24-hour) (e.g., 19:00)"
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
            description: "Get information about the restaurant. Returns standardized response with requested information or error details.",
            parameters: {
                type: "object",
                properties: {
                    infoType: {
                        type: "string",
                        enum: ["hours", "location", "cuisine", "contact", "features", "all"],
                        description: "Type of information to retrieve"
                    }
                },
                required: ["infoType"]
            }
        }
    }
];

// ✅ ENHANCED: Export function implementations for agent to call
export const agentFunctions = {
    check_availability,
    find_alternative_times,
    create_reservation,
    get_restaurant_info
};