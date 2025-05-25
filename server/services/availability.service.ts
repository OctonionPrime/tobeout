// server/services/availability.service.ts
// This service consolidates logic for finding available tables and time slots,
// considering table statuses, restaurant-specific settings, and existing reservations.

import { storage } from '../storage'; // Assuming storage.ts is in the same directory or adjust path
import type {
  Restaurant,
  Table,
  Reservation as SchemaReservation, // Renamed to avoid conflict with local variables
  // Import enums if direct comparison/type checking is needed, though string values often suffice
  // type tableStatusEnum, type reservationStatusEnum
} from '@shared/schema'; // Adjust path as necessary if schema.ts is elsewhere

// Define a clear interface for what an available slot means in this context
export interface AvailabilitySlot {
  date: string;         // YYYY-MM-DD
  time: string;         // HH:MM:SS (internal representation for consistency)
  timeDisplay: string;  // User-friendly format like "10:00 AM"
  tableId: number;
  tableName: string;
  tableCapacity: { min: number; max: number };
}

/**
 * Parses a time string (HH:MM, HH:MM:SS) into minutes since midnight.
 * @param timeStr - The time string to parse. Can be null (e.g., from restaurant settings).
 * @returns Number of minutes since midnight, or null if input is null/invalid.
 */
function parseTimeToMinutes(timeStr: string | null | undefined): number | null {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10) || 0;

  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    console.warn(`[AvailabilityService] Invalid time string encountered for parsing: ${timeStr}`);
    return null;
  }
  return hours * 60 + minutes;
}

/**
 * Adds minutes to a time represented as minutes since midnight.
 * @param timeInMinutes - The base time in minutes since midnight.
 * @param minutesToAdd - The number of minutes to add.
 * @returns New time as minutes since midnight.
 */
function addMinutesToTime(timeInMinutes: number, minutesToAdd: number): number {
  return timeInMinutes + minutesToAdd;
}

/**
 * Formats a 24-hour time string (HH:MM:SS or HH:MM) to a displayable 12-hour AM/PM format.
 * @param time24 - The 24-hour time string.
 * @returns User-friendly 12-hour time string with AM/PM.
 */
function formatTimeForDisplay(time24: string): string {
  const parts = time24.split(':');
  const hour24 = parseInt(parts[0], 10);
  const minutes = parts[1]?.padStart(2, '0') || '00';

  if (isNaN(hour24) || hour24 < 0 || hour24 > 23) {
    console.warn(`[AvailabilityService] Invalid hour in time string for display: ${time24}`);
    return time24; // Return original if hour is invalid
  }

  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  let hour12 = hour24 % 12;
  hour12 = hour12 === 0 ? 12 : hour12; // Convert 0 hour to 12 AM, and 12 to 12 PM

  return `${hour12}:${minutes} ${ampm}`;
}

/**
 * Checks if a specific table is available at a given time slot on a specific date.
 * @param tableId - The ID of the table (for logging/debugging).
 * @param targetTimeSlot - The time slot to check (HH:MM:SS).
 * @param activeReservationsForTable - Pre-filtered list of active reservations for this specific table on the targetDate.
 * These reservations are expected to have `time` (notNull) and `duration` (has DB default).
 * @param slotDurationMinutes - How long the new booking would occupy the table.
 * @returns True if the table is available, false otherwise.
 */
function isTableAvailableAtTimeSlot(
  tableId: number,
  targetTimeSlot: string,
  activeReservationsForTable: Pick<SchemaReservation, 'time' | 'duration'>[],
  slotDurationMinutes: number
): boolean {
  const targetSlotStartMinutes = parseTimeToMinutes(targetTimeSlot);
  // This should ideally not happen if targetTimeSlot is generated correctly.
  if (targetSlotStartMinutes === null) {
    console.warn(`[AvailabilityService] Invalid targetTimeSlot for parsing: ${targetTimeSlot} for tableId ${tableId}`);
    return false;
  }

  const targetSlotEndMinutes = addMinutesToTime(targetSlotStartMinutes, slotDurationMinutes);

  for (const reservation of activeReservationsForTable) {
    // reservation.time is notNull as per schema.ts
    const resStartMinutes = parseTimeToMinutes(reservation.time);
    if (resStartMinutes === null) {
      // This indicates an issue with data integrity or the reservation.time format.
      console.warn(`[AvailabilityService] Reservation for table ${tableId} has invalid time: ${reservation.time}. Skipping for conflict check.`);
      continue;
    }
    // reservation.duration has default(90) in schema.ts, so it should have a value.
    // Use a fallback just in case, but ideally, this should always be populated.
    const resDuration = reservation.duration ?? 90;
    const resEndMinutes = addMinutesToTime(resStartMinutes, resDuration);

    // Standard overlap check
    const overlaps = targetSlotStartMinutes < resEndMinutes && targetSlotEndMinutes > resStartMinutes;
    if (overlaps) {
      return false; // Conflict found
    }
  }
  return true; // No conflicts for this table at this time slot
}

