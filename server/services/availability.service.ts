// server/services/availability.service.ts
import { storage } from '../storage';
import { formatTimeForRestaurant } from '../utils/timezone-utils';
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

// ✅ FIXED: Updated to handle nested reservation structure
function isTableAvailableAtTimeSlot(
    tableId: number,
    targetTimeSlot: string, // HH:MM:SS
    activeReservationsForTable: Pick<SchemaReservation, 'time' | 'duration'>[], // These are now properly extracted flat objects
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
        // ✅ FIX: Use 120 minutes (2 hours) as default duration, not 90
        const resDuration = reservation.duration ?? 120; // Default duration if null
        const resEndMinutes = addMinutesToTime(resStartMinutes, resDuration);

        // Check for overlap:
        // A_start < B_end AND A_end > B_start
        const overlaps = targetSlotStartMinutes < resEndMinutes && targetSlotEndMinutes > resStartMinutes;
        if (overlaps) {
            console.log(`[AvailabilityService] ❌ Table ${tableId} conflicts at ${targetTimeSlot} with reservation from ${reservation.time} for ${resDuration}min.`);
            return false;
        }
    }
    console.log(`[AvailabilityService] ✅ Table ${tableId} is available at ${targetTimeSlot}.`);
    return true;
}

// Selects the best single table that fits the guests, preferring tighter fits.
function selectBestSingleTableForGuests(fittingTables: Table[], guests: number): Table | null {
    if (!fittingTables.length) return null;
    // Sort by maxGuests (ascending) to find the smallest table that can fit the party.
    fittingTables.sort((a, b) => a.maxGuests - b.maxGuests);
    return fittingTables.find(table => table.maxGuests >= guests) || null; // Ensure it still fits after sorting
}

