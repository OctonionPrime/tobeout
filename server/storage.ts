//
// storage.ts (Complete Timezone-Aware Version)
// This version fixes ALL timezone issues in the storage layer
//

import {
    users, restaurants, tables, timeslots, guests, reservations,
    integrationSettings, aiActivities,
    type User, type InsertUser,
    type Restaurant, type InsertRestaurant,
    type Table, type InsertTable,
    type Timeslot, type InsertTimeslot,
    type Guest, type InsertGuest,
    type Reservation, type InsertReservation,
    type AiActivity, type InsertAiActivity,
    type IntegrationSetting, type InsertIntegrationSetting
} from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lte, desc, sql, count, or, inArray, gt, ne, notExists } from "drizzle-orm";
import { addMinutes, format, parse, parseISO } from "date-fns";
// ✅ FIXED: Correct import path for timezone utilities
import { getRestaurantDateTime, getRestaurantDateString } from './utils/timezone-utils';

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

    // Timeslot methods
    getTimeslots(restaurantId: number, date: string): Promise<Timeslot[]>;
    getTimeslot(id: number): Promise<Timeslot | undefined>;
    createTimeslot(timeslot: InsertTimeslot): Promise<Timeslot>;
    updateTimeslot(id: number, timeslot: Partial<InsertTimeslot>): Promise<Timeslot>;
    // ✅ FIXED: Now requires restaurant timezone
    generateTimeslots(restaurantId: number, daysAhead: number): Promise<number>;

    // Guest methods
    getGuests(restaurantId: number): Promise<Guest[]>;
    getGuest(id: number): Promise<Guest | undefined>;
    getGuestByPhone(phone: string): Promise<Guest | undefined>;
    getGuestByTelegramId(telegramUserId: string): Promise<Guest | undefined>;
    createGuest(guest: InsertGuest): Promise<Guest>;
    updateGuest(id: number, guest: Partial<InsertGuest>): Promise<Guest>;

    // Reservation methods
    getReservations(restaurantId: number, filters?: {
        date?: string;
        status?: string[];
        upcoming?: boolean;
        timezone?: string; // ✅ Added timezone to filter interface
    }): Promise<any[]>;
    getReservation(id: number): Promise<any | undefined>;
    createReservation(reservation: InsertReservation): Promise<Reservation>;
    createReservationAtomic(
        reservation: InsertReservation,
        expectedSlot: { tableId: number; time: string; duration: number }
    ): Promise<Reservation>;
    // ✅ FIXED: Method signature updated to require timezone
    getUpcomingReservations(restaurantId: number, restaurantTimezone: string, hours: number): Promise<any[]>;
    // ✅ FIXED: Method signature updated to require timezone
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
    // ✅ FIXED: Now requires timezone
    updateTableStatusFromReservations(tableId: number, restaurantTimezone: string): Promise<void>;
    updateAllTableStatuses(restaurantId: number, restaurantTimezone: string): Promise<void>;
    getTableAvailability(restaurantId: number, date: string, time: string): Promise<Table[]>;
}

export class DatabaseStorage implements IStorage {
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

    // Timeslot methods
    async getTimeslots(restaurantId: number, date: string): Promise<Timeslot[]> {
        return db
            .select()
            .from(timeslots)
            .where(
                and(
                    eq(timeslots.restaurantId, restaurantId),
                    eq(timeslots.date, date)
                )
            )
            .orderBy(timeslots.time);
    }

    async getTimeslot(id: number): Promise<Timeslot | undefined> {
        const [timeslot] = await db.select().from(timeslots).where(eq(timeslots.id, id));
        return timeslot;
    }

    async createTimeslot(timeslot: InsertTimeslot): Promise<Timeslot> {
        const [newTimeslot] = await db.insert(timeslots).values(timeslot).returning();
        return newTimeslot;
    }

    async updateTimeslot(id: number, timeslot: Partial<InsertTimeslot>): Promise<Timeslot> {
        const [updatedTimeslot] = await db
            .update(timeslots)
            .set(timeslot)
            .where(eq(timeslots.id, id))
            .returning();
        return updatedTimeslot;
    }