/**
 * Selects the "best" table from a list of tables that are confirmed to fit the party size.
 * "Best" prefers the smallest table that can accommodate the guests (snuggest fit).
 * @param fittingTables - Tables already filtered to fit the party size and be generally bookable.
 * @param guests - The number of guests in the party (used for logging, actual fit already checked).
 * @returns The best Table object or null if no suitable table is found (should not happen if fittingTables is not empty).
 */
function selectBestTableForGuests(fittingTables: Table[], guests: number): Table | null {
  if (!fittingTables.length) return null;

  // schema.ts: tables.minGuests and tables.maxGuests are notNull.
  // Already filtered for minGuests <= guests && maxGuests >= guests.
  // Now, sort by maxGuests ascending to pick the "snuggest" fit.
  fittingTables.sort((a, b) => a.maxGuests - b.maxGuests);

  return fittingTables[0];
}


/**
 * Retrieves a list of truly available time slots for a given restaurant, date, and party size.
 * This function considers table statuses, restaurant-specific settings (operating hours, avg. duration),
 * and existing reservation schedules.
 * @param restaurantId - The ID of the restaurant.
 * @param date - The target date for availability (YYYY-MM-DD).
 * @param guests - The number of guests in the party.
 * @param configOverrides - Optional configuration overrides for the search.
 * @returns A promise that resolves to an array of AvailabilitySlot objects.
 */
