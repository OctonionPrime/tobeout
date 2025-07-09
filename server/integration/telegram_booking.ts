// server/integration/telegram_booking.ts
// ✅ CRITICAL FIX: Removed circular dependency with booking.tools.ts
// ✅ SOLUTION: Now focuses only on Telegram-specific logic (guest management, name conflicts)
// ✅ RESULT: No longer calls back to booking tools - breaks infinite loop

import { storage } from '../storage';
// ✅ CRITICAL FIX: Removed circular import of booking tools
// OLD (CAUSED INFINITE LOOP): import { create_reservation as coreCreateReservation } from '../services/agents/tools/booking.tools';
// NEW: Only import types and utilities needed for Telegram-specific logic
import type {
    Reservation as SchemaReservation,
    Guest as SchemaGuest,
    InsertGuest,
    Restaurant
} from '@shared/schema';
import type { Language } from '../services/agents/core/agent.types';
import type { AvailabilitySlot as ServiceAvailabilitySlot } from './availability.service';
// ✅ Enhanced: Import timezone utilities for better formatting
import { 
    formatTimeForRestaurant, 
    getRestaurantTimeContext,
    isValidTimezone,
    getRestaurantOperatingStatus,
    isRestaurantOpen,
    isOvernightOperation 
} from '../utils/timezone-utils';

// ✅ SIMPLIFIED: Result type focuses only on Telegram-specific outcomes
export type CreateTelegramReservationResult = {
    success: boolean;
    status: 'guest_ready' | 'name_mismatch_clarification_needed' | 'error' | 'guest_profile_updated';
    guestId?: number; // ✅ NEW: Return guest ID for booking tools to use
    guest?: SchemaGuest; // ✅ NEW: Return guest object
    message: string;
    nameConflict?: {
        guestId: number;
        dbName: string;
        requestName: string;
        phone: string;
        telegramUserId: string;
        date: string;
        time: string;
        guests: number;
        comments?: string;
        lang?: Language;
    };
};

/**
 * ✅ CRITICAL FIX: Prepare Telegram guest for reservation (NO ACTUAL BOOKING)
 * This function now only handles:
 * 1. Guest lookup/creation
 * 2. Name conflict detection/resolution  
 * 3. Telegram-specific logic
 * 
 * It NO LONGER creates reservations - that's handled by booking.tools.ts → booking.ts
 * This breaks the circular dependency completely.
 */
