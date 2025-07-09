// server/services/agents/tools/booking.tools.ts
// ✅ CRITICAL FIX: Removed circular dependency with telegram_booking.ts
// ✅ SOLUTION: Now calls booking.ts directly for reservation creation

import { getAvailableTimeSlots } from '../../availability.service';
// ✅ CRITICAL FIX: Import booking service instead of telegram integration
import { createReservation, type BookingRequest } from '../../booking';
import { storage } from '../../../storage';
import type { Language } from '../core/agent.types';
import OpenAI from 'openai';
import { DateTime } from 'luxon';
import { 
    isValidTimezone,
    validateBookingDateTime,
    getRestaurantOperatingStatus 
} from '../../../utils/timezone-utils';

// ===== TOOL RESPONSE INTERFACES =====
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
    excludeReservationId?: number;
}

// ===== TIMEZONE VALIDATION HELPER =====
function validateTimezoneAndOperatingHours(
    context: BookingToolContext,
    date?: string,
    time?: string
): { 
    isValid: boolean; 
    timezone: string; 
    operatingStatus?: any;
    timeValidation?: any;
    error?: string 
} {
    // Validate timezone
    if (!isValidTimezone(context.timezone)) {
        console.warn(`[BookingTools] Invalid timezone: ${context.timezone}, falling back to Belgrade`);
        context.timezone = 'Europe/Belgrade';
    }

    const result = {
        isValid: true,
        timezone: context.timezone
    };

    // If date and time provided, validate against operating hours
    if (date && time) {
        try {
            const operatingStatus = getRestaurantOperatingStatus(
                context.timezone,
                '10:00', // Default opening time - should come from restaurant config
                '23:00'  // Default closing time - should come from restaurant config
            );

            const timeValidation = validateBookingDateTime(
                date,
                time,
                context.timezone,
                '10:00', // Default opening time
                '23:00'  // Default closing time
            );

            return {
                ...result,
                operatingStatus,
                timeValidation
            };
        } catch (error) {
            console.warn(`[BookingTools] Operating hours validation failed:`, error);
            return result; // Return basic validation without operating hours check
        }
    }

    return result;
}

// ===== BOOKING TOOLS IMPLEMENTATION =====

/**
 * Check availability for ANY specific time with optional reservation exclusion and timezone validation
 */
export async function check_availability(
    date: string,
    time: string,
    guests: number,
    context: BookingToolContext
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`🔍 [Booking Tool] check_availability: ${date} ${time} for ${guests} guests (Restaurant: ${context.restaurantId})${context.excludeReservationId ? ` (excluding reservation ${context.excludeReservationId})` : ''}`);

    // ✅ Timezone validation at entry point
    const timezoneValidation = validateTimezoneAndOperatingHours(context, date, time);
    if (!timezoneValidation.isValid) {
        return createValidationFailure(`Timezone validation failed: ${timezoneValidation.error}`);
    }

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
            
            const baseMessage = `Table ${bestSlot.tableName} available for ${guests} guests at ${time}${bestSlot.isCombined ? ' (combined tables)' : ''}${context.excludeReservationId ? ` (reservation ${context.excludeReservationId} excluded from conflict check)` : ''}`;
            const translatedMessage = await BookingToolTranslationService.translateToolMessage(
                baseMessage,
                context.language as Language,
                'success'
            );

            const responseMetadata: any = {
                execution_time_ms: executionTime,
                timezone_validated: true,
                restaurant_timezone: context.timezone
            };

            // Add operating hours warning if applicable
            if (timezoneValidation.timeValidation && !timezoneValidation.timeValidation.isWithinHours) {
                responseMetadata.warnings = [`Time ${time} is outside normal operating hours`];
            }

            return createSuccessResponse({
                available: true,
                table: bestSlot.tableName,
                capacity: bestSlot.tableCapacity?.max || null,
                isCombined: bestSlot.isCombined || false,
                exactTime: timeFormatted,
                message: translatedMessage,
                constituentTables: bestSlot.constituentTables || null,
                allAvailableSlots: slots.map(s => ({ time: s.time, table: s.tableName })),
                timeSupported: 'exact',
                timezone: context.timezone
            }, responseMetadata);
        } else {
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

    } catch (error) {
        console.error(`❌ [Booking Tool] check_availability error:`, error);
        return createSystemError('Failed to check availability due to system error', error);
    }
}

/**
 * Find alternative time slots around ANY preferred time with timezone validation
 */