// ✅ FIXED: Updated to handle nested reservation structure
async function findCombinableTwoTableSlots(
    timeSlot: string, // HH:MM:SS
    guests: number,
    allBookableTables: Table[],
    activeReservationsForDate: any[], // ✅ FIXED: Now properly handle nested structure
    slotDurationMinutes: number,
    restaurantTimezone: string,
    currentLang: Language
): Promise<AvailabilitySlot[]> {
    const combinableSlots: AvailabilitySlot[] = [];

    // 1. Filter tables that are individually available at this timeSlot
    const availableTablesInSlot = allBookableTables.filter(table => {
        // ✅ FIXED: Extract flat reservations for this table from nested structure
        const flatReservationsForTable = activeReservationsForDate
            .filter(r => {
                const reservation = r.reservation || r;
                return reservation.tableId === table.id;
            })
            .map(r => {
                const reservation = r.reservation || r;
                return {
                    time: reservation.time,
                    duration: reservation.duration
                };
            });

        return isTableAvailableAtTimeSlot(
            table.id,
            timeSlot,
            flatReservationsForTable,
            slotDurationMinutes
        );
    });

    if (availableTablesInSlot.length < 2) return []; // Need at least two tables to combine

    // Sort by maxGuests to make combinations more predictable, can be adjusted
    availableTablesInSlot.sort((a, b) => a.maxGuests - b.maxGuests);

    for (let i = 0; i < availableTablesInSlot.length; i++) {
        for (let j = i + 1; j < availableTablesInSlot.length; j++) {
            const table1 = availableTablesInSlot[i];
            const table2 = availableTablesInSlot[j];

            const combinedMinCapacity = table1.minGuests + table2.minGuests;
            const combinedMaxCapacity = table1.maxGuests + table2.maxGuests;

            if (combinedMaxCapacity >= guests && guests >= combinedMinCapacity) {
                // This combination can seat the party
                const constituentTablesDetails = [
                    { id: table1.id, name: table1.name, capacity: { min: table1.minGuests, max: table1.maxGuests } },
                    { id: table2.id, name: table2.name, capacity: { min: table2.minGuests, max: table2.maxGuests } },
                ];

                combinableSlots.push({
                    date: activeReservationsForDate[0]?.reservation?.date || activeReservationsForDate[0]?.date || new Date().toISOString().split('T')[0],
                    time: timeSlot,
                    timeDisplay: formatTimeForRestaurant(timeSlot, restaurantTimezone, currentLang),
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

// ✅ CRITICAL FIX: Added timezone support to getAvailableTimeSlots
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
        timezone?: string; // ✅ NEW: Restaurant timezone for proper filtering
    }
): Promise<AvailabilitySlot[]> {
    const currentLang = configOverrides?.lang || 'en';
    const allowCombinations = configOverrides?.allowCombinations !== undefined ? configOverrides.allowCombinations : true;
    const restaurantTimezone = configOverrides?.timezone || 'Europe/Moscow'; // ✅ NEW: Timezone support

    console.log(`[AvailabilityService] Initiating slot search: R${restaurantId}, Date ${date}, Guests ${guests}, Lang ${currentLang}, Timezone ${restaurantTimezone}, Combinations: ${allowCombinations}, Config:`, configOverrides);

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
        const slotDurationMinutes = configOverrides?.slotDurationMinutes || restaurant.avgReservationDuration || 120;

        const openingTimeMinutes = parseTimeToMinutes(operatingOpenTimeStr);
        const closingTimeMinutes = parseTimeToMinutes(operatingCloseTimeStr);

        if (openingTimeMinutes === null || closingTimeMinutes === null || openingTimeMinutes >= closingTimeMinutes) {
            console.error(`[AvailabilityService] Invalid operating hours for R${restaurantId}: ${openingTimeMinutes}-${closingTimeMinutes}`);
            return [];
        }

        const slotIntervalMinutes = configOverrides?.slotIntervalMinutes || 30;
        const maxResults = configOverrides?.maxResults || 5;
        const requestedTimeStr = configOverrides?.requestedTime;

        console.log(`[AvailabilityService] Effective settings: Interval=${slotIntervalMinutes}min, SlotDuration=${slotDurationMinutes}min, MaxResults=${maxResults}, OpHours=${operatingOpenTimeStr}-${operatingCloseTimeStr}, Timezone=${restaurantTimezone}`);

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

        // ✅ CRITICAL FIX: Pass restaurant timezone when getting reservations
        const nestedReservationsForDate = await storage.getReservations(restaurantId, {
            date: date,
            status: ['created', 'confirmed'],
            timezone: restaurantTimezone  // ← CRITICAL FIX
        });
        
        console.log(`[AvailabilityService] Raw reservations data structure:`, nestedReservationsForDate.length > 0 ? nestedReservationsForDate[0] : 'no reservations');
        console.log(`[AvailabilityService] Found ${nestedReservationsForDate.length} active reservations on ${date} for R${restaurantId} in timezone ${restaurantTimezone}.`);

        // Define the last possible booking start time
        const lastBookingTimeMinutes = closingTimeMinutes - slotDurationMinutes;

        const potentialTimeSlots: string[] = [];
        for (let currentTimeMinutes = openingTimeMinutes; currentTimeMinutes <= lastBookingTimeMinutes; currentTimeMinutes += slotIntervalMinutes) {
            const hours = Math.floor(currentTimeMinutes / 60);
            const minutes = currentTimeMinutes % 60;
            potentialTimeSlots.push(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`);
        }

        // Sort potential slots: if requestedTime is given, sort by proximity
        if (requestedTimeStr) {
            const requestedTimeMinutes = parseTimeToMinutes(requestedTimeStr.substring(0, 5) + ":00");
            if (requestedTimeMinutes !== null) {
                potentialTimeSlots.sort((a, b) => {
                    const aParsedMinutes = parseTimeToMinutes(a);
                    const bParsedMinutes = parseTimeToMinutes(b);
                    if (aParsedMinutes === null || bParsedMinutes === null) return 0;
                    const aDistance = Math.abs(aParsedMinutes - requestedTimeMinutes);
                    const bDistance = Math.abs(bParsedMinutes - requestedTimeMinutes);
                    if (aDistance !== bDistance) return aDistance - bDistance;
                    return aParsedMinutes - bParsedMinutes;
                });
            }
        }

        const foundAvailableSlots: AvailabilitySlot[] = [];

        for (const timeSlot of potentialTimeSlots) {
            if (foundAvailableSlots.length >= maxResults) break;

            console.log(`[AvailabilityService] 🔍 Checking time slot: ${timeSlot} (${restaurantTimezone})`);

            // ✅ FIXED: Properly extract flat reservations for each table
            const singleSuitableTables = bookableTables.filter(table => {
                // Check capacity first
                if (table.minGuests > guests || table.maxGuests < guests) {
                    return false;
                }

                // ✅ FIXED: Extract flat reservations for this table from nested structure
                const flatReservationsForTable = nestedReservationsForDate
                    .filter(r => {
                        const reservation = r.reservation || r;
                        return reservation.tableId === table.id;
                    })
                    .map(r => {
                        const reservation = r.reservation || r;
                        return {
                            time: reservation.time,
                            duration: reservation.duration
                        };
                    });

                console.log(`[AvailabilityService] Table ${table.name} (ID: ${table.id}) has ${flatReservationsForTable.length} reservations for ${date}`);

                const isAvailable = isTableAvailableAtTimeSlot(
                    table.id,
                    timeSlot,
                    flatReservationsForTable,
                    slotDurationMinutes
                );

                if (isAvailable) {
                    console.log(`[AvailabilityService] ✅ Table ${table.name} is available at ${timeSlot}`);
                } else {
                    console.log(`[AvailabilityService] ❌ Table ${table.name} is occupied at ${timeSlot}`);
                }

                return isAvailable;
            });

            if (singleSuitableTables.length > 0) {
                const bestSingleTable = selectBestSingleTableForGuests(singleSuitableTables, guests);
                if (bestSingleTable) {
                    // Check if this exact slot is already added
                    if (!foundAvailableSlots.some(s => s.tableId === bestSingleTable.id && s.time === timeSlot && !s.isCombined)) {
                        console.log(`[AvailabilityService] ✅ Adding available slot: ${bestSingleTable.name} at ${timeSlot} (${restaurantTimezone})`);
                        foundAvailableSlots.push({
                            date: date,
                            time: timeSlot,
                            timeDisplay: formatTimeForRestaurant(timeSlot, restaurantTimezone, currentLang),
                            tableId: bestSingleTable.id,
                            tableName: bestSingleTable.name,
                            tableCapacity: { min: bestSingleTable.minGuests, max: bestSingleTable.maxGuests },
                            isCombined: false,
                        });
                        if (foundAvailableSlots.length >= maxResults) break;
                    }
                }
            }

            // ✅ FIXED: Updated combination logic with proper nested data handling
            if (allowCombinations && foundAvailableSlots.length < maxResults &&
                (singleSuitableTables.length === 0 || !singleSuitableTables.some(t => t.maxGuests >= guests))) {

                const combinedTwoTableSlots = await findCombinableTwoTableSlots(
                    timeSlot,
                    guests,
                    bookableTables,
                    nestedReservationsForDate, // ✅ FIXED: Pass the nested structure correctly
                    slotDurationMinutes,
                    restaurantTimezone,
                    currentLang
                );

                for (const combinedSlot of combinedTwoTableSlots) {
                    if (foundAvailableSlots.length >= maxResults) break;
                    if (!foundAvailableSlots.some(s =>
                        s.isCombined &&
                        s.time === combinedSlot.time &&
                        s.constituentTables?.length === combinedSlot.constituentTables?.length &&
                        s.constituentTables?.every(ct => combinedSlot.constituentTables?.some(cct => cct.id === ct.id))
                    )) {
                        console.log(`[AvailabilityService] ✅ Adding combined slot: ${combinedSlot.tableName} at ${timeSlot} (${restaurantTimezone})`);
                        foundAvailableSlots.push({ ...combinedSlot, date: date });
                    }
                }
            }
        }

        // Final sort by time, then by preference
        foundAvailableSlots.sort((a, b) => {
            const timeComparison = a.time.localeCompare(b.time);
            if (timeComparison !== 0) return timeComparison;
            if (a.isCombined !== b.isCombined) return a.isCombined ? 1 : -1; // Prefer non-combined
            if (a.isCombined && b.isCombined) {
                return (a.constituentTables?.length || 0) - (b.constituentTables?.length || 0);
            }
            return (a.tableCapacity.max - guests) - (b.tableCapacity.max - guests);
        });

        console.log(`[AvailabilityService] Search complete. Found ${foundAvailableSlots.length} slots for R${restaurantId}, Date ${date}, Guests ${guests}, Lang ${currentLang}, Timezone ${restaurantTimezone}.`);
        return foundAvailableSlots.slice(0, maxResults);

    } catch (error) {
        console.error(`[AvailabilityService] Critical error in getAvailableTimeSlots for R${restaurantId}:`, error);
        return [];
    }
}