    // ✅ FIXED: Now timezone-aware
    async generateTimeslots(restaurantId: number, daysAhead: number): Promise<number> {
        const restaurant = await this.getRestaurant(restaurantId);
        if (!restaurant || !restaurant.openingTime || !restaurant.closingTime) {
            throw new Error("Restaurant or opening hours not found");
        }

        const restaurantTables = await this.getTables(restaurantId);
        if (!restaurantTables.length) {
            return 0;
        }

        // ✅ FIXED: Use restaurant timezone for date calculations
        const restaurantTimezone = restaurant.timezone || 'Europe/Moscow';
        const timeSlotInterval = 30;
        let timeslotsCreated = 0;

        for (let day = 0; day < daysAhead; day++) {
            // ✅ FIXED: Generate dates in restaurant timezone
            const restaurantDateTime = getRestaurantDateTime(restaurantTimezone);
            const targetDate = restaurantDateTime.plus({ days: day });
            const dateString = targetDate.toISODate() as string;

            for (const table of restaurantTables) {
                const startTime = parse(restaurant.openingTime, 'HH:mm:ss', new Date());
                const endTime = parse(restaurant.closingTime, 'HH:mm:ss', new Date());

                const lastSlotTime = new Date(endTime);
                lastSlotTime.setMinutes(lastSlotTime.getMinutes() - (restaurant.avgReservationDuration || 90));

                let currentTime = new Date(startTime);
                while (currentTime <= lastSlotTime) {
                    const timeString = format(currentTime, 'HH:mm:ss');

                    const existingSlots = await db
                        .select()
                        .from(timeslots)
                        .where(
                            and(
                                eq(timeslots.restaurantId, restaurantId),
                                eq(timeslots.tableId, table.id),
                                eq(timeslots.date, dateString),
                                eq(timeslots.time, timeString)
                            )
                        );

                    if (existingSlots.length === 0) {
                        await db.insert(timeslots).values({
                            restaurantId,
                            tableId: table.id,
                            date: dateString,
                            time: timeString,
                            status: 'free'
                        });
                        timeslotsCreated++;
                    }

                    currentTime = addMinutes(currentTime, timeSlotInterval);
                }
            }
        }

        return timeslotsCreated;
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

    // ✅ Your version was good - keeping it
    async getReservations(restaurantId: number, filters?: {
        date?: string;
        status?: string[];
        upcoming?: boolean;
        timezone?: string;
    }): Promise<any[]> {
        const whereConditions = [eq(reservations.restaurantId, restaurantId)];

        if (filters?.date) {
            whereConditions.push(eq(reservations.date, filters.date));
            console.log(`📋 [DEBUG] Filtering by date: ${filters.date}`);
        }

        if (filters?.status && filters.status.length > 0) {
            whereConditions.push(inArray(reservations.status, filters.status));
            console.log(`📋 [DEBUG] Filtering by status: ${filters.status.join(', ')}`);
        } else {
            whereConditions.push(ne(reservations.status, 'canceled'));
            console.log(`📋 [DEBUG] No status filter provided, excluding canceled reservations`);
        }

        // ✅ Your implementation was correct
        if (filters?.upcoming && filters.timezone) {
            const restaurantTimezone = filters.timezone;
            const currentDate = getRestaurantDateString(restaurantTimezone);
            whereConditions.push(sql`${reservations.date} >= '${currentDate}'`);
            console.log(`📋 [DEBUG] Filtering for upcoming reservations from restaurant date: ${currentDate}`);
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
            .orderBy(reservations.date, reservations.time);

        console.log(`📋 [DEBUG] Found ${results.length} reservations with conditions:`, whereConditions.length);

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

        if (newReservation.timeslotId) {
            await db
                .update(timeslots)
                .set({ status: 'pending' })
                .where(eq(timeslots.id, newReservation.timeslotId));
        }
        if (newReservation.tableId) {
            // ✅ FIXED: Now need timezone for table status updates
            const restaurant = await this.getRestaurant(newReservation.restaurantId);
            const timezone = restaurant?.timezone || 'Europe/Moscow';
            await this.updateTableStatusFromReservations(newReservation.tableId, timezone);
        }
        return newReservation;
    }

    // Atomic reservation creation (unchanged logic, but calls fixed methods)
    async createReservationAtomic(
        reservation: InsertReservation,
        expectedSlot: { tableId: number; time: string; duration: number }
    ): Promise<Reservation> {
        console.log(`🔒 [AtomicBooking] Starting atomic reservation creation for table ${expectedSlot.tableId} at ${expectedSlot.time}`);

        return await db.transaction(async (tx) => {
            try {
                const existingReservations = await tx
                    .select({
                        id: reservations.id,
                        time: reservations.time,
                        duration: reservations.duration,
                        status: reservations.status,
                        guestId: reservations.guestId,
                        booking_guest_name: reservations.booking_guest_name
                    })
                    .from(reservations)
                    .where(and(
                        eq(reservations.restaurantId, reservation.restaurantId),
                        eq(reservations.tableId, expectedSlot.tableId),
                        eq(reservations.date, reservation.date),
                        inArray(reservations.status, ['confirmed', 'created'])
                    ));

                console.log(`🔒 [AtomicBooking] Found ${existingReservations.length} existing reservations for table ${expectedSlot.tableId}`);

                const newStartMinutes = this.parseTimeToMinutes(expectedSlot.time);
                const newEndMinutes = newStartMinutes + expectedSlot.duration;

                for (const existing of existingReservations) {
                    const existingStartMinutes = this.parseTimeToMinutes(existing.time);
                    const existingDuration = existing.duration || 120;
                    const existingEndMinutes = existingStartMinutes + existingDuration;

                    const hasOverlap = newStartMinutes < existingEndMinutes && newEndMinutes > existingStartMinutes;

                    if (hasOverlap) {
                        const conflictEndHour = Math.floor(existingEndMinutes / 60);
                        const conflictEndMin = existingEndMinutes % 60;
                        const conflictEndTime = `${conflictEndHour.toString().padStart(2, '0')}:${conflictEndMin.toString().padStart(2, '0')}`;

                        console.log(`❌ [AtomicBooking] CONFLICT DETECTED: Table ${expectedSlot.tableId} has existing reservation from ${existing.time} to ${conflictEndTime} (ID: ${existing.id})`);

                        throw new Error(`Table no longer available - conflict detected with existing reservation from ${existing.time} to ${conflictEndTime}`);
                    }
                }

                console.log(`✅ [AtomicBooking] No conflicts found for table ${expectedSlot.tableId} at ${expectedSlot.time}`);

                const [newReservation] = await tx
                    .insert(reservations)
                    .values(reservation)
                    .returning();

                console.log(`✅ [AtomicBooking] Created reservation ID ${newReservation.id} for table ${expectedSlot.tableId}`);

                if (newReservation.timeslotId) {
                    await tx
                        .update(timeslots)
                        .set({ status: 'pending' })
                        .where(eq(timeslots.id, newReservation.timeslotId));

                    console.log(`✅ [AtomicBooking] Updated timeslot ${newReservation.timeslotId} status to pending`);
                }

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

        if (reservation.status === 'confirmed' && updatedReservation.timeslotId) {
            await db
                .update(timeslots)
                .set({ status: 'occupied' })
                .where(eq(timeslots.id, updatedReservation.timeslotId));
        }
        if (reservation.status === 'canceled' && updatedReservation.timeslotId) {
            await db
                .update(timeslots)
                .set({ status: 'free' })
                .where(eq(timeslots.id, updatedReservation.timeslotId));
        }
        if (updatedReservation.tableId) {
            // ✅ FIXED: Now need timezone for table status updates
            const restaurant = await this.getRestaurant(updatedReservation.restaurantId);
            const timezone = restaurant?.timezone || 'Europe/Moscow';
            await this.updateTableStatusFromReservations(updatedReservation.tableId, timezone);
        }
        return updatedReservation;
    }

    // ✅ Your version was perfect - keeping it
    async getUpcomingReservations(restaurantId: number, restaurantTimezone: string, hours: number = 3): Promise<any[]> {
        const nowInRestaurantZone = getRestaurantDateTime(restaurantTimezone);

        const currentDate = nowInRestaurantZone.toISODate() as string;
        const currentTime = nowInRestaurantZone.toFormat('HH:mm:ss');
        const endTime = nowInRestaurantZone.plus({ hours }).toFormat('HH:mm:ss');

        console.log(`⏰ [DEBUG] Getting upcoming reservations for restaurant timezone ${restaurantTimezone}: ${currentDate} ${currentTime} to ${endTime}`);

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
                    eq(reservations.date, currentDate),
                    gte(reservations.time, currentTime),
                    lte(reservations.time, endTime),
                    inArray(reservations.status, ['confirmed', 'created'])
                )
            )
            .orderBy(reservations.time)
            .limit(10);

        console.log(`⏰ [DEBUG] Found ${results.length} upcoming reservations`);

        return results.map(r => ({
            ...r,
            guestName: r.reservation.booking_guest_name || r.guest.name,
        }));
    }

    // ✅ Your version was perfect - keeping it  
    async getReservationStatistics(restaurantId: number, restaurantTimezone: string): Promise<{
        todayReservations: number;
        confirmedReservations: number;
        pendingReservations: number;
        totalGuests: number;
    }> {
        const today = getRestaurantDateString(restaurantTimezone);

        console.log(`📊 [DEBUG] Getting stats for restaurant ${restaurantId} on its date: ${today}`);

        const [todayCount] = await db
            .select({ count: count() })
            .from(reservations)
            .innerJoin(tables, eq(reservations.tableId, tables.id))
            .where(
                and(
                    eq(reservations.restaurantId, restaurantId),
                    eq(reservations.date, today),
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
                    eq(reservations.date, today),
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
                    eq(reservations.date, today),
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
                    eq(reservations.date, today),
                    ne(reservations.status, 'canceled')
                )
            );

        const stats = {
            todayReservations: todayCount?.count || 0,
            confirmedReservations: confirmedCount?.count || 0,
            pendingReservations: pendingCount?.count || 0,
            totalGuests: guestsResult?.total || 0,
        };

        console.log(`📊 [DEBUG] Computed stats:`, stats);
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

    // ✅ FIXED: Real-time table availability methods now timezone-aware
    async updateTableStatusFromReservations(tableId: number, restaurantTimezone: string): Promise<void> {
        // ✅ FIXED: Use restaurant's current time instead of server time
        const nowInRestaurant = getRestaurantDateTime(restaurantTimezone);
        const today = nowInRestaurant.toISODate() as string;
        const currentTime = nowInRestaurant.toFormat('HH:mm:ss');

        console.log(`🏢 [DEBUG] Updating table ${tableId} status using restaurant time: ${today} ${currentTime} (${restaurantTimezone})`);

        const [activeReservation] = await db
            .select()
            .from(reservations)
            .where(
                and(
                    eq(reservations.tableId, tableId),
                    eq(reservations.date, today),
                    lte(reservations.time, currentTime),
                    gte(sql`${reservations.time} + INTERVAL '2 hours'`, currentTime),
                    inArray(reservations.status, ['confirmed', 'created'])
                )
            );
        const [upcomingReservation] = await db
            .select()
            .from(reservations)
            .where(
                and(
                    eq(reservations.tableId, tableId),
                    or(
                        and(eq(reservations.date, today), gte(reservations.time, currentTime)),
                        gt(reservations.date, today)
                    ),
                    inArray(reservations.status, ['confirmed', 'created'])
                )
            );

        let newStatus: 'free' | 'occupied' | 'reserved' | 'unavailable' = 'free';
        if (activeReservation) {
            newStatus = 'occupied';
        } else if (upcomingReservation) {
            newStatus = 'reserved';
        }
        
        console.log(`🏢 [DEBUG] Table ${tableId} status: ${newStatus}`);
        
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

    async getTableAvailability(restaurantId: number, date: string, time: string): Promise<Table[]> {
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
                            .where(
                                and(
                                    eq(reservations.tableId, tables.id),
                                    eq(reservations.date, date),
                                    eq(reservations.time, time),
                                    inArray(reservations.status, ['confirmed', 'created'])
                                )
                            )
                    )
                )
            );
        return availableTables;
    }
}

export const storage = new DatabaseStorage();