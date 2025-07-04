import { pgTable, serial, text, integer, boolean, timestamp, date, time, foreignKey, json, pgEnum, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";
import { z } from "zod";

// ================================
// ENHANCED ENUMS
// ================================

export const userRoleEnum = pgEnum('user_role', ['admin', 'restaurant', 'staff']);

// ✅ ENHANCED: Complete reservation lifecycle with new statuses
export const reservationStatusEnum = pgEnum('reservation_status', [
    'created', 'confirmed', 'seated', 'in_progress', 'completed', 'canceled', 'no_show', 'archived'
]);

export const tableStatusEnum = pgEnum('table_status', ['free', 'occupied', 'reserved', 'unavailable']);
export const timeslotStatusEnum = pgEnum('timeslot_status', ['free', 'pending', 'occupied']);

// ✅ NEW: Keep allergen enum (standardized globally)
export const allergenEnum = pgEnum('allergen', [
  'gluten', 'dairy', 'eggs', 'nuts', 'peanuts', 'soy', 'fish', 'shellfish'
]);

// ================================
// CORE TABLES
// ================================

// Users table (unchanged)
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
  
  // ✅ EXISTING: Flexible time booking configuration
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
  policies: many(restaurantPolicies),
  // ✅ NEW: Menu system relations
  menuCategories: many(restaurantMenuCategories),
  menuItems: many(menuItems),
}));

// Tables table (unchanged)
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

// Timeslots table (unchanged)
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

// ✅ ENHANCED: Guests table with comprehensive analytics
export const guests = pgTable("guests", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  telegram_user_id: text("telegram_user_id").unique(),
  language: text("language").default('en'),
  birthday: date("birthday"),
  comments: text("comments"),
  tags: text("tags").array(),
  
  // ✅ NEW: Guest analytics and intelligence fields
  visit_count: integer("visit_count").default(0).notNull(),
  no_show_count: integer("no_show_count").default(0).notNull(),
  total_spent: decimal("total_spent", { precision: 10, scale: 2 }).default('0').notNull(),
  average_duration: integer("average_duration").default(120), // minutes
  preferences: json("preferences").$type<{
    dietary_restrictions?: string[];
    preferred_seating?: string;
    special_occasions?: string[];
    communication_preference?: 'telegram' | 'phone' | 'email';
  }>(),
  vip_level: integer("vip_level").default(0), // 0-5 scale
  last_visit_date: timestamp("last_visit_date"),
  reputation_score: integer("reputation_score").default(100), // 0-100 scale
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const guestsRelations = relations(guests, ({ many }) => ({
  reservations: many(reservations),
}));

// ✅ ENHANCED: Reservations table with Maya's features
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
  // ✅ EXISTING: Maya's modification tracking
  lastModifiedAt: timestamp("last_modified_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const reservationsRelations = relations(reservations, ({ one, many }) => ({
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
    references: [reservations.id],
  }),
  // ✅ EXISTING: Maya's audit trail relations
  modifications: many(reservationModifications),
  cancellation: one(reservationCancellations, {
    fields: [reservations.id],
    references: [reservationCancellations.reservationId],
  }),
  // ✅ NEW: Status history relation
  statusHistory: many(reservationStatusHistory),
}));

// ================================
// ✅ NEW: RESERVATION STATUS HISTORY
// ================================

export const reservationStatusHistory = pgTable("reservation_status_history", {
  id: serial("id").primaryKey(),
  reservationId: integer("reservation_id").references(() => reservations.id, { onDelete: 'cascade' }).notNull(),
  fromStatus: reservationStatusEnum("from_status"),
  toStatus: reservationStatusEnum("to_status").notNull(),
  changedBy: text("changed_by"), // 'system', 'staff', 'guest'
  changeReason: text("change_reason"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  metadata: json("metadata").$type<{
    staffMember?: string;
    automaticTrigger?: string;
    guestAction?: string;
  }>(),
});

export const reservationStatusHistoryRelations = relations(reservationStatusHistory, ({ one }) => ({
  reservation: one(reservations, {
    fields: [reservationStatusHistory.reservationId],
    references: [reservations.id],
  }),
}));

// ================================
// ✅ NEW: FLEXIBLE MENU MANAGEMENT SYSTEM
// ================================

// Restaurant-specific menu categories (flexible, not hardcoded)
export const restaurantMenuCategories = pgTable("restaurant_menu_categories", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurants.id, { onDelete: 'cascade' }).notNull(),
  name: text("name").notNull(), // "Appetizers", "Chef's Specials", "Craft Cocktails"
  slug: text("slug").notNull(), // "appetizers", "chefs-specials", "craft-cocktails"
  description: text("description"), // Optional description for staff
  displayOrder: integer("display_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  color: text("color"), // Optional hex color for UI: "#FF6B6B"
  icon: text("icon"), // Optional icon name: "utensils", "wine-glass", "birthday-cake"
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Ensure unique category slugs per restaurant
  unique: [table.restaurantId, table.slug]
}));