export async function find_alternative_times(
    date: string,
    preferredTime: string,
    guests: number,
    context: BookingToolContext
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`🔍 [Booking Tool] find_alternative_times: ${date} around ${preferredTime} for ${guests} guests${context.excludeReservationId ? ` (excluding reservation ${context.excludeReservationId})` : ''}`);

    const timezoneValidation = validateTimezoneAndOperatingHours(context, date, preferredTime);
    if (!timezoneValidation.isValid) {
        return createValidationFailure(`Timezone validation failed: ${timezoneValidation.error}`);
    }

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
            const responseMetadata: any = {
                execution_time_ms: executionTime,
                timezone_validated: true,
                restaurant_timezone: context.timezone
            };

            return createSuccessResponse({
                alternatives,
                count: alternatives.length,
                date: date,
                preferredTime: preferredTime,
                exactTimeRequested: timeFormatted,
                closestAlternative: alternatives[0],
                timezone: context.timezone
            }, responseMetadata);
        } else {
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
 * ✅ CRITICAL FIX: Create a reservation by calling booking.ts directly (no circular dependency)
 * This breaks the infinite loop by bypassing telegram_booking.ts completely
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
    console.log(`🔧 [FIXED] Using direct booking.ts call - NO circular dependency`);

    // Timezone validation at entry point
    const timezoneValidation = validateTimezoneAndOperatingHours(context, date, time);
    if (!timezoneValidation.isValid) {
        return createValidationFailure(`Timezone validation failed: ${timezoneValidation.error}`);
    }

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

        console.log(`✅ [Booking Tool] Validation passed. Creating reservation with booking service:`);
        console.log(`   - Restaurant ID: ${context.restaurantId}`);
        console.log(`   - Guest: ${cleanName} (${cleanPhone})`);
        console.log(`   - Date/Time: ${date} ${timeFormatted}`);
        console.log(`   - Guests: ${guests}`);
        console.log(`   - Timezone: ${context.timezone} (validated)`);
        console.log(`   - Source: ${context.telegramUserId ? 'telegram' : 'web'}`);

        // ✅ CRITICAL FIX: Handle guest lookup and creation before calling booking service
        let guestId: number;
        
        try {
            // Look up or create guest
            if (context.telegramUserId) {
                let guest = await storage.getGuestByTelegramId(context.telegramUserId);
                
                if (!guest) {
                    // Try to find by phone
                    guest = await storage.getGuestByPhone(cleanPhone);
                    if (guest) {
                        // Associate with telegram ID
                        guest = await storage.updateGuest(guest.id, { 
                            telegram_user_id: context.telegramUserId 
                        });
                        console.log(`📝 [Booking Tool] Associated existing guest ${guest.id} with Telegram ID`);
                    } else {
                        // Create new guest
                        guest = await storage.createGuest({
                            name: cleanName,
                            phone: cleanPhone,
                            telegram_user_id: context.telegramUserId,
                            language: context.language as any
                        });
                        console.log(`📝 [Booking Tool] Created new guest ${guest.id}`);
                    }
                } else {
                    // Check for name conflicts
                    if (guest.name !== cleanName && !context.confirmedName) {
                        console.log(`⚠️ [Booking Tool] Name mismatch detected: DB has '${guest.name}', booking requests '${cleanName}'`);
                        return createFailureResponse(
                            'BUSINESS_RULE',
                            `Name mismatch: database has '${guest.name}' but booking requests '${cleanName}'. Please confirm which name to use.`,
                            'NAME_CLARIFICATION_NEEDED',
                            {
                                dbName: guest.name,
                                requestName: cleanName,
                                guestId: guest.id,
                                phone: cleanPhone,
                                telegramUserId: context.telegramUserId
                            }
                        );
                    }
                    
                    // Update guest name if confirmed
                    if (context.confirmedName && guest.name !== context.confirmedName) {
                        guest = await storage.updateGuest(guest.id, { name: context.confirmedName });
                        console.log(`📝 [Booking Tool] Updated guest name to confirmed: ${context.confirmedName}`);
                    }
                }
                
                guestId = guest.id;
            } else {
                // Web booking - simple guest lookup/creation
                let guest = await storage.getGuestByPhone(cleanPhone);
                if (!guest) {
                    guest = await storage.createGuest({
                        name: cleanName,
                        phone: cleanPhone,
                        language: context.language as any
                    });
                    console.log(`📝 [Booking Tool] Created new web guest ${guest.id}`);
                }
                guestId = guest.id;
            }
        } catch (guestError) {
            console.error(`❌ [Booking Tool] Guest lookup/creation error:`, guestError);
            return createSystemError('Failed to process guest information', guestError);
        }

        // ✅ CRITICAL FIX: Call booking.ts directly instead of telegram_booking.ts
        // This breaks the circular dependency completely
        const bookingRequest: BookingRequest = {
            restaurantId: context.restaurantId,
            guestId: guestId,
            // Convert to UTC timestamp for booking service
            reservation_utc: DateTime.fromISO(`${date}T${timeFormatted}`, { zone: context.timezone }).toUTC().toISO()!,
            guests: guests,
            comments: specialRequests,
            source: context.telegramUserId ? 'telegram' : 'web',
            lang: context.language as any,
            booking_guest_name: cleanName
        };

        console.log(`🔧 [FIXED] Calling booking.ts directly - breaking circular dependency`);
        const result = await createReservation(bookingRequest);

        const executionTime = Date.now() - startTime;

        if (result.success && result.reservation) {
            console.log(`✅ [Booking Tool] Reservation created successfully: #${result.reservation.id}`);
            
            const responseMetadata: any = {
                execution_time_ms: executionTime,
                timezone_validated: true,
                restaurant_timezone: context.timezone,
                architecture: 'fixed_no_circular_dependency'
            };

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
                timeSupported: 'exact',
                timezone: context.timezone
            }, responseMetadata);
        } else {
            console.log(`⚠️ [Booking Tool] Reservation failed:`, result.message);

            let errorCode = 'BOOKING_FAILED';
            if (result.message?.toLowerCase().includes('no table')) {
                errorCode = 'NO_TABLE_AVAILABLE';
            } else if (result.message?.toLowerCase().includes('time')) {
                errorCode = 'INVALID_TIME';
            } else if (result.message?.toLowerCase().includes('capacity')) {
                errorCode = 'CAPACITY_EXCEEDED';
            }

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
        return createSystemError('Failed to create reservation due to system error', error);
    }
}

