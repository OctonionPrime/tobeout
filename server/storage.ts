//
// storage.ts (Complete Enhanced Version with All New Features)
// ✅ ENHANCED: Complete timezone-aware system with menu management and guest analytics
// ✅ MAYA FIX: Added excludeReservationId parameter to prevent reservation conflicts during modifications
//

import {
    users, restaurants, tables, guests, reservations,
    integrationSettings, aiActivities,
    reservationStatusHistory, menuItems, restaurantMenuCategories, menuSearchLog,
    type User, type InsertUser,
    type Restaurant, type InsertRestaurant,
    type Table, type InsertTable,
    type Guest, type InsertGuest,
    type Reservation, type InsertReservation,
    type AiActivity, type InsertAiActivity,
    type IntegrationSetting, type InsertIntegrationSetting,
    type ReservationStatusHistory, type InsertReservationStatusHistory,
    type MenuItem, type InsertMenuItem,
    type RestaurantMenuCategory, type InsertRestaurantMenuCategory,
    type MenuSearchLog, type InsertMenuSearchLog
} from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lte, desc, sql, count, or, inArray, gt, ne, notExists, like, ilike } from "drizzle-orm";
import { DateTime } from 'luxon'; 
// ✅ PROPER FIX: Use centralized timezone utilities for consistency across the application
// This ensures all timezone handling follows the same logic and supports all 600+ timezones
import { getRestaurantDateTime, getRestaurantDateString } from './utils/timezone-utils';

// ✅ TYPE SAFETY FIX: Define valid reservation statuses
type ReservationStatus = 'confirmed' | 'created' | 'canceled' | 'completed' | 'archived' | 'seated' | 'in_progress' | 'no_show';

export interface IStorage {
    // ✅ EXISTING: User methods
    getUser(id: number): Promise<User | undefined>;
    getUserByEmail(email: string): Promise<User | undefined>;
    createUser(user: InsertUser): Promise<User>;

    // ✅ EXISTING: Restaurant methods
    getRestaurant(id: number): Promise<Restaurant | undefined>;
    getRestaurantByUserId(userId: number): Promise<Restaurant | undefined>;
    getAllRestaurants(): Promise<Restaurant[]>; // 🆕 NEW: For cleanup service
    createRestaurant(restaurant: InsertRestaurant): Promise<Restaurant>;
    updateRestaurant(id: number, restaurant: Partial<InsertRestaurant>): Promise<Restaurant>;

    // ✅ EXISTING: Table methods
    getTables(restaurantId: number): Promise<Table[]>;
    getTable(id: number): Promise<Table | undefined>;
    createTable(table: InsertTable): Promise<Table>;
    updateTable(id: number, table: Partial<InsertTable>): Promise<Table>;
    deleteTable(id: number): Promise<void>;

    // ✅ EXISTING: Guest methods
    getGuests(restaurantId: number): Promise<Guest[]>;
    getGuest(id: number): Promise<Guest | undefined>;
    getGuestByPhone(phone: string): Promise<Guest | undefined>;
    getGuestByTelegramId(telegramUserId: string): Promise<Guest | undefined>;
    createGuest(guest: InsertGuest): Promise<Guest>;
    updateGuest(id: number, guest: Partial<InsertGuest>): Promise<Guest>;

