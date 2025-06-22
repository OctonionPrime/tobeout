// server/services/booking.ts

import { storage } from '../storage';
import {
    getAvailableTimeSlots,
    type AvailabilitySlot as ServiceAvailabilitySlot,
} from './availability.service';

import type {
    Restaurant,
    Reservation as SchemaReservation,
    InsertReservation,
    Guest,
    Table
} from '@shared/schema';
import type { Language } from './conversation-manager';
import { isValidTimezone, formatTimeForRestaurant } from '../utils/timezone-utils';

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
    tableNoLongerAvailable: string;
    transactionConflict: string;
    deadlockDetected: string;
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
        tableNoLongerAvailable: 'This table was just booked by another customer. Please select a different time or table.',
        transactionConflict: 'Booking conflict detected. Please try again with a different time.',
        deadlockDetected: 'System busy - please try your booking again in a moment.',
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
        tableNoLongerAvailable: 'Этот столик только что был забронирован другим клиентом. Пожалуйста, выберите другое время или столик.',
        transactionConflict: 'Обнаружен конфликт бронирования. Пожалуйста, попробуйте еще раз с другим временем.',
        deadlockDetected: 'Система занята - пожалуйста, повторите бронирование через мгновение.',
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
    tableId?: number; // ✅ NEW: Add optional tableId for manual table selection
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
    conflictType?: 'AVAILABILITY' | 'TRANSACTION' | 'DEADLOCK';
}

// Helper function to safely get locale with fallback
function getLocale(lang?: Language): BookingServiceStrings {
    const validLang = lang && (lang === 'en' || lang === 'ru') ? lang : 'en';
    return bookingLocaleStrings[validLang] || bookingLocaleStrings['en'];
}

