// server/services/booking.ts
// ✅ CRITICAL SECURITY FIX: All functions now receive authenticated tenant ID
// ❌ NEVER trust client-provided restaurantId - always use server-validated tenant ID
// 🔧 BUG-20250725-001 FIX: Correctly pass authenticatedTenantId to storage.getGuest to fix tenant isolation bug.

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
import type { Language } from './enhanced-conversation-manager';
import { isValidTimezone, formatTimeForRestaurant } from '../utils/timezone-utils';
import { DateTime } from 'luxon';

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
    unauthorizedAccess: string;
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
        unauthorizedAccess: 'You are not authorized to access this resource.',
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
        unauthorizedAccess: 'У вас нет прав доступа к этому ресурсу.',
    }
    // Add other languages as needed
};

// Logger utility
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

// ✅ CRITICAL SECURITY FIX: Removed restaurantId from interface (server provides it)
export interface BookingRequest {
    // ❌ REMOVED: restaurantId - now provided by server from authenticated context
    guestId: number;

    // ✅ NEW: Support both legacy and UTC timestamp approaches
    date?: string;           // Legacy: YYYY-MM-DD
    time?: string;           // Legacy: HH:MM:SS
    timezone?: string;       // Legacy: timezone for conversion
    reservation_utc?: string; // NEW: Direct UTC timestamp (ISO string)