    // ✅ EXISTING: Reservation methods
    getReservations(restaurantId: number, filters?: {
        date?: string;
        status?: string[];
        upcoming?: boolean;
        timezone?: string;
        excludeReservationId?: number;
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

    // 🆕 NEW: Enhanced reservation status management
    updateReservationWithHistory(
        reservationId: number, 
        updateData: Partial<InsertReservation>,
        historyData: {
            changedBy: 'system' | 'staff' | 'guest';
            changeReason: string;
            metadata?: any;
        }
    ): Promise<Reservation>;
    getStatusChangeTime(reservationId: number, status: string): Promise<Date | null>;
    getReservationStatusHistory(reservationId: number): Promise<ReservationStatusHistory[]>;

    // 🆕 NEW: Enhanced guest analytics
    updateGuestAnalytics(
        guestId: number,
        analytics: {
            visitCompleted?: boolean;
            noShowOccurred?: boolean;
            duration?: number;
            totalSpent?: number;
        }
    ): Promise<Guest>;
    getGuestReservationHistory(guestId: number, restaurantId: number): Promise<any[]>;

    // 🆕 NEW: Menu management system
    getMenuItems(restaurantId: number, filters?: {
        category?: string;
        availableOnly?: boolean;
        searchQuery?: string;
        popularOnly?: boolean;
    }): Promise<any[]>;
    createMenuItem(data: InsertMenuItem): Promise<MenuItem>;
    bulkUpdateMenuItems(restaurantId: number, items: any[], action: string): Promise<any[]>;
    searchMenuItemsByName(restaurantId: number, query: string): Promise<MenuItem[]>;
    searchMenuItemsByDescription(restaurantId: number, query: string): Promise<MenuItem[]>;
    searchMenuItemsByDietaryTags(restaurantId: number, query: string): Promise<MenuItem[]>;
    fuzzySearchMenuItems(restaurantId: number, query: string): Promise<MenuItem[]>;
    getMenuRecommendations(
        restaurantId: number,
        context: {
            guestPreferences?: string[];
            priceRange?: { min?: number; max?: number };
            category?: string;
            limit?: number;
        }
    ): Promise<any[]>;
    getPopularMenuItems(restaurantId: number, limit?: number): Promise<MenuItem[]>;
    logMenuSearch(restaurantId: number, query: string, source: string): Promise<MenuSearchLog>;

    // ✅ EXISTING: Integration settings methods
    getIntegrationSettings(restaurantId: number, type: string): Promise<IntegrationSetting | undefined>;
    saveIntegrationSettings(settings: InsertIntegrationSetting): Promise<IntegrationSetting>;

    // ✅ EXISTING: AI activities methods
    getAiActivities(restaurantId: number, limit?: number): Promise<AiActivity[]>;
    logAiActivity(activity: InsertAiActivity): Promise<AiActivity>;

    // ✅ EXISTING: Real-time table availability methods
    updateTableStatusFromReservations(tableId: number, restaurantTimezone: string): Promise<void>;
    updateAllTableStatuses(restaurantId: number, restaurantTimezone: string): Promise<void>;
    getTableAvailability(restaurantId: number, date: string, time: string, excludeReservationId?: number): Promise<Table[]>;
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

    // ================================
    // ✅ EXISTING USER METHODS
    // ================================

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

    // ================================
    // ✅ EXISTING + ENHANCED RESTAURANT METHODS
    // ================================

    async getRestaurant(id: number): Promise<Restaurant | undefined> {
        const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.id, id));
        return restaurant;
    }

