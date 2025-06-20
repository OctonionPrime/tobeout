// server/services/booking.ts

import { storage } from '../storage';
import {
    getAvailableTimeSlots,
    type AvailabilitySlot as ServiceAvailabilitySlot,
    formatTimeForDisplay as formatTimeFromAvailabilityService,
} from './availability.service';

import type {
    Restaurant,
    Reservation as SchemaReservation,
    InsertReservation,
    Guest,
    Table
} from '@shared/schema';
import type { Language } from './conversation-manager';

// --- Localized strings for booking.ts ---
interface BookingServiceStrings {
    restaurantNotFound: (restaurantId: number | string) => string;
    noTablesAvailable: (guests: number, date: string, time: string) => string;
    reservationConfirmed: (guests: number, tableName: string, date: string, timeDisplay: string, guestName: string) => string;
    reservationConfirmedCombined: (guests: number, combinedTableName: string, date: string, timeDisplay: string, guestName: string) => string;
    failedToCreateReservation: (errorMsg: string) => string;
    reservationNotFound: (reservationId: number | string) => string;
    reservationAlreadyCancelled: (reservationId: number | string) => string;
    reservationCancelledSuccessfully: string;
    failedToCancelReservation: (errorMsg: string) => string;
    unknownErrorCreating: string;
    unknownErrorCancelling: string;
    guestNotFound: (guestId: number) => string;
    errorCreatingLinkedReservation: (tableName: string) => string;
    timeSlotConflict: (time: string, conflicts: string) => string;
}

const bookingLocaleStrings: Record<Language, BookingServiceStrings> = {
    en: {
        restaurantNotFound: (restaurantId) => `Restaurant with ID ${restaurantId} not found.`,
        noTablesAvailable: (guests, date, time) => `Sorry, no tables are available for ${guests} guests on ${date} at ${time}. Please try a different time or date.`,
        reservationConfirmed: (guests, tableName, date, timeDisplay, guestName) => `Reservation confirmed for ${guestName} (${guests} guests) at Table ${tableName} on ${date} at ${timeDisplay}.`,
        reservationConfirmedCombined: (guests, combinedTableName, date, timeDisplay, guestName) => `Reservation confirmed for ${guestName} (${guests} guests) using ${combinedTableName} on ${date} at ${timeDisplay}.`,
        failedToCreateReservation: (errorMsg) => `Failed to create reservation: ${errorMsg}`,
        reservationNotFound: (reservationId) => `Reservation ID ${reservationId} not found.`,
        reservationAlreadyCancelled: (reservationId) => `Reservation ID ${reservationId} is already canceled.`,
        reservationCancelledSuccessfully: 'Reservation cancelled successfully.',
        failedToCancelReservation: (errorMsg) => `Failed to cancel reservation: ${errorMsg}`,
        unknownErrorCreating: 'An unknown error occurred while creating the reservation.',
        unknownErrorCancelling: 'Unknown error while cancelling reservation.',
        guestNotFound: (guestId) => `Guest with ID ${guestId} not found. Cannot determine booking name.`,
        errorCreatingLinkedReservation: (tableName: string) => `There was an issue securing all parts of the combined table booking (specifically table ${tableName}). Please contact the restaurant.`,
        timeSlotConflict: (time, conflicts) => `Time slot ${time} is not available. ${conflicts}`,
    },
    ru: {
        restaurantNotFound: (restaurantId) => `Ресторан с ID ${restaurantId} не найден.`,
        noTablesAvailable: (guests, date, time) => `К сожалению, нет доступных столиков для ${guests} гостей на ${date} в ${time}. Пожалуйста, попробуйте другое время или дату.`,
        reservationConfirmed: (guests, tableName, date, timeDisplay, guestName) => `Бронирование подтверждено для ${guestName} (${guests} гостей) за столиком ${tableName} на ${date} в ${timeDisplay}.`,
        reservationConfirmedCombined: (guests, combinedTableName, date, timeDisplay, guestName) => `Бронирование подтверждено для ${guestName} (${guests} гостей) с использованием ${combinedTableName} на ${date} в ${timeDisplay}.`,
        failedToCreateReservation: (errorMsg) => `Не удалось создать бронирование: ${errorMsg}`,
        reservationNotFound: (reservationId) => `Бронирование с ID ${reservationId} не найдено.`,
        reservationAlreadyCancelled: (reservationId) => `Бронирование с ID ${reservationId} уже отменено.`,
        reservationCancelledSuccessfully: 'Бронирование успешно отменено.',
        failedToCancelReservation: (errorMsg) => `Не удалось отменить бронирование: ${errorMsg}`,
        unknownErrorCreating: 'Произошла неизвестная ошибка при создании бронирования.',
        unknownErrorCancelling: 'Произошла неизвестная ошибка при отмене бронирования.',
        guestNotFound: (guestId) => `Гость с ID ${guestId} не найден. Невозможно определить имя для бронирования.`,
        errorCreatingLinkedReservation: (tableName: string) => `Возникла проблема с обеспечением всех частей комбинированного бронирования (в частности, столика ${tableName}). Пожалуйста, свяжитесь с рестораном.`,
        timeSlotConflict: (time, conflicts) => `Время ${time} недоступно. ${conflicts}`,
    }
};

