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
 * Find available tables with at least 1-30 hour availability window
 */
export async function findAvailableTables(
  restaurantId: number,
  date: string,
  time: string,
  guests: number
): Promise<AvailableSlot[]> {
  console.log(`🔍 Smart table search for ${guests} guests on ${date} at ${time}`);
  
  // Get all tables for the restaurant that can accommodate the party size
  const tables = await storage.getTables(restaurantId);
  const suitableTables = tables.filter(table => 
    table.minGuests <= guests && table.maxGuests >= guests
  );
  
  console.log(`📋 Found ${suitableTables.length} suitable tables (capacity ${guests} guests)`);
  
  if (suitableTables.length === 0) {
    return [];
  }
  
  // Get existing reservations for the date
  const existingReservations = await storage.getReservations(restaurantId, { date });
  console.log(`📅 Found ${existingReservations.length} existing reservations on ${date}`);
  
  const availableSlots: AvailableSlot[] = [];
  
  // Smart table assignment with conflict detection and priority ranking
  const tableAnalysis: Array<{
    table: any;
    conflictScore: number;
    availabilityHours: number;
    hasDirectConflict: boolean;
  }> = [];

  for (const table of suitableTables) {
    const tableReservations = existingReservations.filter(res => res.tableId === table.id);
    
    // Check for DIRECT conflict at exact requested time (only confirmed/created reservations)
    const activeReservations = tableReservations.filter(r => 
      ['confirmed', 'created'].includes(r.status || '')
    );
    
    const hasDirectConflict = activeReservations.some(res => {
      if (!res.time) return false;
      const resStart = parseISO(`${res.date}T${res.time}`);
      const resEnd = addMinutes(resStart, res.duration || 120);
      const requestedDateTime = parseISO(`${date}T${time}`);
      
      return requestedDateTime >= resStart && requestedDateTime < resEnd;
    });

    if (hasDirectConflict) {
      console.log(`🚫 Table ${table.name} has DIRECT CONFLICT at ${time} - EXCLUDED`);
      continue; // Skip tables with direct conflicts
    }

    // Calculate availability window and conflict score
    const availabilityHours = await calculateAvailabilityWindow(table.id, date, time, tableReservations);
    const conflictScore = calculateConflictScore(table.id, date, time, tableReservations);
    
    if (availabilityHours > 0) {
      tableAnalysis.push({
        table,
        conflictScore,
        availabilityHours,
        hasDirectConflict: false
      });
      console.log(`✅ Table ${table.name}: ${availabilityHours}h available, conflict score: ${conflictScore}`);
    } else {
      console.log(`❌ Table ${table.name}: No sufficient availability window`);
    }
  }

  // Sort by priority: lowest conflict score first, then highest availability
  tableAnalysis.sort((a, b) => {
    if (a.conflictScore !== b.conflictScore) {
      return a.conflictScore - b.conflictScore; // Lower conflict = higher priority
    }
    return b.availabilityHours - a.availabilityHours; // More availability = higher priority
  });

  // Convert to available slots
  for (const analysis of tableAnalysis) {
    availableSlots.push({
      tableId: analysis.table.id,
      timeslotId: 0,
      date,
      time,
      tableName: analysis.table.name,
      tableCapacity: { min: analysis.table.minGuests, max: analysis.table.maxGuests }
    });
  }
  
  return availableSlots;
}

/**
 * Check if a table has at least 1-30 hour availability window from requested time
 */
async function hasAvailabilityWindow(
  tableId: number, 
  date: string, 
  requestedTime: string, 
  tableReservations: any[]
): Promise<boolean> {
  const requestedDateTime = parseISO(`${date}T${requestedTime}`);
  
  // Check for conflicts in the next 30 hours (1-30 hour window)
  for (let hours = 1; hours <= 30; hours++) {
    const checkTime = addMinutes(requestedDateTime, hours * 60);
    const checkTimeStr = format(checkTime, 'HH:mm');
    
    // Check if this time slot conflicts with any existing reservation
    const hasConflict = tableReservations.some(reservation => {
      if (!reservation.time) return false;
      
      const reservationStart = parseISO(`${reservation.date}T${reservation.time}`);
      const reservationEnd = addMinutes(reservationStart, reservation.duration || 120); // Default 2 hours
      
      return checkTime >= reservationStart && checkTime < reservationEnd;
    });
    
    if (!hasConflict) {
      console.log(`✨ Table ${tableId} has ${hours}h availability window from ${requestedTime}`);
      return true; // Found at least 1 hour of availability
    }
  }
  
  return false; // No availability window found
}

