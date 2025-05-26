// server/services/telegram-booking.ts

import { storage } from '../storage';
import { createReservation, type BookingRequest } from './booking';
import type { Reservation as SchemaReservation, Guest as SchemaGuest, InsertGuest, InsertReservation } from '@shared/schema';
import type { Language } from './conversation-manager';

// Новый тип для результата, чтобы поддерживать различные сценарии
export type CreateTelegramReservationResult = {
  success: boolean;
  status: 'created' | 'name_mismatch_clarification_needed' | 'error' | 'guest_profile_updated';
  reservation?: SchemaReservation;
  message: string;
  table?: { id: number; name: string };
  nameConflict?: { // Детали, если требуется уточнение имени
    guestId: number;
    dbName: string;    // Имя, которое сейчас в БД
    requestName: string; // Имя из текущего запроса на бронирование
    // Детали, необходимые для повторного вызова с подтвержденным именем
    phone: string;
    telegramUserId: string;
    date: string;
    time: string;
    guests: number;
    comments?: string;
    lang?: Language;
  };
};

export async function createTelegramReservation(
 restaurantId: number,
 date: string,
 time: string,
 guests: number,
 name: string, // Имя, предоставленное пользователем для ЭТОГО бронирования
 phone: string,
 telegramUserId: string,
 comments?: string,
 lang?: Language,
 confirmedName?: string // Имя, подтвержденное пользователем для ОБНОВЛЕНИЯ ПРОФИЛЯ (если отличается от name)
): Promise<CreateTelegramReservationResult> {
 try {
   console.log(`[TelegramBooking] Attempting to create reservation via Telegram. User-provided name for this booking: ${name}, Confirmed name for profile update: ${confirmedName}, Lang: ${lang}`);

   let guest: SchemaGuest | undefined = await storage.getGuestByTelegramId(telegramUserId);
   const effectiveLang: Language = lang || (guest?.language === 'ru' ? 'ru' : 'en');

   // Это имя будет использоваться для СОЗДАНИЯ бронирования и для ОТОБРАЖЕНИЯ в подтверждении.
   // Оно берется из первоначального ввода пользователя для этого конкретного бронирования.
   const nameForThisSpecificBooking = name; 

   if (!guest) {
     // Гость не найден по Telegram ID, пробуем найти по телефону
     guest = await storage.getGuestByPhone(phone);
     if (guest) {
       console.log(`[TelegramBooking] Found existing guest by phone ${phone}, associating Telegram ID: ${telegramUserId}`);
       const guestUpdateData: Partial<InsertGuest> = { telegram_user_id: telegramUserId };
       if (guest.language !== effectiveLang) {
         guestUpdateData.language = effectiveLang;
       }
       // Если имя в БД отличается от имени, которое пользователь ввел для ЭТОГО бронирования,
       // НЕ обновляем имя в профиле автоматически. Профиль обновляется только через confirmedName.
       if (guest.name !== nameForThisSpecificBooking) {
            console.log(`[TelegramBooking] Guest (found by phone) DB profile name '${guest.name}' differs from name for this booking '${nameForThisSpecificBooking}'. Profile name NOT changed at this step.`);
       }
       // Если confirmedName предоставлено и отличается от имени в БД, обновляем профиль.
       if (confirmedName && guest.name !== confirmedName) {
           console.log(`[TelegramBooking] Profile update: Guest (found by phone) DB name '${guest.name}' will be updated to confirmed name '${confirmedName}'.`);
           guestUpdateData.name = confirmedName;
       }

       if (Object.keys(guestUpdateData).length > 0) {
           guest = await storage.updateGuest(guest.id, guestUpdateData);
       }
     } else {
       // Создаем нового гостя. Имя профиля будет nameForThisSpecificBooking, так как это первое имя.
       console.log(`[TelegramBooking] Creating new guest with profile name: ${nameForThisSpecificBooking} (Phone: ${phone}, Telegram: ${telegramUserId})`);
       const newGuestData: InsertGuest = {
         name: nameForThisSpecificBooking, // Имя профиля нового гостя
         phone,
         telegram_user_id: telegramUserId,
         language: effectiveLang,
       };
       guest = await storage.createGuest(newGuestData);
       console.log(`[TelegramBooking] ✨ Created new guest ID: ${guest.id} for ${nameForThisSpecificBooking} (lang: ${effectiveLang})`);
     }
   } else {
     // Гость найден по Telegram ID
     console.log(`[TelegramBooking] Found existing guest ID: ${guest.id} (DB profile name: ${guest.name}) for Telegram ID ${telegramUserId}. Name for this booking: ${nameForThisSpecificBooking}`);

     // Если имя, введенное для ЭТОГО бронирования (name), отличается от имени в профиле гостя (guest.name)
     // И еще не было диалога подтверждения имени (т.е. confirmedName не предоставлено)
     if (!confirmedName && guest.name !== nameForThisSpecificBooking) {
       console.log(`[TelegramBooking] Name mismatch detected! DB profile: '${guest.name}', Name for this booking: '${nameForThisSpecificBooking}'. Clarification needed.`);
       return {
         success: false,
         status: 'name_mismatch_clarification_needed',
         message: 'Guest name mismatch. Clarification needed.',
         nameConflict: {
           guestId: guest.id,
           dbName: guest.name, // Имя из профиля в БД
           requestName: nameForThisSpecificBooking, // Имя, которое пользователь ввел для этого бронирования
           phone: phone,
           telegramUserId: telegramUserId,
           date: date,
           time: time,
           guests: guests,
           comments: comments,
           lang: effectiveLang,
         }
       };
     }

     // Обновление профиля существующего гостя, если необходимо
     const guestProfileUpdates: Partial<InsertGuest> = {};
     let needsProfileUpdate = false;

     if (phone && guest.phone !== phone) {
       guestProfileUpdates.phone = phone;
       needsProfileUpdate = true;
     }
     if (effectiveLang !== guest.language) {
       guestProfileUpdates.language = effectiveLang;
       needsProfileUpdate = true;
     }
     // Если было передано confirmedName (т.е. пользователь подтвердил имя для обновления профиля)
     // и оно отличается от текущего имени в профиле гостя, обновляем имя в профиле.
     if (confirmedName && guest.name !== confirmedName) {
        guestProfileUpdates.name = confirmedName;
        needsProfileUpdate = true;
        console.log(`[TelegramBooking] Guest profile name will be updated from '${guest.name}' to confirmed name: '${confirmedName}'`);
     }


     if (needsProfileUpdate) {
       guest = await storage.updateGuest(guest.id, guestProfileUpdates);
       console.log(`[TelegramBooking] Updated profile for existing guest ${guest.id}. New DB Profile Name: ${guest.name}`);
     }
   }

   // Подготовка данных для создания бронирования
   const bookingRequestData: InsertReservation = { // Используем InsertReservation из schema
     restaurantId,
     guestId: guest.id,
     date,
     time,
     guests,
     comments: comments || '',
     source: 'telegram',
     // booking_guest_name всегда устанавливается в имя, использованное для этого конкретного бронирования.
     // Это гарантирует, что бронирование будет отображаться с именем, под которым оно было сделано,
     // независимо от последующих изменений имени профиля гостя.
     booking_guest_name: nameForThisSpecificBooking, 
     // остальные поля InsertReservation будут по умолчанию или null, если не указаны
   };

   // Передаем lang в booking.ts, если он там используется для сообщений об ошибках/успехе
   const bookingServiceRequest: BookingRequest = {
       ...bookingRequestData, // booking_guest_name будет частью ...bookingRequestData
       lang: effectiveLang,
   };


   console.log('[TelegramBooking] Calling core createReservation service with request:', bookingServiceRequest);
   // createReservation из booking.ts должен принимать BookingRequest, который может включать booking_guest_name
   // Убедимся, что booking.ts правильно обрабатывает это поле (storage.ts уже обновлен).
   const result = await createReservation(bookingServiceRequest);

   if (result.success && result.reservation) {
     // Для сообщения подтверждения используем nameForThisSpecificBooking, так как это имя, под которым гость делал бронь
     console.log(`[TelegramBooking] ✅ Core booking service successfully created reservation ID: ${result.reservation.id} for table ${result.table?.name}. Guest name for this booking: ${nameForThisSpecificBooking}`);
     // Генерируем сообщение подтверждения, передавая имя, использованное для этого бронирования
     const confirmationMessage = generateTelegramConfirmationMessage(
        result.reservation, 
        nameForThisSpecificBooking, // Используем имя, под которым делалась эта бронь
        result.table?.name, 
        undefined, // restaurantName - можно получить из storage, если нужно
        effectiveLang
     );
     return { ...result, status: 'created', message: confirmationMessage };
   } else {
     console.warn(`[TelegramBooking] Core booking service failed: ${result.message}`);
     return { ...result, status: 'error' }; // result уже содержит success: false и message
   }

 } catch (error: unknown) {
   console.error('❌ [TelegramBooking] Unexpected error during createTelegramReservation:', error);
   const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred during booking.';
   return {
     success: false,
     status: 'error',
     message: `Failed to create reservation via Telegram: ${errorMessage}`,
   };
 }
}