// Logger utility - replace console.log with proper logging
const logger = {
    info: (message: string, data?: any) => {
        console.log(`[BookingService] ${message}`, data || '');
    },
    error: (message: string, error?: any) => {
        console.error(`[BookingService] ❌ ${message}`, error || '');
    },
    warn: (message: string, data?: any) => {
        console.warn(`[BookingService] ⚠️ ${message}`, data || '');
    }
};

export interface BookingRequest {
    restaurantId: number;
    guestId: number;
    date: string;
    time: string;
    guests: number;
    comments?: string;
    source?: string;
    lang?: Language;
    booking_guest_name?: string | null;
    selected_slot_info?: ServiceAvailabilitySlot;
}

export interface BookingResponse {
    success: boolean;
    reservation?: SchemaReservation;
    message: string;
    table?: {
        id: number;
        name: string;
        isCombined: boolean;
        constituentTables?: Array<{ id: number; name: string }>;
    };
    allReservationIds?: number[];
}

// Helper function to safely get locale with fallback
function getLocale(lang?: Language): BookingServiceStrings {
    const validLang = lang && (lang === 'en' || lang === 'ru') ? lang : 'en';
    return bookingLocaleStrings[validLang] || bookingLocaleStrings['en'];
}

// ✅ FIXED: Validates specific table/time combination instead of just "any table"
async function validateSpecificSlot(
    slot: ServiceAvailabilitySlot,
    restaurantId: number,
    date: string,
    duration: number = 120
): Promise<{ isAvailable: boolean; conflicts: any[] }> {
    logger.info(`🔍 Validating specific slot: Table ${slot.tableName} (ID: ${slot.tableId}) at ${slot.time} for ${duration}min`);
    
    try {
        // Get all active reservations for the date and specific table
        const existingReservations = await storage.getReservations(restaurantId, {
            date: date,
            status: ['created', 'confirmed']
        });
        
        // Filter to only reservations for this specific table
        const tableReservations = existingReservations.filter(r => {
            const reservation = r.reservation || r;
            return reservation.tableId === slot.tableId;
        });
        
        // Parse requested time
        const [requestHour, requestMin] = slot.time.split(':').map(Number);
        const requestStartMinutes = requestHour * 60 + requestMin;
        const requestEndMinutes = requestStartMinutes + duration;
        
        const conflicts: any[] = [];
        
        // Check for conflicts with existing reservations on this table
        for (const existingRes of tableReservations) {
            const reservation = existingRes.reservation || existingRes;
            const [existingHour, existingMin] = reservation.time.split(':').map(Number);
            const existingStartMinutes = existingHour * 60 + existingMin;
            const existingDuration = reservation.duration || 120;
            const existingEndMinutes = existingStartMinutes + existingDuration;
            
            // Check for overlap: A_start < B_end AND A_end > B_start
            const overlaps = requestStartMinutes < existingEndMinutes && requestEndMinutes > existingStartMinutes;
            
            if (overlaps) {
                const guestName = existingRes.guestName || reservation.booking_guest_name || 'Guest';
                const endHour = Math.floor(existingEndMinutes / 60);
                const endMin = existingEndMinutes % 60;
                
                conflicts.push({
                    tableId: slot.tableId,
                    tableName: slot.tableName,
                    existingReservation: {
                        id: reservation.id,
                        time: reservation.time,
                        endTime: `${endHour.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')}`,
                        duration: existingDuration,
                        guestName: guestName,
                        status: reservation.status
                    }
                });
                
                logger.error(`❌ CONFLICT: Table ${slot.tableName} occupied by ${guestName} from ${reservation.time} to ${endHour}:${endMin.toString().padStart(2, '0')}`);
                return { isAvailable: false, conflicts };
            }
        }
        
        logger.info(`✅ Table ${slot.tableName} is available for ${slot.time}-${Math.floor(requestEndMinutes/60)}:${(requestEndMinutes%60).toString().padStart(2,'0')}`);
        return { isAvailable: true, conflicts: [] };
        
    } catch (error) {
        logger.error(`Error validating slot:`, error);
        return { isAvailable: false, conflicts: [`Validation error: ${error}`] };
    }
}

