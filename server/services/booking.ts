import { storage } from '../storage';
import { format, addMinutes, parseISO, isSameDay } from 'date-fns';

export interface BookingRequest {
  restaurantId: number;
  guestId: number;
  date: string; // YYYY-MM-DD format
  time: string; // HH:MM format
  guests: number;
  comments?: string;
  source?: string;
}

export interface AvailableSlot {
  tableId: number;
  timeslotId: number;
  date: string;
  time: string;
  tableName: string;
  tableCapacity: { min: number; max: number };
}

/**
 * Find available tables for a booking request
 */
export async function findAvailableTables(
  restaurantId: number,
  date: string,
  time: string,
  guests: number
): Promise<AvailableSlot[]> {
  console.log(`🔍 Searching for available tables for ${guests} guests on ${date} at ${time}`);
  
  // Get all tables for the restaurant that can accommodate the party size
  const tables = await storage.getTables(restaurantId);
  const suitableTables = tables.filter(table => 
    table.minGuests <= guests && table.maxGuests >= guests
  );
  
  console.log(`📋 Found ${suitableTables.length} suitable tables (capacity ${guests} guests)`);
  
  if (suitableTables.length === 0) {
    return [];
  }
  
  // Get all timeslots for the requested date
  const timeslots = await storage.getTimeslots(restaurantId, date);
  console.log(`⏰ Found ${timeslots.length} timeslots for ${date}`);
  
  // Find available slots
  const availableSlots: AvailableSlot[] = [];
  
  for (const table of suitableTables) {
    for (const timeslot of timeslots) {
      // Check if this timeslot matches the requested time (or is within 30 minutes)
      if (timeslot.time === time && timeslot.status === 'free' && timeslot.tableId === table.id) {
        availableSlots.push({
          tableId: table.id,
          timeslotId: timeslot.id,
          date: timeslot.date,
          time: timeslot.time,
          tableName: table.name,
          tableCapacity: { min: table.minGuests, max: table.maxGuests }
        });
      }
    }
  }
  
  console.log(`✅ Found ${availableSlots.length} available slots`);
  return availableSlots;
}

/**
 * Find alternative time slots if the requested time is not available
 */
export async function findAlternativeSlots(
  restaurantId: number,
  date: string,
  time: string,
  guests: number,
  hoursBefore = 2,
  hoursAfter = 2
): Promise<AvailableSlot[]> {
  console.log(`🔄 Searching for alternative slots around ${time} (±${hoursBefore}-${hoursAfter}h)`);
  
  const requestedDateTime = parseISO(`${date}T${time}`);
  const startTime = addMinutes(requestedDateTime, -hoursBefore * 60);
  const endTime = addMinutes(requestedDateTime, hoursAfter * 60);
  
  const alternatives: AvailableSlot[] = [];
  
  // Search in 30-minute intervals
  for (let current = startTime; current <= endTime; current = addMinutes(current, 30)) {
    if (isSameDay(current, requestedDateTime)) {
      const timeStr = format(current, 'HH:mm');
      const slots = await findAvailableTables(restaurantId, date, timeStr, guests);
      alternatives.push(...slots);
    }
  }
  
  // Remove duplicates and sort by time
  const uniqueSlots = alternatives.reduce((acc, slot) => {
    const key = `${slot.tableId}-${slot.time}`;
    if (!acc.some(s => `${s.tableId}-${s.time}` === key)) {
      acc.push(slot);
    }
    return acc;
  }, [] as AvailableSlot[]);
  
  uniqueSlots.sort((a, b) => a.time.localeCompare(b.time));
  
  console.log(`🔄 Found ${uniqueSlots.length} alternative slots`);
  return uniqueSlots;
}

/**
 * Create a reservation and update table/timeslot status
 */
export async function createReservation(bookingRequest: BookingRequest): Promise<{
  success: boolean;
  reservation?: any;
  message: string;
}> {
  try {
    console.log(`📝 Creating reservation for ${bookingRequest.guests} guests`);
    
    // Find available tables
    const availableSlots = await findAvailableTables(
      bookingRequest.restaurantId,
      bookingRequest.date,
      bookingRequest.time,
      bookingRequest.guests
    );
    
    if (availableSlots.length === 0) {
      return {
        success: false,
        message: `No tables available for ${bookingRequest.guests} guests on ${bookingRequest.date} at ${bookingRequest.time}`
      };
    }
    
    // Use the first available slot
    const selectedSlot = availableSlots[0];
    
    // Create the reservation
    const reservation = await storage.createReservation({
      restaurantId: bookingRequest.restaurantId,
      guestId: bookingRequest.guestId,
      tableId: selectedSlot.tableId,
      timeslotId: selectedSlot.timeslotId,
      date: bookingRequest.date,
      time: bookingRequest.time,
      guests: bookingRequest.guests,
      status: 'created',
      comments: bookingRequest.comments || '',
      source: bookingRequest.source || 'manual'
    });
    
    // Update timeslot status to 'occupied'
    await storage.updateTimeslot(selectedSlot.timeslotId, { status: 'occupied' });
    
    console.log(`✅ Reservation created successfully: ID ${reservation.id}`);
    
    return {
      success: true,
      reservation,
      message: `Reservation confirmed for ${bookingRequest.guests} guests at table ${selectedSlot.tableName} on ${bookingRequest.date} at ${bookingRequest.time}`
    };
    
  } catch (error) {
    console.error('❌ Error creating reservation:', error);
    return {
      success: false,
      message: `Failed to create reservation: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Cancel a reservation and free up the table/timeslot
 */
export async function cancelReservation(reservationId: number): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    console.log(`🚫 Cancelling reservation ID ${reservationId}`);
    
    const reservation = await storage.getReservation(reservationId);
    if (!reservation) {
      return {
        success: false,
        message: 'Reservation not found'
      };
    }
    
    // Update reservation status
    await storage.updateReservation(reservationId, { status: 'canceled' });
    
    // Free up the timeslot
    if (reservation.timeslotId) {
      await storage.updateTimeslot(reservation.timeslotId, { status: 'free' });
    }
    
    console.log(`✅ Reservation cancelled successfully`);
    
    return {
      success: true,
      message: 'Reservation cancelled successfully'
    };
    
  } catch (error) {
    console.error('❌ Error cancelling reservation:', error);
    return {
      success: false,
      message: `Failed to cancel reservation: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Get availability for a specific date
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
  const timeslots = await storage.getTimeslots(restaurantId, date);
  
  // Group by time
  const timeGroups: { [time: string]: any[] } = {};
  
  for (const slot of timeslots) {
    if (!timeGroups[slot.time]) {
      timeGroups[slot.time] = [];
    }
    timeGroups[slot.time].push(slot);
  }
  
  const timeSlots = Object.entries(timeGroups).map(([time, slots]) => ({
    time,
    available: slots.filter(s => s.status === 'free').length,
    total: slots.length
  })).sort((a, b) => a.time.localeCompare(b.time));
  
  const totalSlots = timeslots.length;
  const availableSlots = timeslots.filter(s => s.status === 'free').length;
  const occupiedSlots = totalSlots - availableSlots;
  
  return {
    totalSlots,
    availableSlots,
    occupiedSlots,
    timeSlots
  };
}