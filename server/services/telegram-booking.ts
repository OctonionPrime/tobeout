import { storage } from '../storage';
import { createReservation } from './booking';

export async function createTelegramReservation(
  restaurantId: number,
  date: string,
  time: string,
  guests: number,
  name: string,
  phone: string,
  comments?: string
) {
  try {
    console.log(`🤖 Telegram booking request: ${guests} guests on ${date} at ${time}`);
    
    // Find or create guest
    let guest = await storage.getGuestByPhone(phone);
    if (!guest) {
      guest = await storage.createGuest({
        name,
        phone,
        email: '',
        language: 'en'
      });
      console.log(`✨ Created new guest: ${name}`);
    }
    
    // Use smart table assignment - this will find Table 5 for 6 people!
    const result = await createReservation({
      restaurantId,
      guestId: guest.id,
      date,
      time,
      guests,
      comments: comments || '',
      source: 'telegram'
    });
    
    console.log(`📋 Booking result:`, result);
    return result;
    
  } catch (error) {
    console.error('❌ Telegram booking error:', error);
    return {
      success: false,
      message: `Failed to create reservation: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Get alternative available times for a given date and party size
 */
export async function getAlternativeTimes(restaurantId: number, date: string, guests: number) {
  try {
    // Get all tables that can accommodate the party size
    const allTables = await storage.getTables(restaurantId);
    const suitableTables = allTables.filter(table => 
      table.minCapacity <= guests && table.maxCapacity >= guests
    );

    if (suitableTables.length === 0) {
      return [];
    }

    // Get all reservations for the date
    const existingReservations = await storage.getReservations(restaurantId, { 
      date: date,
      status: ['confirmed', 'created'] // Only consider active reservations
    });

    // Generate time slots (10:00 AM to 11:00 PM in 1-hour intervals)
    const timeSlots = [];
    for (let hour = 10; hour <= 23; hour++) {
      const time = `${hour.toString().padStart(2, '0')}:00:00`;
      timeSlots.push(time);
    }

    const alternatives = [];

    // Check each time slot for availability
    for (const time of timeSlots) {
      const availableTables = getAvailableTablesForTime(
        suitableTables, 
        existingReservations, 
        date, 
        time
      );

      if (availableTables.length > 0) {
        // Pick the best table (largest capacity to ensure comfort)
        const bestTable = availableTables.sort((a, b) => b.maxCapacity - a.maxCapacity)[0];
        
        alternatives.push({
          time: formatTime(time),
          tableId: bestTable.id,
          tableName: bestTable.name,
          capacity: bestTable.maxCapacity,
          date
        });
      }
    }

    return alternatives.slice(0, 5); // Return max 5 alternatives
  } catch (error) {
    console.error('❌ Error getting alternative times:', error);
    return [];
  }
}

/**
 * Check which tables are available at a specific time
 */
function getAvailableTablesForTime(
  tables: any[], 
  reservations: any[], 
  date: string, 
  time: string
) {
  const availableTables = [];

  for (const table of tables) {
    // Check if table has conflicting reservations
    const hasConflict = reservations.some(reservation => {
      if (reservation.tableId !== table.id) return false;
      if (reservation.date !== date) return false;
      
      // Check if times overlap (assuming 2-hour duration)
      const reservationStart = new Date(`${date} ${reservation.time}`);
      const reservationEnd = new Date(reservationStart.getTime() + 2 * 60 * 60 * 1000);
      const requestedStart = new Date(`${date} ${time}`);
      const requestedEnd = new Date(requestedStart.getTime() + 2 * 60 * 60 * 1000);
      
      return (requestedStart < reservationEnd && requestedEnd > reservationStart);
    });

    if (!hasConflict) {
      availableTables.push(table);
    }
  }

  return availableTables;
}

/**
 * Format time consistently in 24-hour format
 */
function formatTime(time24: string): string {
  const [hours, minutes] = time24.split(':');
  const h = parseInt(hours);
  const m = parseInt(minutes || '0');
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}