export async function createReservation(bookingRequest: BookingRequest): Promise<BookingResponse> {
    // FIX: Always ensure we have a valid locale with fallback
    const locale = getLocale(bookingRequest.lang);

    // Validate required fields early
    if (!bookingRequest.restaurantId || !bookingRequest.guestId || !bookingRequest.date ||
        !bookingRequest.time || !bookingRequest.guests) {
        return {
            success: false,
            message: locale.failedToCreateReservation('Missing required fields')
        };
    }

    try {
        const { restaurantId, date, time, guests, guestId, comments, source, booking_guest_name, selected_slot_info } = bookingRequest;

        logger.info(`Create reservation request: R${restaurantId}, D:${date}, T:${time}, G:${guests}, GuestID:${guestId}, BookingName: ${booking_guest_name}, Lang:${bookingRequest.lang}`);

        if (selected_slot_info) {
            logger.info(`Using pre-selected slot: TableID ${selected_slot_info.tableId}, Name ${selected_slot_info.tableName}, Combined: ${selected_slot_info.isCombined}`);
        }

        // Fetch restaurant with error handling
        const restaurant: Restaurant | undefined = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
            logger.error(`Restaurant ID ${restaurantId} not found.`);
            return { success: false, message: locale.restaurantNotFound(restaurantId) };
        }

        // Fetch guest with error handling
        const guestInfo: Guest | undefined = await storage.getGuest(guestId);
        if (!guestInfo) {
            logger.error(`Guest ID ${guestId} not found.`);
            return { success: false, message: locale.guestNotFound(guestId) };
        }

        const nameForConfirmationMessage = booking_guest_name || guestInfo.name;
        const slotDurationMinutes = restaurant.avgReservationDuration || 120;

        let selectedSlot: ServiceAvailabilitySlot | undefined = selected_slot_info;

        // ✅ FIXED: Find available slot first, then validate the SPECIFIC slot that will be used
        if (!selectedSlot) {
            logger.info(`No pre-selected slot. Calling getAvailableTimeSlots...`);
            const availableSlots: ServiceAvailabilitySlot[] = await getAvailableTimeSlots(
                restaurantId, date, guests,
                {
                    requestedTime: time,
                    maxResults: 1,
                    slotDurationMinutes: slotDurationMinutes,
                    lang: bookingRequest.lang || 'en',
                    allowCombinations: true
                }
            );

            // 🐛 [DEBUG] Log what getAvailableTimeSlots returned
            console.log(`🐛 [DEBUG] getAvailableTimeSlots returned:`, availableSlots);

            if (!availableSlots || availableSlots.length === 0) {
                const displayTime = formatTimeFromAvailabilityService(time, bookingRequest.lang || 'en');
                logger.info(`No slots found by getAvailableTimeSlots for R${restaurantId}, D:${date}, T:${time}, G:${guests}.`);
                return { success: false, message: locale.noTablesAvailable(guests, date, displayTime) };
            }

            selectedSlot = availableSlots[0];
            logger.info(`Slot found by getAvailableTimeSlots: TableID ${selectedSlot.tableId}, Name ${selectedSlot.tableName}, Combined: ${selectedSlot.isCombined}`);
        }

        if (!selectedSlot) {
            const displayTime = formatTimeFromAvailabilityService(time, bookingRequest.lang || 'en');
            return { success: false, message: locale.noTablesAvailable(guests, date, displayTime) };
        }

        // ✅ FIXED: Now validate the SPECIFIC slot that will actually be booked
        logger.info(`🔍 Validating the specific slot that will be booked...`);
        const validation = await validateSpecificSlot(selectedSlot, restaurantId, date, slotDurationMinutes);
        
        if (!validation.isAvailable) {
            const displayTime = formatTimeFromAvailabilityService(selectedSlot.time, bookingRequest.lang || 'en');
            logger.error(`❌ BOOKING REJECTED: Conflicts found for selected slot:`, validation.conflicts);
            
            // Return detailed conflict information
            const conflictMessages = validation.conflicts.map(conflict => {
                if (typeof conflict === 'string') return conflict;
                return `Table ${conflict.tableName} occupied by ${conflict.existingReservation?.guestName} (${conflict.existingReservation?.time}-${conflict.existingReservation?.endTime})`;
            });
            
            return { 
                success: false, 
                message: locale.timeSlotConflict(displayTime, conflictMessages.join(', '))
            };
        }
        logger.info(`✅ Specific slot validation passed. Proceeding with booking...`);

        const allCreatedReservationIds: number[] = [];
        let primaryReservation: SchemaReservation | undefined;
        let createdReservations: SchemaReservation[] = [];

        // Handle single table booking
        if (!selectedSlot.isCombined || !selectedSlot.constituentTables || selectedSlot.constituentTables.length === 0) {
            logger.info(`Proceeding with single table booking for table ID: ${selectedSlot.tableId}`);

            const reservationData: InsertReservation = {
                restaurantId,
                guestId,
                tableId: selectedSlot.tableId,
                date,
                time: selectedSlot.time,
                duration: slotDurationMinutes,
                guests,
                status: 'confirmed',
                comments: comments || '',
                source: source || 'direct',
                booking_guest_name: booking_guest_name,
            };

            try {
                primaryReservation = await storage.createReservation(reservationData);
                allCreatedReservationIds.push(primaryReservation.id);
                logger.info(`✅ Single Reservation ID ${primaryReservation.id} created for Table ${selectedSlot.tableName}.`);

                const tableDetails = await storage.getTable(selectedSlot.tableId) as Table;

                return {
                    success: true,
                    reservation: primaryReservation,
                    message: locale.reservationConfirmed(guests, selectedSlot.tableName, date, selectedSlot.timeDisplay, nameForConfirmationMessage),
                    table: { id: tableDetails.id, name: tableDetails.name, isCombined: false },
                    allReservationIds: allCreatedReservationIds,
                };
            } catch (error) {
                logger.error('Failed to create single reservation', error);
                throw error;
            }

        } else {
            // Handle combined table booking with transaction-like approach
            logger.info(`Proceeding with combined table booking using: ${selectedSlot.tableName}`);
            const primaryTableInfo = selectedSlot.constituentTables[0];

            try {
                // Create primary reservation
                const primaryReservationData: InsertReservation = {
                    restaurantId,
                    guestId,
                    tableId: primaryTableInfo.id,
                    date,
                    time: selectedSlot.time,
                    duration: slotDurationMinutes,
                    guests,
                    status: 'confirmed',
                    comments: comments ? `${comments} (Combined with: ${selectedSlot.constituentTables.slice(1).map(t => t.name).join(', ')})` : `Combined booking: ${selectedSlot.tableName}`,
                    source: source || 'direct',
                    booking_guest_name: booking_guest_name,
                };

                primaryReservation = await storage.createReservation(primaryReservationData);
                allCreatedReservationIds.push(primaryReservation.id);
                createdReservations.push(primaryReservation);
                logger.info(`✅ Primary Reservation ID ${primaryReservation.id} for combined booking (Table ${primaryTableInfo.name}) created.`);

                // Create linked reservations
                for (let i = 1; i < selectedSlot.constituentTables.length; i++) {
                    const linkedTableInfo = selectedSlot.constituentTables[i];
                    const linkedReservationData: InsertReservation = {
                        restaurantId,
                        guestId,
                        tableId: linkedTableInfo.id,
                        date,
                        time: selectedSlot.time,
                        duration: slotDurationMinutes,
                        guests: 0, // Linked tables don't count guests
                        status: 'confirmed',
                        comments: `Part of combined booking for ${nameForConfirmationMessage} (Primary Res ID: ${primaryReservation.id}, Primary Table: ${primaryTableInfo.name})`,
                        source: source || 'direct',
                        booking_guest_name: booking_guest_name,
                    };

                    try {
                        const linkedRes = await storage.createReservation(linkedReservationData);
                        allCreatedReservationIds.push(linkedRes.id);
                        createdReservations.push(linkedRes);
                        logger.info(`✅ Linked Reservation ID ${linkedRes.id} for combined booking (Table ${linkedTableInfo.name}) created.`);
                    } catch (linkedError: any) {
                        // ROLLBACK: Cancel all created reservations on failure
                        logger.error(`Error creating linked reservation for table ${linkedTableInfo.name}, rolling back...`, linkedError);

                        for (const createdRes of createdReservations) {
                            try {
                                await storage.updateReservation(createdRes.id, { status: 'canceled' });
                                logger.info(`Rolled back reservation ID ${createdRes.id}`);
                            } catch (rollbackError) {
                                logger.error(`Failed to rollback reservation ID ${createdRes.id}`, rollbackError);
                            }
                        }

                        return {
                            success: false,
                            reservation: primaryReservation,
                            message: locale.errorCreatingLinkedReservation(linkedTableInfo.name),
                            table: {
                                id: primaryTableInfo.id,
                                name: primaryTableInfo.name,
                                isCombined: false,
                            },
                            allReservationIds: [], // Return empty array since we rolled back
                        };
                    }
                }

                return {
                    success: true,
                    reservation: primaryReservation,
                    message: locale.reservationConfirmedCombined(guests, selectedSlot.tableName, date, selectedSlot.timeDisplay, nameForConfirmationMessage),
                    table: {
                        id: 0, // Combined tables don't have a single ID
                        name: selectedSlot.tableName,
                        isCombined: true,
                        constituentTables: selectedSlot.constituentTables.map(t => ({ id: t.id, name: t.name })),
                    },
                    allReservationIds: allCreatedReservationIds,
                };
            } catch (error) {
                logger.error('Failed to create combined reservation', error);

                // Attempt to rollback any created reservations
                for (const resId of allCreatedReservationIds) {
                    try {
                        await storage.updateReservation(resId, { status: 'canceled' });
                        logger.info(`Rolled back reservation ID ${resId}`);
                    } catch (rollbackError) {
                        logger.error(`Failed to rollback reservation ID ${resId}`, rollbackError);
                    }
                }

                throw error;
            }
        }

    } catch (error: unknown) {
        logger.error('Error during createReservation:', error);
        const errorMessage = error instanceof Error ? error.message : locale.unknownErrorCreating;
        return { success: false, message: locale.failedToCreateReservation(errorMessage) };
    }
}

