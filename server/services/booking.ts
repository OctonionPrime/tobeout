// server/services/booking.ts

import { storage } from '../storage';
import {
 getAvailableTimeSlots,
 type AvailabilitySlot as ServiceAvailabilitySlot, // Это из availability.service.ts
 formatTimeForDisplay as formatTimeFromAvailabilityService, // Импортируем функцию форматирования
} from './availability.service';

import type {
 Restaurant,
 Reservation as SchemaReservation,
 InsertReservation, // Make sure this is imported
 Guest // Import Guest type if needed for guest details
} from '@shared/schema';
import type { Language } from './conversation-manager'; // Импортируем тип Language

// --- Локализованные строки для booking.ts ---
interface BookingServiceStrings {
  restaurantNotFound: (restaurantId: number | string) => string;
  noTablesAvailable: (guests: number, date: string, time: string) => string;
  reservationConfirmed: (guests: number, tableName: string, date: string, timeDisplay: string, guestName: string) => string; // Added guestName
  failedToCreateReservation: (errorMsg: string) => string;
  reservationNotFound: (reservationId: number | string) => string;
  reservationAlreadyCancelled: (reservationId: number | string) => string;
  reservationCancelledSuccessfully: string;
  failedToCancelReservation: (errorMsg: string) => string;
  unknownErrorCreating: string;
  unknownErrorCancelling: string;
  guestNotFound: (guestId: number) => string;
}

const bookingLocaleStrings: Record<Language, BookingServiceStrings> = {
  en: {
    restaurantNotFound: (restaurantId) => `Restaurant with ID ${restaurantId} not found.`,
    noTablesAvailable: (guests, date, time) => `No tables available for ${guests} guests on ${date} at ${time}.`,
    reservationConfirmed: (guests, tableName, date, timeDisplay, guestName) => `Reservation confirmed for ${guestName} (${guests} guests) at Table ${tableName} on ${date} at ${timeDisplay}.`,
    failedToCreateReservation: (errorMsg) => `Failed to create reservation: ${errorMsg}`,
    reservationNotFound: (reservationId) => `Reservation ID ${reservationId} not found.`,
    reservationAlreadyCancelled: (reservationId) => `Reservation ID ${reservationId} is already canceled.`,
    reservationCancelledSuccessfully: 'Reservation cancelled successfully.',
    failedToCancelReservation: (errorMsg) => `Failed to cancel reservation: ${errorMsg}`,
    unknownErrorCreating: 'An unknown error occurred while creating the reservation.',
    unknownErrorCancelling: 'Unknown error while cancelling reservation.',
    guestNotFound: (guestId) => `Guest with ID ${guestId} not found. Cannot determine booking name.`,
  },
  ru: {
    restaurantNotFound: (restaurantId) => `Ресторан с ID ${restaurantId} не найден.`,
    noTablesAvailable: (guests, date, time) => `Нет доступных столиков для ${guests} гостей на ${date} в ${time}.`,
    reservationConfirmed: (guests, tableName, date, timeDisplay, guestName) => `Бронирование подтверждено для ${guestName} (${guests} гостей) за столиком ${tableName} на ${date} в ${timeDisplay}.`,
    failedToCreateReservation: (errorMsg) => `Не удалось создать бронирование: ${errorMsg}`,
    reservationNotFound: (reservationId) => `Бронирование с ID ${reservationId} не найдено.`,
    reservationAlreadyCancelled: (reservationId) => `Бронирование с ID ${reservationId} уже отменено.`,
    reservationCancelledSuccessfully: 'Бронирование успешно отменено.',
    failedToCancelReservation: (errorMsg) => `Не удалось отменить бронирование: ${errorMsg}`,
    unknownErrorCreating: 'Произошла неизвестная ошибка при создании бронирования.',
    unknownErrorCancelling: 'Произошла неизвестная ошибка при отмене бронирования.',
    guestNotFound: (guestId) => `Гость с ID ${guestId} не найден. Невозможно определить имя для бронирования.`,
  }
};

// Интерфейс для запроса на бронирование
export interface BookingRequest {
 restaurantId: number;
 guestId: number;
 date: string; // Формат YYYY-MM-DD
 time: string; // Формат HH:MM или HH:MM:SS
 guests: number;
 comments?: string;
 source?: string;
 lang?: Language; // Добавляем язык для локализации сообщений
 booking_guest_name?: string | null; // <<< НОВОЕ ПОЛЕ: Имя гостя специфичное для этого бронирования
 // tableId и timeslotId не должны быть здесь, они определяются логикой доступности
}

// Устаревший интерфейс для обратной совместимости с routes.ts
export interface AvailableSlot {
 tableId: number;
 timeslotId: number; // Это поле может быть устаревшим, если timeslots не используются активно
 date: string;
 time: string;
 tableName: string;
 tableCapacity: { min: number; max: number };
}