/**
 * Get restaurant information with timezone-aware operating hours
 */
export async function get_restaurant_info(
    infoType: 'hours' | 'location' | 'cuisine' | 'contact' | 'features' | 'all',
    context: BookingToolContext
): Promise<ToolResponse> {
    const startTime = Date.now();
    console.log(`ℹ️ [Booking Tool] get_restaurant_info: ${infoType} for restaurant ${context.restaurantId}`);

    const timezoneValidation = validateTimezoneAndOperatingHours(context);
    if (!timezoneValidation.isValid) {
        return createValidationFailure(`Timezone validation failed: ${timezoneValidation.error}`);
    }

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

        console.log(`✅ [Booking Tool] Getting restaurant info for ID: ${context.restaurantId} (timezone validated: ${context.timezone})`);

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

        // Get current operating status for enhanced hours info
        let currentOperatingStatus;
        if (infoType === 'hours' || infoType === 'all') {
            try {
                currentOperatingStatus = getRestaurantOperatingStatus(
                    context.timezone,
                    restaurant.openingTime || '10:00',
                    restaurant.closingTime || '23:00'
                );
            } catch (error) {
                console.warn(`[BookingTools] Could not get operating status:`, error);
            }
        }

        switch (infoType) {
            case 'hours':
                responseData = {
                    openingTime: formatTime(restaurant.openingTime),
                    closingTime: formatTime(restaurant.closingTime),
                    timezone: restaurant.timezone || context.timezone,
                    rawOpeningTime: restaurant.openingTime,
                    rawClosingTime: restaurant.closingTime,
                    slotInterval: restaurant.slotInterval || 30,
                    allowAnyTime: restaurant.allowAnyTime !== false,
                    minTimeIncrement: restaurant.minTimeIncrement || 15,
                    currentStatus: currentOperatingStatus?.status,
                    currentStatusMessage: currentOperatingStatus?.message,
                    isOvernightOperation: currentOperatingStatus?.isOvernightOperation
                };
                message = `We're open from ${formatTime(restaurant.openingTime)} to ${formatTime(restaurant.closingTime)}${restaurant.allowAnyTime ? '. You can book at any time during our hours!' : ''}${currentOperatingStatus ? ` Currently: ${currentOperatingStatus.message}` : ''}`;
                break;

            case 'location':
                responseData = {
                    name: restaurant.name,
                    address: restaurant.address,
                    city: restaurant.city,
                    country: restaurant.country,
                    timezone: restaurant.timezone || context.timezone
                };
                message = `${restaurant.name} is located at ${restaurant.address}, ${restaurant.city}${restaurant.country ? `, ${restaurant.country}` : ''} (${restaurant.timezone || context.timezone} timezone)`;
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
                    phone: restaurant.phone,
                    timezone: restaurant.timezone || context.timezone
                };
                message = `You can reach ${restaurant.name}${restaurant.phone ? ` at ${restaurant.phone}` : ''} (${restaurant.timezone || context.timezone} timezone)`;
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
                    timezone: restaurant.timezone || context.timezone,
                    slotInterval: restaurant.slotInterval || 30,
                    allowAnyTime: restaurant.allowAnyTime !== false,
                    minTimeIncrement: restaurant.minTimeIncrement || 15,
                    currentStatus: currentOperatingStatus?.status,
                    currentStatusMessage: currentOperatingStatus?.message,
                    isOvernightOperation: currentOperatingStatus?.isOvernightOperation
                };
                message = `${restaurant.name} serves ${restaurant.cuisine || 'excellent cuisine'} in a ${restaurant.atmosphere || 'wonderful'} atmosphere. We're open ${formatTime(restaurant.openingTime)} to ${formatTime(restaurant.closingTime)}${restaurant.allowAnyTime ? ' You can book at any exact time during our operating hours!' : ''}${currentOperatingStatus ? ` Currently: ${currentOperatingStatus.message}` : ''}`;
                break;
        }

        if (context.language && context.language !== 'en') {
            message = await BookingToolTranslationService.translateToolMessage(
                message,
                context.language as Language,
                'info'
            );
        }

        responseData.message = message;

        const responseMetadata: any = {
            execution_time_ms: executionTime,
            timezone_validated: true,
            restaurant_timezone: context.timezone
        };

        return createSuccessResponse(responseData, responseMetadata);

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

export default bookingTools;