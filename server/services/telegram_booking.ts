// server/services/telegram_booking.ts

import { storage } from '../storage';
import { 
    createReservation as coreCreateReservation, // Renamed to avoid conflict
    type BookingRequest as CoreBookingRequest, // Renamed
    type BookingResponse as CoreBookingResponse // Renamed
} from './booking';
import type { 
    Reservation as SchemaReservation, 
    Guest as SchemaGuest, 
    InsertGuest, 
    Restaurant // Added Restaurant import
} from '@shared/schema';
import type { Language } from './enhanced-conversation-manager';
import type { AvailabilitySlot as ServiceAvailabilitySlot } from './availability.service'; // Import AvailabilitySlot

// Updated result type
export type CreateTelegramReservationResult = {
  success: boolean;
  status: 'created' | 'name_mismatch_clarification_needed' | 'error' | 'guest_profile_updated';
  reservation?: SchemaReservation; // Primary reservation
  message: string; // This will be the user-facing message, often from coreCreateReservation
  table?: { // Detailed table info from coreCreateReservation
      id: number;
      name: string;
      isCombined: boolean;
      constituentTables?: Array<{ id: number; name: string }>;
  };
  allReservationIds?: number[]; // All IDs if multiple reservations were made for a combo
  nameConflict?: {
    guestId: number;
    dbName: string;
    requestName: string;
    phone: string;
    telegramUserId: string;
    date: string;
    time: string;
    guests: number;
    comments?: string;
    lang?: Language;
  };
};

