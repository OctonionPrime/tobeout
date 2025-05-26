// server/services/availability.service.ts
import { storage } from '../storage';
import type {
  Restaurant,
  Table,
  Reservation as SchemaReservation,
} from '@shared/schema';
import type { Language } from './conversation-manager'; // Импортируем тип Language

export interface AvailabilitySlot {
  date: string;
  time: string; // HH:MM:SS (внутренний формат)
  timeDisplay: string; // Формат для пользователя (зависит от языка)
  tableId: number;
  tableName: string;
  tableCapacity: { min: number; max: number };
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

/**
 * Formats a 24-hour time string (HH:MM:SS or HH:MM) to a displayable format based on language.
 * @param time24 - The 24-hour time string.
 * @param lang - The target language ('en' or 'ru').
 * @returns User-friendly time string.
 */
export function formatTimeForDisplay(time24: string, lang: Language = 'en'): string { // <<< ИСПРАВЛЕНО: Добавлено 'export'
  const parts = time24.split(':');
  const hour24 = parseInt(parts[0], 10);
  const minutes = parts[1]?.padStart(2, '0') || '00';

  if (isNaN(hour24) || hour24 < 0 || hour24 > 23) {
    console.warn(`[AvailabilityService] Invalid hour in time string for display: ${time24}`);
    return time24;
  }

  if (lang === 'ru') {
    // Для русского языка используется 24-часовой формат
    return `${hour24.toString().padStart(2, '0')}:${minutes}`;
  }

  // Для английского языка используется AM/PM
  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  let hour12 = hour24 % 12;
  hour12 = hour12 === 0 ? 12 : hour12; // Convert 0 hour to 12 AM

  return `${hour12}:${minutes} ${ampm}`;
}

function isTableAvailableAtTimeSlot(
  tableId: number,
  targetTimeSlot: string,
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
    const resDuration = reservation.duration ?? 90;
    const resEndMinutes = addMinutesToTime(resStartMinutes, resDuration);
    const overlaps = targetSlotStartMinutes < resEndMinutes && targetSlotEndMinutes > resStartMinutes;
    if (overlaps) {
      return false;
    }
  }
  return true;
}

function selectBestTableForGuests(fittingTables: Table[], guests: number): Table | null {
  if (!fittingTables.length) return null;
  fittingTables.sort((a, b) => a.maxGuests - b.maxGuests);
  return fittingTables[0];
}

