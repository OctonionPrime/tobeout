// server/services/telegram-booking.ts

import { storage } from '../storage';
// The core createReservation function is imported from booking.ts
import { createReservation, type BookingRequest } from './booking'; // Ensure this path is correct
import type { Reservation as SchemaReservation, Guest as SchemaGuest, InsertGuest } from '@shared/schema'; // Import SchemaReservation

/**
* Creates a reservation originating from a Telegram interaction.
* It handles finding or creating a guest based on phone number
* and then calls the core booking service.
*
* @param restaurantId - The ID of the restaurant.
* @param date - The desired date for the reservation (YYYY-MM-DD).
* @param time - The desired time for the reservation (HH:MM or HH:MM:SS).
* @param guests - The number of guests for the reservation.
* @param name - The name of the guest making the reservation.
* @param phone - The phone number of the guest.
* @param comments - Optional special requests or comments for the reservation.
* @returns A promise that resolves to an object indicating success or failure,
* along with the reservation details or an error message.
*/
export async function createTelegramReservation(
 restaurantId: number,
 date: string,
 time: string, // Can be HH:MM, booking.ts might handle parsing or expect HH:MM:SS
 guests: number,
 name: string,
 phone: string,
 telegramUserId: string,
 comments?: string
): Promise<{
 success: boolean;
 reservation?: SchemaReservation; // Use the specific type from schema.ts
 message: string;
 table?: { id: number; name: string }; // Match the return type of booking.ts#createReservation
}> {
 try {
   console.log(`[TelegramBooking] Attempting to create reservation via Telegram: ${guests} guests for ${name} on ${date} at ${time}`);

   // Step 1: Find or create the guest by Telegram user ID first, then by phone as fallback.
   let guest: SchemaGuest | undefined = await storage.getGuestByTelegramId(telegramUserId);
   if (!guest) {
     // Try to find by phone number as fallback
     guest = await storage.getGuestByPhone(phone);
     if (guest) {
       // Update existing guest with Telegram ID
       console.log(`[TelegramBooking] Found existing guest by phone ${phone}, adding Telegram ID: ${telegramUserId}`);
       guest = await storage.updateGuest(guest.id, { telegram_user_id: telegramUserId });
     } else {
       console.log(`[TelegramBooking] Creating new guest: ${name} (Phone: ${phone}, Telegram: ${telegramUserId})`);
       // Prepare guest data according to InsertGuest from schema.ts
       const newGuestData: InsertGuest = {
         name,
         phone,
         telegram_user_id: telegramUserId,
         language: 'en', // Default language
         // email, birthday, comments, tags are nullable and can be omitted
       };
       guest = await storage.createGuest(newGuestData);
       console.log(`[TelegramBooking] ✨ Created new guest ID: ${guest.id} for ${name}`);
     }
   } else {
     console.log(`[TelegramBooking] Found existing guest ID: ${guest.id} for Telegram ID ${telegramUserId}`);
     // Update phone number if it's different or missing
     if (!guest.phone || guest.phone !== phone) {
       guest = await storage.updateGuest(guest.id, { phone });
       console.log(`[TelegramBooking] Updated phone number for guest ${guest.id}`);
     }
   }

   // Step 2: Prepare the booking request for the core booking service.
   // BookingRequest interface is defined in booking.ts
   const bookingRequest: BookingRequest = {
     restaurantId,
     guestId: guest.id, // guest is now guaranteed to be defined
     date,
     time, // Pass time as received, booking.ts will handle it
     guests,
     comments: comments || '', // Ensure comments is a string, or undefined if not provided
     source: 'telegram', // Set the source of the booking
   };

   // Step 3: Call the core `createReservation` function (from booking.ts)
   // This function handles the smart table assignment and actual reservation creation.
   console.log('[TelegramBooking] Calling core createReservation service with request:', bookingRequest);
   const result = await createReservation(bookingRequest); // This now returns a strongly-typed response

   if (result.success) {
     console.log(`[TelegramBooking] ✅ Core booking service successfully created reservation ID: ${result.reservation?.id} for table ${result.table?.name}`);
   } else {
     console.warn(`[TelegramBooking] Core booking service failed: ${result.message}`);
   }

   return result; // Return the structured result from createReservation

 } catch (error: unknown) {
   console.error('❌ [TelegramBooking] Unexpected error during createTelegramReservation:', error);
   const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred during booking.';
   return {
     success: false,
     message: `Failed to create reservation via Telegram: ${errorMessage}`,
     // reservation and table will be undefined in this case
   };
 }
}