// ✅ NEW: Detect transaction conflict types from errors
function detectConflictType(error: any): 'AVAILABILITY' | 'TRANSACTION' | 'DEADLOCK' {
    const errorMessage = error?.message?.toLowerCase() || '';
    const errorCode = error?.code || '';
    
    // PostgreSQL deadlock error code
    if (errorCode === '40P01') {
        return 'DEADLOCK';
    }
    
    // Our custom conflict messages
    if (errorMessage.includes('no longer available') || 
        errorMessage.includes('conflict detected')) {
        return 'AVAILABILITY';
    }
    
    // Transaction-related errors
    if (errorMessage.includes('transaction') || 
        errorMessage.includes('serialization') ||
        errorCode.startsWith('40')) {
        return 'TRANSACTION';
    }
    
    return 'AVAILABILITY'; // Default fallback
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
        const { restaurantId, date, time, guests, guestId, comments, source, booking_guest_name, selected_slot_info, tableId } = bookingRequest;

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

        // ✅ CRITICAL FIX: Extract restaurant timezone for all subsequent operations
        const restaurantTimezone = restaurant.timezone || 'Europe/Moscow';
        logger.info(`Using restaurant timezone: ${restaurantTimezone}`);

        // Fetch guest with error handling
        const guestInfo: Guest | undefined = await storage.getGuest(guestId);
        if (!guestInfo) {
            logger.error(`Guest ID ${guestId} not found.`);
            return { success: false, message: locale.guestNotFound(guestId) };
        }

        const nameForConfirmationMessage = booking_guest_name || guestInfo.name;
        const slotDurationMinutes = restaurant.avgReservationDuration || 120;

        let selectedSlot: ServiceAvailabilitySlot | undefined = selected_slot_info;

        // ✅ COMPREHENSIVE FIX: Handle manual table selection from frontend
        if (!selectedSlot && tableId) {
            logger.info(`Manual table selection detected: TableID ${tableId}`);
            
            // Validate the manually selected table
            const selectedTable = await storage.getTable(tableId);
            if (!selectedTable || selectedTable.restaurantId !== restaurantId) {
                logger.error(`Selected table ${tableId} not found or doesn't belong to restaurant ${restaurantId}`);
                return {
                    success: false,
                    message: locale.failedToCreateReservation('Selected table not found or invalid')
                };
            }
            
            // Check if manually selected table can accommodate guests
            if (guests < selectedTable.minGuests || guests > selectedTable.maxGuests) {
                logger.error(`Table ${tableId} capacity (${selectedTable.minGuests}-${selectedTable.maxGuests}) cannot accommodate ${guests} guests`);
                return {
                    success: false,
                    message: locale.failedToCreateReservation(
                        `Selected table "${selectedTable.name}" can only accommodate ${selectedTable.minGuests}-${selectedTable.maxGuests} guests, but you requested ${guests} guests`
                    )
                };
            }
            
            // ✅ FIXED: Use formatTimeForRestaurant with restaurant timezone
            selectedSlot = {
                date: date,
                tableId: selectedTable.id,
                tableName: selectedTable.name,
                time: time,
                timeDisplay: formatTimeForRestaurant(time, restaurantTimezone, bookingRequest.lang || 'en'),
                isCombined: false,
                tableCapacity: { min: selectedTable.minGuests, max: selectedTable.maxGuests }
            };
            
            logger.info(`✅ Created slot object for manual selection: TableID ${selectedSlot.tableId}, Name ${selectedSlot.tableName}`);
        }

        // Find available slot if not pre-selected and no manual table selected
        if (!selectedSlot) {
            logger.info(`No pre-selected slot. Calling getAvailableTimeSlots with timezone ${restaurantTimezone}...`);
            
            // ✅ CRITICAL FIX: Pass restaurant timezone to availability service
            const availableSlots: ServiceAvailabilitySlot[] = await getAvailableTimeSlots(
                restaurantId, date, guests,
                {
                    requestedTime: time,
                    maxResults: 1,
                    slotDurationMinutes: slotDurationMinutes,
                    lang: bookingRequest.lang || 'en',
                    allowCombinations: true,
                    timezone: restaurantTimezone  // ← CRITICAL FIX
                }
            );

            if (!availableSlots || availableSlots.length === 0) {
                // ✅ FIXED: Use formatTimeForRestaurant with restaurant timezone
                const displayTime = formatTimeForRestaurant(time, restaurantTimezone, bookingRequest.lang || 'en');
                logger.info(`No slots found by getAvailableTimeSlots for R${restaurantId}, D:${date}, T:${time}, G:${guests}, TZ:${restaurantTimezone}.`);
                return { success: false, message: locale.noTablesAvailable(guests, date, displayTime) };
            }

            selectedSlot = availableSlots[0];
            logger.info(`Slot found by getAvailableTimeSlots: TableID ${selectedSlot.tableId}, Name ${selectedSlot.tableName}, Combined: ${selectedSlot.isCombined}`);
        }

        if (!selectedSlot) {
            // ✅ FIXED: Use formatTimeForRestaurant with restaurant timezone
            const displayTime = formatTimeForRestaurant(time, restaurantTimezone, bookingRequest.lang || 'en');
            return { success: false, message: locale.noTablesAvailable(guests, date, displayTime) };
        }

        const allCreatedReservationIds: number[] = [];
        let primaryReservation: SchemaReservation | undefined;

        // ✅ NEW: Handle single table booking with atomic transaction
        if (!selectedSlot.isCombined || !selectedSlot.constituentTables || selectedSlot.constituentTables.length === 0) {
            logger.info(`Proceeding with atomic single table booking for table ID: ${selectedSlot.tableId}`);

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
                // ✅ NEW: Atomic reservation creation with built-in conflict detection
                primaryReservation = await storage.createReservationAtomic(reservationData, {
                    tableId: selectedSlot.tableId,
                    time: selectedSlot.time,
                    duration: slotDurationMinutes
                });
                
                allCreatedReservationIds.push(primaryReservation.id);
                logger.info(`✅ Atomic Single Reservation ID ${primaryReservation.id} created for Table ${selectedSlot.tableName} (timezone: ${restaurantTimezone}).`);

                const tableDetails = await storage.getTable(selectedSlot.tableId) as Table;

                return {
                    success: true,
                    reservation: primaryReservation,
                    message: locale.reservationConfirmed(guests, selectedSlot.tableName, date, selectedSlot.timeDisplay, nameForConfirmationMessage),
                    table: { id: tableDetails.id, name: tableDetails.name, isCombined: false },
                    allReservationIds: allCreatedReservationIds,
                };

            } catch (error: any) {
                const conflictType = detectConflictType(error);
                logger.error(`Failed to create atomic single reservation: ${conflictType}`, error);
                
                let errorMessage: string;
                switch (conflictType) {
                    case 'DEADLOCK':
                        errorMessage = locale.deadlockDetected;
                        break;
                    case 'AVAILABILITY':
                        errorMessage = locale.tableNoLongerAvailable;
                        break;
                    case 'TRANSACTION':
                        errorMessage = locale.transactionConflict;
                        break;
                    default:
                        errorMessage = locale.failedToCreateReservation(error.message);
                }
                
                return {
                    success: false,
                    message: errorMessage,
                    conflictType
                };
            }

        } else {
            // ✅ NEW: Handle combined table booking with atomic transaction for each table
            logger.info(`Proceeding with atomic combined table booking using: ${selectedSlot.tableName}`);
            const primaryTableInfo = selectedSlot.constituentTables[0];

            try {
                // Create primary reservation atomically
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

                // ✅ NEW: Atomic primary reservation creation
                primaryReservation = await storage.createReservationAtomic(primaryReservationData, {
                    tableId: primaryTableInfo.id,
                    time: selectedSlot.time,
                    duration: slotDurationMinutes
                });
                
                allCreatedReservationIds.push(primaryReservation.id);
                logger.info(`✅ Atomic Primary Reservation ID ${primaryReservation.id} for combined booking (Table ${primaryTableInfo.name}) created.`);

                // Create linked reservations atomically
                const createdReservations: SchemaReservation[] = [primaryReservation];
                
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
                        // ✅ NEW: Atomic linked reservation creation
                        const linkedRes = await storage.createReservationAtomic(linkedReservationData, {
                            tableId: linkedTableInfo.id,
                            time: selectedSlot.time,
                            duration: slotDurationMinutes
                        });
                        
                        allCreatedReservationIds.push(linkedRes.id);
                        createdReservations.push(linkedRes);
                        logger.info(`✅ Atomic Linked Reservation ID ${linkedRes.id} for combined booking (Table ${linkedTableInfo.name}) created.`);
                        
                    } catch (linkedError: any) {
                        const conflictType = detectConflictType(linkedError);
                        logger.error(`Error creating atomic linked reservation for table ${linkedTableInfo.name}, rolling back...`, linkedError);

                        // ROLLBACK: Cancel all created reservations on failure
                        for (const createdRes of createdReservations) {
                            try {
                                await storage.updateReservation(createdRes.id, { status: 'canceled' });
                                logger.info(`Rolled back reservation ID ${createdRes.id}`);
                            } catch (rollbackError) {
                                logger.error(`Failed to rollback reservation ID ${createdRes.id}`, rollbackError);
                            }
                        }

                        let errorMessage: string;
                        switch (conflictType) {
                            case 'DEADLOCK':
                                errorMessage = locale.deadlockDetected;
                                break;
                            case 'AVAILABILITY':
                                errorMessage = locale.errorCreatingLinkedReservation(linkedTableInfo.name);
                                break;
                            case 'TRANSACTION':
                                errorMessage = locale.transactionConflict;
                                break;
                            default:
                                errorMessage = locale.errorCreatingLinkedReservation(linkedTableInfo.name);
                        }

                        return {
                            success: false,
                            reservation: primaryReservation,
                            message: errorMessage,
                            table: {
                                id: primaryTableInfo.id,
                                name: primaryTableInfo.name,
                                isCombined: false,
                            },
                            allReservationIds: [], // Return empty array since we rolled back
                            conflictType
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

            } catch (error: any) {
                const conflictType = detectConflictType(error);
                logger.error(`Failed to create atomic combined reservation: ${conflictType}`, error);

                // Attempt to rollback any created reservations
                for (const resId of allCreatedReservationIds) {
                    try {
                        await storage.updateReservation(resId, { status: 'canceled' });
                        logger.info(`Rolled back reservation ID ${resId}`);
                    } catch (rollbackError) {
                        logger.error(`Failed to rollback reservation ID ${resId}`, rollbackError);
                    }
                }

                let errorMessage: string;
                switch (conflictType) {
                    case 'DEADLOCK':
                        errorMessage = locale.deadlockDetected;
                        break;
                    case 'AVAILABILITY':
                        errorMessage = locale.tableNoLongerAvailable;
                        break;
                    case 'TRANSACTION':
                        errorMessage = locale.transactionConflict;
                        break;
                    default:
                        errorMessage = locale.failedToCreateReservation(error.message);
                }

                return {
                    success: false,
                    message: errorMessage,
                    conflictType
                };
            }
        }

    } catch (error: unknown) {
        logger.error('Error during createReservation:', error);
        const errorMessage = error instanceof Error ? error.message : locale.unknownErrorCreating;
        return { 
            success: false, 
            message: locale.failedToCreateReservation(errorMessage),
            conflictType: 'TRANSACTION'
        };
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

        // ✅ CRITICAL FIX: Get restaurant for timezone context
        const restaurant = await storage.getRestaurant(reservation.restaurantId);
        const restaurantTimezone = restaurant?.timezone || 'Europe/Moscow';

        const isCombinedPrimary = reservation.comments?.startsWith('Combined booking:');
        const isLinkedPart = reservation.comments?.startsWith('Part of combined booking');

        // Update reservation status
        await storage.updateReservation(reservationId, { status: 'canceled' });

        // Handle combined bookings
        if (isCombinedPrimary) {
            logger.info(`Cancelled primary part of a combined booking (Res ID: ${reservationId}). Checking for linked reservations...`);

            // Find and cancel linked reservations
            try {
                // ✅ CRITICAL FIX: Pass restaurant timezone when getting reservations
                const allReservations = await storage.getReservations(reservation.restaurantId, {
                    date: reservation.date,
                    status: ['confirmed'],
                    timezone: restaurantTimezone  // ← CRITICAL FIX
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

        logger.info(`✅ Reservation ID ${reservationId} cancelled successfully (timezone: ${restaurantTimezone}).`);
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

// ✅ CRITICAL FIX: Updated wrapper functions with timezone support
export async function findAvailableTables(
    restaurantId: number,
    date: string,
    time: string,
    guests: number,
    lang: Language = 'en'
): Promise<ServiceAvailabilitySlot[]> {
    try {
        logger.info(`findAvailableTables (new wrapper) called: R${restaurantId}, D:${date}, T:${time}, G:${guests}, Lang:${lang}`);
        
        // ✅ CRITICAL FIX: Get restaurant for timezone context
        const restaurant = await storage.getRestaurant(restaurantId);
        const restaurantTimezone = restaurant?.timezone || 'Europe/Moscow';
        
        return await getAvailableTimeSlots(restaurantId, date, guests, {
            requestedTime: time,
            maxResults: 10,
            lang: lang,
            allowCombinations: true,
            timezone: restaurantTimezone  // ← CRITICAL FIX
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
        
        // ✅ CRITICAL FIX: Get restaurant for timezone context
        const restaurant = await storage.getRestaurant(restaurantId);
        const restaurantTimezone = restaurant?.timezone || 'Europe/Moscow';
        
        return await getAvailableTimeSlots(restaurantId, date, guests, {
            requestedTime: time,
            maxResults: 5,
            lang: lang,
            allowCombinations: true,
            timezone: restaurantTimezone  // ← CRITICAL FIX
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