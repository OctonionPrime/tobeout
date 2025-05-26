// server/services/booking.ts

import { storage } from '../storage';
import {
 getAvailableTimeSlots,
 type AvailabilitySlot as ServiceAvailabilitySlot,
 formatTimeForDisplay as formatTimeFromAvailabilityService,
} from './availability.service';

import type {
 Restaurant,
 Reservation as SchemaReservation,
 InsertReservation,
 Guest
} from '@shared/schema';
import type { Language } from './conversation-manager';

// --- Локализованные строки для booking.ts ---
interface BookingServiceStrings {
  restaurantNotFound: (restaurantId: number | string) => string;
  noTablesAvailable: (guests: number, date: string, time: string) => string;
  reservationConfirmed: (guests: number, tableName: string, date: string, timeDisplay: string, guestName: string) => string;
  reservationConfirmedCombined: (guests: number, combinedTableName: string, date: string, timeDisplay: string, guestName: string) => string;
  failedToCreateReservation: (errorMsg: string) => string;
  reservationNotFound: (reservationId: number | string) => string;
  reservationAlreadyCancelled: (reservationId: number | string) => string;
  reservationCancelledSuccessfully: string;
  failedToCancelReservation: (errorMsg: string) => string;
  unknownErrorCreating: string;
  unknownErrorCancelling: string;
  guestNotFound: (guestId: number) => string;
  errorCreatingLinkedReservation: (tableName: string) => string;
}

const bookingLocaleStrings: Record<Language, BookingServiceStrings> = {
  en: {
    restaurantNotFound: (restaurantId) => `Restaurant with ID ${restaurantId} not found.`,
    noTablesAvailable: (guests, date, time) => `Sorry, no tables are available for ${guests} guests on ${date} at ${time}. Please try a different time or date.`,
    reservationConfirmed: (guests, tableName, date, timeDisplay, guestName) => `Reservation confirmed for ${guestName} (${guests} guests) at Table ${tableName} on ${date} at ${timeDisplay}.`,
    reservationConfirmedCombined: (guests, combinedTableName, date, timeDisplay, guestName) => `Reservation confirmed for ${guestName} (${guests} guests) using ${combinedTableName} on ${date} at ${timeDisplay}.`,
    failedToCreateReservation: (errorMsg) => `Failed to create reservation: ${errorMsg}`,
    reservationNotFound: (reservationId) => `Reservation ID ${reservationId} not found.`,
    reservationAlreadyCancelled: (reservationId) => `Reservation ID ${reservationId} is already canceled.`,
    reservationCancelledSuccessfully: 'Reservation cancelled successfully.',
    failedToCancelReservation: (errorMsg) => `Failed to cancel reservation: ${errorMsg}`,
    unknownErrorCreating: 'An unknown error occurred while creating the reservation.',
    unknownErrorCancelling: 'Unknown error while cancelling reservation.',
    guestNotFound: (guestId) => `Guest with ID ${guestId} not found. Cannot determine booking name.`,
    errorCreatingLinkedReservation: (tableName: string) => `There was an issue securing all parts of the combined table booking (specifically table ${tableName}). Please contact the restaurant.`,
  },
  ru: {
    restaurantNotFound: (restaurantId) => `Ресторан с ID ${restaurantId} не найден.`,
    noTablesAvailable: (guests, date, time) => `К сожалению, нет доступных столиков для ${guests} гостей на ${date} в ${time}. Пожалуйста, попробуйте другое время или дату.`,
    reservationConfirmed: (guests, tableName, date, timeDisplay, guestName) => `Бронирование подтверждено для ${guestName} (${guests} гостей) за столиком ${tableName} на ${date} в ${timeDisplay}.`,
    reservationConfirmedCombined: (guests, combinedTableName, date, timeDisplay, guestName) => `Бронирование подтверждено для ${guestName} (${guests} гостей) с использованием ${combinedTableName} на ${date} в ${timeDisplay}.`,
    failedToCreateReservation: (errorMsg) => `Не удалось создать бронирование: ${errorMsg}`,
    reservationNotFound: (reservationId) => `Бронирование с ID ${reservationId} не найдено.`,
    reservationAlreadyCancelled: (reservationId) => `Бронирование с ID ${reservationId} уже отменено.`,
    reservationCancelledSuccessfully: 'Бронирование успешно отменено.',
    failedToCancelReservation: (errorMsg) => `Не удалось отменить бронирование: ${errorMsg}`,
    unknownErrorCreating: 'Произошла неизвестная ошибка при создании бронирования.',
    unknownErrorCancelling: 'Произошла неизвестная ошибка при отмене бронирования.',
    guestNotFound: (guestId) => `Гость с ID ${guestId} не найден. Невозможно определить имя для бронирования.`,
    errorCreatingLinkedReservation: (tableName: string) => `Возникла проблема с обеспечением всех частей комбинированного бронирования (в частности, столика ${tableName}). Пожалуйста, свяжитесь с рестораном.`,
  }
};