/**
* Создание бронирования с использованием нового сервиса доступности.
*/
export async function createReservation(bookingRequest: BookingRequest): Promise<{
 success: boolean;
 reservation?: SchemaReservation;
 message: string;
 table?: { id: number; name: string };
}> {
  const lang = bookingRequest.lang || 'en'; // По умолчанию английский
  const locale = bookingLocaleStrings[lang];

 try {
   const { restaurantId, date, time, guests, guestId, comments, source, booking_guest_name } = bookingRequest;
   console.log(`[BookingService] Attempting to create reservation: Restaurant ${restaurantId}, Date ${date}, Time ${time}, Guests ${guests}, GuestID ${guestId}, BookingName: ${booking_guest_name}, Lang: ${lang}`);

   const restaurant: Restaurant | undefined = await storage.getRestaurant(restaurantId);
   if (!restaurant) {
     console.error(`[BookingService] Restaurant with ID ${restaurantId} not found.`);
     return {
       success: false,
       message: locale.restaurantNotFound(restaurantId),
     };
   }

   const guestInfo: Guest | undefined = await storage.getGuest(guestId);
   if (!guestInfo) {
    console.error(`[BookingService] Guest with ID ${guestId} not found.`);
    return {
        success: false,
        message: locale.guestNotFound(guestId),
      };
   }
   // Определяем имя для подтверждения: используем booking_guest_name если есть, иначе имя из профиля гостя
   const nameForConfirmationMessage = booking_guest_name || guestInfo.name;


   const slotDurationMinutes = restaurant.avgReservationDuration;

   const availableSlots: ServiceAvailabilitySlot[] = await getAvailableTimeSlots(
     restaurantId,
     date,
     guests,
     {
       requestedTime: time,
       maxResults: 1,
       slotDurationMinutes: slotDurationMinutes,
       lang: lang, 
     }
   );

   if (!availableSlots || availableSlots.length === 0) {
     const displayTime = formatTimeFromAvailabilityService(time, lang);
     console.log(`[BookingService] No available slots found for Restaurant ${restaurantId}, Date ${date}, Time ${time}, Guests ${guests}.`);
     return {
       success: false,
       message: locale.noTablesAvailable(guests, date, displayTime),
     };
   }

   const selectedSlot = availableSlots[0];
   console.log(`[BookingService] Best available slot found: Table ID ${selectedSlot.tableId} (${selectedSlot.tableName}) at ${selectedSlot.timeDisplay}`);

   const reservationData: InsertReservation = {
     restaurantId: restaurantId,
     guestId: guestId,
     tableId: selectedSlot.tableId,
     timeslotId: null, 
     date: date,
     time: selectedSlot.time, 
     duration: slotDurationMinutes,
     guests: guests,
     status: 'confirmed',
     comments: comments || '',
     source: source || 'direct',
     booking_guest_name: booking_guest_name, // <<< ПЕРЕДАЕМ booking_guest_name в storage
   };

   const newReservation: SchemaReservation = await storage.createReservation(reservationData);
   console.log(`[BookingService] ✅ Reservation ID ${newReservation.id} created successfully for Table ${selectedSlot.tableName}. Booking Guest Name: ${newReservation.booking_guest_name || 'using profile name'}`);

   return {
     success: true,
     reservation: newReservation,
     message: locale.reservationConfirmed(guests, selectedSlot.tableName, date, selectedSlot.timeDisplay, nameForConfirmationMessage),
     table: { id: selectedSlot.tableId, name: selectedSlot.tableName },
   };

 } catch (error: unknown) {
   console.error('[BookingService] ❌ Error during createReservation:', error);
   const errorMessage = error instanceof Error ? error.message : locale.unknownErrorCreating;
   return {
     success: false,
     message: locale.failedToCreateReservation(errorMessage),
   };
 }
}

/**
* Отмена бронирования и обновление соответствующих статусов.
*/
export async function cancelReservation(reservationId: number, lang: Language = 'en'): Promise<{
 success: boolean;
 message: string;
}> {
  const locale = bookingLocaleStrings[lang];
 try {
   console.log(`[BookingService] Attempting to cancel reservation ID ${reservationId}`);

   const reservation: SchemaReservation | undefined = (await storage.getReservation(reservationId)) as SchemaReservation | undefined;

   if (!reservation) {
     return {
       success: false,
       message: locale.reservationNotFound(reservationId),
     };
   }

   if (reservation.status === 'canceled') {
     return {
       success: false,
       message: locale.reservationAlreadyCancelled(reservationId),
     };
   }

   await storage.updateReservation(reservationId, { status: 'canceled' });

   if (reservation.timeslotId) {
     await storage.updateTimeslot(reservation.timeslotId, { status: 'free' });
     console.log(`[BookingService] Timeslot ID ${reservation.timeslotId} status updated to 'free'.`);
   }

   console.log(`[BookingService] ✅ Reservation ID ${reservationId} cancelled successfully.`);
   return {
     success: true,
     message: locale.reservationCancelledSuccessfully,
   };

 } catch (error: unknown) {
   console.error(`[BookingService] ❌ Error cancelling reservation ID ${reservationId}:`, error);
   const errorMessage = error instanceof Error ? error.message : locale.unknownErrorCancelling;
   return {
     success: false,
     message: locale.failedToCancelReservation(errorMessage),
   };
 }
}