/**
 * Calculate availability window in hours from requested time
 */
async function calculateAvailabilityWindow(
  tableId: number, 
  date: string, 
  requestedTime: string, 
  tableReservations: any[]
): Promise<number> {
  const requestedDateTime = parseISO(`${date}T${requestedTime}`);
  let availableHours = 0;
  
  // Only consider confirmed/created reservations (ignore canceled ones)
  const activeReservations = tableReservations.filter(r => 
    ['confirmed', 'created'].includes(r.status || '')
  );
  
  // Check availability for next 30 hours
  for (let hours = 1; hours <= 30; hours++) {
    const checkTime = addMinutes(requestedDateTime, hours * 60);
    
    const hasConflict = activeReservations.some(reservation => {
      if (!reservation.time) return false;
      
      const reservationStart = parseISO(`${reservation.date}T${reservation.time}`);
      const reservationEnd = addMinutes(reservationStart, reservation.duration || 120);
      
      return checkTime >= reservationStart && checkTime < reservationEnd;
    });
    
    if (!hasConflict) {
      availableHours = hours;
    } else {
      break; // Stop at first conflict
    }
  }
  
  return availableHours;
}

/**
 * Calculate conflict score for table priority ranking
 * Lower score = higher priority
 */
function calculateConflictScore(
  tableId: number, 
  date: string, 
  requestedTime: string, 
  tableReservations: any[]
): number {
  let conflictScore = 0;
  const requestedDateTime = parseISO(`${date}T${requestedTime}`);
  
  // Only count confirmed/created reservations (ignore canceled ones)
  const activeReservations = tableReservations.filter(r => 
    ['confirmed', 'created'].includes(r.status || '')
  );
  
  // If table has NO active reservations, give it perfect score (0)
  if (activeReservations.length === 0) {
    console.log(`🎯 Table ${tableId}: COMPLETELY FREE (no active reservations)`);
    return 0;
  }
  
  // Add points for nearby active reservations (within 4 hours)
  activeReservations.forEach(reservation => {
    if (!reservation.time) return;
    
    const resStart = parseISO(`${reservation.date}T${reservation.time}`);
    const timeDifference = Math.abs((resStart.getTime() - requestedDateTime.getTime()) / (1000 * 60 * 60));
    
    if (timeDifference <= 4) {
      // Closer reservations = higher conflict score
      conflictScore += Math.max(0, 4 - timeDifference);
    }
  });
  
  console.log(`📊 Table ${tableId}: conflict score ${conflictScore} (${activeReservations.length} active reservations)`);
  return conflictScore;
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
    
    // Use the best available table (first one with longest availability window)
    const selectedSlot = availableSlots[0];
    console.log(`🎯 Auto-assigning Table ${selectedSlot.tableName} for ${bookingRequest.guests} guests`);
    
    // Create the reservation with automatic table assignment
    const reservation = await storage.createReservation({
      restaurantId: bookingRequest.restaurantId,
      guestId: bookingRequest.guestId,
      tableId: selectedSlot.tableId, // ✨ This ensures table is assigned!
      timeslotId: null, // We're not using timeslot system, using direct table assignment
      date: bookingRequest.date,
      time: bookingRequest.time,
      duration: 120, // Default 2 hours
      guests: bookingRequest.guests,
      status: 'confirmed', // Auto-confirm since we found an available table
      comments: bookingRequest.comments || '',
      source: bookingRequest.source || 'manual'
    });
    
    // Update table status in real-time
    await storage.updateTableStatusFromReservations(selectedSlot.tableId);
    
    console.log(`✅ Auto-assigned Table ${selectedSlot.tableName} to Reservation ${reservation.id}!`);
    
    return {
      success: true,
      reservation,
      message: `✨ Table ${selectedSlot.tableName} automatically assigned for ${bookingRequest.guests} guests on ${bookingRequest.date} at ${bookingRequest.time}`
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