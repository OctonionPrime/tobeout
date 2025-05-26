// server/services/booking.ts

import { storage } from '../storage';
import {
 getAvailableTimeSlots,
 type AvailabilitySlot as ServiceAvailabilitySlot,
} from './availability.service';

import type {
 Restaurant,
 Reservation as SchemaReservation,
 InsertReservation,
} from '@shared/schema';

// Interface for the booking request
export interface BookingRequest {
 restaurantId: number;
 guestId: number;
 date: string; // YYYY-MM-DD format
 time: string; // HH:MM or HH:MM:SS format
 guests: number;
 comments?: string;
 source?: string;
}

// Legacy interface for backward compatibility with routes.ts
export interface AvailableSlot {
 tableId: number;
 timeslotId: number;
 date: string;
 time: string;
 tableName: string;
 tableCapacity: { min: number; max: number };
}

/**
* Create a reservation using the new availability service.
*/
export async function createReservation(bookingRequest: BookingRequest): Promise<{
 success: boolean;
 reservation?: SchemaReservation;
 message: string;
 table?: { id: number; name: string };
}> {
 try {
   const { restaurantId, date, time, guests, guestId, comments, source } = bookingRequest;
   console.log(`[BookingService] Attempting to create reservation: Restaurant ${restaurantId}, Date ${date}, Time ${time}, Guests ${guests}`);

   // 1. Fetch restaurant details
   const restaurant: Restaurant | undefined = await storage.getRestaurant(restaurantId);
   if (!restaurant) {
     console.error(`[BookingService] Restaurant with ID ${restaurantId} not found.`);
     return {
       success: false,
       message: `Restaurant with ID ${restaurantId} not found.`,
     };
   }

   const slotDurationMinutes = restaurant.avgReservationDuration;

   // 2. Find the best available slot using availability service
   const availableSlots: ServiceAvailabilitySlot[] = await getAvailableTimeSlots(
     restaurantId,
     date,
     guests,
     {
       requestedTime: time,
       maxResults: 1,
       slotDurationMinutes: slotDurationMinutes,
     }
   );

   if (!availableSlots || availableSlots.length === 0) {
     console.log(`[BookingService] No available slots found for Restaurant ${restaurantId}, Date ${date}, Time ${time}, Guests ${guests}.`);
     return {
       success: false,
       message: `No tables available for ${guests} guests on ${date} at ${time}.`,
     };
   }

   const selectedSlot = availableSlots[0];
   console.log(`[BookingService] Best available slot found: Table ID ${selectedSlot.tableId} (${selectedSlot.tableName}) at ${selectedSlot.timeDisplay}`);

   // 3. Create the reservation
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
   };

   const newReservation: SchemaReservation = await storage.createReservation(reservationData);

   console.log(`[BookingService] ✅ Reservation ID ${newReservation.id} created successfully for Table ${selectedSlot.tableName}.`);

   return {
     success: true,
     reservation: newReservation,
     message: `Reservation confirmed for ${guests} guests at Table ${selectedSlot.tableName} on ${date} at ${selectedSlot.timeDisplay}.`,
     table: { id: selectedSlot.tableId, name: selectedSlot.tableName },
   };

 } catch (error: unknown) {
   console.error('[BookingService] ❌ Error during createReservation:', error);
   const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred while creating the reservation.';
   return {
     success: false,
     message: `Failed to create reservation: ${errorMessage}`,
   };
 }
}

/**
* Cancel a reservation and update relevant statuses.
*/
export async function cancelReservation(reservationId: number): Promise<{
 success: boolean;
 message: string;
}> {
 try {
   console.log(`[BookingService] Attempting to cancel reservation ID ${reservationId}`);

   const reservation: SchemaReservation | undefined = (await storage.getReservation(reservationId)) as SchemaReservation | undefined;

   if (!reservation) {
     return {
       success: false,
       message: `Reservation ID ${reservationId} not found.`,
     };
   }

   if (reservation.status === 'canceled') {
     return {
       success: false,
       message: `Reservation ID ${reservationId} is already canceled.`,
     };
   }

   // Update reservation status to 'canceled'
   await storage.updateReservation(reservationId, { status: 'canceled' });

   // Update timeslot status if linked
   if (reservation.timeslotId) {
     await storage.updateTimeslot(reservation.timeslotId, { status: 'free' });
     console.log(`[BookingService] Timeslot ID ${reservation.timeslotId} status updated to 'free'.`);
   }

   console.log(`[BookingService] ✅ Reservation ID ${reservationId} cancelled successfully.`);
   return {
     success: true,
     message: 'Reservation cancelled successfully.',
   };

 } catch (error: unknown) {
   console.error(`[BookingService] ❌ Error cancelling reservation ID ${reservationId}:`, error);
   const errorMessage = error instanceof Error ? error.message : 'Unknown error while cancelling reservation.';
   return {
     success: false,
     message: `Failed to cancel reservation: ${errorMessage}`,
   };
 }
}

/**
* Get availability overview from the pre-generated timeslots table for a specific date.
*/
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

// ===========================================
// BACKWARD COMPATIBILITY WRAPPER FUNCTIONS
// ===========================================

/**
* Legacy wrapper for findAvailableTables (used by routes.ts)
* Translates old API to new availability service
*/
export async function findAvailableTables(
 restaurantId: number,
 date: string,
 time: string,
 guests: number
): Promise<AvailableSlot[]> {
 try {
   console.log(`[Legacy] findAvailableTables called: ${restaurantId}, ${date}, ${time}, ${guests}`);

   // Use new availability service
   const slots = await getAvailableTimeSlots(restaurantId, date, guests, {
     requestedTime: time,
     maxResults: 10
   });

   // Convert to legacy format
   return slots.map(slot => ({
     tableId: slot.tableId,
     timeslotId: 0, // Legacy field, not used in new system
     date: slot.date,
     time: slot.time,
     tableName: slot.tableName,
     tableCapacity: slot.tableCapacity
   }));

 } catch (error) {
   console.error('[Legacy] Error in findAvailableTables wrapper:', error);
   return [];
 }
}

/**
* Legacy wrapper for findAlternativeSlots (used by routes.ts)
*/
export async function findAlternativeSlots(
 restaurantId: number,
 date: string,
 time: string,
 guests: number,
 hoursBefore: number = 2,
 hoursAfter: number = 2
): Promise<AvailableSlot[]> {
 try {
   console.log(`[Legacy] findAlternativeSlots called: ${restaurantId}, ${date}, ${time}, ${guests}`);

   // Use new availability service to find alternatives
   const slots = await getAvailableTimeSlots(restaurantId, date, guests, {
     requestedTime: time,
     maxResults: 5
   });

   // Convert to legacy format
   return slots.map(slot => ({
     tableId: slot.tableId,
     timeslotId: 0,
     date: slot.date,
     time: slot.time,
     tableName: slot.tableName,
     tableCapacity: slot.tableCapacity
   }));

 } catch (error) {
   console.error('[Legacy] Error in findAlternativeSlots wrapper:', error);
   return [];
 }
}

/**
* Legacy wrapper for getDateAvailability (used by routes.ts)
*/
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

   // Convert to legacy format
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