    async getRestaurantByUserId(userId: number): Promise<Restaurant | undefined> {
        const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.userId, userId));
        return restaurant;
    }

    // 🆕 NEW: Get all restaurants for cleanup service
    async getAllRestaurants(): Promise<Restaurant[]> {
        return await db.select().from(restaurants);
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

    // ================================
    // ✅ EXISTING TABLE METHODS
    // ================================

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

    // ================================
    // ✅ EXISTING GUEST METHODS
    // ================================

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
                visit_count: guests.visit_count,
                no_show_count: guests.no_show_count,
                total_spent: guests.total_spent,
                average_duration: guests.average_duration,
                preferences: guests.preferences,
                vip_level: guests.vip_level,
                last_visit_date: guests.last_visit_date,
                reputation_score: guests.reputation_score,
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

    // ================================
    // ✅ EXISTING RESERVATION METHODS (with Maya fix)
    // ================================

    async getReservations(restaurantId: number, filters?: {
        date?: string;
        status?: string[];
        upcoming?: boolean;
        timezone?: string;
        excludeReservationId?: number;
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
                    )!
                );
                console.log(`📋 [Storage] Filtering by UTC range: ${startOfDay} to ${endOfDay} for restaurant date: ${filters.date}`);
            }
        }

        // ✅ TYPE SAFETY FIX: Proper status filtering with type casting
        if (filters?.status && filters.status.length > 0) {
            // Validate and cast status values to proper type
            const validStatuses = filters.status.filter(status => 
                ['confirmed', 'created', 'canceled', 'completed', 'archived', 'seated', 'in_progress', 'no_show'].includes(status)
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
            .orderBy(reservations.reservation_utc);

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

        if (newReservation.tableId) {
            const restaurant = await this.getRestaurant(newReservation.restaurantId);
            const timezone = restaurant?.timezone || 'Europe/Moscow';
            await this.updateTableStatusFromReservations(newReservation.tableId, timezone);
        }
        return newReservation;
    }

    async createReservationAtomic(
        reservation: InsertReservation,
        expectedSlot: { tableId: number; time: string; duration: number }
    ): Promise<Reservation> {
        console.log(`🔒 [AtomicBooking] Starting atomic reservation creation for table ${expectedSlot.tableId} at ${expectedSlot.time}`);

        return await db.transaction(async (tx) => {
            try {
                const restaurant = await this.getRestaurant(reservation.restaurantId);
                const restaurantTimezone = restaurant?.timezone || 'Europe/Moscow';

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

                    const hasOverlap = reservationStartUtc < existingEndUtc && reservationEndUtc > existingStartUtc;

                    if (hasOverlap) {
                        console.log(`❌ [AtomicBooking] CONFLICT DETECTED: Table ${expectedSlot.tableId} has existing reservation from ${existingStartUtc.toISO()} to ${existingEndUtc.toISO()} (ID: ${existing.id})`);

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

        if (updatedReservation.tableId) {
            const restaurant = await this.getRestaurant(updatedReservation.restaurantId);
            const timezone = restaurant?.timezone || 'Europe/Moscow';
            await this.updateTableStatusFromReservations(updatedReservation.tableId, timezone);
        }
        return updatedReservation;
    }

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
                    gte(reservations.reservation_utc, nowUtc.toISO()!),
                    lte(reservations.reservation_utc, endTimeUtc.toISO()!),
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

    async getReservationStatistics(restaurantId: number, restaurantTimezone: string): Promise<{
        todayReservations: number;
        confirmedReservations: number;
        pendingReservations: number;
        totalGuests: number;
    }> {
        const restaurantToday = DateTime.now().setZone(restaurantTimezone);
        const startOfDayUtc = restaurantToday.startOf('day').toUTC().toISO();
        const endOfDayUtc = restaurantToday.endOf('day').toUTC().toISO();

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

    // ================================
    // 🆕 NEW: ENHANCED RESERVATION STATUS MANAGEMENT
    // ================================

    async updateReservationWithHistory(
        reservationId: number, 
        updateData: Partial<InsertReservation>,
        historyData: {
            changedBy: 'system' | 'staff' | 'guest';
            changeReason: string;
            metadata?: any;
        }
    ): Promise<Reservation> {
        return await db.transaction(async (tx) => {
            console.log(`🔄 [Storage] Updating reservation ${reservationId} with history tracking`);
            
            // Get current reservation state
            const [currentReservation] = await tx
                .select()
                .from(reservations)
                .where(eq(reservations.id, reservationId));
                
            if (!currentReservation) {
                throw new Error(`Reservation ${reservationId} not found`);
            }
            
            // Track status changes
            if (updateData.status && updateData.status !== currentReservation.status) {
                await tx.insert(reservationStatusHistory).values({
                    reservationId,
                    fromStatus: currentReservation.status,
                    toStatus: updateData.status,
                    changedBy: historyData.changedBy,
                    changeReason: historyData.changeReason,
                    metadata: historyData.metadata
                });
                
                console.log(`📝 [Storage] Status change logged: ${currentReservation.status} → ${updateData.status}`);
            }
            
            // Update reservation
            const [updatedReservation] = await tx
                .update(reservations)
                .set({ ...updateData, lastModifiedAt: new Date() })
                .where(eq(reservations.id, reservationId))
                .returning();
                
            console.log(`✅ [Storage] Reservation ${reservationId} updated successfully`);
            return updatedReservation;
        });
    }

    async getStatusChangeTime(reservationId: number, status: string): Promise<Date | null> {
        const [statusChange] = await db
            .select({ timestamp: reservationStatusHistory.timestamp })
            .from(reservationStatusHistory)
            .where(
                and(
                    eq(reservationStatusHistory.reservationId, reservationId),
                    eq(reservationStatusHistory.toStatus, status as any)
                )
            )
            .orderBy(desc(reservationStatusHistory.timestamp))
            .limit(1);
            
        return statusChange?.timestamp ? new Date(statusChange.timestamp) : null;
    }

    async getReservationStatusHistory(reservationId: number): Promise<ReservationStatusHistory[]> {
        return await db
            .select()
            .from(reservationStatusHistory)
            .where(eq(reservationStatusHistory.reservationId, reservationId))
            .orderBy(reservationStatusHistory.timestamp);
    }

    // ================================
    // 🆕 NEW: ENHANCED GUEST ANALYTICS
    // ================================

    async updateGuestAnalytics(
        guestId: number,
        analytics: {
            visitCompleted?: boolean;
            noShowOccurred?: boolean;
            duration?: number;
            totalSpent?: number;
        }
    ): Promise<Guest> {
        return await db.transaction(async (tx) => {
            console.log(`📊 [Storage] Updating guest ${guestId} analytics:`, analytics);
            
            const [currentGuest] = await tx
                .select()
                .from(guests)
                .where(eq(guests.id, guestId));
                
            if (!currentGuest) {
                throw new Error(`Guest ${guestId} not found`);
            }
            
            const updates: Partial<InsertGuest> = {
                last_visit_date: new Date()
            };
            
            if (analytics.visitCompleted) {
                updates.visit_count = (currentGuest.visit_count || 0) + 1;
                
                // Update total spent
                if (analytics.totalSpent && analytics.totalSpent > 0) {
                    const currentSpent = parseFloat(currentGuest.total_spent || '0');
                    updates.total_spent = (currentSpent + analytics.totalSpent).toFixed(2);
                }
                
                // Update average duration
                if (analytics.duration) {
                    const currentCount = currentGuest.visit_count || 0;
                    const currentAvg = currentGuest.average_duration || 120;
                    const newAvg = Math.round((currentAvg * currentCount + analytics.duration) / (currentCount + 1));
                    updates.average_duration = newAvg;
                }
                
                // Boost reputation for completed visits
                updates.reputation_score = Math.min(100, (currentGuest.reputation_score || 100) + 2);
            }
            
            if (analytics.noShowOccurred) {
                updates.no_show_count = (currentGuest.no_show_count || 0) + 1;
                
                // Reduce reputation for no-shows
                const reputationPenalty = Math.min(15, 5 + (currentGuest.no_show_count || 0) * 2);
                updates.reputation_score = Math.max(0, (currentGuest.reputation_score || 100) - reputationPenalty);
            }
            
            const [updatedGuest] = await tx
                .update(guests)
                .set(updates)
                .where(eq(guests.id, guestId))
                .returning();
                
            console.log(`✅ [Storage] Guest ${guestId} analytics updated`);
            return updatedGuest;
        });
    }

    async getGuestReservationHistory(guestId: number, restaurantId: number): Promise<any[]> {
        const results = await db
            .select({
                reservation: reservations,
                table: tables,
                statusHistory: sql<any[]>`COALESCE(
                    json_agg(
                        json_build_object(
                            'fromStatus', ${reservationStatusHistory.fromStatus},
                            'toStatus', ${reservationStatusHistory.toStatus},
                            'changedBy', ${reservationStatusHistory.changedBy},
                            'changeReason', ${reservationStatusHistory.changeReason},
                            'timestamp', ${reservationStatusHistory.timestamp}
                        ) ORDER BY ${reservationStatusHistory.timestamp}
                    ) FILTER (WHERE ${reservationStatusHistory.id} IS NOT NULL),
                    '[]'::json
                )`
            })
            .from(reservations)
            .leftJoin(tables, eq(reservations.tableId, tables.id))
            .leftJoin(reservationStatusHistory, eq(reservations.id, reservationStatusHistory.reservationId))
            .where(
                and(
                    eq(reservations.guestId, guestId),
                    eq(reservations.restaurantId, restaurantId)
                )
            )
            .groupBy(reservations.id, tables.id)
            .orderBy(desc(reservations.reservation_utc))
            .limit(20);
            
        return results;
    }

    // ================================
    // 🆕 NEW: MENU MANAGEMENT SYSTEM
    // ================================

    async getMenuItems(restaurantId: number, filters?: {
        category?: string;
        availableOnly?: boolean;
        searchQuery?: string;
        popularOnly?: boolean;
    }): Promise<any[]> {
        const whereConditions = [eq(menuItems.restaurantId, restaurantId)];
        
        if (filters?.category) {
            // Join with categories to filter by slug
            const categoryResults = await db
                .select({ id: restaurantMenuCategories.id })
                .from(restaurantMenuCategories)
                .where(
                    and(
                        eq(restaurantMenuCategories.restaurantId, restaurantId),
                        eq(restaurantMenuCategories.slug, filters.category)
                    )
                );
                
            if (categoryResults.length > 0) {
                whereConditions.push(eq(menuItems.categoryId, categoryResults[0].id));
            }
        }
        
        if (filters?.availableOnly) {
            whereConditions.push(eq(menuItems.isAvailable, true));
        }
        
        if (filters?.popularOnly) {
            whereConditions.push(eq(menuItems.isPopular, true));
        }
        
        if (filters?.searchQuery) {
            whereConditions.push(
                or(
                    ilike(menuItems.name, `%${filters.searchQuery}%`),
                    ilike(menuItems.description, `%${filters.searchQuery}%`),
                    ilike(menuItems.subcategory, `%${filters.searchQuery}%`)
                )!
            );
        }
        
        const results = await db
            .select({
                item: menuItems,
                category: restaurantMenuCategories
            })
            .from(menuItems)
            .innerJoin(restaurantMenuCategories, eq(menuItems.categoryId, restaurantMenuCategories.id))
            .where(and(...whereConditions))
            .orderBy(restaurantMenuCategories.displayOrder, menuItems.displayOrder);
            
        return results.map(r => ({
            ...r.item,
            categoryName: r.category.name,
            categorySlug: r.category.slug
        }));
    }

    async createMenuItem(data: InsertMenuItem): Promise<MenuItem> {
        const [newItem] = await db.insert(menuItems).values(data).returning();
        return newItem;
    }

    async bulkUpdateMenuItems(restaurantId: number, items: any[], action: string): Promise<any[]> {
        return await db.transaction(async (tx) => {
            const results = [];
            
            for (const item of items) {
                let updateData: Partial<InsertMenuItem> = {};
                
                switch (action) {
                    case 'availability':
                        updateData.isAvailable = item.isAvailable;
                        break;
                    case 'prices':
                        updateData.price = item.price;
                        if (item.originalPrice) updateData.originalPrice = item.originalPrice;
                        break;
                    case 'categories':
                        updateData.categoryId = item.categoryId;
                        break;
                    default:
                        throw new Error(`Unknown bulk update action: ${action}`);
                }
                
                const [updated] = await tx
                    .update(menuItems)
                    .set({ ...updateData, updatedAt: new Date() })
                    .where(
                        and(
                            eq(menuItems.id, item.id),
                            eq(menuItems.restaurantId, restaurantId)
                        )
                    )
                    .returning();
                    
                results.push(updated);
            }
            
            return results;
        });
    }

    async searchMenuItemsByName(restaurantId: number, query: string): Promise<MenuItem[]> {
        // Try exact match first
        let results = await db
            .select()
            .from(menuItems)
            .where(
                and(
                    eq(menuItems.restaurantId, restaurantId),
                    eq(menuItems.isAvailable, true),
                    ilike(menuItems.name, query)
                )
            );
            
        // If no exact match, try fuzzy
        if (results.length === 0) {
            results = await db
                .select()
                .from(menuItems)
                .where(
                    and(
                        eq(menuItems.restaurantId, restaurantId),
                        eq(menuItems.isAvailable, true),
                        ilike(menuItems.name, `%${query}%`)
                    )
                );
        }
        
        return results;
    }

    async searchMenuItemsByDescription(restaurantId: number, query: string): Promise<MenuItem[]> {
        return await db
            .select()
            .from(menuItems)
            .where(
                and(
                    eq(menuItems.restaurantId, restaurantId),
                    eq(menuItems.isAvailable, true),
                    or(
                        ilike(menuItems.description, `%${query}%`),
                        ilike(menuItems.shortDescription, `%${query}%`)
                    )!
                )
            );
    }

    async searchMenuItemsByDietaryTags(restaurantId: number, query: string): Promise<MenuItem[]> {
        return await db
            .select()
            .from(menuItems)
            .where(
                and(
                    eq(menuItems.restaurantId, restaurantId),
                    eq(menuItems.isAvailable, true),
                    sql`${menuItems.dietaryTags} && ARRAY[${query}]`
                )
            );
    }

    async fuzzySearchMenuItems(restaurantId: number, query: string): Promise<MenuItem[]> {
        // Simple fuzzy search - in production you might want to use PostgreSQL's similarity functions
        const words = query.toLowerCase().split(' ');
        const searchPattern = words.join('%');
        
        return await db
            .select()
            .from(menuItems)
            .where(
                and(
                    eq(menuItems.restaurantId, restaurantId),
                    eq(menuItems.isAvailable, true),
                    or(
                        ilike(menuItems.name, `%${searchPattern}%`),
                        ilike(menuItems.description, `%${searchPattern}%`)
                    )!
                )
            );
    }

    async getMenuRecommendations(
        restaurantId: number,
        context: {
            guestPreferences?: string[];
            priceRange?: { min?: number; max?: number };
            category?: string;
            limit?: number;
        }
    ): Promise<any[]> {
        const whereConditions = [
            eq(menuItems.restaurantId, restaurantId),
            eq(menuItems.isAvailable, true)
        ];
        
        // Filter by category if specified
        if (context.category) {
            const categoryResults = await db
                .select({ id: restaurantMenuCategories.id })
                .from(restaurantMenuCategories)
                .where(
                    and(
                        eq(restaurantMenuCategories.restaurantId, restaurantId),
                        eq(restaurantMenuCategories.slug, context.category)
                    )
                );
                
            if (categoryResults.length > 0) {
                whereConditions.push(eq(menuItems.categoryId, categoryResults[0].id));
            }
        }
        
        // Filter by price range
        if (context.priceRange) {
            if (context.priceRange.min) {
                whereConditions.push(gte(menuItems.price, context.priceRange.min.toString()));
            }
            if (context.priceRange.max) {
                whereConditions.push(lte(menuItems.price, context.priceRange.max.toString()));
            }
        }
        
        let results = await db
            .select({
                item: menuItems,
                category: restaurantMenuCategories
            })
            .from(menuItems)
            .innerJoin(restaurantMenuCategories, eq(menuItems.categoryId, restaurantMenuCategories.id))
            .where(and(...whereConditions))
            .orderBy(
                desc(menuItems.isPopular),
                desc(menuItems.isNew),
                menuItems.displayOrder
            )
            .limit(context.limit || 6);
        
        return results.map(r => ({
            ...r.item,
            categoryName: r.category.name,
            recommendationReason: this.getRecommendationReason(r.item, context.guestPreferences)
        }));
    }

    private getRecommendationReason(item: any, guestPreferences?: string[]): string {
        if (item.isPopular) return "Popular choice";
        if (item.isNew) return "New addition";
        if (guestPreferences?.some(pref => 
            item.dietaryTags?.includes(pref) || 
            item.subcategory?.toLowerCase().includes(pref.toLowerCase())
        )) {
            return "Matches your preferences";
        }
        return "Chef's selection";
    }

    async getPopularMenuItems(restaurantId: number, limit: number = 5): Promise<MenuItem[]> {
        return await db
            .select()
            .from(menuItems)
            .where(
                and(
                    eq(menuItems.restaurantId, restaurantId),
                    eq(menuItems.isAvailable, true),
                    eq(menuItems.isPopular, true)
                )
            )
            .orderBy(menuItems.displayOrder)
            .limit(limit);
    }

    async logMenuSearch(restaurantId: number, query: string, source: string): Promise<MenuSearchLog> {
        const [searchLog] = await db.insert(menuSearchLog).values({
            restaurantId,
            query,
            resultsCount: 0, // Will be updated after search
            source
        }).returning();
        
        return searchLog;
    }

    // ================================
    // ✅ EXISTING INTEGRATION SETTINGS METHODS
    // ================================

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

    // ================================
    // ✅ EXISTING AI ACTIVITIES METHODS
    // ================================

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

    // ================================
    // ✅ EXISTING TABLE AVAILABILITY METHODS (with Maya fix)
    // ================================

    async updateTableStatusFromReservations(tableId: number, restaurantTimezone: string): Promise<void> {
        const nowInRestaurant = DateTime.now().setZone(restaurantTimezone);
        const nowUtc = nowInRestaurant.toUTC();

        console.log(`🏢 [Storage] Updating table ${tableId} status using restaurant time converted to UTC: ${nowUtc.toISO()} (${restaurantTimezone})`);

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

    async updateAllTableStatuses(restaurantId: number, restaurantTimezone: string): Promise<void> {
        const restaurantTables = await this.getTables(restaurantId);
        for (const table of restaurantTables) {
            await this.updateTableStatusFromReservations(table.id, restaurantTimezone);
        }
    }

    async getTableAvailability(restaurantId: number, date: string, time: string, excludeReservationId?: number): Promise<Table[]> {
        // Get restaurant timezone for conversion
        const restaurant = await this.getRestaurant(restaurantId);
        const restaurantTimezone = restaurant?.timezone || 'Europe/Moscow';

        // Convert date/time to UTC range
        const startOfSlotUtc = DateTime.fromISO(`${date}T${time}`, { zone: restaurantTimezone }).toUTC().toISO();
        const endOfSlotUtc = DateTime.fromISO(`${date}T${time}`, { zone: restaurantTimezone }).plus({ hours: 2 }).toUTC().toISO();

        if (!startOfSlotUtc || !endOfSlotUtc) {
            console.error(`❌ [Storage] Failed to convert date/time to UTC for availability check`);
            return [];
        }

        console.log(`🏢 [Storage] Checking table availability for UTC range: ${startOfSlotUtc} to ${endOfSlotUtc}${excludeReservationId ? ` (excluding reservation ${excludeReservationId})` : ''}`);

        // Build conflict check conditions with optional exclusion
        const conflictConditions = [
            eq(reservations.tableId, tables.id),
            // Check for overlap using UTC timestamps
            sql`${reservations.reservation_utc} < ${endOfSlotUtc}`,
            sql`${reservations.reservation_utc} + INTERVAL '2 hours' > ${startOfSlotUtc}`,
            inArray(reservations.status, ['confirmed', 'created'] as ReservationStatus[])
        ];

        // Add exclusion condition if provided
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