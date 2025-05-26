// server/services/availability.service.ts
import { storage } from '../storage';
import type {
  Restaurant,
  Table,
  Reservation as SchemaReservation,
} from '@shared/schema';
import type { Language } from './conversation-manager';

export interface AvailabilitySlot {
  date: string;
  time: string; // HH:MM:SS (внутренний формат)
  timeDisplay: string; // Формат для пользователя (зависит от языка)
  tableId: number; // ID of the single table, or 0 for combined
  tableName: string; // Name of single table, or descriptive name for combined (e.g., "Tables T1 & T2")
  tableCapacity: { min: number; max: number }; // Capacity of single, or total for combined
  isCombined: boolean; // True if this represents a combination of tables
  constituentTables?: Array<{ id: number; name: string; capacity: { min: number; max: number } }>; // Details of tables if combined
}

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

function addMinutesToTime(timeInMinutes: number, minutesToAdd: number): number {
  return timeInMinutes + minutesToAdd;
}

export function formatTimeForDisplay(time24: string, lang: Language = 'en'): string {
  const parts = time24.split(':');
  const hour24 = parseInt(parts[0], 10);
  const minutes = parts[1]?.padStart(2, '0') || '00';

  if (isNaN(hour24) || hour24 < 0 || hour24 > 23) {
    console.warn(`[AvailabilityService] Invalid hour in time string for display: ${time24}`);
    return time24;
  }

  if (lang === 'ru') {
    return `${hour24.toString().padStart(2, '0')}:${minutes}`;
  }

  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  let hour12 = hour24 % 12;
  hour12 = hour12 === 0 ? 12 : hour12; 

  return `${hour12}:${minutes} ${ampm}`;
}

function isTableAvailableAtTimeSlot(
  tableId: number,
  targetTimeSlot: string, // HH:MM:SS
  activeReservationsForTable: Pick<SchemaReservation, 'time' | 'duration'>[],
  slotDurationMinutes: number
): boolean {
  const targetSlotStartMinutes = parseTimeToMinutes(targetTimeSlot);
  if (targetSlotStartMinutes === null) {
    console.warn(`[AvailabilityService] Invalid targetTimeSlot for parsing: ${targetTimeSlot} for tableId ${tableId}`);
    return false;
  }
  const targetSlotEndMinutes = addMinutesToTime(targetSlotStartMinutes, slotDurationMinutes);

  for (const reservation of activeReservationsForTable) {
    const resStartMinutes = parseTimeToMinutes(reservation.time);
    if (resStartMinutes === null) {
      console.warn(`[AvailabilityService] Reservation for table ${tableId} has invalid time: ${reservation.time}. Skipping for conflict check.`);
      continue;
    }
    const resDuration = reservation.duration ?? 90; // Default duration if null
    const resEndMinutes = addMinutesToTime(resStartMinutes, resDuration);

    // Check for overlap:
    // A_start < B_end AND A_end > B_start
    const overlaps = targetSlotStartMinutes < resEndMinutes && targetSlotEndMinutes > resStartMinutes;
    if (overlaps) {
      // console.log(`[AvailabilityService] Table ${tableId} conflicts at ${targetTimeSlot} with reservation from ${reservation.time} for ${resDuration}min.`);
      return false;
    }
  }
  // console.log(`[AvailabilityService] Table ${tableId} is available at ${targetTimeSlot}.`);
  return true;
}

// Selects the best single table that fits the guests, preferring tighter fits.
function selectBestSingleTableForGuests(fittingTables: Table[], guests: number): Table | null {
  if (!fittingTables.length) return null;
  // Sort by maxGuests (ascending) to find the smallest table that can fit the party.
  fittingTables.sort((a, b) => a.maxGuests - b.maxGuests);
  return fittingTables.find(table => table.maxGuests >= guests) || null; // Ensure it still fits after sorting
}