export interface BookingRequest {
 restaurantId: number;
 guestId: number;
 date: string; 
 time: string; 
 guests: number;
 comments?: string;
 source?: string;
 lang?: Language; 
 booking_guest_name?: string | null;
 // The specific AvailabilitySlot chosen by the user, if applicable (e.g., from Telegram interaction)
 // This helps bypass re-running getAvailableTimeSlots if a slot is already selected.
 selected_slot_info?: ServiceAvailabilitySlot;
}

export interface BookingResponse {
    success: boolean;
    reservation?: SchemaReservation; // The primary reservation object
    message: string;
    table?: { // Details of the table(s) booked
        id: number; // ID of the primary table, or 0 for combined
        name: string; // Name of primary table or descriptive name for combined
        isCombined: boolean;
        constituentTables?: Array<{ id: number; name: string }>;
    };
    // Optional: list of all created reservation IDs if multiple were made for a combined booking
    allReservationIds?: number[]; 
}


/**
* Создание бронирования с использованием нового сервиса доступности.
* Handles single table and combined table bookings.
*/
export async function createReservation(bookingRequest: BookingRequest): Promise<BookingResponse> {
  const lang = bookingRequest.lang || 'en';
  const locale = bookingLocaleStrings[lang];

 try {
   const { restaurantId, date, time, guests, guestId, comments, source, booking_guest_name, selected_slot_info } = bookingRequest;
   console.log(`[BookingService] Create reservation request: R${restaurantId}, D:${date}, T:${time}, G:${guests}, GuestID:${guestId}, BookingName: ${booking_guest_name}, Lang:${lang}`);
   if (selected_slot_info) {
    console.log(`[BookingService] Using pre-selected slot: TableID ${selected_slot_info.tableId}, Name ${selected_slot_info.tableName}, Combined: ${selected_slot_info.isCombined}`);
   }

   const restaurant: Restaurant | undefined = await storage.getRestaurant(restaurantId);
   if (!restaurant) {
     console.error(`[BookingService] Restaurant ID ${restaurantId} not found.`);
     return { success: false, message: locale.restaurantNotFound(restaurantId) };
   }

   const guestInfo: Guest | undefined = await storage.getGuest(guestId);
   if (!guestInfo) {
    console.error(`[BookingService] Guest ID ${guestId} not found.`);
    return { success: false, message: locale.guestNotFound(guestId) };
   }
   const nameForConfirmationMessage = booking_guest_name || guestInfo.name;
   const slotDurationMinutes = restaurant.avgReservationDuration || 90;

   let selectedSlot: ServiceAvailabilitySlot | undefined = selected_slot_info;

   if (!selectedSlot) {
        console.log(`[BookingService] No pre-selected slot. Calling getAvailableTimeSlots...`);
        const availableSlots: ServiceAvailabilitySlot[] = await getAvailableTimeSlots(
            restaurantId, date, guests,
            {
                requestedTime: time, // User's preferred time
                maxResults: 1, // We need the single best slot (could be combined)
                slotDurationMinutes: slotDurationMinutes,
                lang: lang,
                allowCombinations: true // Ensure combinations are considered
            }
        );
        if (!availableSlots || availableSlots.length === 0) {
            const displayTime = formatTimeFromAvailabilityService(time, lang);
            console.log(`[BookingService] No slots found by getAvailableTimeSlots for R${restaurantId}, D:${date}, T:${time}, G:${guests}.`);
            return { success: false, message: locale.noTablesAvailable(guests, date, displayTime) };
        }
        selectedSlot = availableSlots[0];
        console.log(`[BookingService] Slot found by getAvailableTimeSlots: TableID ${selectedSlot.tableId}, Name ${selectedSlot.tableName}, Combined: ${selectedSlot.isCombined}`);
   }


   if (!selectedSlot) { // Should be caught by previous block, but as a safeguard
    const displayTime = formatTimeFromAvailabilityService(time, lang);
    return { success: false, message: locale.noTablesAvailable(guests, date, displayTime) };
   }

   const allCreatedReservationIds: number[] = [];
   let primaryReservation: SchemaReservation | undefined;

   if (!selectedSlot.isCombined || !selectedSlot.constituentTables || selectedSlot.constituentTables.length === 0) {
     // --- SINGLE TABLE BOOKING ---
     console.log(`[BookingService] Proceeding with single table booking for table ID: ${selectedSlot.tableId}`);
     const reservationData: InsertReservation = {
       restaurantId, guestId,
       tableId: selectedSlot.tableId, // ID of the single table
       date, time: selectedSlot.time, // Use actual slot time
       duration: slotDurationMinutes,
       guests, status: 'confirmed',
       comments: comments || '', source: source || 'direct',
       booking_guest_name: booking_guest_name,
     };
     primaryReservation = await storage.createReservation(reservationData);
     allCreatedReservationIds.push(primaryReservation.id);
     console.log(`[BookingService] ✅ Single Reservation ID ${primaryReservation.id} created for Table ${selectedSlot.tableName}.`);

     return {
       success: true,
       reservation: primaryReservation,
       message: locale.reservationConfirmed(guests, selectedSlot.tableName, date, selectedSlot.timeDisplay, nameForConfirmationMessage),
       table: { id: selectedSlot.tableId, name: selectedSlot.tableName, isCombined: false },
       allReservationIds,
     };

   } else {
     // --- COMBINED TABLE BOOKING ---
     console.log(`[BookingService] Proceeding with combined table booking using: ${selectedSlot.tableName}`);
     const primaryTableInfo = selectedSlot.constituentTables[0];

     // Create primary reservation for the first table in the combination
     const primaryReservationData: InsertReservation = {
       restaurantId, guestId,
       tableId: primaryTableInfo.id,
       date, time: selectedSlot.time,
       duration: slotDurationMinutes,
       guests, // Primary reservation holds the total guest count
       status: 'confirmed',
       comments: comments ? `${comments} (Combined with: ${selectedSlot.constituentTables.slice(1).map(t => t.name).join(', ')})` : `Combined booking: ${selectedSlot.tableName}`,
       source: source || 'direct',
       booking_guest_name: booking_guest_name,
     };
     primaryReservation = await storage.createReservation(primaryReservationData);
     allCreatedReservationIds.push(primaryReservation.id);
     console.log(`[BookingService] ✅ Primary Reservation ID ${primaryReservation.id} for combined booking (Table ${primaryTableInfo.name}) created.`);

     // Create linked/placeholder reservations for other constituent tables
     for (let i = 1; i < selectedSlot.constituentTables.length; i++) {
       const linkedTableInfo = selectedSlot.constituentTables[i];
       const linkedReservationData: InsertReservation = {
         restaurantId, guestId,
         tableId: linkedTableInfo.id,
         date, time: selectedSlot.time,
         duration: slotDurationMinutes,
         guests: 0, // Signifies placeholder for occupancy, not for guest count stats
         status: 'confirmed', 
         comments: `Part of combined booking for ${nameForConfirmationMessage} (Primary Res ID: ${primaryReservation.id}, Primary Table: ${primaryTableInfo.name})`,
         source: source || 'direct',
         booking_guest_name: booking_guest_name, // Keep consistent for tracking if needed
       };
       try {
         const linkedRes = await storage.createReservation(linkedReservationData);
         allCreatedReservationIds.push(linkedRes.id);
         console.log(`[BookingService] ✅ Linked Reservation ID ${linkedRes.id} for combined booking (Table ${linkedTableInfo.name}) created.`);
       } catch (linkedError: any) {
         console.error(`[BookingService] ❌ Error creating linked reservation for table ${linkedTableInfo.name}:`, linkedError);
         // Critical decision: Do we try to rollback the primary reservation?
         // For now, log error and inform user. A full rollback is complex.
         // The primary reservation is made, but one of the linked tables failed.
         // This is a partial success/failure state.
         return {
             success: false, // Or true with a warning? Let's say false for now as the full combo isn't secured.
             reservation: primaryReservation, // Return the primary one that was made
             message: locale.errorCreatingLinkedReservation(linkedTableInfo.name),
             table: {
                 id: primaryTableInfo.id, // Reflect only the successfully booked part
                 name: primaryTableInfo.name,
                 isCombined: false, // Because the full combination failed
             },
             allReservationIds,
         };
       }
     }

     return {
       success: true,
       reservation: primaryReservation, // Return the primary reservation
       message: locale.reservationConfirmedCombined(guests, selectedSlot.tableName, date, selectedSlot.timeDisplay, nameForConfirmationMessage),
       table: {
         id: 0, // Special ID for combined
         name: selectedSlot.tableName,
         isCombined: true,
         constituentTables: selectedSlot.constituentTables.map(t => ({ id: t.id, name: t.name })),
       },
       allReservationIds,
     };
   }

 } catch (error: unknown) {
   console.error('[BookingService] ❌ Error during createReservation:', error);
   const errorMessage = error instanceof Error ? error.message : locale.unknownErrorCreating;
   return { success: false, message: locale.failedToCreateReservation(errorMessage) };
 }
}