export async function prepareTelegramGuest(
    restaurantId: number,
    name: string,
    phone: string,
    telegramUserId: string,
    lang?: Language,
    confirmedName?: string, // ✅ Handle confirmed name for conflict resolution
    restaurantTimezone: string = 'Europe/Belgrade'
): Promise<CreateTelegramReservationResult> {
    try {
        console.log(`[TelegramBooking] Preparing guest: UserReqName:${name}, TGUser:${telegramUserId}, Lang:${lang}, ConfirmedProfileName:${confirmedName}, Timezone:${restaurantTimezone}`);

        let guest: SchemaGuest | undefined = await storage.getGuestByTelegramId(telegramUserId);
        const effectiveLang: Language = lang || (guest?.language === 'ru' ? 'ru' : 'en');
        const nameForThisSpecificBooking = name;

        const restaurant: Restaurant | undefined = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
            console.error(`[TelegramBooking] Restaurant not found: ${restaurantId}`);
            return { success: false, status: 'error', message: `Restaurant not found.` };
        }

        // ✅ Enhanced: Use restaurant timezone with validation
        const effectiveTimezone = restaurant.timezone || restaurantTimezone;
        
        // ✅ Validate timezone
        if (!isValidTimezone(effectiveTimezone)) {
            console.warn(`[TelegramBooking] Invalid timezone: ${effectiveTimezone}, falling back to Europe/Belgrade`);
        }
        
        console.log(`[TelegramBooking] Using timezone: ${effectiveTimezone}`);

        // ✅ Enhanced: Check restaurant operating status for context
        const operatingStatus = getRestaurantOperatingStatus(
            effectiveTimezone,
            restaurant.opening_time || '10:00',
            restaurant.closing_time || '22:00'
        );
        
        const isOvernight = isOvernightOperation(
            restaurant.opening_time || '10:00',
            restaurant.closing_time || '22:00'
        );

        console.log(`[TelegramBooking] Restaurant operating status: ${operatingStatus.isOpen ? 'OPEN' : 'CLOSED'}, Overnight: ${isOvernight}`);

        if (!guest) {
            guest = await storage.getGuestByPhone(phone);
            if (guest) {
                console.log(`[TelegramBooking] Found guest by phone ${phone}, associating Telegram ID: ${telegramUserId}`);
                const guestUpdateData: Partial<InsertGuest> = { telegram_user_id: telegramUserId };
                if (guest.language !== effectiveLang) guestUpdateData.language = effectiveLang;

                // ✅ CRITICAL FIX: Handle confirmed name properly for phone-found guests
                if (confirmedName && guest.name !== confirmedName) {
                    console.log(`[TelegramBooking] Updating guest (found by phone) profile name from '${guest.name}' to confirmed name '${confirmedName}'.`);
                    guestUpdateData.name = confirmedName;
                } else if (!confirmedName && guest.name !== nameForThisSpecificBooking) {
                    console.log(`[TelegramBooking] Guest (found by phone) DB name '${guest.name}' differs from this booking's name '${nameForThisSpecificBooking}'. Profile name NOT changed without confirmation.`);
                }

                if (Object.keys(guestUpdateData).length > 0) {
                    guest = await storage.updateGuest(guest.id, guestUpdateData);
                }
            } else {
                console.log(`[TelegramBooking] Creating new guest. Profile name: ${nameForThisSpecificBooking}, Phone: ${phone}, TG: ${telegramUserId}`);
                guest = await storage.createGuest({
                    name: nameForThisSpecificBooking,
                    phone,
                    telegram_user_id: telegramUserId,
                    language: effectiveLang,
                });
                console.log(`[TelegramBooking] ✨ New guest ID: ${guest.id} for ${nameForThisSpecificBooking} (lang: ${effectiveLang})`);
            }
        } else {
            // ✅ CRITICAL FIX: Enhanced logic for guests found by Telegram ID
            console.log(`[TelegramBooking] Found guest ID: ${guest.id} (DB Profile: ${guest.name}) by TG ID. This booking name: ${nameForThisSpecificBooking}`);
            const guestProfileUpdates: Partial<InsertGuest> = {};
            let needsProfileUpdate = false;

            if (phone && guest.phone !== phone) {
                guestProfileUpdates.phone = phone;
                needsProfileUpdate = true;
            }
            if (effectiveLang !== guest.language) {
                guestProfileUpdates.language = effectiveLang;
                needsProfileUpdate = true;
            }

            // ✅ CRITICAL FIX: Enhanced name handling logic
            if (confirmedName) {
                // User has explicitly confirmed a name to use
                if (guest.name !== confirmedName) {
                    guestProfileUpdates.name = confirmedName;
                    needsProfileUpdate = true;
                    console.log(`[TelegramBooking] ✅ Updating existing guest profile name from '${guest.name}' to confirmed name: '${confirmedName}'`);
                } else {
                    console.log(`[TelegramBooking] ✅ Confirmed name '${confirmedName}' matches existing profile - proceeding`);
                }
            } else if (guest.name !== nameForThisSpecificBooking) {
                // No confirmed name, but names don't match - request clarification
                console.log(`[TelegramBooking] ⚠️ Name mismatch! DB Profile: '${guest.name}', This booking: '${nameForThisSpecificBooking}'. Clarification needed.`);
                return {
                    success: false,
                    status: 'name_mismatch_clarification_needed',
                    message: 'Guest name mismatch. Clarification needed.',
                    nameConflict: {
                        guestId: guest.id,
                        dbName: guest.name,
                        requestName: nameForThisSpecificBooking,
                        phone,
                        telegramUserId,
                        date: '', // Will be filled in by caller
                        time: '', // Will be filled in by caller
                        guests: 0, // Will be filled in by caller
                        comments: '',
                        lang: effectiveLang,
                    }
                };
            } else {
                console.log(`[TelegramBooking] ✅ Names match - DB: '${guest.name}' = Booking: '${nameForThisSpecificBooking}'`);
            }

            if (needsProfileUpdate) {
                guest = await storage.updateGuest(guest.id, guestProfileUpdates);
                console.log(`[TelegramBooking] ✅ Updated profile for guest ${guest.id}. New DB Profile Name: ${guest.name}`);
            }
        }

        // ✅ SUCCESS: Guest is ready for booking
        console.log(`[TelegramBooking] ✅ Guest prepared successfully: ID ${guest.id}, Name: ${guest.name}`);
        
        return {
            success: true,
            status: 'guest_ready',
            guestId: guest.id,
            guest: guest,
            message: `Guest ${guest.name} (ID: ${guest.id}) is ready for booking`
        };

    } catch (error: unknown) {
        console.error('❌ [TelegramBooking] Unexpected error preparing guest:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error during Telegram guest preparation.';
        return {
            success: false,
            status: 'error',
            message: `Guest preparation failed: ${errorMessage}`,
        };
    }
}

