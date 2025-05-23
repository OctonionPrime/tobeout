// NEW FILE: telegram-availability.ts
// This replaces the fake suggestAlternativeSlots with real availability logic

import { storage } from '../storage';

interface RealAvailableSlot {
  time: string;
  timeDisplay: string;
  tableId: number;
  tableName: string;
  tableCapacity: { min: number; max: number };
  date: string;
}

/**
 * Get REAL available time slots using actual table/reservation data
 * This replaces the fake suggestAlternativeSlots function
 */
export async function getRealAvailableSlots(
  restaurantId: number,
  date: string,
  guests: number,
  requestedTime?: string,
  maxResults: number = 5
): Promise<RealAvailableSlot[]> {
  try {
    console.log(`🔍 Finding REAL availability for ${guests} guests on ${date} ${requestedTime ? `near ${requestedTime}` : ''}`);

    // Get all tables that can accommodate the party size
    const allTables = await storage.getTables(restaurantId);
    const suitableTables = allTables.filter(table => 
      table.minGuests <= guests && 
      table.maxGuests >= guests &&
      table.status === 'free' // Only consider free tables
    );

    if (suitableTables.length === 0) {
      console.log('❌ No suitable tables found for party size');
      return [];
    }

    console.log(`📋 Found ${suitableTables.length} suitable tables:`, suitableTables.map(t => `${t.name}(${t.minGuests}-${t.maxGuests})`));

    // Get all reservations for the date
    const existingReservations = await storage.getReservations(restaurantId, { 
      date: date,
      status: ['created', 'confirmed'] // Only active reservations block slots
    });

    console.log(`📅 Found ${existingReservations.length} existing reservations on ${date}`);

    // Generate time slots (same as your dashboard: 10 AM to 11 PM hourly)
    const timeSlots = generateTimeSlots();

    // If requested time provided, sort slots by distance from requested time
    if (requestedTime) {
      timeSlots.sort((a, b) => {
        const aDistance = getTimeDistance(a, requestedTime);
        const bDistance = getTimeDistance(b, requestedTime);
        return aDistance - bDistance;
      });
    }

    const availableSlots: RealAvailableSlot[] = [];

    // Check each time slot for availability
    for (const timeSlot of timeSlots) {
      // Find tables available at this time slot
      const availableTables = suitableTables.filter(table => 
        isTableAvailableAtTime(table, timeSlot, existingReservations, date)
      );

      if (availableTables.length > 0) {
        // Pick the best table (closest to party size)
        const bestTable = selectBestTable(availableTables, guests);

        availableSlots.push({
          time: timeSlot,
          timeDisplay: formatTimeForDisplay(timeSlot),
          tableId: bestTable.id,
          tableName: bestTable.name,
          tableCapacity: { min: bestTable.minGuests, max: bestTable.maxGuests },
          date
        });

        if (availableSlots.length >= maxResults) break;
      }
    }

    console.log(`✅ Found ${availableSlots.length} real available slots:`, 
      availableSlots.map(s => `${s.timeDisplay} - ${s.tableName}`));

    return availableSlots;
  } catch (error) {
    console.error('❌ Error finding real available slots:', error);
    return [];
  }
}

/**
 * Generate time slots like in your dashboard (10 AM - 11 PM hourly)
 */
function generateTimeSlots(): string[] {
  const slots = [];

  // 10 AM to 11 PM (10:00 to 23:00)
  for (let hour = 10; hour <= 23; hour++) {
    slots.push(`${hour.toString().padStart(2, '0')}:00:00`);
  }

  return slots;
}

/**
 * Check if a table is available at a specific time
 * Uses the same logic as your dashboard availability grid
 */
function isTableAvailableAtTime(
  table: any,
  timeSlot: string,
  reservations: any[],
  date: string
): boolean {
  // Find reservations for this table on this date
  const tableReservations = reservations.filter(res => 
    res.tableId === table.id && res.date === date
  );

  if (tableReservations.length === 0) {
    return true; // No reservations = available
  }

  // Check if any reservation conflicts with this time slot
  for (const reservation of tableReservations) {
    if (doesReservationConflict(reservation, timeSlot)) {
      return false; // Conflict found
    }
  }

  return true; // No conflicts
}

/**
 * Check if a reservation conflicts with a time slot
 * Uses 90-minute default duration like your system
 */
function doesReservationConflict(reservation: any, timeSlot: string): boolean {
  const reservationStart = parseTime(reservation.time);
  const reservationDuration = reservation.duration || 90; // 90 minutes default
  const reservationEnd = addMinutes(reservationStart, reservationDuration);

  const slotStart = parseTime(timeSlot);
  const slotDuration = 90; // Assume 90-minute dining slots
  const slotEnd = addMinutes(slotStart, slotDuration);

  // Check if time ranges overlap
  return (slotStart < reservationEnd && slotEnd > reservationStart);
}

/**
 * Parse time string to minutes since midnight for comparison
 */
function parseTime(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + (minutes || 0);
}

/**
 * Add minutes to a time (in minutes since midnight)
 */
function addMinutes(timeInMinutes: number, minutesToAdd: number): number {
  return timeInMinutes + minutesToAdd;
}

/**
 * Calculate distance between two times (for sorting by proximity)
 */
function getTimeDistance(time1: string, time2: string): number {
  const t1 = parseTime(time1);
  const t2 = parseTime(time2);
  return Math.abs(t1 - t2);
}

/**
 * Select best table for the party size
 */
function selectBestTable(availableTables: any[], guests: number): any {
  // Sort by how close the table capacity is to the party size
  return availableTables.reduce((best, current) => {
    const bestDiff = Math.abs(best.maxGuests - guests);
    const currentDiff = Math.abs(current.maxGuests - guests);
    return currentDiff < bestDiff ? current : best;
  });
}

/**
 * Format time for display (24-hour to 12-hour with AM/PM)
 */
function formatTimeForDisplay(time24: string): string {
  const [hours, minutes] = time24.split(':');
  const hour = parseInt(hours);
  const min = minutes || '00';

  if (hour === 0) return `12:${min} AM`;
  if (hour < 12) return `${hour}:${min} AM`;
  if (hour === 12) return `12:${min} PM`;
  return `${hour - 12}:${min} PM`;
}

/**
 * Generate smart alternative message for Telegram
 */
export function generateSmartAlternativeMessage(
  guestName: string,
  requestedTime: string,
  guests: number,
  availableSlots: RealAvailableSlot[]
): string {
  if (availableSlots.length === 0) {
    return `I'm sorry ${guestName}, but we're fully booked today for ${guests} ${guests === 1 ? 'person' : 'people'}. Would you like to try a different date? 📅`;
  }

  const alternatives = availableSlots
    .slice(0, 3) // Show top 3 closest times
    .map((slot, index) => 
      `${index + 1}. ${slot.timeDisplay} - Table ${slot.tableName} (seats ${slot.tableCapacity.max})`
    ).join('\n');

  return `I'm sorry ${guestName}, but ${formatTimeForDisplay(requestedTime)} is taken for ${guests} ${guests === 1 ? 'person' : 'people'}. 😔

However, I have these great alternatives for today:

${alternatives}

Which one would you prefer? Just tell me the number! 🎯`;
}