export async function cancelReservation(reservationId: number, lang: Language = 'en'): Promise<{
 success: boolean;
 message: string;
}> {
  const locale = bookingLocaleStrings[lang];
 try {
   console.log(`[BookingService] Attempting to cancel reservation ID ${reservationId}`);

   const reservation: SchemaReservation | undefined = (await storage.getReservation(reservationId)) as SchemaReservation | undefined;

   if (!reservation) {
     return { success: false, message: locale.reservationNotFound(reservationId) };
   }

   if (reservation.status === 'canceled') {
     return { success: false, message: locale.reservationAlreadyCancelled(reservationId) };
   }

   // If this is a primary reservation of a combined booking, we might need to cancel linked ones.
   // For now, this function cancels only the specified reservationId.
   // A more advanced cancel would look for linked reservations based on comments or a group_id.
   // Example comment check (simplistic):
   const isCombinedPrimary = reservation.comments?.startsWith('Combined booking:');
   const isLinkedPart = reservation.comments?.startsWith('Part of combined booking');

   await storage.updateReservation(reservationId, { status: 'canceled' });

   // If it was a combined booking and this was the primary, ideally, find and cancel linked ones.
   // This part is complex without a proper group_id.
   // For now, we'll just log if it was part of a combo.
   if (isCombinedPrimary) {
    console.log(`[BookingService] Cancelled primary part of a combined booking (Res ID: ${reservationId}). Manual check for linked reservations might be needed if no group_id exists.`);
   }
   if (isLinkedPart) {
    console.log(`[BookingService] Cancelled a linked part of a combined booking (Res ID: ${reservationId}).`);
   }


   console.log(`[BookingService] ✅ Reservation ID ${reservationId} cancelled successfully.`);
   return { success: true, message: locale.reservationCancelledSuccessfully };

 } catch (error: unknown) {
   console.error(`[BookingService] ❌ Error cancelling reservation ID ${reservationId}:`, error);
   const errorMessage = error instanceof Error ? error.message : locale.unknownErrorCancelling;
   return { success: false, message: locale.failedToCancelReservation(errorMessage) };
 }
}