/**
 * ✅ LEGACY COMPATIBILITY: Wrapper that maintains old interface but uses new architecture
 * This allows existing code to work while the new architecture is being adopted
 */
export async function createTelegramReservation(
    restaurantId: number,
    date: string,
    time: string,
    guests: number,
    name: string,
    phone: string,
    telegramUserId: string,
    comments?: string,
    lang?: Language,
    confirmedName?: string,
    selected_slot_info?: ServiceAvailabilitySlot,
    restaurantTimezone: string = 'Europe/Belgrade'
): Promise<CreateTelegramReservationResult> {
    
    console.log(`[TelegramBooking] 🔧 LEGACY WRAPPER: Preparing guest for new architecture`);
    console.log(`[TelegramBooking] ⚠️ NOTE: Actual reservation creation should now be done via booking.tools.ts → booking.ts`);
    
    // Prepare the guest (this is the only thing we do now)
    const guestResult = await prepareTelegramGuest(
        restaurantId,
        name,
        phone,
        telegramUserId,
        lang,
        confirmedName,
        restaurantTimezone
    );
    
    if (!guestResult.success) {
        return guestResult;
    }
    
    // ✅ Return information for the caller to create the reservation
    // The actual reservation creation is now handled by booking.tools.ts → booking.ts
    return {
        success: true,
        status: 'guest_ready',
        guestId: guestResult.guestId,
        guest: guestResult.guest,
        message: `Guest prepared. Use booking.tools.ts to create the actual reservation with guest ID: ${guestResult.guestId}`
    };
}

/**
 * ✅ Enhanced: Generate confirmation message with timezone utilities
 */