// --- Функции для обратной совместимости и другие ---

export async function getDateAvailabilityFromTimeslots(
 restaurantId: number,
 date: string
): Promise<{
 totalDefinedSlots: number;
 availableDefinedSlots: number;
 occupiedDefinedSlots: number;
 timeSlotsSummary: Array<{
   time: string;
   availableCount: number;
   totalCount: number;
 }>;
}> {
 const timeslotsForDate = await storage.getTimeslots(restaurantId, date);
 const timeGroups: { [time: string]: { free: number, pending: number, occupied: number, total: number } } = {};

 for (const slot of timeslotsForDate) {
   if (!timeGroups[slot.time]) {
     timeGroups[slot.time] = { free: 0, pending: 0, occupied: 0, total: 0 };
   }
   timeGroups[slot.time].total++;
   if (slot.status === 'free') {
     timeGroups[slot.time].free++;
   } else if (slot.status === 'pending') {
     timeGroups[slot.time].pending++;
   } else if (slot.status === 'occupied') {
     timeGroups[slot.time].occupied++;
   }
 }

 const timeSlotsSummary = Object.entries(timeGroups)
   .map(([time, counts]) => ({
     time: time,
     availableCount: counts.free,
     totalCount: counts.total,
   }))
   .sort((a, b) => a.time.localeCompare(b.time));

 const totalDefinedSlots = timeslotsForDate.length;
 const availableDefinedSlots = timeslotsForDate.filter(s => s.status === 'free').length;
 const occupiedDefinedSlots = timeslotsForDate.filter(s => s.status === 'occupied' || s.status === 'pending').length;

 return {
   totalDefinedSlots,
   availableDefinedSlots,
   occupiedDefinedSlots,
   timeSlotsSummary,
 };
}

export async function findAvailableTables(
 restaurantId: number,
 date: string,
 time: string,
 guests: number,
 lang: Language = 'en' 
): Promise<AvailableSlot[]> {
 try {
   console.log(`[Legacy] findAvailableTables called: ${restaurantId}, ${date}, ${time}, ${guests}, Lang: ${lang}`);
   const slots = await getAvailableTimeSlots(restaurantId, date, guests, {
     requestedTime: time,
     maxResults: 10,
     lang: lang, 
   });
   return slots.map(slot => ({
     tableId: slot.tableId,
     timeslotId: 0, 
     date: slot.date,
     time: slot.time, 
     tableName: slot.tableName,
     tableCapacity: slot.tableCapacity,
   }));
 } catch (error) {
   console.error('[Legacy] Error in findAvailableTables wrapper:', error);
   return [];
 }
}

export async function findAlternativeSlots(
 restaurantId: number,
 date: string,
 time: string,
 guests: number,
 lang: Language = 'en' 
): Promise<AvailableSlot[]> {
 try {
   console.log(`[Legacy] findAlternativeSlots called: ${restaurantId}, ${date}, ${time}, ${guests}, Lang: ${lang}`);
   const slots = await getAvailableTimeSlots(restaurantId, date, guests, {
     requestedTime: time,
     maxResults: 5,
     lang: lang, 
   });
   return slots.map(slot => ({
     tableId: slot.tableId,
     timeslotId: 0, 
     date: slot.date,
     time: slot.time,
     tableName: slot.tableName,
     tableCapacity: slot.tableCapacity,
   }));
 } catch (error) {
   console.error('[Legacy] Error in findAlternativeSlots wrapper:', error);
   return [];
 }
}

export async function getDateAvailability(
 restaurantId: number,
 date: string
): Promise<{
 totalSlots: number;
 availableSlots: number;
 occupiedSlots: number;
 timeSlots: Array<{
   time: string;
   available: number;
   total: number;
 }>;
}> {
 try {
   console.log(`[Legacy] getDateAvailability called: ${restaurantId}, ${date}`);
   const result = await getDateAvailabilityFromTimeslots(restaurantId, date);
   return {
     totalSlots: result.totalDefinedSlots,
     availableSlots: result.availableDefinedSlots,
     occupiedSlots: result.occupiedDefinedSlots,
     timeSlots: result.timeSlotsSummary.map(slot => ({
       time: slot.time,
       available: slot.availableCount,
       total: slot.totalCount
     }))
   };
 } catch (error) {
   console.error('[Legacy] Error in getDateAvailability wrapper:', error);
   return {
     totalSlots: 0,
     availableSlots: 0,
     occupiedSlots: 0,
     timeSlots: []
   };
 }
}