export async function getAvailableTimeSlots(
  restaurantId: number,
  date: string,
  guests: number,
  configOverrides?: {
    requestedTime?: string; // HH:MM:SS or HH:MM (optional, for prioritizing results)
    maxResults?: number;
    slotIntervalMinutes?: number; // e.g., 30 for 30-minute intervals
    // Explicit override for operating hours, format HH:MM or HH:MM:SS
    operatingHours?: { open: string; close: string };
    // Explicit override for how long a booked slot lasts, in minutes
    slotDurationMinutes?: number;
  }
): Promise<AvailabilitySlot[]> {
  console.log(`[AvailabilityService] Initiating slot search for restaurant ${restaurantId}, date: ${date}, guests: ${guests}, configOverrides:`, configOverrides);

  try {
    // 1. Fetch restaurant details for dynamic settings.
    const restaurant: Restaurant | undefined = await storage.getRestaurant(restaurantId);
    if (!restaurant) {
      console.error(`[AvailabilityService] Restaurant with ID ${restaurantId} not found.`);
      return [];
    }

    // 2. Determine effective operating hours, slot interval, and slot duration.
    // Priority: configOverrides -> restaurant settings from DB -> hardcoded service defaults.
    const serviceDefaults = {
      openingTime: '10:00:00',
      closingTime: '22:00:00', // Updated to match restaurant default
      slotInterval: 60, // minutes
      // restaurant.avgReservationDuration has DB default 90, so it should exist.
      slotDuration: restaurant.avgReservationDuration, // minutes
    };

    const operatingOpenTimeStr = configOverrides?.operatingHours?.open || restaurant.openingTime || serviceDefaults.openingTime;
    const operatingCloseTimeStr = configOverrides?.operatingHours?.close || restaurant.closingTime || serviceDefaults.closingTime;

    const openingTimeMinutes = parseTimeToMinutes(operatingOpenTimeStr);
    const closingTimeMinutes = parseTimeToMinutes(operatingCloseTimeStr);

    if (openingTimeMinutes === null || closingTimeMinutes === null || openingTimeMinutes >= closingTimeMinutes) {
      console.error(`[AvailabilityService] Invalid or missing operating hours for restaurant ${restaurantId}. Using resolved Open: ${operatingOpenTimeStr}, Close: ${operatingCloseTimeStr}. Cannot proceed.`);
      return [];
    }

    const slotIntervalMinutes = configOverrides?.slotIntervalMinutes || serviceDefaults.slotInterval;
    const slotDurationMinutes = configOverrides?.slotDurationMinutes || serviceDefaults.slotDuration;
    const maxResults = configOverrides?.maxResults || 5;
    const requestedTime = configOverrides?.requestedTime;

    console.log(`[AvailabilityService] Effective search settings: Interval=${slotIntervalMinutes}min, SlotDuration=${slotDurationMinutes}min, MaxResults=${maxResults}, OperatingHours=${operatingOpenTimeStr}-${operatingCloseTimeStr}`);

    // 3. Fetch all tables for the restaurant.
    const allRestaurantTables: Table[] = await storage.getTables(restaurantId);
    if (!allRestaurantTables || allRestaurantTables.length === 0) {
      console.log(`[AvailabilityService] No tables found for restaurant ${restaurantId}.`);
      return [];
    }

    // 4. Filter out tables that are permanently 'unavailable'.
    // table.status comes from tableStatusEnum (string values like 'free', 'unavailable', etc.)
    const bookableTables = allRestaurantTables.filter(
      table => table.status !== 'unavailable' // As per schema and user explanation
    );
    if (bookableTables.length === 0) {
      console.log(`[AvailabilityService] No tables are currently bookable (all marked "unavailable" or no tables exist after this filter).`);
      return [];
    }

    // 5. From these bookable tables, find those suitable for the party size.
    // table.minGuests and table.maxGuests are notNull in schema.ts.
    const suitableCapacityTables = bookableTables.filter(table =>
      table.minGuests <= guests && table.maxGuests >= guests
    );
    if (suitableCapacityTables.length === 0) {
      console.log(`[AvailabilityService] No tables found with capacity for ${guests} guests (that are not "unavailable").`);
      return [];
    }
    console.log(`[AvailabilityService] Found ${suitableCapacityTables.length} tables initially suitable by capacity for ${guests} guests.`);

    // 6. Fetch active (confirmed or created) reservations for the entire target date.
    // storage.getReservations is typed as Promise<any[]> in storage.ts IStorage interface.
    // We cast to SchemaReservation[] assuming the implementation returns objects
    // containing at least { tableId, date, time, duration, status }.
    const activeReservationsForDate = (await storage.getReservations(restaurantId, {
      date: date,
      status: ['created', 'confirmed'] // From reservationStatusEnum
    })) as SchemaReservation[];
    console.log(`[AvailabilityService] Found ${activeReservationsForDate.length} active reservations on ${date} to check against.`);

    // 7. Generate potential time slots based on determined operating hours and interval.
    // Apply one-hour-before-closing rule: last booking should be at least 1 hour before closing
    const lastBookingTimeMinutes = closingTimeMinutes - 60; // One hour before closing
    
    const potentialTimeSlots: string[] = [];
    for (let currentTimeMinutes = openingTimeMinutes; currentTimeMinutes <= lastBookingTimeMinutes; currentTimeMinutes += slotIntervalMinutes) {
      // Ensure the slot doesn't start after our last booking time
      if (currentTimeMinutes > lastBookingTimeMinutes) {
        continue; // This slot would be too late
      }
      const hours = Math.floor(currentTimeMinutes / 60);
      const minutes = currentTimeMinutes % 60;
      // Store in consistent HH:MM:SS for internal use, display formatting happens later.
      potentialTimeSlots.push(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`);
    }

    // 8. If a requested time is provided, sort potential slots by proximity to it.
    if (requestedTime) {
      const requestedTimeMinutes = parseTimeToMinutes(requestedTime);
      if (requestedTimeMinutes !== null) {
        potentialTimeSlots.sort((a, b) => {
          const aParsedMinutes = parseTimeToMinutes(a);
          const bParsedMinutes = parseTimeToMinutes(b);
          // Should not happen if slots are generated correctly.
          if (aParsedMinutes === null || bParsedMinutes === null) return 0;
          const aDistance = Math.abs(aParsedMinutes - requestedTimeMinutes);
          const bDistance = Math.abs(bParsedMinutes - requestedTimeMinutes);
          return aDistance - bDistance;
        });
      }
    }

    const foundAvailableSlots: AvailabilitySlot[] = [];

    // 9. Check each potential time slot for table availability.
    for (const timeSlot of potentialTimeSlots) {
      if (foundAvailableSlots.length >= maxResults) {
        break; // Stop if we've found enough results.
      }

      const tablesAvailableInThisExactSlot: Table[] = [];
      for (const table of suitableCapacityTables) {
        // Filter reservations specifically for the current table being checked.
        const reservationsForCurrentTable = activeReservationsForDate.filter(
          res => res.tableId === table.id
        );
        if (isTableAvailableAtTimeSlot(table.id, timeSlot, reservationsForCurrentTable, slotDurationMinutes)) {
          tablesAvailableInThisExactSlot.push(table);
        }
      }

      if (tablesAvailableInThisExactSlot.length > 0) {
        // If one or more tables are free for this slot, select the "best" one.
        const bestTable = selectBestTableForGuests(tablesAvailableInThisExactSlot, guests);
        if (bestTable) {
          foundAvailableSlots.push({
            date: date,
            time: timeSlot, // Internal HH:MM:SS representation
            timeDisplay: formatTimeForDisplay(timeSlot), // User-friendly format
            tableId: bestTable.id,
            tableName: bestTable.name,
            tableCapacity: {
              min: bestTable.minGuests, // Not nullable in schema
              max: bestTable.maxGuests  // Not nullable in schema
            },
          });
        }
      }
    }

    console.log(`[AvailabilityService] Search complete. Found ${foundAvailableSlots.length} available slots for restaurant ${restaurantId} on ${date} for ${guests} guests.`);
    return foundAvailableSlots;

  } catch (error) {
    console.error(`[AvailabilityService] Critical error during getAvailableTimeSlots for restaurant ${restaurantId}:`, error);
    // For robustness in a service, returning an empty array with logging is often preferred over throwing.
    return [];
  }
}