export const restaurantMenuCategoriesRelations = relations(restaurantMenuCategories, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [restaurantMenuCategories.restaurantId],
    references: [restaurants.id],
  }),
  menuItems: many(menuItems),
}));

// Menu items table with comprehensive features
export const menuItems = pgTable("menu_items", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurants.id, { onDelete: 'cascade' }).notNull(),
  
  // ✅ FLEXIBLE: Reference restaurant's custom category instead of hardcoded enum
  categoryId: integer("category_id").references(() => restaurantMenuCategories.id).notNull(),
  
  name: text("name").notNull(),
  description: text("description"),
  shortDescription: text("short_description"), // For compact displays
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  originalPrice: decimal("original_price", { precision: 10, scale: 2 }), // For discounts
  
  // ✅ FLEXIBLE: Free-form subcategory (restaurant can use anything)
  subcategory: text("subcategory"), // "Pasta", "Grilled", "Vegetarian", "House Specials"
  
  // Dietary and allergen information (standardized)
  allergens: allergenEnum("allergens").array(),
  dietaryTags: text("dietary_tags").array(), // ['vegan', 'vegetarian', 'keto', 'low-carb']
  spicyLevel: integer("spicy_level").default(0), // 0-5 scale
  
  // Availability and popularity
  isAvailable: boolean("is_available").default(true).notNull(),
  isPopular: boolean("is_popular").default(false).notNull(),
  isNew: boolean("is_new").default(false).notNull(),
  isSeasonal: boolean("is_seasonal").default(false).notNull(),
  
  // Operational data
  preparationTime: integer("preparation_time"), // minutes
  calories: integer("calories"),
  servingSize: text("serving_size"),
  
  // Ordering and display
  displayOrder: integer("display_order").default(0),
  availableFrom: time("available_from"), // e.g., "11:00" for lunch items
  availableTo: time("available_to"),     // e.g., "23:00"
  
  // Admin fields
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const menuItemsRelations = relations(menuItems, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [menuItems.restaurantId],
    references: [restaurants.id],
  }),
  category: one(restaurantMenuCategories, {
    fields: [menuItems.categoryId],
    references: [restaurantMenuCategories.id],
  }),
  options: many(menuItemOptions),
  searchLogs: many(menuSearchLog),
}));

// Menu item customization options (e.g., "Size", "Cooking level", "Extras")
export const menuItemOptions = pgTable("menu_item_options", {
  id: serial("id").primaryKey(),
  menuItemId: integer("menu_item_id").references(() => menuItems.id, { onDelete: 'cascade' }).notNull(),
  name: text("name").notNull(), // "Size", "Extras", "Cooking level"
  type: text("type").notNull(), // "radio", "checkbox", "select"
  isRequired: boolean("is_required").default(false).notNull(),
  displayOrder: integer("display_order").default(0),
});

export const menuItemOptionsRelations = relations(menuItemOptions, ({ one, many }) => ({
  menuItem: one(menuItems, {
    fields: [menuItemOptions.menuItemId],
    references: [menuItems.id],
  }),
  values: many(menuItemOptionValues),
}));

// Values for menu item options (e.g., "Large", "Medium rare", "Extra cheese")
export const menuItemOptionValues = pgTable("menu_item_option_values", {
  id: serial("id").primaryKey(),
  optionId: integer("option_id").references(() => menuItemOptions.id, { onDelete: 'cascade' }).notNull(),
  value: text("value").notNull(), // "Large", "Extra cheese", "Medium rare"
  priceModifier: decimal("price_modifier", { precision: 10, scale: 2 }).default('0'), // +2.50, -1.00
  displayOrder: integer("display_order").default(0),
});

export const menuItemOptionValuesRelations = relations(menuItemOptionValues, ({ one }) => ({
  option: one(menuItemOptions, {
    fields: [menuItemOptionValues.optionId],
    references: [menuItemOptions.id],
  }),
}));

// Menu search analytics
export const menuSearchLog = pgTable("menu_search_log", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurants.id).notNull(),
  query: text("query").notNull(),
  resultsCount: integer("results_count").notNull(),
  clickedItemId: integer("clicked_item_id").references(() => menuItems.id),
  source: text("source").notNull(), // 'ai_chat', 'staff_search', 'guest_inquiry'
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const menuSearchLogRelations = relations(menuSearchLog, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [menuSearchLog.restaurantId],
    references: [restaurants.id],
  }),
  clickedItem: one(menuItems, {
    fields: [menuSearchLog.clickedItemId],
    references: [menuItems.id],
  }),
}));