// ✅ CRITICAL FIX: Add restaurantTimezone parameter
export async function createTelegramReservation(
 restaurantId: number,
 date: string,
 time: string,
 guests: number,
 name: string, 
 phone: string,
 telegramUserId: string,
 comments?: string,
 lang?: Language,
 confirmedName?: string,
 selected_slot_info?: ServiceAvailabilitySlot, // Added selected_slot_info
 restaurantTimezone: string = 'Europe/Moscow' // ✅ CRITICAL ADDITION
): Promise<CreateTelegramReservationResult> {
 try {
   console.log(`[TelegramBooking] Initiating reservation: R${restaurantId}, UserReqName:${name}, Date:${date}, Time:${time}, Guests:${guests}, TGUser:${telegramUserId}, Lang:${lang}, ConfirmedProfileName:${confirmedName}, Timezone:${restaurantTimezone}`);
   if (selected_slot_info) {
    console.log(`[TelegramBooking] Using pre-selected slot: TableName ${selected_slot_info.tableName}, IsCombined: ${selected_slot_info.isCombined}`);
   }

   let guest: SchemaGuest | undefined = await storage.getGuestByTelegramId(telegramUserId);
   const effectiveLang: Language = lang || (guest?.language === 'ru' ? 'ru' : 'en');
   const nameForThisSpecificBooking = name; 

   const restaurant: Restaurant | undefined = await storage.getRestaurant(restaurantId);
   if (!restaurant) {
       console.error(`[TelegramBooking] Restaurant not found: ${restaurantId}`);
       return { success: false, status: 'error', message: `Restaurant not found.` }; // Consider localizing
   }

   // ✅ ENHANCEMENT: Use restaurant timezone from database if not provided
   const effectiveTimezone = restaurant.timezone || restaurantTimezone;
   console.log(`[TelegramBooking] Using timezone: ${effectiveTimezone}`);

   if (!guest) {
     guest = await storage.getGuestByPhone(phone);
     if (guest) {
       console.log(`[TelegramBooking] Found guest by phone ${phone}, associating Telegram ID: ${telegramUserId}`);
       const guestUpdateData: Partial<InsertGuest> = { telegram_user_id: telegramUserId };
       if (guest.language !== effectiveLang) guestUpdateData.language = effectiveLang;
       if (confirmedName && guest.name !== confirmedName) {
            console.log(`[TelegramBooking] Updating guest (found by phone) profile name from '${guest.name}' to '${confirmedName}'.`);
            guestUpdateData.name = confirmedName;
       } else if (!confirmedName && guest.name !== nameForThisSpecificBooking) {
            console.log(`[TelegramBooking] Guest (found by phone) DB name '${guest.name}' differs from this booking's name '${nameForThisSpecificBooking}'. Profile name NOT changed without confirmation.`);
       }
       if (Object.keys(guestUpdateData).length > 0) {
           guest = await storage.updateGuest(guest.id, guestUpdateData);
       }
     } else {
       console.log(`[TelegramBooking] Creating new guest. Profile name: ${nameForThisSpecificBooking}, Phone: ${phone}, TG: ${telegramUserId}`);
       guest = await storage.createGuest({
         name: nameForThisSpecificBooking,
         phone,
         telegram_user_id: telegramUserId,
         language: effectiveLang,
       });
       console.log(`[TelegramBooking] ✨ New guest ID: ${guest.id} for ${nameForThisSpecificBooking} (lang: ${effectiveLang})`);
     }
   } else { // Guest found by Telegram ID
     console.log(`[TelegramBooking] Found guest ID: ${guest.id} (DB Profile: ${guest.name}) by TG ID. This booking name: ${nameForThisSpecificBooking}`);
     const guestProfileUpdates: Partial<InsertGuest> = {};
     let needsProfileUpdate = false;

     if (phone && guest.phone !== phone) { guestProfileUpdates.phone = phone; needsProfileUpdate = true; }
     if (effectiveLang !== guest.language) { guestProfileUpdates.language = effectiveLang; needsProfileUpdate = true; }

     if (confirmedName && guest.name !== confirmedName) {
        guestProfileUpdates.name = confirmedName;
        needsProfileUpdate = true;
        console.log(`[TelegramBooking] Updating existing guest profile name from '${guest.name}' to confirmed name: '${confirmedName}'`);
     } else if (!confirmedName && guest.name !== nameForThisSpecificBooking) {
       console.log(`[TelegramBooking] Name mismatch! DB Profile: '${guest.name}', This booking: '${nameForThisSpecificBooking}'. Clarification needed.`);
       return {
         success: false,
         status: 'name_mismatch_clarification_needed',
         message: 'Guest name mismatch. Clarification needed.', // This message might be overridden by telegram.ts
         nameConflict: {
           guestId: guest.id,
           dbName: guest.name,
           requestName: nameForThisSpecificBooking,
           phone, telegramUserId, date, time, guests, comments, lang: effectiveLang,
         }
       };
     }
     if (needsProfileUpdate) {
       guest = await storage.updateGuest(guest.id, guestProfileUpdates);
       console.log(`[TelegramBooking] Updated profile for guest ${guest.id}. New DB Profile Name: ${guest.name}`);
     }
   }

   // ✅ CRITICAL FIX: Pass timezone to core booking service
   const bookingServiceRequest: CoreBookingRequest = {
     restaurantId,
     guestId: guest.id,
     date, time, guests,
     comments: comments || '',
     source: 'telegram',
     booking_guest_name: nameForThisSpecificBooking,
     lang: effectiveLang,
     selected_slot_info: selected_slot_info, // Pass the selected slot if available
     timezone: effectiveTimezone // ✅ CRITICAL ADDITION
   };

   console.log('[TelegramBooking] Calling coreCreateReservation with request:', bookingServiceRequest);
   const result: CoreBookingResponse = await coreCreateReservation(bookingServiceRequest);

   if (result.success) {
     console.log(`[TelegramBooking] ✅ Core booking successful. Message: ${result.message}`);
     return {
       success: true,
       status: 'created',
       reservation: result.reservation,
       message: result.message, // Use the message from core booking service
       table: result.table,
       allReservationIds: result.allReservationIds
     };
   } else {
     console.warn(`[TelegramBooking] Core booking failed: ${result.message}`);
     return {
       success: false,
       status: 'error',
       message: result.message, // Use error message from core booking service
       table: result.table // Pass table info even on failure if available (e.g. partial booking)
     };
   }

 } catch (error: unknown) {
   console.error('❌ [TelegramBooking] Unexpected error:', error);
   const errorMessage = error instanceof Error ? error.message : 'Unknown error during Telegram booking.';
   return {
     success: false,
     status: 'error',
     message: `Booking failed: ${errorMessage}`,
   };
 }
}


