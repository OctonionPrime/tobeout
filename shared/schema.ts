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

// Restaurants table
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
  avgReservationDuration: integer("avg_reservation_duration").default(90), // in minutes
  minGuests: integer("min_guests").default(1),
  maxGuests: integer("max_guests").default(12),
  phone: text("phone"),
  googleMapsLink: text("google_maps_link"),
  tripAdvisorLink: text("trip_advisor_link"),
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
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  email: text("email"),
  language: text("language").default('en'),
  birthday: date("birthday"),
  comments: text("comments"),
  tags: text("tags").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const guestsRelations = relations(guests, ({ many }) => ({
  reservations: many(reservations),
}));

// Reservations table
export const reservations = pgTable("reservations", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurants.id).notNull(),
  guestId: integer("guest_id").references(() => guests.id).notNull(),
  tableId: integer("table_id").references(() => tables.id),
  timeslotId: integer("timeslot_id").references(() => timeslots.id),
  date: date("date").notNull(),
  time: time("time").notNull(),
  duration: integer("duration").default(90), // in minutes
  guests: integer("guests").notNull(),
  status: reservationStatusEnum("status").default('created'),
  comments: text("comments"),
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

// Create insert schemas
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertRestaurantSchema = createInsertSchema(restaurants).omit({ id: true, createdAt: true });
export const insertTableSchema = createInsertSchema(tables).omit({ id: true, createdAt: true });
export const insertTimeslotSchema = createInsertSchema(timeslots).omit({ id: true, createdAt: true });
export const insertGuestSchema = createInsertSchema(guests).omit({ id: true, createdAt: true });
export const insertReservationSchema = createInsertSchema(reservations).omit({ id: true, createdAt: true });
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