// ✅ NEW: Category templates for quick restaurant setup
export const menuCategoryTemplates = pgTable("menu_category_templates", {
  id: serial("id").primaryKey(),
  templateName: text("template_name").notNull(), // "Standard Restaurant", "Cafe", "Bar"
  description: text("description").notNull(),
  categories: json("categories").$type<Array<{
    name: string;
    slug: string;
    description?: string;
    displayOrder: number;
    color?: string;
    icon?: string;
  }>>().notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ================================
// MAYA'S AUDIT TABLES (unchanged)
// ================================

export const reservationModifications = pgTable("reservation_modifications", {
  id: serial("id").primaryKey(),
  reservationId: integer("reservation_id").references(() => reservations.id).notNull(),
  fieldChanged: text("field_changed").notNull(), // 'time', 'date', 'guests', 'special_requests'
  oldValue: text("old_value"),
  newValue: text("new_value"),
  modifiedBy: text("modified_by"), // 'guest_telegram', 'guest_web', 'staff'
  modifiedAt: timestamp("modified_at").defaultNow().notNull(),
  reason: text("reason"),
  source: text("source"), // 'telegram', 'web', 'phone', 'staff'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const reservationCancellations = pgTable("reservation_cancellations", {
  id: serial("id").primaryKey(),
  reservationId: integer("reservation_id").references(() => reservations.id).notNull(),
  cancelledAt: timestamp("cancelled_at").defaultNow().notNull(),
  cancelledBy: text("cancelled_by"), // 'guest_telegram', 'guest_web', 'staff'
  reason: text("reason"),
  cancellationPolicy: text("cancellation_policy"), // 'free', 'fee_applied', 'no_refund'
  feeAmount: text("fee_amount"), // Stored as string like totalAmount
  refundStatus: text("refund_status"), // 'not_applicable', 'pending', 'processed'
  refundAmount: text("refund_amount"),
  source: text("source"), // 'telegram', 'web', 'phone', 'staff'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const restaurantPolicies = pgTable("restaurant_policies", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurants.id).notNull(),
  policyType: text("policy_type").notNull(), // 'modification', 'cancellation', 'verification'
  policyData: json("policy_data").$type<{
    // Modification policies
    freeModificationHours?: number; // Free changes if X hours before
    maxModificationsPerReservation?: number; // Limit number of changes
    allowedModifications?: string[]; // ['time', 'date', 'guests', 'special_requests']
    
    // Cancellation policies  
    freeCancellationHours?: number; // Free cancellation if X hours before
    cancellationFeePercentage?: number; // Fee as percentage
    noRefundHours?: number; // No refund if less than X hours
    
    // Verification policies
    verificationRequired?: boolean; // Require identity verification
    verificationMethods?: string[]; // ['phone', 'telegram', 'email']
  }>(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const reservationModificationsRelations = relations(reservationModifications, ({ one }) => ({
  reservation: one(reservations, {
    fields: [reservationModifications.reservationId],
    references: [reservations.id],
  }),
}));

export const reservationCancellationsRelations = relations(reservationCancellations, ({ one }) => ({
  reservation: one(reservations, {
    fields: [reservationCancellations.reservationId],
    references: [reservations.id],
  }),
}));

export const restaurantPoliciesRelations = relations(restaurantPolicies, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [restaurantPolicies.restaurantId],
    references: [restaurants.id],
  }),
}));

// ================================
// INTEGRATION & AI TABLES (unchanged)
// ================================

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

// ================================
// INSERT SCHEMAS WITH VALIDATION
// ================================

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });

export const insertRestaurantSchema = createInsertSchema(restaurants, {
  timezone: z.string().min(1, "Timezone is required")
    .refine((tz) => {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Invalid timezone format"),
  slotInterval: z.number().min(15).max(60).optional(),
  allowAnyTime: z.boolean().optional(),
  minTimeIncrement: z.number().min(5).max(30).optional(),
}).omit({ id: true, createdAt: true });

export const insertTableSchema = createInsertSchema(tables).omit({ id: true, createdAt: true });
export const insertTimeslotSchema = createInsertSchema(timeslots).omit({ id: true, createdAt: true });

// ✅ ENHANCED: Guest schema with analytics validation
export const insertGuestSchema = createInsertSchema(guests, {
  visit_count: z.number().min(0).optional(),
  no_show_count: z.number().min(0).optional(),
  total_spent: z.string().optional(),
  vip_level: z.number().min(0).max(5).optional(),
  reputation_score: z.number().min(0).max(100).optional(),
}).omit({ id: true, createdAt: true });

export const insertReservationSchema = createInsertSchema(reservations, {
  booking_guest_name: z.string().optional().nullable(),
  reservation_utc: z.string().datetime({ message: "Invalid ISO 8601 UTC timestamp format" }),
  lastModifiedAt: z.date().optional(),
}).omit({ id: true, createdAt: true });

// ✅ NEW: Status history schema
export const insertReservationStatusHistorySchema = createInsertSchema(reservationStatusHistory).omit({ 
  id: true, 
  timestamp: true 
});

// ✅ NEW: Menu category schemas
export const insertRestaurantMenuCategorySchema = createInsertSchema(restaurantMenuCategories, {
  name: z.string().min(1, "Category name is required"),
  slug: z.string().min(1).regex(/^[a-z0-9-_]+$/, "Slug must contain only lowercase letters, numbers, hyphens, and underscores"),
  displayOrder: z.number().min(0).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a valid hex color").optional(),
}).omit({ id: true, createdAt: true, updatedAt: true });

// ✅ NEW: Menu item schemas
export const insertMenuItemSchema = createInsertSchema(menuItems, {
  price: z.string().min(1, "Price is required"),
  originalPrice: z.string().optional(),
  spicyLevel: z.number().min(0).max(5).optional(),
  displayOrder: z.number().min(0).optional(),
  categoryId: z.number().min(1, "Category is required"),
}).omit({ id: true, createdAt: true, updatedAt: true });

export const insertMenuItemOptionSchema = createInsertSchema(menuItemOptions).omit({ id: true });
export const insertMenuItemOptionValueSchema = createInsertSchema(menuItemOptionValues).omit({ id: true });
export const insertMenuSearchLogSchema = createInsertSchema(menuSearchLog).omit({ id: true, timestamp: true });
export const insertMenuCategoryTemplateSchema = createInsertSchema(menuCategoryTemplates).omit({ 
  id: true, 
  createdAt: true 
});

// ✅ EXISTING: Maya's audit schemas (unchanged)
export const insertReservationModificationSchema = createInsertSchema(reservationModifications).omit({ 
  id: true, 
  createdAt: true 
});

export const insertReservationCancellationSchema = createInsertSchema(reservationCancellations).omit({ 
  id: true, 
  createdAt: true 
});

export const insertRestaurantPolicySchema = createInsertSchema(restaurantPolicies).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

export const insertIntegrationSettingSchema = createInsertSchema(integrationSettings).omit({ id: true, createdAt: true });
export const insertAiActivitySchema = createInsertSchema(aiActivities).omit({ id: true, createdAt: true });

// ================================
// EXPORT TYPES
// ================================

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

// ✅ NEW: Status history types
export type ReservationStatusHistory = typeof reservationStatusHistory.$inferSelect;
export type InsertReservationStatusHistory = z.infer<typeof insertReservationStatusHistorySchema>;

// ✅ NEW: Menu management types
export type RestaurantMenuCategory = typeof restaurantMenuCategories.$inferSelect;
export type InsertRestaurantMenuCategory = z.infer<typeof insertRestaurantMenuCategorySchema>;

export type MenuItem = typeof menuItems.$inferSelect;
export type InsertMenuItem = z.infer<typeof insertMenuItemSchema>;

export type MenuItemOption = typeof menuItemOptions.$inferSelect;
export type InsertMenuItemOption = z.infer<typeof insertMenuItemOptionSchema>;

export type MenuItemOptionValue = typeof menuItemOptionValues.$inferSelect;
export type InsertMenuItemOptionValue = z.infer<typeof insertMenuItemOptionValueSchema>;

export type MenuSearchLog = typeof menuSearchLog.$inferSelect;
export type InsertMenuSearchLog = z.infer<typeof insertMenuSearchLogSchema>;

export type MenuCategoryTemplate = typeof menuCategoryTemplates.$inferSelect;
export type InsertMenuCategoryTemplate = z.infer<typeof insertMenuCategoryTemplateSchema>;

// ✅ EXISTING: Maya's audit types (unchanged)
export type ReservationModification = typeof reservationModifications.$inferSelect;
export type InsertReservationModification = z.infer<typeof insertReservationModificationSchema>;

export type ReservationCancellation = typeof reservationCancellations.$inferSelect;
export type InsertReservationCancellation = z.infer<typeof insertReservationCancellationSchema>;

export type RestaurantPolicy = typeof restaurantPolicies.$inferSelect;
export type InsertRestaurantPolicy = z.infer<typeof insertRestaurantPolicySchema>;

export type IntegrationSetting = typeof integrationSettings.$inferSelect;
export type InsertIntegrationSetting = z.infer<typeof insertIntegrationSettingSchema>;

export type AiActivity = typeof aiActivities.$inferSelect;
export type InsertAiActivity = z.infer<typeof insertAiActivitySchema>;