// ✅ CRITICAL FIX: Add restaurantTimezone parameter to confirmation message
export function generateTelegramConfirmationMessage(
 reservation: SchemaReservation,
 guestNameForThisBooking: string,
 tableNameFromSlot?: string, // This will be the descriptive name like "Tables T1 & T2" or "Table A5"
 restaurantName?: string,
 lang: Language = 'en',
 restaurantTimezone: string = 'Europe/Moscow' // ✅ CRITICAL ADDITION
): string {
  interface ConfirmationStrings {
    header: string;
    guestPrefix: string;
    datePrefix: string;
    timePrefix: string;
    partySizePrefix: (count: number) => string;
    tablePrefix: string;
    specialRequestsPrefix: string;
    footerBase: string;
    footerWithRestaurant: (restaurantName: string) => string;
  }

  const confirmationLocaleStrings: Record<Language, ConfirmationStrings> = {
    en: {
      header: "🎉 Reservation Confirmed!\n\n",
      guestPrefix: "👤 Guest:",
      datePrefix: "📅 Date:",
      timePrefix: "⏰ Time:",
      partySizePrefix: (count) => `👥 Party Size: ${count} ${count === 1 ? 'person' : 'people'}`,
      tablePrefix: "🪑 Table(s):", // Changed to Table(s)
      specialRequestsPrefix: "📝 Special Requests:",
      footerBase: "\n✨ We look forward to serving you!",
      footerWithRestaurant: (restaurantName) => `\n✨ We look forward to serving you at ${restaurantName}!`,
    },
    ru: {
      header: "🎉 Бронирование подтверждено!\n\n",
      guestPrefix: "👤 Гость:",
      datePrefix: "📅 Дата:",
      timePrefix: "⏰ Время:",
      partySizePrefix: (count) => {
          let peopleStr = "человек"; // Default for 0, 5-20, 25-30 etc. and 1.
          if (count % 10 === 1 && count % 100 !== 11) peopleStr = "человек"; // 1, 21, 31 (but not 11)
          else if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) peopleStr = "человека"; // 2-4, 22-24 etc.
          else peopleStr = "человек"; // 0, 5-20 etc.
          return `👥 Количество гостей: ${count} ${peopleStr}`;
      },
      tablePrefix: "🪑 Стол(ик/и):", // Changed to Стол(ик/и)
      specialRequestsPrefix: "📝 Особые пожелания:",
      footerBase: "\n✨ С нетерпением ждем вас!",
      footerWithRestaurant: (restaurantName) => `\n✨ С нетерпением ждем вас в ${restaurantName}!`,
    }
  };
 const locale = confirmationLocaleStrings[lang] || confirmationLocaleStrings.en;

 const timeFormatted = formatTimeForTelegram(reservation.time, lang);
 
 // ✅ CRITICAL FIX: Use restaurant timezone instead of hardcoded Moscow
 const dateFormatted = new Date(reservation.date + 'T00:00:00Z')
    .toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', {
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric', 
      timeZone: restaurantTimezone // ✅ CRITICAL FIX: Use restaurant timezone
 });

 let message = locale.header;
 message += `${locale.guestPrefix} ${guestNameForThisBooking}\n`;
 message += `${locale.datePrefix} ${dateFormatted}\n`;
 message += `${locale.timePrefix} ${timeFormatted}\n`;
 message += `${locale.partySizePrefix(reservation.guests)}\n`;

 // Use the tableNameFromSlot which could be "Table A5" or "Tables T1 & T2"
 if (tableNameFromSlot) {
   message += `${locale.tablePrefix} ${tableNameFromSlot}\n`;
 }

 if (reservation.comments && !reservation.comments.startsWith("Combined booking:") && !reservation.comments.startsWith("Part of combined booking")) {
   message += `${locale.specialRequestsPrefix} ${reservation.comments}\n`;
 } else if (reservation.comments?.includes(" (Combined with:")){ // Show user's original comment if it was part of a combined booking comment
    const originalComment = reservation.comments.substring(0, reservation.comments.indexOf(" (Combined with:"));
    if (originalComment.trim()) {
        message += `${locale.specialRequestsPrefix} ${originalComment.trim()}\n`;
    }
 }

 if (restaurantName) {
   message += locale.footerWithRestaurant(restaurantName);
 } else {
   message += locale.footerBase;
 }

 return message;
}

// Helper function (already in telegram_booking.ts, ensure it's exported or accessible if needed elsewhere)
export function formatTimeForTelegram(time24: string, lang: Language = 'en'): string {
 try {
   const [hoursStr, minutesStr] = time24.split(':');
   const hours = parseInt(hoursStr, 10);
   const minutes = parseInt(minutesStr, 10);

   if (isNaN(hours) || isNaN(minutes)) return time24;
   const formattedMinutes = minutes.toString().padStart(2, '0');
   if (lang === 'ru') return `${hours.toString().padStart(2, '0')}:${formattedMinutes}`;

   const period = hours >= 12 ? 'PM' : 'AM';
   const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
   return `${displayHours}:${formattedMinutes} ${period}`;
 } catch (error) {
   console.warn('[TelegramBooking] Error formatting time:', error);
   return time24;
 }
}

// getAlternativeTimes and isTimeSlotAvailable are more related to availability checking
// and might be better suited in availability.service.ts or called from telegram.ts directly
// For now, they are removed from here to keep telegram_booking.ts focused on the booking act itself.
// If telegram.ts needs these, it should import them from availability.service.ts.