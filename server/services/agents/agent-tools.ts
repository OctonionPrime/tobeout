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
 * ✅ ENHANCED: Check availability for ANY specific time (16:15, 19:43, etc.)
 * Now supports exact time checking while maintaining backward compatibility
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

        // ✅ ENHANCED: Support ANY time format (HH:MM, HH:MM:SS, or even H:MM)
        let timeFormatted: string;
        
        // Handle various time formats
        if (/^\d{1,2}:\d{2}$/.test(time)) {
            // Format like "16:15" or "8:30"
            const [hours, minutes] = time.split(':');
            timeFormatted = `${hours.padStart(2, '0')}:${minutes}:00`;
        } else if (/^\d{1,2}:\d{2}:\d{2}$/.test(time)) {
            // Format like "16:15:00"
            timeFormatted = time;
        } else {
            return createValidationFailure('Invalid time format. Expected HH:MM or HH:MM:SS (supports exact times like 16:15, 19:43)', 'time');
        }

        // ✅ VALIDATION: Check guests is positive number
        if (guests <= 0 || guests > 50) {
            return createValidationFailure('Invalid number of guests. Must be between 1 and 50', 'guests');
        }

        console.log(`✅ [Agent Tool] Validation passed. Using exact time checking for: ${timeFormatted}...`);

        // ✅ NEW: Use exact time checking mode
        const slots = await getAvailableTimeSlots(
            context.restaurantId,
            date,
            guests,
            {
                requestedTime: timeFormatted,
                exactTimeOnly: true, // NEW: Only check this exact time
                timezone: context.timezone,
                allowCombinations: true
            }
        );

        console.log(`✅ [Agent Tool] Found ${slots.length} slots for exact time ${timeFormatted}`);

        const executionTime = Date.now() - startTime;

        if (slots.length > 0) {
            const bestSlot = slots[0]; // Take the best available option
            return createSuccessResponse({
                available: true,
                table: bestSlot.tableName,
                capacity: bestSlot.tableCapacity?.max || null,
                isCombined: bestSlot.isCombined || false,
                exactTime: timeFormatted, // NEW: Confirm exact time checked
                message: `Table ${bestSlot.tableName} available for ${guests} guests at ${time}${bestSlot.isCombined ? ' (combined tables)' : ''}`,
                constituentTables: bestSlot.constituentTables || null,
                allAvailableSlots: slots.map(s => ({ time: s.time, table: s.tableName })),
                timeSupported: 'exact' // NEW: Indicate exact time support
            }, {
                execution_time_ms: executionTime
            });
        } else {
            // ✅ ENHANCED: If no tables at exact time, check for smaller party sizes
            console.log(`⚠️ [Agent Tool] No tables for ${guests} guests at exact time ${timeFormatted}, checking for smaller party sizes...`);

            let suggestedAlternatives = [];

            // Check for smaller number of guests (from guests-1 to 1)
            for (let altGuests = guests - 1; altGuests >= 1 && suggestedAlternatives.length === 0; altGuests--) {
                console.log(`🔍 [Agent Tool] Checking exact time ${timeFormatted} for ${altGuests} guests...`);

                const altSlots = await getAvailableTimeSlots(
                    context.restaurantId,
                    date,
                    altGuests,
                    {
                        requestedTime: timeFormatted,
                        exactTimeOnly: true, // NEW: Still use exact time for alternatives
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
                    `No tables available for ${guests} guests at ${time} on ${date}. However, I found availability for ${suggestedAlternatives[0].guests} guests at the same time. Would you like me to check that option?`,
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
 * ✅ ENHANCED: Find alternative time slots around ANY preferred time
 * Supports exact times like 16:15, 19:43, etc.
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

        // ✅ ENHANCED: Support ANY time format for preferred time
        let timeFormatted: string;
        
        if (/^\d{1,2}:\d{2}$/.test(preferredTime)) {
            // Format like "16:15" or "8:30"
            const [hours, minutes] = preferredTime.split(':');
            timeFormatted = `${hours.padStart(2, '0')}:${minutes}:00`;
        } else if (/^\d{1,2}:\d{2}:\d{2}$/.test(preferredTime)) {
            // Format like "16:15:00"
            timeFormatted = preferredTime;
        } else {
            return createValidationFailure('Invalid time format. Expected HH:MM or HH:MM:SS (supports exact times like 16:15, 19:43)', 'preferredTime');
        }

        // ✅ VALIDATION: Check guests
        if (guests <= 0 || guests > 50) {
            return createValidationFailure('Invalid number of guests. Must be between 1 and 50', 'guests');
        }

        console.log(`✅ [Agent Tool] Validation passed for alternatives around exact time: ${timeFormatted}...`);

        // ✅ NEW: Use standard slot generation (not exact time only) to find alternatives
        const slots = await getAvailableTimeSlots(
            context.restaurantId,
            date,
            guests,
            {
                requestedTime: timeFormatted,  // This will sort results by proximity to preferred time
                exactTimeOnly: false,         // Allow slot generation for alternatives
                maxResults: 8,                // More alternatives
                timezone: context.timezone,
                allowCombinations: true
            }
        );

        // Calculate proximity to preferred time and format alternatives
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
        }).sort((a, b) => a.proximityMinutes - b.proximityMinutes); // Sort by proximity to preferred time

        const executionTime = Date.now() - startTime;

        console.log(`✅ [Agent Tool] Found ${alternatives.length} alternatives around ${preferredTime}`);

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
            return createBusinessRuleFailure(
                `No alternative times available for ${guests} guests on ${date} near ${preferredTime}`,
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
 * ✅ CRITICAL FIX: Create a reservation with proper name clarification handling
 * Supports ANY time format for reservations
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

        // ✅ ENHANCED: Support ANY time format for exact reservations
        let timeFormatted: string;
        
        if (/^\d{1,2}:\d{2}$/.test(time)) {
            // Format like "16:15" or "8:30" - convert to HH:MM
            const [hours, minutes] = time.split(':');
            timeFormatted = `${hours.padStart(2, '0')}:${minutes}`;
        } else if (/^\d{1,2}:\d{2}:\d{2}$/.test(time)) {
            // Format like "16:15:00" - extract HH:MM
            timeFormatted = time.substring(0, 5);
        } else {
            return createValidationFailure(`Invalid time format: ${time}. Expected HH:MM or HH:MM:SS (supports exact times like 16:15, 19:43)`, 'time');
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

        console.log(`✅ [Agent Tool] Validation passed. Creating reservation with exact time:`);
        console.log(`   - Restaurant ID: ${context.restaurantId}`);
        console.log(`   - Guest: ${cleanName} (${cleanPhone})`);
        console.log(`   - Date/Time: ${date} ${timeFormatted} (exact time support)`);
        console.log(`   - Guests: ${guests}`);
        console.log(`   - Timezone: ${context.timezone}`);
        console.log(`   - Confirmed Name: ${context.confirmedName || 'none'}`);

        // ✅ CRITICAL: Use existing createTelegramReservation function with confirmed name
        const result = await createTelegramReservation(
            context.restaurantId,
            date,
            timeFormatted, // Exact time in HH:MM format
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

        // ✅ CRITICAL FIX: Handle the specific name mismatch case
        if (!result.success && result.status === 'name_mismatch_clarification_needed' && result.nameConflict) {
            console.log(`⚠️ [Agent Tool] NAME MISMATCH DETECTED: Converting to proper format for conversation manager`);
            
            const { dbName, requestName } = result.nameConflict;
            
            return createFailureResponse(
                'BUSINESS_RULE',
                `Name mismatch detected: database has '${dbName}' but booking requests '${requestName}'`,
                'NAME_CLARIFICATION_NEEDED', // ✅ CRITICAL: This exact code triggers the conversation manager
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

        // ✅ ENHANCED: More thorough success checking
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
                exactTime: timeFormatted, // NEW: Confirm exact time was used
                guests: guests,
                specialRequests: specialRequests,
                message: result.message,
                success: true, // ✅ Add explicit success flag
                timeSupported: 'exact' // NEW: Indicate exact time support
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
                    rawClosingTime: restaurant.closingTime,
                    // ✅ NEW: Include flexible time configuration
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
                    // ✅ NEW: Include flexible time configuration
                    slotInterval: restaurant.slotInterval || 30,
                    allowAnyTime: restaurant.allowAnyTime !== false,
                    minTimeIncrement: restaurant.minTimeIncrement || 15
                };
                message = `${restaurant.name} serves ${restaurant.cuisine || 'excellent cuisine'} in a ${restaurant.atmosphere || 'wonderful'} atmosphere. We're open ${formatTime(restaurant.openingTime)} to ${formatTime(restaurant.closingTime)}.${restaurant.allowAnyTime ? ' You can book at any exact time during our operating hours!' : ''}`;
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

// ✅ ENHANCED: Export agent tools configuration for OpenAI function calling with exact time support
export const agentTools = [
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
                        description: "Date in YYYY-MM-DD format (e.g., 2025-06-27)"
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
                        description: "Date in YYYY-MM-DD format (e.g., 2025-06-27)"
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
                        description: "Date in YYYY-MM-DD format (e.g., 2025-06-27)"
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

// ✅ ENHANCED: Export function implementations for agent to call
export const agentFunctions = {
    check_availability,
    find_alternative_times,
    create_reservation,
    get_restaurant_info
};