export function generateTelegramConfirmationMessage(
    reservation: SchemaReservation,
    guestNameForThisBooking: string,
    tableNameFromSlot?: string,
    restaurantName?: string,
    lang: Language = 'en',
    restaurantTimezone: string = 'Europe/Belgrade'
): string {
    interface ConfirmationStrings {
        header: string;
        guestPrefix: string;
        datePrefix: string;
        timePrefix: string;
        partySizePrefix: (count: number) => string;
        tablePrefix: string;
        specialRequestsPrefix: string;
        footerBase: string;
        footerWithRestaurant: (restaurantName: string) => string;
    }

    const confirmationLocaleStrings: Record<Language, ConfirmationStrings> = {
        en: {
            header: "🎉 Reservation Confirmed!\n\n",
            guestPrefix: "👤 Guest:",
            datePrefix: "📅 Date:",
            timePrefix: "⏰ Time:",
            partySizePrefix: (count) => `👥 Party Size: ${count} ${count === 1 ? 'person' : 'people'}`,
            tablePrefix: "🪑 Table(s):",
            specialRequestsPrefix: "📝 Special Requests:",
            footerBase: "\n✨ We look forward to serving you!",
            footerWithRestaurant: (restaurantName) => `\n✨ We look forward to serving you at ${restaurantName}!`,
        },
        ru: {
            header: "🎉 Бронирование подтверждено!\n\n",
            guestPrefix: "👤 Гость:",
            datePrefix: "📅 Дата:",
            timePrefix: "⏰ Время:",
            partySizePrefix: (count) => {
                let peopleStr = "человек";
                if (count % 10 === 1 && count % 100 !== 11) peopleStr = "человек";
                else if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) peopleStr = "человека";
                else peopleStr = "человек";
                return `👥 Количество гостей: ${count} ${peopleStr}`;
            },
            tablePrefix: "🪑 Стол(ик/и):",
            specialRequestsPrefix: "📝 Особые пожелания:",
            footerBase: "\n✨ С нетерпением ждем вас!",
            footerWithRestaurant: (restaurantName) => `\n✨ С нетерпением ждем вас в ${restaurantName}!`,
        },
        sr: {
            header: "🎉 Rezervacija potvrđena!\n\n",
            guestPrefix: "👤 Gost:",
            datePrefix: "📅 Datum:",
            timePrefix: "⏰ Vreme:",
            partySizePrefix: (count) => {
                let peopleStr = "osoba";
                if (count === 1) peopleStr = "osoba";
                else if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20)) peopleStr = "osobe";
                else peopleStr = "osoba";
                return `👥 Broj gostiju: ${count} ${peopleStr}`;
            },
            tablePrefix: "🪑 Sto(lovi):",
            specialRequestsPrefix: "📝 Posebni zahtevi:",
            footerBase: "\n✨ Radujemo se što ćemo vas služiti!",
            footerWithRestaurant: (restaurantName) => `\n✨ Radujemo se što ćemo vas služiti u ${restaurantName}!`,
        },
        hu: {
            header: "🎉 Foglalás megerősítve!\n\n",
            guestPrefix: "👤 Vendég:",
            datePrefix: "📅 Dátum:",
            timePrefix: "⏰ Idő:",
            partySizePrefix: (count) => `👥 Létszám: ${count} ${count === 1 ? 'fő' : 'fő'}`,
            tablePrefix: "🪑 Asztal(ok):",
            specialRequestsPrefix: "📝 Különleges kérések:",
            footerBase: "\n✨ Várjuk Önt vendégségre!",
            footerWithRestaurant: (restaurantName) => `\n✨ Várjuk Önt a ${restaurantName}-ban!`,
        },
        de: {
            header: "🎉 Reservierung bestätigt!\n\n",
            guestPrefix: "👤 Gast:",
            datePrefix: "📅 Datum:",
            timePrefix: "⏰ Zeit:",
            partySizePrefix: (count) => `👥 Personenanzahl: ${count} ${count === 1 ? 'Person' : 'Personen'}`,
            tablePrefix: "🪑 Tisch(e):",
            specialRequestsPrefix: "📝 Besondere Wünsche:",
            footerBase: "\n✨ Wir freuen uns darauf, Sie zu bedienen!",
            footerWithRestaurant: (restaurantName) => `\n✨ Wir freuen uns darauf, Sie im ${restaurantName} zu bedienen!`,
        },
        fr: {
            header: "🎉 Réservation confirmée!\n\n",
            guestPrefix: "👤 Invité:",
            datePrefix: "📅 Date:",
            timePrefix: "⏰ Heure:",
            partySizePrefix: (count) => `👥 Nombre de personnes: ${count} ${count === 1 ? 'personne' : 'personnes'}`,
            tablePrefix: "🪑 Table(s):",
            specialRequestsPrefix: "📝 Demandes spéciales:",
            footerBase: "\n✨ Nous avons hâte de vous servir!",
            footerWithRestaurant: (restaurantName) => `\n✨ Nous avons hâte de vous servir au ${restaurantName}!`,
        },
        es: {
            header: "🎉 ¡Reserva confirmada!\n\n",
            guestPrefix: "👤 Huésped:",
            datePrefix: "📅 Fecha:",
            timePrefix: "⏰ Hora:",
            partySizePrefix: (count) => `👥 Número de personas: ${count} ${count === 1 ? 'persona' : 'personas'}`,
            tablePrefix: "🪑 Mesa(s):",
            specialRequestsPrefix: "📝 Solicitudes especiales:",
            footerBase: "\n✨ ¡Esperamos servirle!",
            footerWithRestaurant: (restaurantName) => `\n✨ ¡Esperamos servirle en ${restaurantName}!`,
        },
        it: {
            header: "🎉 Prenotazione confermata!\n\n",
            guestPrefix: "👤 Ospite:",
            datePrefix: "📅 Data:",
            timePrefix: "⏰ Ora:",
            partySizePrefix: (count) => `👥 Numero di persone: ${count} ${count === 1 ? 'persona' : 'persone'}`,
            tablePrefix: "🪑 Tavolo(i):",
            specialRequestsPrefix: "📝 Richieste speciali:",
            footerBase: "\n✨ Non vediamo l'ora di servirvi!",
            footerWithRestaurant: (restaurantName) => `\n✨ Non vediamo l'ora di servirvi al ${restaurantName}!`,
        },
        pt: {
            header: "🎉 Reserva confirmada!\n\n",
            guestPrefix: "👤 Hóspede:",
            datePrefix: "📅 Data:",
            timePrefix: "⏰ Hora:",
            partySizePrefix: (count) => `👥 Número de pessoas: ${count} ${count === 1 ? 'pessoa' : 'pessoas'}`,
            tablePrefix: "🪑 Mesa(s):",
            specialRequestsPrefix: "📝 Solicitações especiais:",
            footerBase: "\n✨ Estamos ansiosos para servi-lo!",
            footerWithRestaurant: (restaurantName) => `\n✨ Estamos ansiosos para servi-lo no ${restaurantName}!`,
        },
        nl: {
            header: "🎉 Reservering bevestigd!\n\n",
            guestPrefix: "👤 Gast:",
            datePrefix: "📅 Datum:",
            timePrefix: "⏰ Tijd:",
            partySizePrefix: (count) => `👥 Aantal personen: ${count} ${count === 1 ? 'persoon' : 'personen'}`,
            tablePrefix: "🪑 Tafel(s):",
            specialRequestsPrefix: "📝 Speciale verzoeken:",
            footerBase: "\n✨ We kijken ernaar uit u te bedienen!",
            footerWithRestaurant: (restaurantName) => `\n✨ We kijken ernaar uit u te bedienen in ${restaurantName}!`,
        },
        auto: {
            header: "🎉 Reservation Confirmed!\n\n",
            guestPrefix: "👤 Guest:",
            datePrefix: "📅 Date:",
            timePrefix: "⏰ Time:",
            partySizePrefix: (count) => `👥 Party Size: ${count} ${count === 1 ? 'person' : 'people'}`,
            tablePrefix: "🪑 Table(s):",
            specialRequestsPrefix: "📝 Special Requests:",
            footerBase: "\n✨ We look forward to serving you!",
            footerWithRestaurant: (restaurantName) => `\n✨ We look forward to serving you at ${restaurantName}!`,
        }
    };
    const locale = confirmationLocaleStrings[lang] || confirmationLocaleStrings.en;

    // ✅ Use timezone utilities for time formatting
    const timeFormatted = formatTimeForRestaurant(reservation.time, restaurantTimezone, lang, false);

    // ✅ Use timezone utilities for date formatting
    const dateFormatted = formatTimeForRestaurant(
        reservation.date + 'T00:00:00', 
        restaurantTimezone, 
        lang, 
        false,
        'date-long'
    );

    let message = locale.header;
    message += `${locale.guestPrefix} ${guestNameForThisBooking}\n`;
    message += `${locale.datePrefix} ${dateFormatted}\n`;
    message += `${locale.timePrefix} ${timeFormatted}\n`;
    message += `${locale.partySizePrefix(reservation.guests)}\n`;

    if (tableNameFromSlot) {
        message += `${locale.tablePrefix} ${tableNameFromSlot}\n`;
    }

    if (reservation.comments && !reservation.comments.startsWith("Combined booking:") && !reservation.comments.startsWith("Part of combined booking")) {
        message += `${locale.specialRequestsPrefix} ${reservation.comments}\n`;
    } else if (reservation.comments?.includes(" (Combined with:")) {
        const originalComment = reservation.comments.substring(0, reservation.comments.indexOf(" (Combined with:"));
        if (originalComment.trim()) {
            message += `${locale.specialRequestsPrefix} ${originalComment.trim()}\n`;
        }
    }

    if (restaurantName) {
        message += locale.footerWithRestaurant(restaurantName);
    } else {
        message += locale.footerBase;
    }

    return message;
}

/**
 * ✅ Enhanced: Use timezone utilities instead of manual time formatting
 */
export function formatTimeForTelegram(time24: string, lang: Language = 'en', timezone: string = 'Europe/Belgrade'): string {
    try {
        // ✅ Use timezone utilities for consistent formatting
        return formatTimeForRestaurant(time24, timezone, lang, false);
    } catch (error) {
        console.warn('[TelegramBooking] Error formatting time with timezone utilities, falling back:', error);
        
        // ✅ FALLBACK: Keep original logic as backup
        const [hoursStr, minutesStr] = time24.split(':');
        const hours = parseInt(hoursStr, 10);
        const minutes = parseInt(minutesStr, 10);

        if (isNaN(hours) || isNaN(minutes)) return time24;
        const formattedMinutes = minutes.toString().padStart(2, '0');

        if (lang === 'ru' || lang === 'sr') return `${hours.toString().padStart(2, '0')}:${formattedMinutes}`;

        const period = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
        return `${displayHours}:${formattedMinutes} ${period}`;
    }
}