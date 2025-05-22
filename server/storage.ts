import {
  users, restaurants, tables, timeslots, guests, reservations, 
  integrationSettings, aiActivities,
  type User, type InsertUser, 
  type Restaurant, type InsertRestaurant,
  type Table, type InsertTable,
  type Timeslot, type InsertTimeslot,
  type Guest, type InsertGuest,
  type Reservation, type InsertReservation,
  type IntegrationSetting, type InsertIntegrationSetting,
  type AiActivity, type InsertAiActivity
} from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lte, desc, sql, count, or, inArray, gt, ne, notExists } from "drizzle-orm";
import { addMinutes, format, parse, parseISO } from "date-fns";

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
  generateTimeslots(restaurantId: number, daysAhead: number): Promise<number>;

  // Guest methods
  getGuests(restaurantId: number): Promise<Guest[]>;
  getGuest(id: number): Promise<Guest | undefined>;
  getGuestByPhone(phone: string): Promise<Guest | undefined>;
  createGuest(guest: InsertGuest): Promise<Guest>;
  updateGuest(id: number, guest: Partial<InsertGuest>): Promise<Guest>;

  // Reservation methods
  getReservations(restaurantId: number, filters?: {
    date?: string;
    status?: string[];
    upcoming?: boolean;
  }): Promise<Reservation[]>;
  getReservation(id: number): Promise<Reservation | undefined>;
  createReservation(reservation: InsertReservation): Promise<Reservation>;
  updateReservation(id: number, reservation: Partial<InsertReservation>): Promise<Reservation>;
  getUpcomingReservations(restaurantId: number, hours: number): Promise<Reservation[]>;
  getReservationStatistics(restaurantId: number): Promise<{
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
  updateTableStatusFromReservations(tableId: number): Promise<void>;
  updateAllTableStatuses(restaurantId: number): Promise<void>;
  getTableAvailability(restaurantId: number, date: string, time: string): Promise<Table[]>;
}

export class DatabaseStorage implements IStorage {
  // User methods
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

  // Restaurant methods
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

  // Table methods
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

  async generateTimeslots(restaurantId: number, daysAhead: number): Promise<number> {
    // Get restaurant details to determine opening hours
    const restaurant = await this.getRestaurant(restaurantId);
    if (!restaurant || !restaurant.openingTime || !restaurant.closingTime) {
      throw new Error("Restaurant or opening hours not found");
    }

    // Get all tables for the restaurant
    const restaurantTables = await this.getTables(restaurantId);
    if (!restaurantTables.length) {
      return 0;
    }

    const timeSlotInterval = 30; // Minutes
    let timeslotsCreated = 0;

    // Generate for each day
    for (let day = 0; day < daysAhead; day++) {
      const date = new Date();
      date.setDate(date.getDate() + day);
      const dateString = format(date, 'yyyy-MM-dd');

      // Generate for each table
      for (const table of restaurantTables) {
        // Parse opening and closing times
        const startTime = parse(restaurant.openingTime, 'HH:mm:ss', new Date());
        const endTime = parse(restaurant.closingTime, 'HH:mm:ss', new Date());
        
        // Account for restaurant.avgReservationDuration
        // Last slot should allow for full duration before closing
        const lastSlotTime = new Date(endTime);
        lastSlotTime.setMinutes(lastSlotTime.getMinutes() - restaurant.avgReservationDuration);

        // Loop through time slots for the day
        let currentTime = new Date(startTime);
        while (currentTime <= lastSlotTime) {
          const timeString = format(currentTime, 'HH:mm:ss');
          
          // Check if timeslot already exists
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
          
          // If slot doesn't exist, create it
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
          
          // Move to next timeslot
          currentTime = addMinutes(currentTime, timeSlotInterval);
        }
      }
    }

    return timeslotsCreated;
  }

