import { pgTable, serial, text, integer, boolean, timestamp, date, time, foreignKey, json, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";
import { z } from "zod";

// Enums
export const userRoleEnum = pgEnum('user_role', ['admin', 'restaurant', 'staff']);
export const reservationStatusEnum = pgEnum('reservation_status', ['created', 'confirmed', 'canceled', 'completed', 'archived']);
export const tableStatusEnum = pgEnum('table_status', ['free', 'occupied', 'reserved', 'unavailable']);
export const timeslotStatusEnum = pgEnum('timeslot_status', ['free', 'pending', 'occupied']);

// Users table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: userRoleEnum("role").notNull().default('restaurant'),
  name: text("name").notNull(),
  phone: text("phone"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [users.id],
    references: [restaurants.userId],
  }),
}));

// ✅ ENHANCED: Restaurants table with flexible time configuration
export const restaurants = pgTable("restaurants", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  country: text("country"),
  city: text("city"),
  address: text("address"),
  photo: text("photo"),
  openingTime: time("opening_time"),
  closingTime: time("closing_time"),
  cuisine: text("cuisine"),
  atmosphere: text("atmosphere"),
  features: text("features").array(),
  tags: text("tags").array(),
  languages: text("languages").array(),
  avgReservationDuration: integer("avg_reservation_duration").default(120),
  minGuests: integer("min_guests").default(1),
  maxGuests: integer("max_guests").default(12),
  phone: text("phone"),
  googleMapsLink: text("google_maps_link"),
  tripAdvisorLink: text("trip_advisor_link"),
  timezone: text("timezone").notNull().default('Europe/Moscow'),
  
  // ✅ NEW: Flexible time booking configuration
  slotInterval: integer("slot_interval").default(30), // 15, 30, or 60 minutes for suggestions
  allowAnyTime: boolean("allow_any_time").default(true), // Allow booking at any time vs only slots
  minTimeIncrement: integer("min_time_increment").default(15), // 5, 15, or 30 minutes precision
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const restaurantsRelations = relations(restaurants, ({ one, many }) => ({
  user: one(users, {
    fields: [restaurants.userId],
    references: [users.id],
  }),
  tables: many(tables),
  reservations: many(reservations),
  timeslots: many(timeslots),
}));

// Tables table
export const tables = pgTable("tables", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurants.id).notNull(),
  name: text("name").notNull(),
  minGuests: integer("min_guests").notNull().default(1),
  maxGuests: integer("max_guests").notNull(),
  status: tableStatusEnum("status").default('free'),
  features: text("features").array(),
  comments: text("comments"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tablesRelations = relations(tables, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [tables.restaurantId],
    references: [restaurants.id],
  }),
  timeslots: many(timeslots),
  reservations: many(reservations),
}));

// Timeslots table
export const timeslots = pgTable("timeslots", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurants.id).notNull(),
  tableId: integer("table_id").references(() => tables.id).notNull(),
  date: date("date").notNull(),
  time: time("time").notNull(),
  status: timeslotStatusEnum("status").default('free'),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const timeslotsRelations = relations(timeslots, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [timeslots.restaurantId],
    references: [restaurants.id],
  }),
  table: one(tables, {
    fields: [timeslots.tableId],
    references: [tables.id],
  }),
  reservation: one(reservations, {
    fields: [timeslots.id],
    references: [reservations.timeslotId],
  }),
}));

