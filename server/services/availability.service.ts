// server/services/availability.service.ts
import { storage } from '../storage';
import { formatTimeForRestaurant } from '../utils/timezone-utils';
import { DateTime } from 'luxon';
import type {
    Restaurant,
    Table,
    Reservation as SchemaReservation,
} from '@shared/schema';
import type { Language } from './enhanced-conversation-manager';

export interface AvailabilitySlot {
    date: string;
    time: string; // HH:MM:SS (internal format)
    timeDisplay: string; // User-facing format (depends on language)
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

// ✅ DYNAMIC: Works for ANY overnight operation (not hardcoded)
function isOvernightOperation(openingTime: string, closingTime: string): boolean {
    const openingMinutes = parseTimeToMinutes(openingTime);
    const closingMinutes = parseTimeToMinutes(closingTime);
    
    if (openingMinutes === null || closingMinutes === null) {
        return false;
    }
    
    // If closing time is earlier in the day than opening time, it's overnight
    return closingMinutes < openingMinutes;
}

// ✅ DYNAMIC: Enhanced date validation for ANY overnight operations
function validateReservationDate(
    reservation_utc: string,
    requestedDate: string, // YYYY-MM-DD
    restaurantTimezone: string,
    isOvernightOp: boolean = false
): boolean {
    try {
        // Handle both ISO and PostgreSQL timestamp formats
        let utcDateTime;
        try {
            utcDateTime = DateTime.fromISO(reservation_utc, { zone: 'utc' });
            if (!utcDateTime.isValid) {
                const pgTimestamp = reservation_utc.replace(' ', 'T').replace('+00', 'Z');
                utcDateTime = DateTime.fromISO(pgTimestamp, { zone: 'utc' });
            }
        } catch (parseError) {
            console.error(`[AvailabilityService] Error parsing reservation timestamp ${reservation_utc}:`, parseError);
            return false;
        }
        
        if (!utcDateTime.isValid) {
            console.warn(`[AvailabilityService] Invalid reservation timestamp ${reservation_utc}`);
            return false;
        }
        
        // Convert to restaurant timezone and extract date
        const restaurantLocal = utcDateTime.setZone(restaurantTimezone);
        const reservationDate = restaurantLocal.toISODate();
        
        // ✅ DYNAMIC: For overnight operations, check both the target date and previous date
        if (isOvernightOp) {
            const previousDate = DateTime.fromISO(requestedDate, { zone: restaurantTimezone })
                .minus({ days: 1 }).toISODate();
            
            const isValid = reservationDate === requestedDate || reservationDate === previousDate;
            
            if (!isValid) {
                console.log(`[AvailabilityService] 🚫 Overnight filtering: UTC ${reservation_utc} → ${reservationDate} (${restaurantTimezone}) ≠ requested ${requestedDate} or previous ${previousDate}`);
            } else {
                console.log(`[AvailabilityService] ✅ Overnight reservation valid: UTC ${reservation_utc} → ${reservationDate} (${restaurantTimezone}) matches ${requestedDate} window`);
            }
            
            return isValid;
        } else {
            // Standard operation - exact date match
            const isValid = reservationDate === requestedDate;
            
            if (!isValid) {
                console.log(`[AvailabilityService] 🚫 Filtering out reservation: UTC ${reservation_utc} → ${reservationDate} (${restaurantTimezone}) ≠ requested ${requestedDate}`);
            } else {
                console.log(`[AvailabilityService] ✅ Reservation valid for date: UTC ${reservation_utc} → ${reservationDate} (${restaurantTimezone}) = requested ${requestedDate}`);
            }
            
            return isValid;
        }
    } catch (error) {
        console.error(`[AvailabilityService] Error validating reservation date for ${reservation_utc}:`, error);
        return false;
    }
}

// 🔧 FIXED: Enhanced overnight conflict detection with proper date handling
function isTableAvailableAtTimeSlot(
    tableId: number,
    targetTimeSlot: string, // HH:MM:SS in restaurant timezone
    activeReservationsForTable: Array<{ 
        reservation_utc: string; 
        duration: number | null; 
        id?: number;
    }>,
    slotDurationMinutes: number,
    restaurantTimezone: string,
    requestedDate: string,
    isOvernightOp: boolean = false,
    openingMinutes: number = 0,
    closingMinutes: number = 1440
): boolean {
    const targetSlotStartMinutes = parseTimeToMinutes(targetTimeSlot);
    if (targetSlotStartMinutes === null) {
        console.warn(`[AvailabilityService] Invalid targetTimeSlot for parsing: ${targetTimeSlot} for tableId ${tableId}`);
        return false;
    }
    const targetSlotEndMinutes = addMinutesToTime(targetSlotStartMinutes, slotDurationMinutes);

    console.log(`[AvailabilityService] 🔍 Checking table ${tableId} at ${targetTimeSlot} (${targetSlotStartMinutes}-${targetSlotEndMinutes}min) for ${requestedDate} [${isOvernightOp ? 'OVERNIGHT' : 'STANDARD'}]`);

    for (const reservation of activeReservationsForTable) {
        if (!reservation.reservation_utc) {
            console.warn(`[AvailabilityService] Reservation ${reservation.id || 'unknown'} missing UTC timestamp, skipping`);
            continue;
        }

        // Validate reservation belongs to the operation window
        if (!validateReservationDate(reservation.reservation_utc, requestedDate, restaurantTimezone, isOvernightOp)) {
            continue;
        }

        try {
            // Parse UTC timestamp
            let localDateTime;
            try {
                localDateTime = DateTime.fromISO(reservation.reservation_utc, { zone: 'utc' });
                if (!localDateTime.isValid) {
                    const pgTimestamp = reservation.reservation_utc.replace(' ', 'T').replace('+00', 'Z');
                    localDateTime = DateTime.fromISO(pgTimestamp, { zone: 'utc' });
                }
            } catch (parseError) {
                console.error(`[AvailabilityService] Error parsing timestamp ${reservation.reservation_utc}:`, parseError);
                continue;
            }
            
            if (!localDateTime.isValid) {
                console.warn(`[AvailabilityService] Invalid timestamp ${reservation.reservation_utc}, skipping reservation ${reservation.id || 'unknown'}`);
                continue;
            }
            
            const restaurantLocal = localDateTime.setZone(restaurantTimezone);
            const localTime = restaurantLocal.toFormat('HH:mm:ss');
            
            // 🔧 CRITICAL FIX: Get the actual date of the reservation
            const reservationDate = restaurantLocal.toISODate();
            
            console.log(`[AvailabilityService] 🔍 [Time Check] Reservation UTC: ${reservation.reservation_utc} -> Local: ${localTime} on ${reservationDate} (${restaurantTimezone})`);
            
            const resStartMinutes = parseTimeToMinutes(localTime);
            if (resStartMinutes === null) {
                console.warn(`[AvailabilityService] Converted time ${localTime} invalid for reservation ${reservation.id || 'unknown'} (UTC: ${reservation.reservation_utc})`);
                continue;
            }
            
            const resDuration = reservation.duration ?? 120;
            const resEndMinutes = addMinutesToTime(resStartMinutes, resDuration);

            // 🔧 CRITICAL FIX: Check if reservation and slot are from different dates
            if (reservationDate !== requestedDate) {
                console.log(`[AvailabilityService] 📅 Date mismatch: Reservation on ${reservationDate} vs Slot on ${requestedDate}`);
                
                if (isOvernightOp) {
                    // For overnight operations, check if reservation from previous day extends to current day
                    const previousDate = DateTime.fromISO(requestedDate, { zone: restaurantTimezone })
                        .minus({ days: 1 }).toISODate();
                    
                    if (reservationDate === previousDate) {
                        // Reservation is from previous day - check if it extends past midnight to current day
                        console.log(`[AvailabilityService] 🌙 Checking if previous day reservation extends to current day: ${resStartMinutes}-${resEndMinutes} (${resDuration}min)`);
                        
                        // Check if reservation extends past midnight (24*60 = 1440 minutes)
                        if (resEndMinutes > 24 * 60) {
                            // Reservation extends to next day, calculate overlap with current day slot
                            const resEndOnCurrentDay = resEndMinutes - 24 * 60;
                            console.log(`[AvailabilityService] 🌙 Reservation extends to current day: ends at ${resEndOnCurrentDay} minutes`);
                            
                            // Check overlap with current day slot
                            const overlaps = targetSlotStartMinutes < resEndOnCurrentDay;
                            if (overlaps) {
                                console.log(`[AvailabilityService] ❌ Table ${tableId} conflicts: Slot ${targetSlotStartMinutes}-${targetSlotEndMinutes} overlaps with previous day reservation ending at ${resEndOnCurrentDay} on ${requestedDate}`);
                                return false;
                            } else {
                                console.log(`[AvailabilityService] ✅ No overlap: Previous day reservation ends at ${resEndOnCurrentDay}, slot starts at ${targetSlotStartMinutes}`);
                            }
                        } else {
                            console.log(`[AvailabilityService] ✅ Previous day reservation (${resStartMinutes}-${resEndMinutes}) doesn't extend to current day`);
                        }
                        continue;
                    } else {
                        // Reservation is from a completely different date - no conflict possible
                        console.log(`[AvailabilityService] ✅ Different date, no conflict: ${reservationDate} vs ${requestedDate}`);
                        continue;
                    }
                } else {
                    // Non-overnight operation - different dates = no conflict
                    console.log(`[AvailabilityService] ✅ Standard operation, different dates = no conflict: ${reservationDate} vs ${requestedDate}`);
                    continue;
                }
            }

            // 🔧 ENHANCED: Same-date conflict detection with proper overnight handling
            let overlaps = false;

            if (isOvernightOp) {
                console.log(`[AvailabilityService] 🌙 Same-date overnight conflict check: Slot ${targetSlotStartMinutes}-${targetSlotEndMinutes} vs Reservation ${resStartMinutes}-${resEndMinutes}`);
                
                // ✅ DYNAMIC: Determine if times are in "early" or "late" portions of operation
                const isTargetInEarlyPortion = targetSlotStartMinutes < closingMinutes;
                const isTargetInLatePortion = targetSlotStartMinutes >= openingMinutes;
                const isReservationInEarlyPortion = resStartMinutes < closingMinutes;
                const isReservationInLatePortion = resStartMinutes >= openingMinutes;
                
                if (isTargetInEarlyPortion && isReservationInEarlyPortion) {
                    // Both in early portion (after midnight, before closing)
                    overlaps = targetSlotStartMinutes < resEndMinutes && targetSlotEndMinutes > resStartMinutes;
                    console.log(`[AvailabilityService] 🌅 Early vs Early: ${overlaps}`);
                } else if (isTargetInLatePortion && isReservationInLatePortion) {
                    // Both in late portion (after opening, before midnight)
                    overlaps = targetSlotStartMinutes < resEndMinutes && targetSlotEndMinutes > resStartMinutes;
                    console.log(`[AvailabilityService] 🌆 Late vs Late: ${overlaps}`);
                } else if (isTargetInEarlyPortion && isReservationInLatePortion) {
                    // Target in early portion, reservation in late portion
                    // Check if reservation extends past midnight
                    if (resEndMinutes > 24 * 60) {
                        const resEndNextDay = resEndMinutes - 24 * 60;
                        overlaps = targetSlotStartMinutes < resEndNextDay && targetSlotEndMinutes > 0;
                        console.log(`[AvailabilityService] 🌅 Early vs Late (extending): ${overlaps}, resEndNextDay: ${resEndNextDay}`);
                    }
                } else if (isTargetInLatePortion && isReservationInEarlyPortion) {
                    // Target in late portion, reservation in early portion
                    // Check if target extends past midnight
                    if (targetSlotEndMinutes > 24 * 60) {
                        const targetEndNextDay = targetSlotEndMinutes - 24 * 60;
                        overlaps = 0 < resEndMinutes && targetEndNextDay > resStartMinutes;
                        console.log(`[AvailabilityService] 🌆 Late (extending) vs Early: ${overlaps}, targetEndNextDay: ${targetEndNextDay}`);
                    }
                }
                
            } else {
                // Standard overlap check for non-overnight operations
                overlaps = targetSlotStartMinutes < resEndMinutes && targetSlotEndMinutes > resStartMinutes;
                console.log(`[AvailabilityService] 📅 Standard conflict check: ${overlaps}`);
            }

            if (overlaps) {
                console.log(`[AvailabilityService] ❌ Table ${tableId} conflicts at ${targetTimeSlot} with reservation from ${localTime} (UTC: ${reservation.reservation_utc}) for ${resDuration}min on ${reservationDate} [${isOvernightOp ? 'OVERNIGHT' : 'STANDARD'}]`);
                return false;
            }
        } catch (error) {
            console.error(`[AvailabilityService] Error converting UTC timestamp ${reservation.reservation_utc} for table ${tableId}:`, error);
            continue;
        }
    }
    
    console.log(`[AvailabilityService] ✅ Table ${tableId} is available at ${targetTimeSlot} on ${requestedDate} (${restaurantTimezone}) [${isOvernightOp ? 'OVERNIGHT' : 'STANDARD'}]`);
    return true;
}

// Selects the best single table that fits the guests, preferring tighter fits.
function selectBestSingleTableForGuests(fittingTables: Table[], guests: number): Table | null {
    if (!fittingTables.length) return null;
    fittingTables.sort((a, b) => a.maxGuests - b.maxGuests);
    return fittingTables.find(table => table.maxGuests >= guests) || null;
}

// ✅ DYNAMIC: Updated combination logic with proper overnight support
async function findCombinableTwoTableSlots(
    timeSlot: string,
    guests: number,
    allBookableTables: Table[],
    activeReservationsForDate: any[],
    slotDurationMinutes: number,
    restaurantTimezone: string,
    currentLang: Language,
    requestedDate: string,
    isOvernightOp: boolean = false,
    openingMinutes: number = 0,
    closingMinutes: number = 1440
): Promise<AvailabilitySlot[]> {
    const combinableSlots: AvailabilitySlot[] = [];

    const availableTablesInSlot = allBookableTables.filter(table => {
        const utcReservationsForTable = activeReservationsForDate
            .filter(r => {
                const reservation = r.reservation || r;
                return reservation.tableId === table.id;
            })
            .map(r => {
                const reservation = r.reservation || r;
                return {
                    reservation_utc: reservation.reservation_utc,
                    duration: reservation.duration,
                    id: reservation.id
                };
            })
            .filter(r => r.reservation_utc && validateReservationDate(r.reservation_utc, requestedDate, restaurantTimezone, isOvernightOp));

        return isTableAvailableAtTimeSlot(
            table.id,
            timeSlot,
            utcReservationsForTable,
            slotDurationMinutes,
            restaurantTimezone,
            requestedDate,
            isOvernightOp,
            openingMinutes,
            closingMinutes
        );
    });

    if (availableTablesInSlot.length < 2) return [];

    availableTablesInSlot.sort((a, b) => a.maxGuests - b.maxGuests);

    for (let i = 0; i < availableTablesInSlot.length; i++) {
        for (let j = i + 1; j < availableTablesInSlot.length; j++) {
            const table1 = availableTablesInSlot[i];
            const table2 = availableTablesInSlot[j];

            const combinedMinCapacity = table1.minGuests + table2.minGuests;
            const combinedMaxCapacity = table1.maxGuests + table2.maxGuests;

            if (combinedMaxCapacity >= guests && guests >= combinedMinCapacity) {
                const constituentTablesDetails = [
                    { id: table1.id, name: table1.name, capacity: { min: table1.minGuests, max: table1.maxGuests } },
                    { id: table2.id, name: table2.name, capacity: { min: table2.minGuests, max: table2.maxGuests } },
                ];

                combinableSlots.push({
                    date: requestedDate,
                    time: timeSlot,
                    timeDisplay: formatTimeForRestaurant(timeSlot, restaurantTimezone, currentLang),
                    tableId: 0,
                    tableName: currentLang === 'ru' ? `Столики ${table1.name} и ${table2.name}` : `Tables ${table1.name} & ${table2.name}`,
                    tableCapacity: { min: combinedMinCapacity, max: combinedMaxCapacity },
                    isCombined: true,
                    constituentTables: constituentTablesDetails,
                });
            }
        }
    }

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

function getRestaurantDateRange(date: string, restaurantTimezone: string) {
    try {
        const startOfDay = DateTime.fromISO(date, { zone: restaurantTimezone }).startOf('day');
        const endOfDay = DateTime.fromISO(date, { zone: restaurantTimezone }).endOf('day');
        
        return {
            utcStart: startOfDay.toUTC().toISO(),
            utcEnd: endOfDay.toUTC().toISO(),
            restaurantStart: startOfDay.toISO(),
            restaurantEnd: endOfDay.toISO(),
            isValid: startOfDay.isValid && endOfDay.isValid
        };
    } catch (error) {
        console.error(`[AvailabilityService] Error calculating date range for ${date} in ${restaurantTimezone}:`, error);
        return {
            utcStart: null,
            utcEnd: null,
            restaurantStart: null,
            restaurantEnd: null,
            isValid: false
        };
    }
}

// ✅ DYNAMIC: Completely rewritten overnight slot generation (works for ANY times)
function generateOvernightTimeSlots(
    openingTimeMinutes: number,
    closingTimeMinutes: number, 
    slotIntervalMinutes: number,
    slotDurationMinutes: number
): string[] {
    const slots: string[] = [];
    
    console.log(`[AvailabilityService] 🌙 Generating overnight slots: opening=${Math.floor(openingTimeMinutes/60)}:${String(openingTimeMinutes%60).padStart(2,'0')}, closing=${Math.floor(closingTimeMinutes/60)}:${String(closingTimeMinutes%60).padStart(2,'0')}, duration=${slotDurationMinutes}min`);
    
    // ✅ DYNAMIC: Calculate the latest possible reservation start time
    let latestStartTime: number;
    
    if (closingTimeMinutes < slotDurationMinutes) {
        // If closing is very early and duration is long, handle wraparound
        latestStartTime = closingTimeMinutes + (24 * 60) - slotDurationMinutes;
        if (latestStartTime >= 24 * 60) {
            latestStartTime = latestStartTime - (24 * 60);
        }
    } else {
        latestStartTime = closingTimeMinutes - slotDurationMinutes;
    }
    
    console.log(`[AvailabilityService] 🌙 Latest start time calculated: ${Math.floor(latestStartTime/60)}:${String(latestStartTime%60).padStart(2,'0')}`);
    
    // Phase 1: Generate slots from opening time until midnight
    if (openingTimeMinutes < 24 * 60) {
        let currentTimeMinutes = openingTimeMinutes;
        while (currentTimeMinutes < 24 * 60) {
            const hours = Math.floor(currentTimeMinutes / 60);
            const minutes = currentTimeMinutes % 60;
            
            // Check if this slot would end before the restaurant closes (considering overnight)
            const slotEndMinutes = currentTimeMinutes + slotDurationMinutes;
            
            // For overnight operations, allow slots that extend past midnight
            if (slotEndMinutes <= 24 * 60 || closingTimeMinutes > 0) {
                slots.push(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`);
            }
            
            currentTimeMinutes += slotIntervalMinutes;
        }
    }
    
    // Phase 2: Generate slots from midnight until the latest valid start time (early morning)
    let currentTimeMinutes = 0;
    while (currentTimeMinutes <= latestStartTime && currentTimeMinutes < closingTimeMinutes) {
        const hours = Math.floor(currentTimeMinutes / 60);
        const minutes = currentTimeMinutes % 60;
        slots.push(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`);
        currentTimeMinutes += slotIntervalMinutes;
    }
    
    console.log(`[AvailabilityService] 🌙 Generated ${slots.length} overnight slots`);
    console.log(`[AvailabilityService] 🌙 First 5 slots: ${slots.slice(0, 5).join(', ')}`);
    console.log(`[AvailabilityService] 🌙 Last 5 slots: ${slots.slice(-5).join(', ')}`);
    
    return slots;
}

// ✅ MAIN FUNCTION: Complete overnight support (DYNAMIC for ANY times)
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
        searchRadiusMinutes?: number;
        allowCombinations?: boolean;
        timezone?: string;
    }
): Promise<AvailabilitySlot[]> {
    const currentLang = configOverrides?.lang || 'en';
    const allowCombinations = configOverrides?.allowCombinations !== undefined ? configOverrides.allowCombinations : true;
    const restaurantTimezone = configOverrides?.timezone || 'Europe/Moscow';

    console.log(`[AvailabilityService] 🔍 Starting slot search: R${restaurantId}, Date ${date}, Guests ${guests}, Lang ${currentLang}, Timezone ${restaurantTimezone}, Combinations: ${allowCombinations}`);

    const dateRange = getRestaurantDateRange(date, restaurantTimezone);
    if (!dateRange.isValid) {
        console.error(`[AvailabilityService] Invalid date range for ${date} in timezone ${restaurantTimezone}`);
        return [];
    }

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

        if (openingTimeMinutes === null || closingTimeMinutes === null) {
            console.error(`[AvailabilityService] Invalid operating hours parsing for R${restaurantId}: opening=${operatingOpenTimeStr}, closing=${operatingCloseTimeStr}`);
            return [];
        }

        // ✅ DYNAMIC: Detect overnight operations (works for ANY times)
        const isOvernightOp = isOvernightOperation(operatingOpenTimeStr, operatingCloseTimeStr);
        
        console.log(`[AvailabilityService] 🕒 Operating hours: ${operatingOpenTimeStr} to ${operatingCloseTimeStr} | Overnight: ${isOvernightOp ? 'YES' : 'NO'}`);

        const slotIntervalMinutes = configOverrides?.slotIntervalMinutes || 30;
        const maxResults = configOverrides?.maxResults || (isOvernightOp ? 80 : 20); // ✅ More slots for overnight
        const requestedTimeStr = configOverrides?.requestedTime;

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

        // ✅ DYNAMIC: Enhanced reservation fetching for overnight operations
        let validReservationsForDate;
        if (isOvernightOp) {
            const currentDateReservations = await storage.getReservations(restaurantId, {
                date: date,
                status: ['created', 'confirmed'],
                timezone: restaurantTimezone
            });
            
            const previousDate = DateTime.fromISO(date, { zone: restaurantTimezone })
                .minus({ days: 1 }).toISODate();
            const previousDateReservations = await storage.getReservations(restaurantId, {
                date: previousDate,
                status: ['created', 'confirmed'],
                timezone: restaurantTimezone
            });
            
            const nestedReservationsForDate = [...currentDateReservations, ...previousDateReservations];
            
            validReservationsForDate = nestedReservationsForDate.filter(r => {
                const reservation = r.reservation || r;
                if (!reservation.reservation_utc) {
                    console.warn(`[AvailabilityService] Reservation ${reservation.id || 'unknown'} missing UTC timestamp, excluding`);
                    return false;
                }
                return validateReservationDate(reservation.reservation_utc, date, restaurantTimezone, isOvernightOp);
            });
            
            console.log(`[AvailabilityService] 🌙 Overnight reservations: ${currentDateReservations.length} current + ${previousDateReservations.length} previous = ${validReservationsForDate.length} valid for ${date}`);
        } else {
            const nestedReservationsForDate = await storage.getReservations(restaurantId, {
                date: date,
                status: ['created', 'confirmed'],
                timezone: restaurantTimezone
            });
            
            validReservationsForDate = nestedReservationsForDate.filter(r => {
                const reservation = r.reservation || r;
                if (!reservation.reservation_utc) {
                    console.warn(`[AvailabilityService] Reservation ${reservation.id || 'unknown'} missing UTC timestamp, excluding`);
                    return false;
                }
                return validateReservationDate(reservation.reservation_utc, date, restaurantTimezone, false);
            });
            
            console.log(`[AvailabilityService] 📅 Standard reservations: ${validReservationsForDate.length} valid for ${date}`);
        }

        // ✅ DYNAMIC: Generate time slots based on operation type
        let potentialTimeSlots: string[];
        
        if (isOvernightOp) {
            potentialTimeSlots = generateOvernightTimeSlots(
                openingTimeMinutes, 
                closingTimeMinutes, 
                slotIntervalMinutes, 
                slotDurationMinutes
            );
            console.log(`[AvailabilityService] 🌙 Generated ${potentialTimeSlots.length} overnight time slots`);
        } else {
            potentialTimeSlots = [];
            const lastBookingTimeMinutes = closingTimeMinutes - slotDurationMinutes;
            
            for (let currentTimeMinutes = openingTimeMinutes; currentTimeMinutes <= lastBookingTimeMinutes; currentTimeMinutes += slotIntervalMinutes) {
                const hours = Math.floor(currentTimeMinutes / 60);
                const minutes = currentTimeMinutes % 60;
                potentialTimeSlots.push(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`);
            }

            console.log(`[AvailabilityService] 📅 Generated ${potentialTimeSlots.length} standard time slots (${operatingOpenTimeStr}-${operatingCloseTimeStr})`);
        }

        // Sort by proximity if requested time is specified
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

            console.log(`[AvailabilityService] 🔍 Checking time slot: ${timeSlot} on ${date} (${restaurantTimezone}) [${isOvernightOp ? 'OVERNIGHT' : 'STANDARD'}]`);

            const singleSuitableTables = bookableTables.filter(table => {
                if (table.minGuests > guests || table.maxGuests < guests) {
                    return false;
                }

                const utcReservationsForTable = validReservationsForDate
                    .filter(r => {
                        const reservation = r.reservation || r;
                        return reservation.tableId === table.id;
                    })
                    .map(r => {
                        const reservation = r.reservation || r;
                        return {
                            reservation_utc: reservation.reservation_utc,
                            duration: reservation.duration,
                            id: reservation.id
                        };
                    });

                const isAvailable = isTableAvailableAtTimeSlot(
                    table.id,
                    timeSlot,
                    utcReservationsForTable,
                    slotDurationMinutes,
                    restaurantTimezone,
                    date,
                    isOvernightOp,
                    openingTimeMinutes, // ✅ DYNAMIC: Pass actual opening time
                    closingTimeMinutes  // ✅ DYNAMIC: Pass actual closing time
                );

                return isAvailable;
            });

            if (singleSuitableTables.length > 0) {
                const bestSingleTable = selectBestSingleTableForGuests(singleSuitableTables, guests);
                if (bestSingleTable) {
                    if (!foundAvailableSlots.some(s => s.tableId === bestSingleTable.id && s.time === timeSlot && !s.isCombined)) {
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

            // Check for table combinations
            if (allowCombinations && foundAvailableSlots.length < maxResults &&
                (singleSuitableTables.length === 0 || !singleSuitableTables.some(t => t.maxGuests >= guests))) {

                const combinedTwoTableSlots = await findCombinableTwoTableSlots(
                    timeSlot,
                    guests,
                    bookableTables,
                    validReservationsForDate,
                    slotDurationMinutes,
                    restaurantTimezone,
                    currentLang,
                    date,
                    isOvernightOp,
                    openingTimeMinutes, // ✅ DYNAMIC: Pass actual opening time
                    closingTimeMinutes  // ✅ DYNAMIC: Pass actual closing time
                );

                for (const combinedSlot of combinedTwoTableSlots) {
                    if (foundAvailableSlots.length >= maxResults) break;
                    if (!foundAvailableSlots.some(s =>
                        s.isCombined &&
                        s.time === combinedSlot.time &&
                        s.constituentTables?.length === combinedSlot.constituentTables?.length &&
                        s.constituentTables?.every(ct => combinedSlot.constituentTables?.some(cct => cct.id === ct.id))
                    )) {
                        foundAvailableSlots.push({ ...combinedSlot, date: date });
                    }
                }
            }
        }

        // Final sort by time
        foundAvailableSlots.sort((a, b) => {
            const timeComparison = a.time.localeCompare(b.time);
            if (timeComparison !== 0) return timeComparison;
            if (a.isCombined !== b.isCombined) return a.isCombined ? 1 : -1;
            if (a.isCombined && b.isCombined) {
                return (a.constituentTables?.length || 0) - (b.constituentTables?.length || 0);
            }
            return (a.tableCapacity.max - guests) - (b.tableCapacity.max - guests);
        });

        console.log(`[AvailabilityService] 🎯 Search complete. Found ${foundAvailableSlots.length} available slots for R${restaurantId}, Date ${date}, Guests ${guests} [${isOvernightOp ? 'OVERNIGHT' : 'STANDARD'}]`);
        
        if (foundAvailableSlots.length > 0) {
            console.log(`[AvailabilityService] 📋 Available slots summary:`);
            foundAvailableSlots.forEach((slot, index) => {
                console.log(`  ${index + 1}. ${slot.tableName} at ${slot.timeDisplay} (${slot.time})`);
            });
        } else {
            console.log(`[AvailabilityService] ❌ No available slots found. Generated ${potentialTimeSlots.length} potential slots, checked against ${validReservationsForDate.length} reservations.`);
        }
        
        return foundAvailableSlots.slice(0, maxResults);

    } catch (error) {
        console.error(`[AvailabilityService] ❌ Critical error in getAvailableTimeSlots for R${restaurantId}:`, error);
        return [];
    }
}
// Export the function for use in routes
export { isTableAvailableAtTimeSlot };