export async function getAvailableTimeSlots(
  restaurantId: number,
  date: string,
  guests: number,
  configOverrides?: {
    requestedTime?: string;
    maxResults?: number;
    slotIntervalMinutes?: number;
    operatingHours?: { open: string; close: string };
    slotDurationMinutes?: number;
    lang?: Language;
  }
): Promise<AvailabilitySlot[]> {
  const currentLang = configOverrides?.lang || 'en';
  console.log(`[AvailabilityService] Initiating slot search for restaurant ${restaurantId}, date: ${date}, guests: ${guests}, lang: ${currentLang}, configOverrides:`, configOverrides);

  try {
    const restaurant: Restaurant | undefined = await storage.getRestaurant(restaurantId);
    if (!restaurant) {
      console.error(`[AvailabilityService] Restaurant with ID ${restaurantId} not found.`);
      return [];
    }

    if (!restaurant.openingTime || !restaurant.closingTime) {
      console.error(`[AvailabilityService] Restaurant ${restaurantId} missing required operating hours.`);
      return [];
    }

    const operatingOpenTimeStr = configOverrides?.operatingHours?.open || restaurant.openingTime;
    const operatingCloseTimeStr = configOverrides?.operatingHours?.close || restaurant.closingTime;
    const slotDurationMinutes = configOverrides?.slotDurationMinutes || restaurant.avgReservationDuration;

    const openingTimeMinutes = parseTimeToMinutes(operatingOpenTimeStr);
    const closingTimeMinutes = parseTimeToMinutes(operatingCloseTimeStr);

    if (openingTimeMinutes === null || closingTimeMinutes === null || openingTimeMinutes >= closingTimeMinutes) {
      console.error(`[AvailabilityService] Invalid or missing operating hours for restaurant ${restaurantId}.`);
      return [];
    }

    const slotIntervalMinutes = configOverrides?.slotIntervalMinutes || 60;
    const maxResults = configOverrides?.maxResults || 5;
    const requestedTime = configOverrides?.requestedTime;

    console.log(`[AvailabilityService] Effective search settings: Interval=${slotIntervalMinutes}min, SlotDuration=${slotDurationMinutes}min, MaxResults=${maxResults}, OperatingHours=${operatingOpenTimeStr}-${operatingCloseTimeStr}`);

    const allRestaurantTables: Table[] = await storage.getTables(restaurantId);
    if (!allRestaurantTables || allRestaurantTables.length === 0) {
      console.log(`[AvailabilityService] No tables found for restaurant ${restaurantId}.`);
      return [];
    }

    const bookableTables = allRestaurantTables.filter(table => table.status !== 'unavailable');
    if (bookableTables.length === 0) {
      console.log(`[AvailabilityService] No tables are currently bookable.`);
      return [];
    }

    const suitableCapacityTables = bookableTables.filter(table =>
      table.minGuests <= guests && table.maxGuests >= guests
    );
    if (suitableCapacityTables.length === 0) {
      console.log(`[AvailabilityService] No tables found with capacity for ${guests} guests.`);
      return [];
    }
    console.log(`[AvailabilityService] Found ${suitableCapacityTables.length} tables initially suitable by capacity for ${guests} guests.`);

    const activeReservationsForDate = (await storage.getReservations(restaurantId, {
      date: date,
      status: ['created', 'confirmed']
    })) as SchemaReservation[];
    console.log(`[AvailabilityService] Found ${activeReservationsForDate.length} active reservations on ${date} to check against.`);

    const lastBookingTimeMinutes = closingTimeMinutes - 60;

    const potentialTimeSlots: string[] = [];
    for (let currentTimeMinutes = openingTimeMinutes; currentTimeMinutes <= lastBookingTimeMinutes; currentTimeMinutes += slotIntervalMinutes) {
      if (currentTimeMinutes > lastBookingTimeMinutes) {
        continue;
      }
      const hours = Math.floor(currentTimeMinutes / 60);
      const minutes = currentTimeMinutes % 60;
      potentialTimeSlots.push(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`);
    }

    if (requestedTime) {
      const requestedTimeMinutes = parseTimeToMinutes(requestedTime);
      if (requestedTimeMinutes !== null) {
        potentialTimeSlots.sort((a, b) => {
          const aParsedMinutes = parseTimeToMinutes(a);
          const bParsedMinutes = parseTimeToMinutes(b);
          if (aParsedMinutes === null || bParsedMinutes === null) return 0;
          const aDistance = Math.abs(aParsedMinutes - requestedTimeMinutes);
          const bDistance = Math.abs(bParsedMinutes - requestedTimeMinutes);
          return aDistance - bDistance;
        });
      }
    }

    const foundAvailableSlots: AvailabilitySlot[] = [];

    for (const timeSlot of potentialTimeSlots) {
      if (foundAvailableSlots.length >= maxResults) {
        break;
      }

      const tablesAvailableInThisExactSlot: Table[] = [];
      for (const table of suitableCapacityTables) {
        const reservationsForCurrentTable = activeReservationsForDate.filter(
          res => res.tableId === table.id
        );
        if (isTableAvailableAtTimeSlot(table.id, timeSlot, reservationsForCurrentTable, slotDurationMinutes)) {
          tablesAvailableInThisExactSlot.push(table);
        }
      }

      if (tablesAvailableInThisExactSlot.length > 0) {
        const bestTable = selectBestTableForGuests(tablesAvailableInThisExactSlot, guests);
        if (bestTable) {
          foundAvailableSlots.push({
            date: date,
            time: timeSlot,
            timeDisplay: formatTimeForDisplay(timeSlot, currentLang), // Используем currentLang
            tableId: bestTable.id,
            tableName: bestTable.name, // tableName может требовать локализации на уровне БД
            tableCapacity: {
              min: bestTable.minGuests,
              max: bestTable.maxGuests
            },
          });
        }
      }
    }

    console.log(`[AvailabilityService] Search complete. Found ${foundAvailableSlots.length} available slots for restaurant ${restaurantId} on ${date} for ${guests} guests (lang: ${currentLang}).`);
    return foundAvailableSlots;

  } catch (error) {
    console.error(`[AvailabilityService] Critical error during getAvailableTimeSlots for restaurant ${restaurantId}:`, error);
    return [];
  }
}
