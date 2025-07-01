// server/services/agents/agent-tools.ts
// ✅ MAYA FIX: Added proper table reassignment logic to prevent capacity bypassing
// ✅ MAYA FIX: Enhanced time calculation and immediate response logic

import { getAvailableTimeSlots } from '../availability.service';
import { createTelegramReservation } from '../telegram_booking';
import { storage } from '../../storage';
import type { Restaurant } from '@shared/schema';
import { DateTime } from 'luxon';
import { getRestaurantDateTime } from '../../utils/timezone-utils';

// ✅ FIX: Import the Drizzle 'db' instance, schema definitions, and ORM operators
import { db } from '../../db';
import { eq, and, gt, gte, like, inArray, sql, desc, ne } from 'drizzle-orm';
// ✅ FIX: Use the correct camelCase table names from your schema
import {
    reservations,
    guests,
    tables,
    reservationModifications,
    reservationCancellations
} from '@shared/schema';

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
            return createSuccessResponse({
                available: true,
                table: bestSlot.tableName,
                capacity: bestSlot.tableCapacity?.max || null,
                isCombined: bestSlot.isCombined || false,
                exactTime: timeFormatted,
                message: `Table ${bestSlot.tableName} available for ${guests} guests at ${time}${bestSlot.isCombined ? ' (combined tables)' : ''}${context.excludeReservationId ? ` (reservation ${context.excludeReservationId} excluded from conflict check)` : ''}`,
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
                return createBusinessRuleFailure(
                    `No tables available for ${guests} guests at ${time} on ${date}. However, I found availability for ${suggestedAlternatives[0].guests} guests at the same time. Would you like me to check that option?`,
                    'NO_AVAILABILITY_SUGGEST_SMALLER'
                );
            } else {
                return createBusinessRuleFailure(
                    `No tables available for ${guests} guests at ${time} on ${date}${context.excludeReservationId ? ` (even after excluding reservation ${context.excludeReservationId})` : ''}`,
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
 * ✅ ENHANCED: Find alternative time slots around ANY preferred time
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

        console.log(`✅ [Agent Tool] Validation passed for alternatives around exact time: ${timeFormatted}...`);

        const slots = await getAvailableTimeSlots(
            context.restaurantId,
            date,
            guests,
            {
                requestedTime: timeFormatted,
                exactTimeOnly: false,
                maxResults: 8,
                timezone: context.timezone,
                allowCombinations: true
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

            return createBusinessRuleFailure(
                result.message || 'Could not complete reservation due to business constraints',
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
    context: { restaurantId: number }
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
 * ✅ FIXED: Find existing reservations for a guest using Drizzle ORM with timezone utils
 */
export async function find_existing_reservation(
    identifier: string,
    identifierType: 'phone' | 'telegram' | 'name' | 'confirmation' = 'phone',
    context: {
        restaurantId: number;
        timezone: string;
        language: string;
        telegramUserId?: string;
        sessionId?: string;
    }
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`🔍 [Maya Tool] Finding reservations for: "${identifier}" (${identifierType})`);

    try {
        // ✅ BUG FIX: Robustly parse the numeric part of the identifier.
        const numericIdentifier = parseInt(identifier.replace(/\D/g, ''), 10);

        if (identifierType === 'phone' && isNaN(numericIdentifier)) {
            identifierType = 'name';
            console.log(`[Maya Tool] Identifier "${identifier}" is not a number, switching search type to 'name'`);
        } else if (identifierType === 'phone') {
            // Assume numbers are confirmation IDs unless specified otherwise by the LLM
            identifierType = 'confirmation';
            console.log(`[Maya Tool] Identifier "${identifier}" is numeric, assuming search type 'confirmation'`);
        }

        const nowUtc = getRestaurantDateTime(context.timezone).toUTC().toISO();
        const conditions = [
            eq(reservations.restaurantId, context.restaurantId),
            inArray(reservations.status, ['created', 'confirmed']),
            gt(reservations.reservation_utc, nowUtc)
        ];

        switch (identifierType) {
            case 'phone':
                // This case might be less used now but kept for completeness
                conditions.push(eq(guests.phone, String(numericIdentifier)));
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
                if (isNaN(numericIdentifier)) {
                    return createBusinessRuleFailure(`"${identifier}" is not a valid confirmation number. It must be a number.`, 'INVALID_CONFIRMATION');
                }
                conditions.push(eq(reservations.id, numericIdentifier));
                break;
        }

        console.log(`[Maya Tool] Executing Drizzle query with type '${identifierType}'...`);

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
            const notFoundMessages = {
                en: `I couldn't find any upcoming reservations for "${identifier}". Please check the information or try a different way to identify your booking.`,
                ru: `Не удалось найти предстоящие бронирования для "${identifier}". Проверьте информацию или попробуйте другой способ.`,
                sr: `Nisam mogao da pronađem nadolazeće rezervacije za "${identifier}". Molim proverite informacije ili pokušajte drugi način.`
            };

            return createBusinessRuleFailure(
                notFoundMessages[context.language as keyof typeof notFoundMessages] || notFoundMessages.en,
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

        const successMessages = {
            en: `Found ${formattedReservations.length} upcoming reservation(s) for you. Let me show you the details.`,
            ru: `Нашел ${formattedReservations.length} предстоящих бронирования для вас. Позвольте показать детали.`,
            sr: `Pronašao sam ${formattedReservations.length} nadolazećih rezervacija za vas. Evo detalja.`
        };

        return createSuccessResponse({
            reservations: formattedReservations,
            count: formattedReservations.length,
            searchedBy: identifierType,
            message: successMessages[context.language as keyof typeof successMessages] || successMessages.en
        }, {
            execution_time_ms: Date.now() - startTime
        });

    } catch (error) {
        console.error(`❌ [Maya Tool] Error finding reservations:`, error);
        return createSystemError('Failed to search for reservations', error);
    }
}

/**
 * ✅ MAYA FIX: Modified reservation with PROPER TABLE REASSIGNMENT LOGIC + TIME CALCULATION
 * This prevents guests from being assigned to tables that can't accommodate them
 * ✅ NEW: Enhanced with proper time calculation for relative changes
 */
export async function modify_reservation(
    reservationId: number,
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
    }
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`✏️ [Maya Tool] Modifying reservation ${reservationId}:`, modifications);

    try {
        // 1. Get existing reservation with table info
        const [existingReservation] = await db
            .select({
                reservation: reservations,
                table: tables
            })
            .from(reservations)
            .leftJoin(tables, eq(reservations.tableId, tables.id))
            .where(and(
                eq(reservations.id, reservationId),
                eq(reservations.restaurantId, context.restaurantId)
            ));

        if (!existingReservation) {
            return createBusinessRuleFailure(
                'Reservation not found. Please provide the correct confirmation number or phone number first.',
                'RESERVATION_NOT_FOUND'
            );
        }

        const currentReservation = existingReservation.reservation;
        const currentTable = existingReservation.table;

        console.log(`📋 [Maya] Current reservation details:`, {
            id: currentReservation.id,
            currentGuests: currentReservation.guests,
            currentTable: currentTable?.name,
            currentTableCapacity: `${currentTable?.minGuests}-${currentTable?.maxGuests}`,
            newGuests: modifications.newGuests
        });

        // 2. Check modification policy
        const normalizedDateString = normalizeDatabaseTimestamp(currentReservation.reservation_utc);
        const reservationUtcDt = DateTime.fromISO(normalizedDateString);

        if (!reservationUtcDt.isValid) {
            console.error(`[Maya Tool] Invalid existing reservation date: ${currentReservation.reservation_utc}`);
            return createSystemError('Invalid reservation date format in database');
        }

        const nowUtcDt = getRestaurantDateTime(context.timezone).toUTC();
        const hoursUntilReservation = reservationUtcDt.diff(nowUtcDt, 'hours').hours;

        if (hoursUntilReservation < 4) {
            const tooLateMessages = {
                en: `Sorry, this reservation is too close to modify (${Math.round(hoursUntilReservation * 10) / 10} hours away, minimum 4 hours required). Please call the restaurant directly.`,
                ru: `Извините, это бронирование слишком близко для изменения (${Math.round(hoursUntilReservation * 10) / 10} часов, минимум 4 часа). Пожалуйста, позвоните в ресторан.`,
                sr: `Izvinjavam se, ova rezervacija je previše blizu za izmenu (${Math.round(hoursUntilReservation * 10) / 10} sati, minimum 4 sata). Molim pozovite restoran direktno.`
            };

            return createBusinessRuleFailure(
                tooLateMessages[context.language as keyof typeof tooLateMessages] || tooLateMessages.en,
                'MODIFICATION_TOO_LATE'
            );
        }

        // ✅ NEW: Enhanced time calculation logic
        let finalTime = modifications.newTime;
        let finalDate = modifications.newDate;

        // If no explicit new time provided, check if this is a relative time change (like "+30 minutes")
        if (!finalTime && reason) {
            const currentLocalTime = reservationUtcDt.setZone(context.timezone);
            finalDate = finalDate || currentLocalTime.toFormat('yyyy-MM-dd');
            finalTime = currentLocalTime.toFormat('HH:mm');

            // Try to parse relative time changes from the reason
            const relativeTimeMatch = reason.match(/(\d+)\s*(минут|minutes?|час|hours?)\s*(позже|later|раньше|earlier)/i);
            if (relativeTimeMatch) {
                const amount = parseInt(relativeTimeMatch[1]);
                const unit = relativeTimeMatch[2].toLowerCase();
                const direction = relativeTimeMatch[3].toLowerCase();

                let minutesToAdd = 0;
                if (unit.includes('минут') || unit.includes('minute')) {
                    minutesToAdd = amount;
                } else if (unit.includes('час') || unit.includes('hour')) {
                    minutesToAdd = amount * 60;
                }

                if (direction.includes('раньше') || direction.includes('earlier')) {
                    minutesToAdd = -minutesToAdd;
                }

                const newDateTime = currentLocalTime.plus({ minutes: minutesToAdd });
                finalTime = newDateTime.toFormat('HH:mm');
                finalDate = newDateTime.toFormat('yyyy-MM-dd');

                console.log(`🧮 [Maya] Calculated relative time change: ${currentLocalTime.toFormat('HH:mm')} + ${minutesToAdd} minutes = ${finalTime}`);
            }
        }

        // Use existing values if not modified
        if (!finalDate) finalDate = reservationUtcDt.setZone(context.timezone).toFormat('yyyy-MM-dd');
        if (!finalTime) finalTime = reservationUtcDt.setZone(context.timezone).toFormat('HH:mm');

        // 3. ✅ CRITICAL FIX: Check if table reassignment is needed
        const needsTableReassignment = (
            modifications.newGuests && modifications.newGuests !== currentReservation.guests
        ) || (
                finalDate !== reservationUtcDt.setZone(context.timezone).toFormat('yyyy-MM-dd')
            ) || (
                finalTime !== reservationUtcDt.setZone(context.timezone).toFormat('HH:mm')
            );

        let newTableId = currentTable?.id; // Default to keeping current table
        let newTableInfo = currentTable;
        let requiresTableChange = false;

        if (needsTableReassignment) {
            // Determine final reservation details
            const finalGuests = modifications.newGuests || currentReservation.guests;

            console.log(`🔍 [Maya] Checking table capacity for ${finalGuests} guests...`);

            // ✅ CRITICAL FIX: Check if current table can still accommodate the new guest count
            if (modifications.newGuests && currentTable) {
                const canCurrentTableHandle = finalGuests >= currentTable.minGuests && finalGuests <= currentTable.maxGuests;

                if (!canCurrentTableHandle) {
                    console.log(`❌ [Maya] Current table "${currentTable.name}" (capacity: ${currentTable.minGuests}-${currentTable.maxGuests}) cannot accommodate ${finalGuests} guests`);
                    requiresTableChange = true;
                } else {
                    console.log(`✅ [Maya] Current table "${currentTable.name}" can still accommodate ${finalGuests} guests`);
                }
            }

            // ✅ CRITICAL FIX: If table change is needed OR time/date changed, find available tables
            if (requiresTableChange || finalDate !== reservationUtcDt.setZone(context.timezone).toFormat('yyyy-MM-dd') || finalTime !== reservationUtcDt.setZone(context.timezone).toFormat('HH:mm')) {
                console.log(`🔄 [Maya] Finding available tables for ${finalGuests} guests at ${finalTime} on ${finalDate}...`);

                // Use availability service to find suitable tables (excluding current reservation)
                const availableSlots = await getAvailableTimeSlots(
                    context.restaurantId,
                    finalDate,
                    finalGuests,
                    {
                        requestedTime: finalTime + ':00',
                        exactTimeOnly: true,
                        timezone: context.timezone,
                        allowCombinations: true,
                        excludeReservationId: reservationId // ✅ CRITICAL: Exclude current reservation
                    }
                );

                if (availableSlots.length === 0) {
                    return createBusinessRuleFailure(
                        `No tables available for ${finalGuests} guests at ${finalTime} on ${finalDate}. Please choose a different time or party size.`,
                        'NEW_TIME_UNAVAILABLE'
                    );
                }

                // ✅ CRITICAL FIX: Get the best available table
                const bestSlot = availableSlots[0];

                // Get table details for the assigned table
                const [newTable] = await db
                    .select()
                    .from(tables)
                    .where(eq(tables.id, bestSlot.tableId));

                if (newTable) {
                    newTableId = newTable.id;
                    newTableInfo = newTable;

                    if (newTable.id !== currentTable?.id) {
                        console.log(`🔄 [Maya] Reassigning from table "${currentTable?.name}" to table "${newTable.name}" for ${finalGuests} guests`);
                    } else {
                        console.log(`✅ [Maya] Keeping same table "${newTable.name}" (it can handle the changes)`);
                    }
                } else {
                    console.error(`❌ [Maya] Could not find table details for tableId ${bestSlot.tableId}`);
                    return createSystemError('Table assignment error during modification');
                }
            } else {
                console.log(`✅ [Maya] No table reassignment needed for current changes`);
            }
        }

        // 4. Build update data
        const updateData: Partial<typeof reservations.$inferInsert> = {};
        const modificationHistory: Array<{ field: string, oldValue: any, newValue: any }> = [];

        if (finalDate !== reservationUtcDt.setZone(context.timezone).toFormat('yyyy-MM-dd') || 
            finalTime !== reservationUtcDt.setZone(context.timezone).toFormat('HH:mm')) {
            
            const newUtcTime = DateTime.fromISO(`${finalDate}T${finalTime}`, { zone: context.timezone }).toUTC().toISO();
            updateData.reservation_utc = newUtcTime;

            modificationHistory.push({
                field: 'datetime',
                oldValue: currentReservation.reservation_utc,
                newValue: newUtcTime
            });
        }

        if (modifications.newGuests && modifications.newGuests !== currentReservation.guests) {
            updateData.guests = modifications.newGuests;
            modificationHistory.push({
                field: 'guests',
                oldValue: currentReservation.guests,
                newValue: modifications.newGuests
            });
        }

        if (modifications.newSpecialRequests !== undefined && modifications.newSpecialRequests !== currentReservation.comments) {
            updateData.comments = modifications.newSpecialRequests;
            modificationHistory.push({
                field: 'special_requests',
                oldValue: currentReservation.comments,
                newValue: modifications.newSpecialRequests
            });
        }

        // ✅ CRITICAL FIX: Update table assignment if needed
        if (newTableId && newTableId !== currentTable?.id) {
            updateData.tableId = newTableId;
            modificationHistory.push({
                field: 'table',
                oldValue: currentTable?.name || 'Unknown',
                newValue: newTableInfo?.name || 'Unknown'
            });
        }

        updateData.lastModifiedAt = new Date();

        // 5. Update reservation if there are changes
        if (Object.keys(updateData).length > 1) { // More than just lastModifiedAt
            const [updatedReservation] = await db
                .update(reservations)
                .set(updateData)
                .where(eq(reservations.id, reservationId))
                .returning();

            // 6. Log modifications
            for (const mod of modificationHistory) {
                await db.insert(reservationModifications).values({
                    reservationId,
                    fieldChanged: mod.field,
                    oldValue: String(mod.oldValue),
                    newValue: String(mod.newValue),
                    modifiedBy: context.telegramUserId ? 'guest_telegram' : 'guest_web',
                    reason,
                    source: context.telegramUserId ? 'telegram' : 'web'
                });
            }

            // 7. ✅ IMPROVEMENT: Format success message using localization
            const modificationStrings = {
                en: {
                    time: `time to ${finalDate} at ${finalTime}`,
                    guests: (val: any) => `party size to ${val} guests`,
                    table: (val: any) => `table to ${val}`,
                    requests: 'special requests',
                    success: (changes: string) => `Perfect! I've successfully updated your reservation: ${changes}.`
                },
                ru: {
                    time: `время на ${finalDate} в ${finalTime}`,
                    guests: (val: any) => `количество гостей на ${val}`,
                    table: (val: any) => `столик на ${val}`,
                    requests: 'особые пожелания',
                    success: (changes: string) => `Отлично! Ваше бронирование успешно обновлено: ${changes}.`
                },
                sr: {
                    time: `vreme na ${finalDate} u ${finalTime}`,
                    guests: (val: any) => `broj gostiju na ${val}`,
                    table: (val: any) => `sto na ${val}`,
                    requests: 'posebni zahtevi',
                    success: (changes: string) => `Savršeno! Vaša rezervacija je uspešno ažurirana: ${changes}.`
                }
            };

            const locale = modificationStrings[context.language as keyof typeof modificationStrings] || modificationStrings.en;

            const changes = modificationHistory.map(mod => {
                switch (mod.field) {
                    case 'datetime': return locale.time;
                    case 'guests': return locale.guests(mod.newValue);
                    case 'table': return locale.table(mod.newValue);
                    case 'special_requests': return locale.requests;
                    default: return mod.field;
                }
            }).join(', ');

            return createSuccessResponse({
                reservationId: updatedReservation.id,
                modifications: modificationHistory,
                message: locale.success(changes),
                updatedReservation: {
                    id: updatedReservation.id,
                    date: finalDate,
                    time: finalTime,
                    guests: updatedReservation.guests,
                    tableName: newTableInfo?.name || 'Unknown',
                    tableCapacity: newTableInfo ? `${newTableInfo.minGuests}-${newTableInfo.maxGuests}` : 'Unknown',
                    comments: updatedReservation.comments || ''
                }
            }, {
                execution_time_ms: Date.now() - startTime
            });
        } else {
            return createBusinessRuleFailure(
                'No changes were specified for the reservation.',
                'NO_CHANGES_SPECIFIED'
            );
        }

    } catch (error) {
        console.error(`❌ [Maya Tool] Error modifying reservation:`, error);
        return createSystemError('Failed to modify reservation', error);
    }
}

/**
 * ✅ FIXED: Cancel an existing reservation using Drizzle ORM with timezone utils
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
            const confirmMessages = {
                en: `Are you sure you want to cancel your reservation? This action cannot be undone. Please confirm if you want to proceed.`,
                ru: `Вы уверены, что хотите отменить бронирование? Это действие нельзя отменить. Подтвердите, если хотите продолжить.`,
                sr: `Da li ste sigurni da želite da otkažete rezervaciju? Ova radnja se ne može poništiti. Molim potvrdite ako želite da nastavite.`
            };

            return createBusinessRuleFailure(
                confirmMessages[context.language as keyof typeof confirmMessages] || confirmMessages.en,
                'CANCELLATION_NOT_CONFIRMED'
            );
        }

        const [existingReservation] = await db
            .select()
            .from(reservations)
            .where(and(
                eq(reservations.id, reservationId),
                eq(reservations.restaurantId, context.restaurantId)
            ));

        if (!existingReservation) {
            return createBusinessRuleFailure('Reservation not found', 'RESERVATION_NOT_FOUND');
        }

        if (existingReservation.status === 'canceled') {
            const alreadyCancelledMessages = {
                en: `This reservation is already cancelled.`,
                ru: `Это бронирование уже отменено.`,
                sr: `Ova rezervacija je već otkazana.`
            };

            return createBusinessRuleFailure(
                alreadyCancelledMessages[context.language as keyof typeof alreadyCancelledMessages] || alreadyCancelledMessages.en,
                'ALREADY_CANCELLED'
            );
        }

        const normalizedDateString = normalizeDatabaseTimestamp(existingReservation.reservation_utc);
        const reservationUtcDt = DateTime.fromISO(normalizedDateString);
        const nowUtcDt = getRestaurantDateTime(context.timezone).toUTC();
        const hoursUntilReservation = reservationUtcDt.diff(nowUtcDt, 'hours').hours;

        if (hoursUntilReservation < 2) {
            const tooLateMessages = {
                en: `Sorry, cancellations are not allowed less than 2 hours before the reservation. Please call the restaurant directly.`,
                ru: `Извините, отмены не разрешены менее чем за 2 часа до бронирования. Пожалуйста, позвоните в ресторан.`,
                sr: `Izvinjavam se, otkazivanja nisu dozvoljena manje od 2 sata pre rezervacije. Molim pozovite restoran direktno.`
            };

            return createBusinessRuleFailure(
                tooLateMessages[context.language as keyof typeof tooLateMessages] || tooLateMessages.en,
                'CANCELLATION_TOO_LATE'
            );
        }

        const [cancelledReservation] = await db
            .update(reservations)
            .set({ status: 'canceled', lastModifiedAt: new Date() })
            .where(eq(reservations.id, reservationId))
            .returning();

        await db.insert(reservationCancellations).values({
            reservationId,
            cancelledBy: context.telegramUserId ? 'guest_telegram' : 'guest_web',
            reason,
            cancellationPolicy: 'free',
            source: context.telegramUserId ? 'telegram' : 'web'
        });

        const successMessages = {
            en: `Your reservation has been successfully cancelled. We're sorry to see you go and hope to serve you again in the future!`,
            ru: `Ваше бронирование успешно отменено. Жаль, что вы не сможете прийти, надеемся увидеть вас в будущем!`,
            sr: `Vaša rezervacija je uspešno otkazana. Žao nam je što nećete doći i nadamo se da ćemo vas služiti u budućnosti!`
        };

        return createSuccessResponse({
            reservationId: cancelledReservation.id,
            reason: reason,
            message: successMessages[context.language as keyof typeof successMessages] || successMessages.en,
            cancelledAt: new Date().toISOString(),
            refundEligible: hoursUntilReservation >= 24
        }, {
            execution_time_ms: Date.now() - startTime
        });

    } catch (error) {
        console.error(`❌ [Maya Tool] Error cancelling reservation:`, error);
        return createSystemError('Failed to cancel reservation', error);
    }
}

// ✅ ENHANCED: Export agent tools configuration
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
    // ===== 🆕 MAYA'S TOOLS =====
    {
        type: "function" as const,
        function: {
            name: "find_existing_reservation",
            description: "Find guest's existing reservations by phone, name, or confirmation number. Use this when guest wants to modify or view existing bookings.",
            parameters: {
                type: "object",
                properties: {
                    identifier: {
                        type: "string",
                        description: "Phone number, guest name, or confirmation number to search by"
                    },
                    identifierType: {
                        type: "string",
                        enum: ["phone", "telegram", "name", "confirmation"],
                        description: "Type of identifier being used (auto-detected if not specified)"
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
            description: "Modify details of an existing reservation (time, date, party size, special requests). AUTOMATICALLY REASSIGNS TABLES when needed to ensure capacity requirements are met. AUTOMATICALLY CALCULATES relative time changes.",
            parameters: {
                type: "object",
                properties: {
                    reservationId: {
                        type: "number",
                        description: "ID of the reservation to modify"
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
                required: ["reservationId", "modifications"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "cancel_reservation",
            description: "Cancel an existing reservation. Always ask for confirmation before proceeding.",
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

// ✅ ENHANCED: Export function implementations
export const agentFunctions = {
    // Sofia's tools (existing)
    check_availability,
    find_alternative_times,
    create_reservation,
    get_restaurant_info,

    // Maya's tools (with proper table reassignment + time calculation)
    find_existing_reservation,
    modify_reservation,
    cancel_reservation
};