//
// storage.ts (Complete Timezone-Aware Version with UTC Timestamps + Legacy Timeslot System Removed)
// ✅ PHASE 3: All legacy timeslot code completely removed
// ✅ MAYA FIX: Added excludeReservationId parameter to prevent reservation conflicts during modifications
//

import {
    users, restaurants, tables, guests, reservations,
    integrationSettings, aiActivities,
    type User, type InsertUser,
    type Restaurant, type InsertRestaurant,
    type Table, type InsertTable,
    type Guest, type InsertGuest,
    type Reservation, type InsertReservation,
    type AiActivity, type InsertAiActivity,
    type IntegrationSetting, type InsertIntegrationSetting
} from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lte, desc, sql, count, or, inArray, gt, ne, notExists } from "drizzle-orm";
import { DateTime } from 'luxon'; 
// ✅ PROPER FIX: Use centralized timezone utilities for consistency across the application
// This ensures all timezone handling follows the same logic and supports all 600+ timezones
import { getRestaurantDateTime, getRestaurantDateString } from './utils/timezone-utils';

// ✅ TYPE SAFETY FIX: Define valid reservation statuses
type ReservationStatus = 'confirmed' | 'created' | 'canceled' | 'completed' | 'archived';

export interface IStorage {
    // User methods
    getUser(id: number): Promise<User | undefined>;
    getUserByEmail(email: string): Promise<User | undefined>;
    createUser(user: InsertUser): Promise<User>;

    // Restaurant methods
    getRestaurant(id: number): Promise<Restaurant | undefined>;
    getRestaurantByUserId(userId: number): Promise<Restaurant | undefined>;
    createRestaurant(restaurant: InsertRestaurant): Promise<Restaurant>;
    updateRestaurant(id: number, restaurant: Partial<InsertRestaurant>): Promise<Restaurant>;

    // Table methods
    getTables(restaurantId: number): Promise<Table[]>;
    getTable(id: number): Promise<Table | undefined>;
    createTable(table: InsertTable): Promise<Table>;
    updateTable(id: number, table: Partial<InsertTable>): Promise<Table>;
    deleteTable(id: number): Promise<void>;

    // Guest methods
    getGuests(restaurantId: number): Promise<Guest[]>;
    getGuest(id: number): Promise<Guest | undefined>;
    getGuestByPhone(phone: string): Promise<Guest | undefined>;
    getGuestByTelegramId(telegramUserId: string): Promise<Guest | undefined>;
    createGuest(guest: InsertGuest): Promise<Guest>;
    updateGuest(id: number, guest: Partial<InsertGuest>): Promise<Guest>;

    // Reservation methods - ✅ MAYA FIX: Updated interface
    getReservations(restaurantId: number, filters?: {
        date?: string;
        status?: string[];
        upcoming?: boolean;
        timezone?: string;
        excludeReservationId?: number; // 🆕 NEW: Exclude specific reservation from results
    }): Promise<any[]>;
    getReservation(id: number): Promise<any | undefined>;
    createReservation(reservation: InsertReservation): Promise<Reservation>;
    createReservationAtomic(
        reservation: InsertReservation,
        expectedSlot: { tableId: number; time: string; duration: number }
    ): Promise<Reservation>;
    updateReservation(id: number, reservation: Partial<InsertReservation>): Promise<Reservation>;
    getUpcomingReservations(restaurantId: number, restaurantTimezone: string, hours: number): Promise<any[]>;
    getReservationStatistics(restaurantId: number, restaurantTimezone: string): Promise<{
        todayReservations: number;
        confirmedReservations: number;
        pendingReservations: number;
        totalGuests: number;
    }>;

    // Integration settings methods
    getIntegrationSettings(restaurantId: number, type: string): Promise<IntegrationSetting | undefined>;
    saveIntegrationSettings(settings: InsertIntegrationSetting): Promise<IntegrationSetting>;

    // AI activities methods
    getAiActivities(restaurantId: number, limit?: number): Promise<AiActivity[]>;
    logAiActivity(activity: InsertAiActivity): Promise<AiActivity>;

    // Real-time table availability methods
    updateTableStatusFromReservations(tableId: number, restaurantTimezone: string): Promise<void>;
    updateAllTableStatuses(restaurantId: number, restaurantTimezone: string): Promise<void>;
    getTableAvailability(restaurantId: number, date: string, time: string, excludeReservationId?: number): Promise<Table[]>; // 🆕 MAYA FIX
}