// Helper function to find combinations of two tables for a given slot
async function findCombinableTwoTableSlots(
  timeSlot: string, // HH:MM:SS
  guests: number,
  allBookableTables: Table[],
  activeReservationsForDate: SchemaReservation[],
  slotDurationMinutes: number,
  currentLang: Language
): Promise<AvailabilitySlot[]> {
  const combinableSlots: AvailabilitySlot[] = [];

  // 1. Filter tables that are individually available at this timeSlot
  const availableTablesInSlot = allBookableTables.filter(table =>
    isTableAvailableAtTimeSlot(
      table.id,
      timeSlot,
      activeReservationsForDate.filter(r => r.tableId === table.id),
      slotDurationMinutes
    )
  );

  if (availableTablesInSlot.length < 2) return []; // Need at least two tables to combine

  // Sort by maxGuests to make combinations more predictable, can be adjusted
  availableTablesInSlot.sort((a, b) => a.maxGuests - b.maxGuests);

  for (let i = 0; i < availableTablesInSlot.length; i++) {
    for (let j = i + 1; j < availableTablesInSlot.length; j++) {
      const table1 = availableTablesInSlot[i];
      const table2 = availableTablesInSlot[j];

      // Skip if any table is individually large enough (should have been caught by single table search)
      // This check might be redundant if single table search runs first for the slot.
      // if (table1.maxGuests >= guests || table2.maxGuests >= guests) continue;

      const combinedMinCapacity = table1.minGuests + table2.minGuests;
      const combinedMaxCapacity = table1.maxGuests + table2.maxGuests;

      if (combinedMaxCapacity >= guests && guests >= combinedMinCapacity) {
        // This combination can seat the party
        // TODO: Add logic for physical proximity or restaurant rules for combining if available

        const constituentTablesDetails = [
          { id: table1.id, name: table1.name, capacity: { min: table1.minGuests, max: table1.maxGuests } },
          { id: table2.id, name: table2.name, capacity: { min: table2.minGuests, max: table2.maxGuests } },
        ];

        combinableSlots.push({
          date: activeReservationsForDate[0]?.date || new Date().toISOString().split('T')[0], // Needs actual date
          time: timeSlot,
          timeDisplay: formatTimeForDisplay(timeSlot, currentLang),
          tableId: 0, // Special ID for combined tables
          tableName: currentLang === 'ru' ? `Столики ${table1.name} и ${table2.name}` : `Tables ${table1.name} & ${table2.name}`,
          tableCapacity: { min: combinedMinCapacity, max: combinedMaxCapacity },
          isCombined: true,
          constituentTables: constituentTablesDetails,
        });
      }
    }
  }

  // Sort combinations: prefer those with tighter fit (less excess capacity)
  // and then by the smallest maximum capacity (to keep larger tables free if possible)
  combinableSlots.sort((a, b) => {
    const aExcess = a.tableCapacity.max - guests;
    const bExcess = b.tableCapacity.max - guests;
    if (aExcess !== bExcess) {
      return aExcess - bExcess;
    }
    return a.tableCapacity.max - b.tableCapacity.max;
  });

  return combinableSlots;
}