export async function cancelReservation(reservationId: number, lang?: Language): Promise<{
    success: boolean;
    message: string;
}> {
    // FIX: Always ensure we have a valid locale with fallback
    const locale = getLocale(lang);

    // Validate reservation ID
    if (!reservationId || isNaN(reservationId)) {
        return { success: false, message: locale.reservationNotFound(reservationId) };
    }

    try {
        logger.info(`Attempting to cancel reservation ID ${reservationId}`);

        const reservationResult = await storage.getReservation(reservationId);

        if (!reservationResult) {
            return { success: false, message: locale.reservationNotFound(reservationId) };
        }

        const reservation: SchemaReservation = reservationResult.reservation;

        if (reservation.status === 'canceled') {
            return { success: false, message: locale.reservationAlreadyCancelled(reservationId) };
        }

        const isCombinedPrimary = reservation.comments?.startsWith('Combined booking:');
        const isLinkedPart = reservation.comments?.startsWith('Part of combined booking');

        // Update reservation status
        await storage.updateReservation(reservationId, { status: 'canceled' });

        // Handle combined bookings
        if (isCombinedPrimary) {
            logger.info(`Cancelled primary part of a combined booking (Res ID: ${reservationId}). Checking for linked reservations...`);

            // Find and cancel linked reservations
            try {
                const allReservations = await storage.getReservations(reservation.restaurantId, {
                    date: reservation.date,
                    status: ['confirmed']
                });

                const linkedReservations = allReservations.filter(r =>
                    r.reservation.comments?.includes(`Primary Res ID: ${reservationId}`)
                );

                for (const linked of linkedReservations) {
                    await storage.updateReservation(linked.reservation.id, { status: 'canceled' });
                    logger.info(`Cancelled linked reservation ID ${linked.reservation.id}`);
                }
            } catch (linkedError) {
                logger.error('Error cancelling linked reservations', linkedError);
                // Continue anyway - primary is already cancelled
            }
        }

        if (isLinkedPart) {
            logger.info(`Cancelled a linked part of a combined booking (Res ID: ${reservationId}).`);
        }

        logger.info(`✅ Reservation ID ${reservationId} cancelled successfully.`);
        return { success: true, message: locale.reservationCancelledSuccessfully };

    } catch (error: unknown) {
        logger.error(`Error cancelling reservation ID ${reservationId}:`, error);
        const errorMessage = error instanceof Error ? error.message : locale.unknownErrorCancelling;
        return { success: false, message: locale.failedToCancelReservation(errorMessage) };
    }
}