/**
* Get alternative available times for a given date and party size
* This is a simplified version for Telegram bot usage
*/
export async function getAlternativeTimes(
 restaurantId: number, 
 date: string, 
 guests: number
): Promise<Array<{
 time: string;
 timeDisplay: string;
 tableId: number;
 tableName: string;
 capacity: number;
 date: string;
}>> {
 try {
   console.log(`[TelegramBooking] Getting alternative times for ${guests} guests on ${date}`);

   // Import availability service dynamically to avoid circular dependencies
   const { getAvailableTimeSlots } = await import('./availability.service');

   const availableSlots = await getAvailableTimeSlots(
     restaurantId,
     date,
     guests,
     {
       maxResults: 5 // Return max 5 alternatives for Telegram
     }
   );

   // Convert to simplified format for Telegram bot
   return availableSlots.map(slot => ({
     time: slot.time,
     timeDisplay: slot.timeDisplay,
     tableId: slot.tableId,
     tableName: slot.tableName,
     capacity: slot.tableCapacity.max,
     date: slot.date
   }));

 } catch (error) {
   console.error('❌ Error getting alternative times:', error);
   return [];
 }
}

/**
* Check if a specific time slot is available for booking
* Useful for Telegram bot to validate user selections
*/
export async function isTimeSlotAvailable(
 restaurantId: number,
 date: string,
 time: string,
 guests: number
): Promise<boolean> {
 try {
   console.log(`[TelegramBooking] Checking availability: ${restaurantId}, ${date}, ${time}, ${guests} guests`);

   const { getAvailableTimeSlots } = await import('./availability.service');

   const availableSlots = await getAvailableTimeSlots(
     restaurantId,
     date,
     guests,
     {
       requestedTime: time,
       maxResults: 1
     }
   );

   const isAvailable = availableSlots.length > 0;
   console.log(`[TelegramBooking] Time slot ${time} availability: ${isAvailable}`);

   return isAvailable;

 } catch (error) {
   console.error('❌ Error checking time slot availability:', error);
   return false;
 }
}

/**
* Format time for display in Telegram messages
* Converts 24-hour format to 12-hour format with AM/PM
*/
export function formatTimeForTelegram(time24: string): string {
 try {
   const [hours, minutes] = time24.split(':').map(Number);

   if (isNaN(hours) || isNaN(minutes)) {
     return time24; // Return original if parsing fails
   }

   const period = hours >= 12 ? 'PM' : 'AM';
   const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;

   return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
 } catch (error) {
   console.warn('Error formatting time for Telegram:', error);
   return time24;
 }
}

/**
* Generate a user-friendly confirmation message for Telegram
*/
export function generateTelegramConfirmationMessage(
 reservation: SchemaReservation,
 guestName: string,
 tableName?: string,
 restaurantName?: string
): string {
 const timeFormatted = formatTimeForTelegram(reservation.time);
 const dateFormatted = new Date(reservation.date).toLocaleDateString('en-US', {
   weekday: 'long',
   year: 'numeric',
   month: 'long',
   day: 'numeric'
 });

 let message = `🎉 Reservation Confirmed!\n\n`;
 message += `👤 Guest: ${guestName}\n`;
 message += `📅 Date: ${dateFormatted}\n`;
 message += `⏰ Time: ${timeFormatted}\n`;
 message += `👥 Party Size: ${reservation.guests} ${reservation.guests === 1 ? 'person' : 'people'}\n`;

 if (tableName) {
   message += `🪑 Table: ${tableName}\n`;
 }

 if (reservation.comments) {
   message += `📝 Special Requests: ${reservation.comments}\n`;
 }

 message += `\n✨ We look forward to serving you`;
 if (restaurantName) {
   message += ` at ${restaurantName}`;
 }
 message += `!`;

 return message;
}

// The function `getAlternativeTimes` and its helpers (`getAvailableTablesForTime`, `formatTime`)
// from the old implementation have been REMOVED and replaced with the functions above.
// The new implementation uses `availability.service.ts` for comprehensive availability logic.