// --- Legacy/Compatibility Functions (to be reviewed/phased out if possible) ---

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
 // This function relies on the old timeslot system.
 // It might not accurately reflect availability if combined bookings are made without individual timeslots.
 console.warn("[BookingService] getDateAvailabilityFromTimeslots is using legacy timeslot logic.");
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

 return {
   totalDefinedSlots: timeslotsForDate.length,
   availableDefinedSlots: timeslotsForDate.filter(s => s.status === 'free').length,
   occupiedDefinedSlots: timeslotsForDate.filter(s => s.status === 'occupied' || s.status === 'pending').length,
   timeSlotsSummary,
 };
}

// Wrapper for findAvailableTables using the new service
export async function findAvailableTables(
 restaurantId: number,
 date: string,
 time: string,
 guests: number,
 lang: Language = 'en'
): Promise<ServiceAvailabilitySlot[]> { // Return type changed to ServiceAvailabilitySlot
 try {
   console.log(`[BookingService] findAvailableTables (new wrapper) called: R${restaurantId}, D:${date}, T:${time}, G:${guests}, Lang:${lang}`);
   // This will find single or combined slots based on availability.service logic
   return await getAvailableTimeSlots(restaurantId, date, guests, {
     requestedTime: time,
     maxResults: 10, // Or a suitable number for "tables" view
     lang: lang,
     allowCombinations: true // Explicitly allow combinations here
   });
 } catch (error) {
   console.error('[BookingService] Error in findAvailableTables (new wrapper):', error);
   return [];
 }
}

// Wrapper for findAlternativeSlots using the new service
export async function findAlternativeSlots(
 restaurantId: number,
 date: string,
 time: string,
 guests: number,
 lang: Language = 'en'
): Promise<ServiceAvailabilitySlot[]> { // Return type changed
 try {
   console.log(`[BookingService] findAlternativeSlots (new wrapper) called: R${restaurantId}, D:${date}, T:${time}, G:${guests}, Lang:${lang}`);
   return await getAvailableTimeSlots(restaurantId, date, guests, {
     requestedTime: time,
     maxResults: 5, // Standard for alternatives
     lang: lang,
     allowCombinations: true
   });
 } catch (error) {
   console.error('[BookingService] Error in findAlternativeSlots (new wrapper):', error);
   return [];
 }
}

// This function might need significant rework if the old timeslot system is fully deprecated.
export async function getDateAvailability(
 restaurantId: number,
 date: string
): Promise<{
 totalSlots: number;
 availableSlots: number;
 occupiedSlots: number;
 timeSlots: Array<{
   time: string;
   available: number; // Represents number of tables/combinations available at this time
   total: number; // Might be harder to define "total possible" with combinations
 }>;
}> {
  console.warn("[BookingService] getDateAvailability is using legacy timeslot logic and may not be accurate with combined bookings.");
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
}