// Legacy functions for timeslot-based availability (can be deprecated if not used)
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
    logger.warn("getDateAvailabilityFromTimeslots is using legacy timeslot logic.");
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

    return {
        totalDefinedSlots: timeslotsForDate.length,
        availableDefinedSlots: timeslotsForDate.filter(s => s.status === 'free').length,
        occupiedDefinedSlots: timeslotsForDate.filter(s => s.status === 'occupied' || s.status === 'pending').length,
        timeSlotsSummary,
    };
}

export async function findAvailableTables(
    restaurantId: number,
    date: string,
    time: string,
    guests: number,
    lang: Language = 'en'
): Promise<ServiceAvailabilitySlot[]> {
    try {
        logger.info(`findAvailableTables (new wrapper) called: R${restaurantId}, D:${date}, T:${time}, G:${guests}, Lang:${lang}`);
        return await getAvailableTimeSlots(restaurantId, date, guests, {
            requestedTime: time,
            maxResults: 10,
            lang: lang,
            allowCombinations: true
        });
    } catch (error) {
        logger.error('Error in findAvailableTables (new wrapper):', error);
        return [];
    }
}

export async function findAlternativeSlots(
    restaurantId: number,
    date: string,
    time: string,
    guests: number,
    lang: Language = 'en'
): Promise<ServiceAvailabilitySlot[]> {
    try {
        logger.info(`findAlternativeSlots (new wrapper) called: R${restaurantId}, D:${date}, T:${time}, G:${guests}, Lang:${lang}`);
        return await getAvailableTimeSlots(restaurantId, date, guests, {
            requestedTime: time,
            maxResults: 5,
            lang: lang,
            allowCombinations: true
        });
    } catch (error) {
        logger.error('Error in findAlternativeSlots (new wrapper):', error);
        return [];
    }
}

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
    logger.warn("getDateAvailability is using legacy timeslot logic and may not be accurate with combined bookings.");
    const result = await getDateAvailabilityFromTimeslots(restaurantId, date);
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
}