    guests: number;
    comments?: string;
    source?: string;
    lang?: Language;
    booking_guest_name?: string | null;
    selected_slot_info?: ServiceAvailabilitySlot;
    tableId?: number;
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

// Detect transaction conflict types from errors
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

// ✅ CRITICAL SECURITY FIX: Function now receives authenticated tenant ID
export async function createReservation(
    authenticatedTenantId: number, // ✅ From middleware - NEVER trust client
    bookingRequest: BookingRequest
): Promise<BookingResponse> {
    const locale = getLocale(bookingRequest.lang);

    // ✅ SECURITY: Use authenticated tenant ID instead of client data
    const restaurantId = authenticatedTenantId;

    // ✅ CRITICAL FIX: Updated validation to handle both formats
    if (!restaurantId || !bookingRequest.guestId || !bookingRequest.guests) {
        return {
            success: false,
            message: locale.failedToCreateReservation('Missing required fields: guestId or guests')
        };
    }

    // ✅ CRITICAL FIX: Validate we have either UTC timestamp OR date/time/timezone
    const hasUtcTimestamp = Boolean(bookingRequest.reservation_utc);
    const hasLegacyFields = Boolean(bookingRequest.date && bookingRequest.time && bookingRequest.timezone);

    if (!hasUtcTimestamp && !hasLegacyFields) {
        return {
            success: false,
            message: locale.failedToCreateReservation('Must provide either reservation_utc timestamp OR date/time/timezone combination')
        };
    }

    try {
        const { guests, guestId, comments, source, booking_guest_name, selected_slot_info, tableId } = bookingRequest;

        logger.info(`Create reservation request: R${restaurantId}, G:${guests}, GuestID:${guestId}, BookingName: ${booking_guest_name}, HasUTC: ${hasUtcTimestamp}, HasLegacy: ${hasLegacyFields}`);

        // ✅ SECURITY: Validate restaurant exists and belongs to authenticated tenant
        const restaurant: Restaurant | undefined = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
            logger.error(`Restaurant ID ${restaurantId} not found or unauthorized access.`);
            return { success: false, message: locale.restaurantNotFound(restaurantId) };
        }

        const restaurantTimezone = restaurant.timezone || 'Europe/Moscow';
        logger.info(`Using restaurant timezone: ${restaurantTimezone}`);

        // 🔧 BUG-20250725-001 FIX: Pass the authenticatedTenantId to storage.getGuest to ensure tenant isolation.
        const guestInfo: Guest | undefined = await storage.getGuest(guestId, authenticatedTenantId);
        if (!guestInfo || guestInfo.restaurantId !== restaurantId) {
            logger.error(`Guest ID ${guestId} not found or doesn't belong to restaurant ${restaurantId}.`);
            return { success: false, message: locale.guestNotFound(guestId) };
        }

        // ✅ CRITICAL FIX: Handle both UTC timestamp and legacy date/time conversion
        let absoluteUtcTime: string;
        let displayDate: string;
        let displayTime: string;

        if (hasUtcTimestamp) {
            // ✅ NEW: Direct UTC timestamp provided (from updated routes.ts)
            absoluteUtcTime = bookingRequest.reservation_utc!;

            // Convert UTC back to restaurant local time for display
            const localDateTime = DateTime.fromISO(absoluteUtcTime, { zone: 'utc' }).setZone(restaurantTimezone);
            displayDate = localDateTime.toISODate() || '';
            displayTime = localDateTime.toFormat('HH:mm:ss');

            logger.info(`✅ Using provided UTC timestamp: ${absoluteUtcTime} -> Local: ${displayDate} ${displayTime} (${restaurantTimezone})`);

        } else {
            // ✅ LEGACY: Convert date/time/timezone to UTC (for backward compatibility)
            const { date, time, timezone } = bookingRequest;
            absoluteUtcTime = DateTime.fromISO(`${date}T${time}`, { zone: timezone }).toUTC().toISO()!;
            displayDate = date!;
            displayTime = time!;

            if (!absoluteUtcTime) {
                logger.error(`Invalid date/time/zone combination: ${date}, ${time}, ${timezone}`);
                return { success: false, message: "Invalid date, time, or timezone provided." };
            }

            logger.info(`✅ Converted legacy ${date}T${time} (${timezone}) to UTC: ${absoluteUtcTime}`);
        }

        if (selected_slot_info) {
            logger.info(`Using pre-selected slot: TableID ${selected_slot_info.tableId}, Name ${selected_slot_info.tableName}, Combined: ${selected_slot_info.isCombined}`);
        }

        const nameForConfirmationMessage = booking_guest_name || guestInfo.name;
        const slotDurationMinutes = restaurant.avgReservationDuration || 120;

        let selectedSlot: ServiceAvailabilitySlot | undefined = selected_slot_info;

        // ✅ SECURITY FIX: Handle manual table selection with tenant validation
        if (!selectedSlot && tableId) {
            logger.info(`Manual table selection detected: TableID ${tableId}`);

            // ✅ SECURITY: Validate the manually selected table belongs to this restaurant
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

            selectedSlot = {
                date: displayDate,
                tableId: selectedTable.id,
                tableName: selectedTable.name,
                time: displayTime,
                timeDisplay: formatTimeForRestaurant(displayTime, restaurantTimezone, bookingRequest.lang || 'en'),
                isCombined: false,
                tableCapacity: { min: selectedTable.minGuests, max: selectedTable.maxGuests }
            };

            logger.info(`✅ Created slot object for manual selection: TableID ${selectedSlot.tableId}, Name ${selectedSlot.tableName}`);
        }

        // Find available slot if not pre-selected and no manual table selected
        if (!selectedSlot) {
            logger.info(`No pre-selected slot. Calling getAvailableTimeSlots with timezone ${restaurantTimezone}...`);

            const availableSlots: ServiceAvailabilitySlot[] = await getAvailableTimeSlots(
                restaurantId, displayDate, guests,
                {
                    requestedTime: displayTime,
                    exactTimeOnly: true,
                    maxResults: 1,
                    slotDurationMinutes: slotDurationMinutes,
                    lang: bookingRequest.lang || 'en',
                    allowCombinations: true,
                    timezone: restaurantTimezone
                }
            );

            if (!availableSlots || availableSlots.length === 0) {
                const displayTimeFormatted = formatTimeForRestaurant(displayTime, restaurantTimezone, bookingRequest.lang || 'en');
                logger.info(`No slots found by getAvailableTimeSlots for R${restaurantId}, D:${displayDate}, T:${displayTime}, G:${guests}, TZ:${restaurantTimezone}.`);
                return { success: false, message: locale.noTablesAvailable(guests, displayDate, displayTimeFormatted) };
            }

            selectedSlot = availableSlots[0];
            logger.info(`Slot found by getAvailableTimeSlots: TableID ${selectedSlot.tableId}, Name ${selectedSlot.tableName}, Combined: ${selectedSlot.isCombined}`);
        }

        if (!selectedSlot) {
            const displayTimeFormatted = formatTimeForRestaurant(displayTime, restaurantTimezone, bookingRequest.lang || 'en');
            return { success: false, message: locale.noTablesAvailable(guests, displayDate, displayTimeFormatted) };
        }

        const allCreatedReservationIds: number[] = [];
        let primaryReservation: SchemaReservation | undefined;

        // ✅ FIXED: Handle single table booking with UTC timestamp
        if (!selectedSlot.isCombined || !selectedSlot.constituentTables || selectedSlot.constituentTables.length === 0) {
            logger.info(`Proceeding with atomic single table booking for table ID: ${selectedSlot.tableId}`);

            const reservationData: InsertReservation = {
                restaurantId, // ✅ Uses authenticated tenant ID
                guestId,
                tableId: selectedSlot.tableId,
                reservation_utc: absoluteUtcTime, // ✅ Always use UTC timestamp
                duration: slotDurationMinutes,
                guests,
                status: 'confirmed',
                comments: comments || '',
                source: source || 'direct',
                booking_guest_name: booking_guest_name,
            };

            try {
                // ✅ FALLBACK: If createReservationAtomic doesn't exist, use regular createReservation
                let createReservationMethod = storage.createReservationAtomic || storage.createReservation;

                if (storage.createReservationAtomic) {
                    primaryReservation = await storage.createReservationAtomic(reservationData, {
                        tableId: selectedSlot.tableId,
                        time: selectedSlot.time,
                        duration: slotDurationMinutes
                    });
                } else {
                    logger.warn('createReservationAtomic not available, using standard createReservation');
                    primaryReservation = await storage.createReservation(reservationData);
                }

                allCreatedReservationIds.push(primaryReservation.id);
                logger.info(`✅ Single Reservation ID ${primaryReservation.id} created for Table ${selectedSlot.tableName} with UTC timestamp.`);

                const tableDetails = await storage.getTable(selectedSlot.tableId) as Table;

                return {
                    success: true,
                    reservation: primaryReservation,
                    message: locale.reservationConfirmed(guests, selectedSlot.tableName, displayDate, formatTimeForRestaurant(displayTime, restaurantTimezone, bookingRequest.lang || 'en'), nameForConfirmationMessage),
                    table: { id: tableDetails.id, name: tableDetails.name, isCombined: false },
                    allReservationIds: allCreatedReservationIds,
                };

            } catch (error: any) {
                const conflictType = detectConflictType(error);
                logger.error(`Failed to create single reservation: ${conflictType}`, error);

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
            // ✅ FIXED: Handle combined table booking with UTC timestamp
            logger.info(`Proceeding with combined table booking using: ${selectedSlot.tableName}`);
            const primaryTableInfo = selectedSlot.constituentTables[0];

            try {
                const primaryReservationData: InsertReservation = {
                    restaurantId, // ✅ Uses authenticated tenant ID
                    guestId,
                    tableId: primaryTableInfo.id,
                    reservation_utc: absoluteUtcTime, // ✅ Always use UTC timestamp
                    duration: slotDurationMinutes,
                    guests,
                    status: 'confirmed',
                    comments: comments ? `${comments} (Combined with: ${selectedSlot.constituentTables.slice(1).map(t => t.name).join(', ')})` : `Combined booking: ${selectedSlot.tableName}`,
                    source: source || 'direct',
                    booking_guest_name: booking_guest_name,
                };

                // Create primary reservation
                if (storage.createReservationAtomic) {
                    primaryReservation = await storage.createReservationAtomic(primaryReservationData, {
                        tableId: primaryTableInfo.id,
                        time: selectedSlot.time,
                        duration: slotDurationMinutes
                    });
                } else {
                    logger.warn('createReservationAtomic not available, using standard createReservation');
                    primaryReservation = await storage.createReservation(primaryReservationData);
                }

                allCreatedReservationIds.push(primaryReservation.id);
                logger.info(`✅ Primary Reservation ID ${primaryReservation.id} for combined booking (Table ${primaryTableInfo.name}) created.`);

                // Create linked reservations
                const createdReservations: SchemaReservation[] = [primaryReservation];

                for (let i = 1; i < selectedSlot.constituentTables.length; i++) {
                    const linkedTableInfo = selectedSlot.constituentTables[i];
                    const linkedReservationData: InsertReservation = {
                        restaurantId, // ✅ Uses authenticated tenant ID
                        guestId,
                        tableId: linkedTableInfo.id,
                        reservation_utc: absoluteUtcTime, // ✅ Always use UTC timestamp
                        duration: slotDurationMinutes,
                        guests: 0, // Linked tables don't count guests
                        status: 'confirmed',
                        comments: `Part of combined booking for ${nameForConfirmationMessage} (Primary Res ID: ${primaryReservation.id}, Primary Table: ${primaryTableInfo.name})`,
                        source: source || 'direct',
                        booking_guest_name: booking_guest_name,
                    };

                    try {
                        let linkedRes: SchemaReservation;
                        if (storage.createReservationAtomic) {
                            linkedRes = await storage.createReservationAtomic(linkedReservationData, {
                                tableId: linkedTableInfo.id,
                                time: selectedSlot.time,
                                duration: slotDurationMinutes
                            });
                        } else {
                            linkedRes = await storage.createReservation(linkedReservationData);
                        }

                        allCreatedReservationIds.push(linkedRes.id);
                        createdReservations.push(linkedRes);
                        logger.info(`✅ Linked Reservation ID ${linkedRes.id} for combined booking (Table ${linkedTableInfo.name}) created.`);

                    } catch (linkedError: any) {
                        const conflictType = detectConflictType(linkedError);
                        logger.error(`Error creating linked reservation for table ${linkedTableInfo.name}, rolling back...`, linkedError);

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
                            allReservationIds: [],
                            conflictType
                        };
                    }
                }

                return {
                    success: true,
                    reservation: primaryReservation,
                    message: locale.reservationConfirmedCombined(guests, selectedSlot.tableName, displayDate, formatTimeForRestaurant(displayTime, restaurantTimezone, bookingRequest.lang || 'en'), nameForConfirmationMessage),
                    table: {
                        id: 0,
                        name: selectedSlot.tableName,
                        isCombined: true,
                        constituentTables: selectedSlot.constituentTables.map(t => ({ id: t.id, name: t.name })),
                    },
                    allReservationIds: allCreatedReservationIds,
                };

            } catch (error: any) {
                const conflictType = detectConflictType(error);
                logger.error(`Failed to create combined reservation: ${conflictType}`, error);

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

// ✅ CRITICAL SECURITY FIX: Ensure user can only cancel their own restaurant's reservations
export async function cancelReservation(
    authenticatedTenantId: number, // ✅ From middleware
    reservationId: number,
    lang?: Language
): Promise<{
    success: boolean;
    message: string;
}> {
    const locale = getLocale(lang);

    if (!reservationId || isNaN(reservationId)) {
        return { success: false, message: locale.reservationNotFound(reservationId) };
    }

    try {
        logger.info(`Attempting to cancel reservation ID ${reservationId} for tenant ${authenticatedTenantId}`);

        const reservationResult = await storage.getReservation(reservationId);

        if (!reservationResult) {
            return { success: false, message: locale.reservationNotFound(reservationId) };
        }

        const reservation: SchemaReservation = reservationResult.reservation;

        // ✅ CRITICAL SECURITY FIX: Verify reservation belongs to authenticated tenant
        if (reservation.restaurantId !== authenticatedTenantId) {
            logger.error(`Unauthorized cancellation attempt: Reservation ${reservationId} belongs to restaurant ${reservation.restaurantId}, but user is authenticated for ${authenticatedTenantId}`);
            return { success: false, message: locale.unauthorizedAccess };
        }

        if (reservation.status === 'canceled') {
            return { success: false, message: locale.reservationAlreadyCancelled(reservationId) };
        }

        // Get restaurant for timezone context
        const restaurant = await storage.getRestaurant(reservation.restaurantId);
        const restaurantTimezone = restaurant?.timezone || 'Europe/Moscow';

        const isCombinedPrimary = reservation.comments?.startsWith('Combined booking:');
        const isLinkedPart = reservation.comments?.startsWith('Part of combined booking');

        // Update reservation status
        await storage.updateReservation(reservationId, { status: 'canceled' });

        // Handle combined bookings
        if (isCombinedPrimary) {
            logger.info(`Cancelled primary part of a combined booking (Res ID: ${reservationId}). Checking for linked reservations...`);

            try {
                const allReservations = await storage.getReservations(reservation.restaurantId, {
                    status: ['confirmed'],
                    timezone: restaurantTimezone
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

// ✅ CRITICAL SECURITY FIX: Updated wrapper functions to receive authenticated tenant ID
export async function findAvailableTables(
    authenticatedTenantId: number, // ✅ From middleware
    date: string,
    time: string,
    guests: number,
    lang: Language = 'en'
): Promise<ServiceAvailabilitySlot[]> {
    try {
        logger.info(`findAvailableTables (secure wrapper) called: R${authenticatedTenantId}, D:${date}, T:${time}, G:${guests}, Lang:${lang}`);

        // ✅ SECURITY: Verify restaurant exists and belongs to authenticated tenant
        const restaurant = await storage.getRestaurant(authenticatedTenantId);
        if (!restaurant) {
            logger.error(`Restaurant ${authenticatedTenantId} not found or unauthorized`);
            return [];
        }

        const restaurantTimezone = restaurant.timezone || 'Europe/Moscow';

        return await getAvailableTimeSlots(authenticatedTenantId, date, guests, {
            requestedTime: time,
            maxResults: 10,
            lang: lang,
            allowCombinations: true,
            timezone: restaurantTimezone
        });
    } catch (error) {
        logger.error('Error in findAvailableTables (secure wrapper):', error);
        return [];
    }
}

export async function findAlternativeSlots(
    authenticatedTenantId: number, // ✅ From middleware
    date: string,
    time: string,
    guests: number,
    lang: Language = 'en'
): Promise<ServiceAvailabilitySlot[]> {
    try {
        logger.info(`findAlternativeSlots (secure wrapper) called: R${authenticatedTenantId}, D:${date}, T:${time}, G:${guests}, Lang:${lang}`);

        // ✅ SECURITY: Verify restaurant exists and belongs to authenticated tenant
        const restaurant = await storage.getRestaurant(authenticatedTenantId);
        if (!restaurant) {
            logger.error(`Restaurant ${authenticatedTenantId} not found or unauthorized`);
            return [];
        }

        const restaurantTimezone = restaurant.timezone || 'Europe/Moscow';

        return await getAvailableTimeSlots(authenticatedTenantId, date, guests, {
            requestedTime: time,
            maxResults: 5,
            lang: lang,
            allowCombinations: true,
            timezone: restaurantTimezone
        });
    } catch (error) {
        logger.error('Error in findAlternativeSlots (secure wrapper):', error);
        return [];
    }
}
