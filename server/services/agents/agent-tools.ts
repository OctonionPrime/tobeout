import { function_tool } from '@openai/agents';
import { getAvailableTimeSlots } from '../availability.service';
import { createTelegramReservation } from '../telegram_booking';
import { storage } from '../storage';
import type { Restaurant } from '@shared/schema';

// ✅ VERIFIED: Uses YOUR EXACT getAvailableTimeSlots function signature
@function_tool
export async function check_availability(
    date: string,
    time: string,
    guests: number,
    context: { restaurantId: number; timezone: string; language: string }
) {
    console.log(`🔍 [Agent Tool] check_availability: ${date} ${time} for ${guests} guests (Restaurant: ${context.restaurantId})`);

    try {
        // Use YOUR EXACT availability service with YOUR EXACT parameters
        const slots = await getAvailableTimeSlots(
            context.restaurantId,
            date,
            guests,
            {
                requestedTime: time,
                maxResults: 1,
                lang: context.language as any, // Your function expects Language type
                timezone: context.timezone,
                allowCombinations: true
            }
        );

        const requestedSlot = slots.find(slot => slot.time === time);

        const result = {
            available: !!requestedSlot,
            table: requestedSlot?.tableName || null,
            capacity: requestedSlot?.tableCapacity?.max || null,
            isCombined: requestedSlot?.isCombined || false,
            message: requestedSlot
                ? `Table ${requestedSlot.tableName} available for ${guests} guests${requestedSlot.isCombined ? ' (combined tables)' : ''}`
                : `No tables available for ${guests} guests at ${time}`,
            constituentTables: requestedSlot?.constituentTables || null
        };

        console.log(`✅ [Agent Tool] Availability result:`, result);
        return result;

    } catch (error) {
        console.error(`❌ [Agent Tool] check_availability error:`, error);
        return {
            available: false,
            error: error.message || 'Failed to check availability',
            message: 'Sorry, I encountered an issue checking availability. Please try again.'
        };
    }
}

@function_tool
export async function find_alternative_times(
    date: string,
    preferredTime: string,
    guests: number,
    context: { restaurantId: number; timezone: string; language: string }
) {
    console.log(`🔍 [Agent Tool] find_alternative_times: ${date} around ${preferredTime} for ${guests} guests`);

    try {
        // Use YOUR EXACT availability service for alternatives
        const slots = await getAvailableTimeSlots(
            context.restaurantId,
            date,
            guests,
            {
                requestedTime: preferredTime,
                maxResults: 5,
                lang: context.language as any, // Your Language type
                timezone: context.timezone,
                allowCombinations: true
            }
        );

        const alternatives = slots.map(slot => ({
            time: slot.timeDisplay,
            timeInternal: slot.time,
            table: slot.tableName,
            capacity: slot.tableCapacity.max,
            isCombined: slot.isCombined || false,
            message: `${slot.timeDisplay} - ${slot.tableName}${slot.isCombined ? ' (combined)' : ''}`
        }));

        console.log(`✅ [Agent Tool] Found ${alternatives.length} alternatives`);
        return {
            alternatives,
            count: alternatives.length,
            date: date
        };

    } catch (error) {
        console.error(`❌ [Agent Tool] find_alternative_times error:`, error);
        return {
            alternatives: [],
            count: 0,
            error: error.message,
            message: 'Sorry, I encountered an issue finding alternatives.'
        };
    }
}