  // Guest methods
  async getGuests(restaurantId: number): Promise<Guest[]> {
    // Get guests with their reservation counts
    const guestsWithCounts = await db
      .select({
        id: guests.id,
        name: guests.name,
        phone: guests.phone,
        email: guests.email,
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

    return guestsWithCounts;
  }

  async getGuest(id: number): Promise<Guest | undefined> {
    const [guest] = await db.select().from(guests).where(eq(guests.id, id));
    return guest;
  }

  async getGuestByPhone(phone: string): Promise<Guest | undefined> {
    const [guest] = await db.select().from(guests).where(eq(guests.phone, phone));
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

  // Reservation methods
  async getReservations(restaurantId: number, filters?: {
    date?: string;
    status?: string[];
    upcoming?: boolean;
  }): Promise<any[]> {
    // Get reservations with guest and table information
    const reservationsWithDetails = await db
      .select({
        // Reservation fields
        id: reservations.id,
        restaurantId: reservations.restaurantId,
        guestId: reservations.guestId,
        tableId: reservations.tableId,
        timeslotId: reservations.timeslotId,
        date: reservations.date,
        time: reservations.time,
        duration: reservations.duration,
        guests: reservations.guests,
        status: reservations.status,
        comments: reservations.comments,
        source: reservations.source,
        createdAt: reservations.createdAt,
        // Guest fields
        guest: {
          id: guests.id,
          name: guests.name,
          phone: guests.phone,
          email: guests.email,
          language: guests.language
        },
        // Table fields
        table: {
          id: tables.id,
          name: tables.name,
          minGuests: tables.minGuests,
          maxGuests: tables.maxGuests
        }
      })
      .from(reservations)
      .leftJoin(guests, eq(reservations.guestId, guests.id))
      .leftJoin(tables, eq(reservations.tableId, tables.id))
      .where(eq(reservations.restaurantId, restaurantId))
      .orderBy(reservations.date, reservations.time);

    return reservationsWithDetails;
  }

  async getReservation(id: number): Promise<Reservation | undefined> {
    const [reservation] = await db.select().from(reservations).where(eq(reservations.id, id));
    return reservation;
  }

  async createReservation(reservation: InsertReservation): Promise<Reservation> {
    const [newReservation] = await db.insert(reservations).values(reservation).returning();
    
    // If timeslotId is provided, update the timeslot status
    if (newReservation.timeslotId) {
      await db
        .update(timeslots)
        .set({ status: 'pending' })
        .where(eq(timeslots.id, newReservation.timeslotId));
    }

    return newReservation;
  }

  async updateReservation(id: number, reservation: Partial<InsertReservation>): Promise<Reservation> {
    const [updatedReservation] = await db
      .update(reservations)
      .set(reservation)
      .where(eq(reservations.id, id))
      .returning();

    // If status changed to confirmed, update the timeslot
    if (reservation.status === 'confirmed' && updatedReservation.timeslotId) {
      await db
        .update(timeslots)
        .set({ status: 'occupied' })
        .where(eq(timeslots.id, updatedReservation.timeslotId));
    }
    
    // If status changed to canceled, update the timeslot
    if (reservation.status === 'canceled' && updatedReservation.timeslotId) {
      await db
        .update(timeslots)
        .set({ status: 'free' })
        .where(eq(timeslots.id, updatedReservation.timeslotId));
    }

    return updatedReservation;
  }

  async getUpcomingReservations(restaurantId: number, hours: number = 3): Promise<Reservation[]> {
    const currentDate = format(new Date(), 'yyyy-MM-dd');
    const currentTime = format(new Date(), 'HH:mm:ss');
    const endTime = format(addMinutes(new Date(), hours * 60), 'HH:mm:ss');

    return db
      .select({
        reservation: reservations,
        guest: guests,
        table: tables
      })
      .from(reservations)
      .leftJoin(guests, eq(reservations.guestId, guests.id))
      .leftJoin(tables, eq(reservations.tableId, tables.id))
      .where(
        and(
          eq(reservations.restaurantId, restaurantId),
          eq(reservations.date, currentDate),
          gte(reservations.time, currentTime),
          lte(reservations.time, endTime)
        )
      )
      .orderBy(reservations.time)
      .limit(10);
  }

  async getReservationStatistics(restaurantId: number): Promise<{
    todayReservations: number;
    confirmedReservations: number;
    pendingReservations: number;
    totalGuests: number;
  }> {
    const today = format(new Date(), 'yyyy-MM-dd');

    // Get total reservations for today
    const [todayCount] = await db
      .select({ count: count() })
      .from(reservations)
      .where(
        and(
          eq(reservations.restaurantId, restaurantId),
          eq(reservations.date, today)
        )
      );

    // Get confirmed reservations for today
    const [confirmedCount] = await db
      .select({ count: count() })
      .from(reservations)
      .where(
        and(
          eq(reservations.restaurantId, restaurantId),
          eq(reservations.date, today),
          eq(reservations.status, 'confirmed')
        )
      );

    // Get pending reservations for today
    const [pendingCount] = await db
      .select({ count: count() })
      .from(reservations)
      .where(
        and(
          eq(reservations.restaurantId, restaurantId),
          eq(reservations.date, today),
          eq(reservations.status, 'created')
        )
      );

    // Get total guests for today
    const [guestsResult] = await db
      .select({ total: sql`SUM(${reservations.guests})` })
      .from(reservations)
      .where(
        and(
          eq(reservations.restaurantId, restaurantId),
          eq(reservations.date, today)
        )
      );

    return {
      todayReservations: todayCount?.count || 0,
      confirmedReservations: confirmedCount?.count || 0,
      pendingReservations: pendingCount?.count || 0,
      totalGuests: guestsResult?.total || 0,
    };
  }

  // Integration settings methods
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
    // Check if settings already exist
    const existingSettings = await this.getIntegrationSettings(
      settings.restaurantId,
      settings.type
    );

    if (existingSettings) {
      // Update existing settings
      const [updatedSettings] = await db
        .update(integrationSettings)
        .set(settings)
        .where(eq(integrationSettings.id, existingSettings.id))
        .returning();
      return updatedSettings;
    } else {
      // Create new settings
      const [newSettings] = await db
        .insert(integrationSettings)
        .values(settings)
        .returning();
      return newSettings;
    }
  }

  // AI activities methods
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

  // Real-time table availability methods
  async updateTableStatusFromReservations(tableId: number): Promise<void> {
    const now = new Date();
    const today = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const currentTime = now.toTimeString().split(' ')[0]; // HH:mm:ss

    // Check if table has any active reservations right now
    const [activeReservation] = await db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.tableId, tableId),
          eq(reservations.date, today),
          lte(reservations.time, currentTime),
          gte(sql`${reservations.time} + INTERVAL '2 hours'`, currentTime), // Assuming 2-hour duration
          inArray(reservations.status, ['confirmed', 'created'])
        )
      );

    // Check if table has upcoming reservations
    const [upcomingReservation] = await db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.tableId, tableId),
          or(
            and(eq(reservations.date, today), gte(reservations.time, currentTime)),
            gte(reservations.date, today)
          ),
          inArray(reservations.status, ['confirmed', 'created'])
        )
      );

    // Determine new status
    let newStatus: 'free' | 'occupied' | 'reserved' | 'unavailable' = 'free';
    
    if (activeReservation) {
      newStatus = 'occupied';
    } else if (upcomingReservation) {
      newStatus = 'reserved';
    }

    // Update table status
    await db
      .update(tables)
      .set({ status: newStatus })
      .where(eq(tables.id, tableId));
  }

  async updateAllTableStatuses(restaurantId: number): Promise<void> {
    const restaurantTables = await this.getTables(restaurantId);
    
    for (const table of restaurantTables) {
      await this.updateTableStatusFromReservations(table.id);
    }
  }

  async getTableAvailability(restaurantId: number, date: string, time: string): Promise<Table[]> {
    // Get available tables for specific date/time
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