export async function getAlternativeTimes(
 restaurantId: number,
 date: string,
 guests: number,
 lang: Language = 'en'
): Promise<Array<{
 time: string;
 timeDisplay: string;
 tableId: number;
 tableName: string;
 capacity: number;
 date: string;
}>> {
 try {
   console.log(`[TelegramBooking] Getting alternative times for ${guests} guests on ${date}, lang: ${lang}`);
   const { getAvailableTimeSlots } = await import('./availability.service');
   const availableSlots = await getAvailableTimeSlots(
     restaurantId,
     date,
     guests,
     {
       maxResults: 5,
       lang: lang
     }
   );
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

export async function isTimeSlotAvailable(
 restaurantId: number,
 date: string,
 time: string,
 guests: number,
 lang: Language = 'en'
): Promise<boolean> {
 try {
   console.log(`[TelegramBooking] Checking availability: ${restaurantId}, ${date}, ${time}, ${guests} guests, lang: ${lang}`);
   const { getAvailableTimeSlots } = await import('./availability.service');
   const availableSlots = await getAvailableTimeSlots(
     restaurantId,
     date,
     guests,
     {
       requestedTime: time,
       maxResults: 1,
       lang: lang
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

export function formatTimeForTelegram(time24: string, lang: Language = 'en'): string {
 try {
   const [hoursStr, minutesStr] = time24.split(':');
   const hours = parseInt(hoursStr, 10);
   const minutes = parseInt(minutesStr, 10);

   if (isNaN(hours) || isNaN(minutes)) {
     return time24;
   }

   const formattedMinutes = minutes.toString().padStart(2, '0');

   if (lang === 'ru') {
     return `${hours.toString().padStart(2, '0')}:${formattedMinutes}`;
   }

   const period = hours >= 12 ? 'PM' : 'AM';
   const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
   return `${displayHours}:${formattedMinutes} ${period}`;

 } catch (error) {
   console.warn('Error formatting time for Telegram:', error);
   return time24;
 }
}

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
    tablePrefix: "🪑 Table:",
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
        let peopleStr = "человек";
        if (count % 10 === 1 && count % 100 !== 11) {
            peopleStr = "человек";
        } else if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) {
            peopleStr = "человека";
        } else if (count > 4) { // Default for 0, 5-9, 11-14 etc.
            peopleStr = "человек";
        }
        return `👥 Количество гостей: ${count} ${peopleStr}`;
    },
    tablePrefix: "🪑 Столик:",
    specialRequestsPrefix: "📝 Особые пожелания:",
    footerBase: "\n✨ С нетерпением ждем вас!",
    footerWithRestaurant: (restaurantName) => `\n✨ С нетерпением ждем вас в ${restaurantName}!`,
  }
};

export function generateTelegramConfirmationMessage(
 reservation: SchemaReservation,
 guestNameForThisBooking: string, // This should be the name used for this specific booking
 tableName?: string,
 restaurantName?: string,
 lang: Language = 'en'
): string {
 const locale = confirmationLocaleStrings[lang] || confirmationLocaleStrings.en;

 const timeFormatted = formatTimeForTelegram(reservation.time, lang);
 const dateFormatted = new Date(reservation.date + 'T00:00:00Z') // Ensure UTC interpretation of date string
    .toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'Europe/Moscow' // Display in Moscow time
 });

 let message = locale.header;
 message += `${locale.guestPrefix} ${guestNameForThisBooking}\n`; // Use the specific name for this booking
 message += `${locale.datePrefix} ${dateFormatted}\n`;
 message += `${locale.timePrefix} ${timeFormatted}\n`;
 message += `${locale.partySizePrefix(reservation.guests)}\n`;

 if (tableName) {
   message += `${locale.tablePrefix} ${tableName}\n`;
 }

 // Use reservation.comments for special requests if available
 if (reservation.comments) { 
   message += `${locale.specialRequestsPrefix} ${reservation.comments}\n`;
 }

 if (restaurantName) {
   message += locale.footerWithRestaurant(restaurantName);
 } else {
   message += locale.footerBase;
 }

 return message;
}