// Guests table
export const guests = pgTable("guests", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // This is the guest's main profile name
  phone: text("phone"),
  email: text("email"),
  telegram_user_id: text("telegram_user_id").unique(),
  language: text("language").default('en'),
  birthday: date("birthday"),
  comments: text("comments"),
  tags: text("tags").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const guestsRelations = relations(guests, ({ many }) => ({
  reservations: many(reservations),
}));

// ✅ FIXED: Reservations table with UTC timestamp
export const reservations = pgTable("reservations", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurants.id).notNull(),
  guestId: integer("guest_id").references(() => guests.id).notNull(),
  tableId: integer("table_id").references(() => tables.id),
  timeslotId: integer("timeslot_id").references(() => timeslots.id),
  // ✅ THE FIX: A single, unambiguous, timezone-aware timestamp stored in UTC
  reservation_utc: timestamp("reservation_utc", { withTimezone: true, mode: 'string' }).notNull(),
  duration: integer("duration").default(120),
  guests: integer("guests").notNull(),
  status: reservationStatusEnum("status").default('created'),
  // New field to store the name specifically used for this booking, if different from guest's profile
  booking_guest_name: text("booking_guest_name"), 
  comments: text("comments"),
  specialRequests: text("special_requests"), // dietary preferences, seating requests, etc.
  staffNotes: text("staff_notes"), // internal staff observations
  totalAmount: text("total_amount"), // stored as string to handle different currencies/formats
  currency: text("currency").default('USD'),
  guestRating: integer("guest_rating"), // 1-5 stars, guest satisfaction
  confirmation24h: boolean("confirmation_24h").default(false),
  confirmation2h: boolean("confirmation_2h").default(false),
  source: text("source").default('direct'), // direct, telegram, web, facebook, etc.
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const reservationsRelations = relations(reservations, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [reservations.restaurantId],
    references: [restaurants.id],
  }),
  guest: one(guests, {
    fields: [reservations.guestId],
    references: [guests.id],
  }),
  table: one(tables, {
    fields: [reservations.tableId],
    references: [tables.id],
  }),
  timeslot: one(timeslots, {
    fields: [reservations.timeslotId],
    references: [timeslots.id],
  }),
}));

// Integration settings table
export const integrationSettings = pgTable("integration_settings", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurants.id).notNull(),
  type: text("type").notNull(), // telegram, facebook, web, etc.
  apiKey: text("api_key"),
  token: text("token"),
  enabled: boolean("enabled").default(false),
  settings: json("settings"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const integrationSettingsRelations = relations(integrationSettings, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [integrationSettings.restaurantId],
    references: [restaurants.id],
  }),
}));

// AI activities log table
export const aiActivities = pgTable("ai_activities", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurants.id).notNull(),
  type: text("type").notNull(), // reservation_create, reservation_update, reminder_sent, etc.
  description: text("description").notNull(),
  data: json("data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const aiActivitiesRelations = relations(aiActivities, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [aiActivities.restaurantId],
    references: [restaurants.id],
  }),
}));

// ✅ ENHANCED: Create insert schemas with new time configuration fields
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });

export const insertRestaurantSchema = createInsertSchema(restaurants, {
  timezone: z.string().min(1, "Timezone is required")
    .refine((tz) => {
      // Validate timezone format using Intl.supportedValuesOf if available, or basic validation
      try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Invalid timezone format"),
  // ✅ NEW: Validation for flexible time configuration
  slotInterval: z.number().min(15).max(60).optional(),
  allowAnyTime: z.boolean().optional(),
  minTimeIncrement: z.number().min(5).max(30).optional(),
}).omit({ id: true, createdAt: true });

export const insertTableSchema = createInsertSchema(tables).omit({ id: true, createdAt: true });
export const insertTimeslotSchema = createInsertSchema(timeslots).omit({ id: true, createdAt: true });
export const insertGuestSchema = createInsertSchema(guests).omit({ id: true, createdAt: true });

// ✅ FIXED: Updated insert schema for reservations
export const insertReservationSchema = createInsertSchema(reservations, {
  booking_guest_name: z.string().optional().nullable(),
  // ✅ Add validation for our new, required field
  reservation_utc: z.string().datetime({ message: "Invalid ISO 8601 UTC timestamp format" }),
}).omit({ id: true, createdAt: true });

export const insertIntegrationSettingSchema = createInsertSchema(integrationSettings).omit({ id: true, createdAt: true });
export const insertAiActivitySchema = createInsertSchema(aiActivities).omit({ id: true, createdAt: true });

// Export types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Restaurant = typeof restaurants.$inferSelect;
export type InsertRestaurant = z.infer<typeof insertRestaurantSchema>;

export type Table = typeof tables.$inferSelect;
export type InsertTable = z.infer<typeof insertTableSchema>;

export type Timeslot = typeof timeslots.$inferSelect;
export type InsertTimeslot = z.infer<typeof insertTimeslotSchema>;

export type Guest = typeof guests.$inferSelect;
export type InsertGuest = z.infer<typeof insertGuestSchema>;

export type Reservation = typeof reservations.$inferSelect;
export type InsertReservation = z.infer<typeof insertReservationSchema>;

export type IntegrationSetting = typeof integrationSettings.$inferSelect;
export type InsertIntegrationSetting = z.infer<typeof insertIntegrationSettingSchema>;

export type AiActivity = typeof aiActivities.$inferSelect;
export type InsertAiActivity = z.infer<typeof insertAiActivitySchema>;