// ✅ VERIFIED: Uses YOUR EXACT createTelegramReservation function
@function_tool
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
    }
) {
    console.log(`📝 [Agent Tool] create_reservation: ${guestName} (${guestPhone}) for ${guests} guests on ${date} at ${time}`);

    try {
        // Use YOUR EXACT createTelegramReservation function with YOUR EXACT parameters
        const result = await createTelegramReservation(
            context.restaurantId,
            date,
            time,
            guests,
            guestName,
            guestPhone,
            context.telegramUserId || 'web_chat_user',
            specialRequests,
            context.language as any, // Your Language type
            undefined, // confirmedName
            undefined, // selected_slot_info
            context.timezone
        );

        if (result.success && result.reservation) {
            console.log(`✅ [Agent Tool] Reservation created successfully: #${result.reservation.id}`);
            return {
                success: true,
                reservationId: result.reservation.id,
                message: result.message,
                table: result.table,
                confirmationNumber: result.reservation.id
            };
        } else {
            console.log(`⚠️ [Agent Tool] Reservation failed:`, result.message);
            return {
                success: false,
                error: result.message || 'Unknown booking error',
                message: result.message || 'Sorry, I could not complete your reservation. Please try again.'
            };
        }

    } catch (error) {
        console.error(`❌ [Agent Tool] create_reservation error:`, error);
        return {
            success: false,
            error: error.message || 'Failed to create reservation',
            message: 'Sorry, I encountered an issue creating your reservation. Please contact us directly.'
        };
    }
}

// ✅ VERIFIED: Uses YOUR EXACT storage.getRestaurant function
@function_tool
export async function get_restaurant_info(
    infoType: 'hours' | 'location' | 'cuisine' | 'contact' | 'features' | 'all',
    context: { restaurantId: number }
) {
    console.log(`ℹ️ [Agent Tool] get_restaurant_info: ${infoType} for restaurant ${context.restaurantId}`);

    try {
        // Use YOUR EXACT storage.getRestaurant method
        const restaurant = await storage.getRestaurant(context.restaurantId);
        if (!restaurant) {
            return {
                error: 'Restaurant not found',
                message: 'Sorry, I could not find restaurant information.'
            };
        }

        const formatTime = (time: string) => {
            if (!time) return 'Not specified';
            const [hours, minutes] = time.split(':');
            const hour = parseInt(hours);
            const ampm = hour >= 12 ? 'PM' : 'AM';
            const displayHour = hour % 12 || 12;
            return `${displayHour}:${minutes} ${ampm}`;
        };

        switch (infoType) {
            case 'hours':
                return {
                    openingTime: formatTime(restaurant.openingTime),
                    closingTime: formatTime(restaurant.closingTime),
                    timezone: restaurant.timezone,
                    message: `We're open from ${formatTime(restaurant.openingTime)} to ${formatTime(restaurant.closingTime)}`
                };
            case 'location':
                return {
                    name: restaurant.name,
                    address: restaurant.address,
                    city: restaurant.city,
                    country: restaurant.country,
                    message: `${restaurant.name} is located at ${restaurant.address}, ${restaurant.city}${restaurant.country ? `, ${restaurant.country}` : ''}`
                };
            case 'cuisine':
                return {
                    cuisine: restaurant.cuisine,
                    atmosphere: restaurant.atmosphere,
                    features: restaurant.features,
                    message: `We specialize in ${restaurant.cuisine || 'excellent cuisine'} with a ${restaurant.atmosphere || 'wonderful'} atmosphere.`
                };
            case 'contact':
                return {
                    name: restaurant.name,
                    phone: restaurant.phone,
                    message: `You can reach ${restaurant.name}${restaurant.phone ? ` at ${restaurant.phone}` : ''}`
                };
            default:
                return {
                    name: restaurant.name,
                    cuisine: restaurant.cuisine,
                    atmosphere: restaurant.atmosphere,
                    address: restaurant.address,
                    city: restaurant.city,
                    phone: restaurant.phone,
                    openingTime: formatTime(restaurant.openingTime),
                    closingTime: formatTime(restaurant.closingTime),
                    features: restaurant.features,
                    message: `${restaurant.name} serves ${restaurant.cuisine || 'excellent cuisine'} in a ${restaurant.atmosphere || 'wonderful'} atmosphere. We're open ${formatTime(restaurant.openingTime)} to ${formatTime(restaurant.closingTime)}.`
                };
        }

    } catch (error) {
        console.error(`❌ [Agent Tool] get_restaurant_info error:`, error);
        return {
            error: error.message,
            message: 'Sorry, I could not retrieve restaurant information at the moment.'
        };
    }
}