export async function getAvailableTimeSlots(
  restaurantId: number,
  date: string, // YYYY-MM-DD
  guests: number,
  configOverrides?: {
    requestedTime?: string; // HH:MM or HH:MM:SS
    maxResults?: number;
    slotIntervalMinutes?: number;
    operatingHours?: { open: string; close: string }; // HH:MM:SS
    slotDurationMinutes?: number;
    lang?: Language;
    searchRadiusMinutes?: number; // How far before/after requestedTime to search
    allowCombinations?: boolean; // Explicit flag to allow table combinations
  }
): Promise<AvailabilitySlot[]> {
  const currentLang = configOverrides?.lang || 'en';
  const allowCombinations = configOverrides?.allowCombinations !== undefined ? configOverrides.allowCombinations : true; // Default to true

  console.log(`[AvailabilityService] Initiating slot search: R${restaurantId}, Date ${date}, Guests ${guests}, Lang ${currentLang}, Combinations: ${allowCombinations}, Config:`, configOverrides);

  try {
    const restaurant: Restaurant | undefined = await storage.getRestaurant(restaurantId);
    if (!restaurant) {
      console.error(`[AvailabilityService] Restaurant ID ${restaurantId} not found.`);
      return [];
    }
    if (!restaurant.openingTime || !restaurant.closingTime) {
      console.error(`[AvailabilityService] Restaurant ${restaurantId} missing operating hours.`);
      return [];
    }

    const operatingOpenTimeStr = configOverrides?.operatingHours?.open || restaurant.openingTime;
    const operatingCloseTimeStr = configOverrides?.operatingHours?.close || restaurant.closingTime;
    const slotDurationMinutes = configOverrides?.slotDurationMinutes || restaurant.avgReservationDuration || 90;

    const openingTimeMinutes = parseTimeToMinutes(operatingOpenTimeStr);
    const closingTimeMinutes = parseTimeToMinutes(operatingCloseTimeStr);

    if (openingTimeMinutes === null || closingTimeMinutes === null || openingTimeMinutes >= closingTimeMinutes) {
      console.error(`[AvailabilityService] Invalid operating hours for R${restaurantId}: ${openingTimeMinutes}-${closingTimeMinutes}`);
      return [];
    }

    const slotIntervalMinutes = configOverrides?.slotIntervalMinutes || 30; // Check every 30 mins
    const maxResults = configOverrides?.maxResults || 5;
    const requestedTimeStr = configOverrides?.requestedTime; // User's preferred time HH:MM or HH:MM:SS

    console.log(`[AvailabilityService] Effective settings: Interval=${slotIntervalMinutes}min, SlotDuration=${slotDurationMinutes}min, MaxResults=${maxResults}, OpHours=${operatingOpenTimeStr}-${operatingCloseTimeStr}`);

    const allRestaurantTables: Table[] = await storage.getTables(restaurantId);
    if (!allRestaurantTables || allRestaurantTables.length === 0) {
      console.log(`[AvailabilityService] No tables for R${restaurantId}.`);
      return [];
    }

    const bookableTables = allRestaurantTables.filter(table => table.status !== 'unavailable');
    if (bookableTables.length === 0) {
      console.log(`[AvailabilityService] No bookable tables for R${restaurantId}.`);
      return [];
    }

    const activeReservationsForDate = (await storage.getReservations(restaurantId, {
      date: date,
      status: ['created', 'confirmed'] // Consider only active bookings
    })) as SchemaReservation[];
    console.log(`[AvailabilityService] Found ${activeReservationsForDate.length} active reservations on ${date} for R${restaurantId}.`);

    // Define the last possible booking start time
    const lastBookingTimeMinutes = closingTimeMinutes - slotDurationMinutes;

    const potentialTimeSlots: string[] = [];
    for (let currentTimeMinutes = openingTimeMinutes; currentTimeMinutes <= lastBookingTimeMinutes; currentTimeMinutes += slotIntervalMinutes) {
      const hours = Math.floor(currentTimeMinutes / 60);
      const minutes = currentTimeMinutes % 60;
      potentialTimeSlots.push(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`);
    }

    // Sort potential slots: if requestedTime is given, sort by proximity. Otherwise, chronological.
    if (requestedTimeStr) {
      const requestedTimeMinutes = parseTimeToMinutes(requestedTimeStr.substring(0,5) + ":00"); // Ensure HH:MM:SS format for parse
      if (requestedTimeMinutes !== null) {
        potentialTimeSlots.sort((a, b) => {
          const aParsedMinutes = parseTimeToMinutes(a);
          const bParsedMinutes = parseTimeToMinutes(b);
          if (aParsedMinutes === null || bParsedMinutes === null) return 0; // Should not happen
          const aDistance = Math.abs(aParsedMinutes - requestedTimeMinutes);
          const bDistance = Math.abs(bParsedMinutes - requestedTimeMinutes);
          if (aDistance !== bDistance) return aDistance - bDistance;
          return aParsedMinutes - bParsedMinutes; // Secondary sort by time
        });
      }
    }
    // console.log("[AvailabilityService] Potential time slots to check (sorted):", potentialTimeSlots);

    const foundAvailableSlots: AvailabilitySlot[] = [];

    for (const timeSlot of potentialTimeSlots) {
      if (foundAvailableSlots.length >= maxResults) break;

      // 1. Try to find a single table
      const singleSuitableTables = bookableTables.filter(table =>
        table.minGuests <= guests &&
        table.maxGuests >= guests &&
        isTableAvailableAtTimeSlot(
          table.id,
          timeSlot,
          activeReservationsForDate.filter(r => r.tableId === table.id),
          slotDurationMinutes
        )
      );

      if (singleSuitableTables.length > 0) {
        const bestSingleTable = selectBestSingleTableForGuests(singleSuitableTables, guests);
        if (bestSingleTable) {
          // Check if this exact slot (table + time) is already added
          if (!foundAvailableSlots.some(s => s.tableId === bestSingleTable.id && s.time === timeSlot && !s.isCombined)) {
             foundAvailableSlots.push({
                date: date,
                time: timeSlot,
                timeDisplay: formatTimeForDisplay(timeSlot, currentLang),
                tableId: bestSingleTable.id,
                tableName: bestSingleTable.name,
                tableCapacity: { min: bestSingleTable.minGuests, max: bestSingleTable.maxGuests },
                isCombined: false,
             });
             if (foundAvailableSlots.length >= maxResults) break;
          }
        }
      }

      // 2. If no single table found for this slot (or if we still need more results) AND combinations are allowed
      if (allowCombinations && foundAvailableSlots.length < maxResults && 
          (singleSuitableTables.length === 0 || !singleSuitableTables.some(t => t.maxGuests >= guests))) { // Check if a single table fitting guests was actually found

        const combinedTwoTableSlots = await findCombinableTwoTableSlots(
          timeSlot,
          guests,
          bookableTables, // Pass all bookable tables for combination consideration
          activeReservationsForDate,
          slotDurationMinutes,
          currentLang
        );

        for (const combinedSlot of combinedTwoTableSlots) {
          if (foundAvailableSlots.length >= maxResults) break;
          // Add the combined slot (findCombinableTwoTableSlots already sorts by best fit)
          // Ensure we don't add duplicate representations of combined slots if logic is re-run
           if (!foundAvailableSlots.some(s => 
                s.isCombined && 
                s.time === combinedSlot.time && 
                s.constituentTables?.length === combinedSlot.constituentTables?.length &&
                s.constituentTables?.every(ct => combinedSlot.constituentTables?.some(cct => cct.id === ct.id))
            )) {
                foundAvailableSlots.push({ ...combinedSlot, date: date }); // Ensure date is set correctly
           }
        }
      }
    }

    // Final sort of all found slots (single and combined) by time, then by preference (e.g., non-combined first)
    foundAvailableSlots.sort((a,b) => {
        const timeComparison = a.time.localeCompare(b.time);
        if (timeComparison !== 0) return timeComparison;
        if (a.isCombined !== b.isCombined) return a.isCombined ? 1 : -1; // Prefer non-combined
        // If both combined or not, could sort by capacity or number of tables
        if (a.isCombined && b.isCombined) {
            return (a.constituentTables?.length || 0) - (b.constituentTables?.length || 0);
        }
        return (a.tableCapacity.max - guests) - (b.tableCapacity.max - guests); // Tighter fit for single
    });


    console.log(`[AvailabilityService] Search complete. Found ${foundAvailableSlots.length} slots for R${restaurantId}, Date ${date}, Guests ${guests}, Lang ${currentLang}.`);
    return foundAvailableSlots.slice(0, maxResults); // Ensure maxResults is respected

  } catch (error) {
    console.error(`[AvailabilityService] Critical error in getAvailableTimeSlots for R${restaurantId}:`, error);
    return [];
  }
}