export class DatabaseStorage implements IStorage {
    // ✅ RESTORED: Use centralized timezone utilities instead of duplicating code
    
    private parseTimeToMinutes(timeStr: string): number {
        if (!timeStr) {
            throw new Error(`Invalid time string: ${timeStr}`);
        }

        const parts = timeStr.split(':');
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10) || 0;

        if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            throw new Error(`Invalid time format: ${timeStr}. Expected HH:MM or HH:MM:SS`);
        }

        return hours * 60 + minutes;
    }

    // ✅ SIMPLIFIED: Basic timestamp parsing (comprehensive timezone handling is in timezone-utils.ts)
    private parsePostgresTimestamp(timestamp: string): DateTime {
        try {
            // Handle both ISO and PostgreSQL timestamp formats
            return DateTime.fromISO(timestamp, { zone: 'utc' });
        } catch (error) {
            console.error(`[Storage] Failed to parse timestamp: ${timestamp}`, error);
            return DateTime.now().toUTC(); // Fallback to current time
        }
    }

    // User methods (unchanged)
    async getUser(id: number): Promise<User | undefined> {
        const [user] = await db.select().from(users).where(eq(users.id, id));
        return user;
    }

    async getUserByEmail(email: string): Promise<User | undefined> {
        const [user] = await db.select().from(users).where(eq(users.email, email));
        return user;
    }

    async createUser(user: InsertUser): Promise<User> {
        const [newUser] = await db.insert(users).values(user).returning();
        return newUser;
    }

    // Restaurant methods (unchanged)
    async getRestaurant(id: number): Promise<Restaurant | undefined> {
        const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.id, id));
        return restaurant;
    }

    async getRestaurantByUserId(userId: number): Promise<Restaurant | undefined> {
        const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.userId, userId));
        return restaurant;
    }

    async createRestaurant(restaurant: InsertRestaurant): Promise<Restaurant> {
        const [newRestaurant] = await db.insert(restaurants).values(restaurant).returning();
        return newRestaurant;
    }

    async updateRestaurant(id: number, restaurant: Partial<InsertRestaurant>): Promise<Restaurant> {
        const [updatedRestaurant] = await db
            .update(restaurants)
            .set(restaurant)
            .where(eq(restaurants.id, id))
            .returning();
        return updatedRestaurant;
    }

    // Table methods (unchanged)
    async getTables(restaurantId: number): Promise<Table[]> {
        return db.select().from(tables).where(eq(tables.restaurantId, restaurantId));
    }

    async getTable(id: number): Promise<Table | undefined> {
        const [table] = await db.select().from(tables).where(eq(tables.id, id));
        return table;
    }

    async createTable(table: InsertTable): Promise<Table> {
        const [newTable] = await db.insert(tables).values(table).returning();
        return newTable;
    }

    async updateTable(id: number, table: Partial<InsertTable>): Promise<Table> {
        const [updatedTable] = await db
            .update(tables)
            .set(table)
            .where(eq(tables.id, id))
            .returning();
        return updatedTable;
    }

    async deleteTable(id: number): Promise<void> {
        await db.delete(tables).where(eq(tables.id, id));
    }

    // Guest methods (unchanged)
    async getGuests(restaurantId: number): Promise<Guest[]> {
        const guestsWithCounts = await db
            .select({
                id: guests.id,
                name: guests.name,
                phone: guests.phone,
                email: guests.email,
                telegram_user_id: guests.telegram_user_id,
                language: guests.language,
                birthday: guests.birthday,
                tags: guests.tags,
                comments: guests.comments,
                createdAt: guests.createdAt,
                reservationCount: count(reservations.id)
            })
            .from(guests)
            .leftJoin(reservations, and(
                eq(guests.id, reservations.guestId),
                eq(reservations.restaurantId, restaurantId)
            ))
            .where(sql`EXISTS (
        SELECT 1 FROM ${reservations} 
        WHERE ${reservations.guestId} = ${guests.id} 
        AND ${reservations.restaurantId} = ${restaurantId}
      )`)
            .groupBy(guests.id);

        return guestsWithCounts as Guest[];
    }

    async getGuest(id: number): Promise<Guest | undefined> {
        const [guest] = await db.select().from(guests).where(eq(guests.id, id));
        return guest;
    }

    async getGuestByPhone(phone: string): Promise<Guest | undefined> {
        const [guest] = await db.select().from(guests).where(eq(guests.phone, phone));
        return guest;
    }

    async getGuestByTelegramId(telegramUserId: string): Promise<Guest | undefined> {
        const [guest] = await db.select().from(guests).where(eq(guests.telegram_user_id, telegramUserId));
        return guest;
    }

    async createGuest(guest: InsertGuest): Promise<Guest> {
        const [newGuest] = await db.insert(guests).values(guest).returning();
        return newGuest;
    }

    async updateGuest(id: number, guest: Partial<InsertGuest>): Promise<Guest> {
        const [updatedGuest] = await db
            .update(guests)
            .set(guest)
            .where(eq(guests.id, id))
            .returning();
        return updatedGuest;
    }

    // ✅ MAYA FIX: Updated getReservations method with excludeReservationId parameter
    async getReservations(restaurantId: number, filters?: {
        date?: string;
        status?: string[];
        upcoming?: boolean;
        timezone?: string;
        excludeReservationId?: number; // 🆕 NEW: Exclude specific reservation from results
    }): Promise<any[]> {
        const whereConditions = [eq(reservations.restaurantId, restaurantId)];

        // ✅ MAYA FIX: Exclude specific reservation if provided
        if (filters?.excludeReservationId) {
            whereConditions.push(ne(reservations.id, filters.excludeReservationId));
            console.log(`📋 [Storage] Excluding reservation ID ${filters.excludeReservationId} from results`);
        }

        // ✅ FIXED: Date filtering now works with UTC timestamps + TYPE SAFETY
        if (filters?.date && filters?.timezone) {
            // Convert the restaurant date to UTC range
            const startOfDay = DateTime.fromISO(filters.date, { zone: filters.timezone }).startOf('day').toUTC().toISO();
            const endOfDay = DateTime.fromISO(filters.date, { zone: filters.timezone }).endOf('day').toUTC().toISO();
            
            // ✅ TYPE SAFETY FIX: Add null checks
            if (startOfDay && endOfDay) {
                whereConditions.push(
                    and(
                        gte(reservations.reservation_utc, startOfDay),
                        lte(reservations.reservation_utc, endOfDay)
                    )!  // ✅ Non-null assertion since we validated above
                );
                console.log(`📋 [Storage] Filtering by UTC range: ${startOfDay} to ${endOfDay} for restaurant date: ${filters.date}`);
            }
        }

        // ✅ TYPE SAFETY FIX: Proper status filtering with type casting
        if (filters?.status && filters.status.length > 0) {
            // Validate and cast status values to proper type
            const validStatuses = filters.status.filter(status => 
                ['confirmed', 'created', 'canceled', 'completed', 'archived'].includes(status)
            ) as ReservationStatus[];
            
            if (validStatuses.length > 0) {
                whereConditions.push(inArray(reservations.status, validStatuses));
            }
            console.log(`📋 [Storage] Filtering by status: ${validStatuses.join(', ')}`);
        } else {
            whereConditions.push(ne(reservations.status, 'canceled'));
            console.log(`📋 [Storage] No status filter provided, excluding canceled reservations`);
        }

        // ✅ FIXED: Upcoming filtering with UTC timestamps + NULL CHECK
        if (filters?.upcoming && filters.timezone) {
            const nowUtc = DateTime.now().toUTC().toISO();
            if (nowUtc) {
                whereConditions.push(gte(reservations.reservation_utc, nowUtc));
                console.log(`📋 [Storage] Filtering for upcoming reservations from UTC: ${nowUtc}`);
            }
        }

        const results = await db
            .select({
                reservation: reservations,
                guest: guests,
                table: tables
            })
            .from(reservations)
            .innerJoin(guests, eq(reservations.guestId, guests.id))
            .innerJoin(tables, eq(reservations.tableId, tables.id))
            .where(and(...whereConditions))
            .orderBy(reservations.reservation_utc); // ✅ FIXED: Order by UTC timestamp

        console.log(`📋 [Storage] Found ${results.length} reservations with ${whereConditions.length} conditions${filters?.excludeReservationId ? ` (excluded reservation ${filters.excludeReservationId})` : ''}`);

        return results.map(r => ({
            ...r,
            guestName: r.reservation.booking_guest_name || r.guest.name,
        }));
    }

    async getReservation(id: number): Promise<any | undefined> {
        const result = await db
            .select({
                reservation: reservations,
                guest: guests,
                table: tables
            })
            .from(reservations)
            .innerJoin(guests, eq(reservations.guestId, guests.id))
            .innerJoin(tables, eq(reservations.tableId, tables.id))
            .where(eq(reservations.id, id))
            .limit(1);

        if (!result || result.length === 0) return undefined;

        const r = result[0];
        return {
            ...r,
            guestName: r.reservation.booking_guest_name || r.guest.name,
        };
    }

    async createReservation(reservation: InsertReservation): Promise<Reservation> {
        const [newReservation] = await db.insert(reservations).values(reservation).returning();

        // ✅ REMOVED: All timeslot-related code from legacy system

        if (newReservation.tableId) {
            // ✅ FIXED: Now need timezone for table status updates
            const restaurant = await this.getRestaurant(newReservation.restaurantId);
            const timezone = restaurant?.timezone || 'Europe/Moscow';
            await this.updateTableStatusFromReservations(newReservation.tableId, timezone);
        }
        return newReservation;
    }

    // ✅ MAYA FIX: Updated atomic reservation creation with excludeReservationId support
    async createReservationAtomic(
        reservation: InsertReservation,
        expectedSlot: { tableId: number; time: string; duration: number }
    ): Promise<Reservation> {
        console.log(`🔒 [AtomicBooking] Starting atomic reservation creation for table ${expectedSlot.tableId} at ${expectedSlot.time}`);

        return await db.transaction(async (tx) => {
            try {
                // ✅ FIXED: Get restaurant for timezone context
                const restaurant = await this.getRestaurant(reservation.restaurantId);
                const restaurantTimezone = restaurant?.timezone || 'Europe/Moscow';

                // ✅ IMPROVED: Robust UTC timestamp parsing
                let reservationStartUtc: DateTime;
                try {
                    reservationStartUtc = this.parsePostgresTimestamp(reservation.reservation_utc);
                } catch (error) {
                    console.error(`🔒 [AtomicBooking] Failed to parse reservation UTC timestamp: ${reservation.reservation_utc}`, error);
                    throw new Error('Invalid reservation timestamp format');
                }

                const reservationEndUtc = reservationStartUtc.plus({ minutes: expectedSlot.duration });

                console.log(`🔒 [AtomicBooking] Expected UTC time range: ${reservationStartUtc.toISO()} to ${reservationEndUtc.toISO()}`);

                const existingReservations = await tx
                    .select({
                        id: reservations.id,
                        reservation_utc: reservations.reservation_utc,
                        duration: reservations.duration,
                        status: reservations.status,
                        guestId: reservations.guestId,
                        booking_guest_name: reservations.booking_guest_name
                    })
                    .from(reservations)
                    .where(and(
                        eq(reservations.restaurantId, reservation.restaurantId),
                        eq(reservations.tableId, expectedSlot.tableId),
                        inArray(reservations.status, ['confirmed', 'created'] as ReservationStatus[])
                    ));

                console.log(`🔒 [AtomicBooking] Found ${existingReservations.length} existing reservations for table ${expectedSlot.tableId}`);

                for (const existing of existingReservations) {
                    let existingStartUtc: DateTime;
                    try {
                        existingStartUtc = this.parsePostgresTimestamp(existing.reservation_utc);
                    } catch (error) {
                        console.warn(`🔒 [AtomicBooking] Skipping reservation ${existing.id} due to invalid timestamp: ${existing.reservation_utc}`);
                        continue;
                    }

                    const existingDuration = existing.duration || 120;
                    const existingEndUtc = existingStartUtc.plus({ minutes: existingDuration });

                    // Check for overlap using UTC timestamps
                    const hasOverlap = reservationStartUtc < existingEndUtc && reservationEndUtc > existingStartUtc;

                    if (hasOverlap) {
                        console.log(`❌ [AtomicBooking] CONFLICT DETECTED: Table ${expectedSlot.tableId} has existing reservation from ${existingStartUtc.toISO()} to ${existingEndUtc.toISO()} (ID: ${existing.id})`);

                        // Convert back to restaurant timezone for error message
                        const conflictStartLocal = existingStartUtc.setZone(restaurantTimezone).toFormat('HH:mm');
                        const conflictEndLocal = existingEndUtc.setZone(restaurantTimezone).toFormat('HH:mm');

                        throw new Error(`Table no longer available - conflict detected with existing reservation from ${conflictStartLocal} to ${conflictEndLocal}`);
                    }
                }

                console.log(`✅ [AtomicBooking] No conflicts found for table ${expectedSlot.tableId} at ${expectedSlot.time}`);

                const [newReservation] = await tx
                    .insert(reservations)
                    .values(reservation)
                    .returning();

                console.log(`✅ [AtomicBooking] Created reservation ID ${newReservation.id} for table ${expectedSlot.tableId} with UTC timestamp`);

                // ✅ REMOVED: All timeslot-related code from legacy system

                console.log(`🎉 [AtomicBooking] Atomic reservation creation completed successfully for reservation ID ${newReservation.id}`);
                return newReservation;

            } catch (error: any) {
                console.log(`❌ [AtomicBooking] Transaction failed:`, error.message);

                if (error.code === '40P01') {
                    throw new Error('Deadlock detected - please try again');
                } else if (error.code === '40001') {
                    throw new Error('Transaction conflict - please try again');
                } else if (error.message.includes('conflict detected')) {
                    throw error;
                } else {
                    console.error(`🔥 [AtomicBooking] Unexpected database error:`, error);
                    throw new Error(`Database error during reservation creation: ${error.message}`);
                }
            }
        });
    }

    async updateReservation(id: number, reservation: Partial<InsertReservation>): Promise<Reservation> {
        const [updatedReservation] = await db
            .update(reservations)
            .set(reservation)
            .where(eq(reservations.id, id))
            .returning();

        // ✅ REMOVED: All timeslot-related code from legacy system

        if (updatedReservation.tableId) {
            // ✅ FIXED: Now need timezone for table status updates
            const restaurant = await this.getRestaurant(updatedReservation.restaurantId);
            const timezone = restaurant?.timezone || 'Europe/Moscow';
            await this.updateTableStatusFromReservations(updatedReservation.tableId, timezone);
        }
        return updatedReservation;
    }

    // ✅ FIXED: Upcoming reservations with UTC timestamps + TYPE SAFETY
    async getUpcomingReservations(restaurantId: number, restaurantTimezone: string, hours: number = 3): Promise<any[]> {
        const nowUtc = DateTime.now().toUTC();
        const endTimeUtc = nowUtc.plus({ hours });

        console.log(`⏰ [Storage] Getting upcoming reservations from UTC ${nowUtc.toISO()} to ${endTimeUtc.toISO()}`);

        const results = await db
            .select({
                reservation: reservations,
                guest: guests,
                table: tables
            })
            .from(reservations)
            .innerJoin(guests, eq(reservations.guestId, guests.id))
            .innerJoin(tables, eq(reservations.tableId, tables.id))
            .where(
                and(
                    eq(reservations.restaurantId, restaurantId),
                    gte(reservations.reservation_utc, nowUtc.toISO()!),  // ✅ TYPE SAFETY FIX
                    lte(reservations.reservation_utc, endTimeUtc.toISO()!),  // ✅ TYPE SAFETY FIX
                    inArray(reservations.status, ['confirmed', 'created'] as ReservationStatus[])
                )
            )
            .orderBy(reservations.reservation_utc)
            .limit(10);

        console.log(`⏰ [Storage] Found ${results.length} upcoming reservations`);

        return results.map(r => ({
            ...r,
            guestName: r.reservation.booking_guest_name || r.guest.name,
        }));
    }

    // ✅ FIXED: Statistics with UTC timestamps + TYPE SAFETY
    async getReservationStatistics(restaurantId: number, restaurantTimezone: string): Promise<{
        todayReservations: number;
        confirmedReservations: number;
        pendingReservations: number;
        totalGuests: number;
    }> {
        // Get today's date range in UTC for the restaurant timezone
        const restaurantToday = DateTime.now().setZone(restaurantTimezone);
        const startOfDayUtc = restaurantToday.startOf('day').toUTC().toISO();
        const endOfDayUtc = restaurantToday.endOf('day').toUTC().toISO();

        // ✅ TYPE SAFETY FIX: Add null checks
        if (!startOfDayUtc || !endOfDayUtc) {
            throw new Error('Invalid timezone for statistics calculation');
        }

        console.log(`📊 [Storage] Getting stats for restaurant ${restaurantId} for UTC range: ${startOfDayUtc} to ${endOfDayUtc}`);

        const [todayCount] = await db
            .select({ count: count() })
            .from(reservations)
            .innerJoin(tables, eq(reservations.tableId, tables.id))
            .where(
                and(
                    eq(reservations.restaurantId, restaurantId),
                    gte(reservations.reservation_utc, startOfDayUtc),
                    lte(reservations.reservation_utc, endOfDayUtc),
                    ne(reservations.status, 'canceled')
                )
            );

        const [confirmedCount] = await db
            .select({ count: count() })
            .from(reservations)
            .innerJoin(tables, eq(reservations.tableId, tables.id))
            .where(
                and(
                    eq(reservations.restaurantId, restaurantId),
                    gte(reservations.reservation_utc, startOfDayUtc),
                    lte(reservations.reservation_utc, endOfDayUtc),
                    eq(reservations.status, 'confirmed')
                )
            );

        const [pendingCount] = await db
            .select({ count: count() })
            .from(reservations)
            .innerJoin(tables, eq(reservations.tableId, tables.id))
            .where(
                and(
                    eq(reservations.restaurantId, restaurantId),
                    gte(reservations.reservation_utc, startOfDayUtc),
                    lte(reservations.reservation_utc, endOfDayUtc),
                    eq(reservations.status, 'created')
                )
            );

        const [guestsResult] = await db
            .select({ total: sql<number>`SUM(${reservations.guests})`.mapWith(Number) })
            .from(reservations)
            .innerJoin(tables, eq(reservations.tableId, tables.id))
            .where(
                and(
                    eq(reservations.restaurantId, restaurantId),
                    gte(reservations.reservation_utc, startOfDayUtc),
                    lte(reservations.reservation_utc, endOfDayUtc),
                    ne(reservations.status, 'canceled')
                )
            );

        const stats = {
            todayReservations: todayCount?.count || 0,
            confirmedReservations: confirmedCount?.count || 0,
            pendingReservations: pendingCount?.count || 0,
            totalGuests: guestsResult?.total || 0,
        };

        console.log(`📊 [Storage] Computed stats:`, stats);
        return stats;
    }

    // Integration settings methods (unchanged)
    async getIntegrationSettings(restaurantId: number, type: string): Promise<IntegrationSetting | undefined> {
        const [settings] = await db
            .select()
            .from(integrationSettings)
            .where(
                and(
                    eq(integrationSettings.restaurantId, restaurantId),
                    eq(integrationSettings.type, type)
                )
            );
        return settings;
    }

    async saveIntegrationSettings(settings: InsertIntegrationSetting): Promise<IntegrationSetting> {
        const existingSettings = await this.getIntegrationSettings(
            settings.restaurantId as number,
            settings.type as string
        );
        if (existingSettings) {
            const [updatedSettings] = await db
                .update(integrationSettings)
                .set(settings)
                .where(eq(integrationSettings.id, existingSettings.id))
                .returning();
            return updatedSettings;
        } else {
            const [newSettings] = await db
                .insert(integrationSettings)
                .values(settings)
                .returning();
            return newSettings;
        }
    }

    // AI activities methods (unchanged)
    async getAiActivities(restaurantId: number, limit: number = 10): Promise<AiActivity[]> {
        return db
            .select()
            .from(aiActivities)
            .where(eq(aiActivities.restaurantId, restaurantId))
            .orderBy(desc(aiActivities.createdAt))
            .limit(limit);
    }

    async logAiActivity(activity: InsertAiActivity): Promise<AiActivity> {
        const [newActivity] = await db
            .insert(aiActivities)
            .values(activity)
            .returning();
        return newActivity;
    }

    // ✅ FIXED: Real-time table availability methods now timezone-aware with UTC timestamps
    async updateTableStatusFromReservations(tableId: number, restaurantTimezone: string): Promise<void> {
        // ✅ FIXED: Use restaurant's current time instead of server time
        const nowInRestaurant = DateTime.now().setZone(restaurantTimezone);
        const nowUtc = nowInRestaurant.toUTC();

        console.log(`🏢 [Storage] Updating table ${tableId} status using restaurant time converted to UTC: ${nowUtc.toISO()} (${restaurantTimezone})`);

        // ✅ IMPROVED: Check for active reservations using UTC timestamps with proper duration handling
        const activeReservations = await db
            .select()
            .from(reservations)
            .where(
                and(
                    eq(reservations.tableId, tableId),
                    inArray(reservations.status, ['confirmed', 'created'] as ReservationStatus[])
                )
            );

        let isCurrentlyOccupied = false;
        let hasUpcomingReservation = false;

        for (const reservation of activeReservations) {
            try {
                const reservationStartUtc = this.parsePostgresTimestamp(reservation.reservation_utc);
                const reservationDuration = reservation.duration || 120;
                const reservationEndUtc = reservationStartUtc.plus({ minutes: reservationDuration });

                // Check if currently occupied
                if (nowUtc >= reservationStartUtc && nowUtc <= reservationEndUtc) {
                    isCurrentlyOccupied = true;
                    console.log(`🏢 [Storage] Table ${tableId} currently occupied by reservation ${reservation.id} (${reservationStartUtc.toISO()} - ${reservationEndUtc.toISO()})`);
                }

                // Check for upcoming reservations (within next 2 hours)
                const twoHoursFromNow = nowUtc.plus({ hours: 2 });
                if (reservationStartUtc > nowUtc && reservationStartUtc <= twoHoursFromNow) {
                    hasUpcomingReservation = true;
                    console.log(`🏢 [Storage] Table ${tableId} has upcoming reservation ${reservation.id} at ${reservationStartUtc.toISO()}`);
                }
            } catch (error) {
                console.warn(`🏢 [Storage] Skipping reservation ${reservation.id} due to invalid timestamp`, error);
            }
        }

        let newStatus: 'free' | 'occupied' | 'reserved' | 'unavailable' = 'free';
        if (isCurrentlyOccupied) {
            newStatus = 'occupied';
        } else if (hasUpcomingReservation) {
            newStatus = 'reserved';
        }
        
        console.log(`🏢 [Storage] Table ${tableId} status: ${newStatus}`);
        
        await db
            .update(tables)
            .set({ status: newStatus })
            .where(eq(tables.id, tableId));
    }

    // ✅ FIXED: Now timezone-aware
    async updateAllTableStatuses(restaurantId: number, restaurantTimezone: string): Promise<void> {
        const restaurantTables = await this.getTables(restaurantId);
        for (const table of restaurantTables) {
            await this.updateTableStatusFromReservations(table.id, restaurantTimezone);
        }
    }

    // ✅ MAYA FIX: Updated table availability with excludeReservationId parameter
    async getTableAvailability(restaurantId: number, date: string, time: string, excludeReservationId?: number): Promise<Table[]> {
        // Get restaurant timezone for conversion
        const restaurant = await this.getRestaurant(restaurantId);
        const restaurantTimezone = restaurant?.timezone || 'Europe/Moscow';

        // Convert date/time to UTC range
        const startOfSlotUtc = DateTime.fromISO(`${date}T${time}`, { zone: restaurantTimezone }).toUTC().toISO();
        const endOfSlotUtc = DateTime.fromISO(`${date}T${time}`, { zone: restaurantTimezone }).plus({ hours: 2 }).toUTC().toISO();

        // ✅ TYPE SAFETY: Null checks
        if (!startOfSlotUtc || !endOfSlotUtc) {
            console.error(`❌ [Storage] Failed to convert date/time to UTC for availability check`);
            return [];
        }

        console.log(`🏢 [Storage] Checking table availability for UTC range: ${startOfSlotUtc} to ${endOfSlotUtc}${excludeReservationId ? ` (excluding reservation ${excludeReservationId})` : ''}`);

        // ✅ MAYA FIX: Build conflict check conditions with optional exclusion
        const conflictConditions = [
            eq(reservations.tableId, tables.id),
            // Check for overlap using UTC timestamps
            sql`${reservations.reservation_utc} < ${endOfSlotUtc}`,
            sql`${reservations.reservation_utc} + INTERVAL '2 hours' > ${startOfSlotUtc}`,
            inArray(reservations.status, ['confirmed', 'created'] as ReservationStatus[])
        ];

        // ✅ MAYA FIX: Add exclusion condition if provided
        if (excludeReservationId) {
            conflictConditions.push(ne(reservations.id, excludeReservationId));
        }

        const availableTables = await db
            .select()
            .from(tables)
            .where(
                and(
                    eq(tables.restaurantId, restaurantId),
                    ne(tables.status, 'unavailable'),
                    notExists(
                        db.select()
                            .from(reservations)
                            .where(and(...conflictConditions))
                    )
                )
            );
        
        console.log(`🏢 [Storage] Found ${availableTables.length} available tables${excludeReservationId ? ` (excluded reservation ${excludeReservationId})` : ''}`);
        return availableTables;
    }
}

export const storage = new DatabaseStorage();