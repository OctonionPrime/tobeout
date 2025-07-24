import { pgTable, serial, text, integer, boolean, timestamp, date, time, foreignKey, json, pgEnum, decimal, unique } from "drizzle-orm/pg-core";
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
// MULTI-TENANT ENUMS
// ================================

export const tenantStatusEnum = pgEnum('tenant_status', ['active', 'suspended', 'trial', 'inactive']);
export const tenantPlanEnum = pgEnum('tenant_plan', ['free', 'starter', 'professional', 'enterprise']);

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

// ✅ ENHANCED: Restaurants table with multi-tenant fields
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
  slotInterval: integer("slot_interval").default(30),
  allowAnyTime: boolean("allow_any_time").default(true),
  minTimeIncrement: integer("min_time_increment").default(15),
  
  // ================================
  // MULTI-TENANT FIELDS
  // ================================
  
  // Tenant identification & status
  subdomain: text("subdomain").unique(),
  tenantStatus: tenantStatusEnum("tenant_status").default('trial'),
  tenantPlan: tenantPlanEnum("tenant_plan").default('free'),
  trialEndsAt: timestamp("trial_ends_at"),
  suspendedAt: timestamp("suspended_at"),
  suspendedReason: text("suspended_reason"),

  // Service configuration
  primaryAiModel: text("primary_ai_model").default('gpt-4'),
  fallbackAiModel: text("fallback_ai_model").default('gpt-3.5-turbo'),
  aiTemperature: decimal("ai_temperature", { precision: 2, scale: 1 }).default('0.7'),
  maxTablesAllowed: integer("max_tables_allowed").default(10),
  maxMonthlyReservations: integer("max_monthly_reservations").default(1000),
  maxStaffAccounts: integer("max_staff_accounts").default(5),

  // Feature flags
  enableAiChat: boolean("enable_ai_chat").default(true),
  enableTelegramBot: boolean("enable_telegram_bot").default(false),
  enableMenuManagement: boolean("enable_menu_management").default(true),
  enableGuestAnalytics: boolean("enable_guest_analytics").default(true),
  enableAdvancedReporting: boolean("enable_advanced_reporting").default(false),

  // Billing & usage tracking
  monthlyReservationCount: integer("monthly_reservation_count").default(0),
  lastBillingResetDate: timestamp("last_billing_reset_date").defaultNow(),
  totalReservationsAllTime: integer("total_reservations_all_time").default(0),

  // Onboarding
  onboardingCompleted: boolean("onboarding_completed").default(false),
  onboardingStep: text("onboarding_step").default('restaurant_info'),
  
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
  menuCategories: many(restaurantMenuCategories),
  menuItems: many(menuItems),
  guests: many(guests), // ✅ SECURITY FIX: Add guest relation
  auditLogs: many(tenantAuditLogs),
  usageMetrics: many(tenantUsageMetrics),
}));

// ================================
// MULTI-TENANT MANAGEMENT TABLES
// ================================

// Super Admins table
export const superAdmins = pgTable("super_admins", {
    id: serial("id").primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    role: text("role").default('super_admin'),
    isActive: boolean("isActive").default(false).notNull(), // 👈 ADD THIS LINE
    lastLoginAt: timestamp("last_login_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Tenant audit logs
export const tenantAuditLogs = pgTable("tenant_audit_logs", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurants.id),
  action: text("action").notNull(),
  performedBy: text("performed_by").notNull(),
  performedByType: text("performed_by_type").notNull(),
  details: json("details").$type<any>(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const tenantAuditLogsRelations = relations(tenantAuditLogs, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [tenantAuditLogs.restaurantId],
    references: [restaurants.id],
  }),
}));

// Tenant usage metrics
export const tenantUsageMetrics = pgTable("tenant_usage_metrics", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurants.id).notNull(),
  metricDate: date("metric_date").notNull(),
  reservationCount: integer("reservation_count").default(0),
  guestCount: integer("guest_count").default(0),
  aiRequestCount: integer("ai_request_count").default(0),
  storageUsedMb: decimal("storage_used_mb", { precision: 10, scale: 2 }).default('0'),
  activeTableCount: integer("active_table_count").default(0),
  activeStaffCount: integer("active_staff_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  uniqueRestaurantDate: unique().on(table.restaurantId, table.metricDate)
}));

export const tenantUsageMetricsRelations = relations(tenantUsageMetrics, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [tenantUsageMetrics.restaurantId],
    references: [restaurants.id],
  }),
}));

// Plan limits configuration
export const planLimits = pgTable("plan_limits", {
  id: serial("id").primaryKey(),
  planName: text("plan_name").notNull().unique(),
  maxTables: integer("max_tables").notNull(),
  maxMonthlyReservations: integer("max_monthly_reservations").notNull(),
  maxStaffAccounts: integer("max_staff_accounts").notNull(),
  maxStorageMb: integer("max_storage_mb").notNull(),
  features: json("features").$type<{
    aiChat: boolean;
    telegramBot: boolean;
    advancedAnalytics: boolean;
    customBranding: boolean;
    apiAccess: boolean;
    prioritySupport: boolean;
  }>().notNull(),
  monthlyPrice: decimal("monthly_price", { precision: 10, scale: 2 }).notNull(),
  yearlyPrice: decimal("yearly_price", { precision: 10, scale: 2 }).notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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

// ================================
// 🔒 SECURITY FIX: GUESTS TABLE WITH RESTAURANT ISOLATION
// ================================

export const guests = pgTable("guests", {
  id: serial("id").primaryKey(),
  // 🚨 CRITICAL SECURITY FIX: Add restaurant ID for tenant isolation
  restaurantId: integer("restaurant_id").references(() => restaurants.id, { onDelete: 'cascade' }).notNull(),
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
  total_spent: decimal("total_spent", { precision: 10, scale: 2 }).default('0').notNull(), // ✅ CURRENCY FIX: decimal type
  average_duration: integer("average_duration").default(120),
  preferences: json("preferences").$type<{
    dietary_restrictions?: string[];
    preferred_seating?: string;
    special_occasions?: string[];
    communication_preference?: 'telegram' | 'phone' | 'email';
  }>(),
  vip_level: integer("vip_level").default(0),
  last_visit_date: timestamp("last_visit_date"),
  reputation_score: integer("reputation_score").default(100),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // ✅ SECURITY: Add composite indexes for performance with restaurant scoping
  phoneRestaurantIdx: unique().on(table.phone, table.restaurantId),
  telegramRestaurantIdx: unique().on(table.telegram_user_id, table.restaurantId),
}));

export const guestsRelations = relations(guests, ({ one, many }) => ({
  // ✅ SECURITY FIX: Add restaurant relation
  restaurant: one(restaurants, {
    fields: [guests.restaurantId],
    references: [restaurants.id],
  }),
  reservations: many(reservations),
}));

// ================================
// 🔒 CURRENCY FIX: RESERVATIONS TABLE WITH PROPER DECIMAL TYPES
// ================================

export const reservations = pgTable("reservations", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurants.id).notNull(),
  guestId: integer("guest_id").references(() => guests.id).notNull(),
  tableId: integer("table_id").references(() => tables.id),
  timeslotId: integer("timeslot_id").references(() => timeslots.id),
  reservation_utc: timestamp("reservation_utc", { withTimezone: true, mode: 'string' }).notNull(),
  duration: integer("duration").default(120),
  guests: integer("guests").notNull(),
  status: reservationStatusEnum("status").default('created'),
  booking_guest_name: text("booking_guest_name"), 
  comments: text("comments"),
  specialRequests: text("special_requests"),
  staffNotes: text("staff_notes"),
  // 🚨 CRITICAL CURRENCY FIX: Change from text to decimal for proper financial calculations
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }),
  currency: text("currency").default('USD'),
  guestRating: integer("guest_rating"),
  confirmation24h: boolean("confirmation_24h").default(false),
  confirmation2h: boolean("confirmation_2h").default(false),
  source: text("source").default('direct'),
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
  modifications: many(reservationModifications),
  cancellation: one(reservationCancellations, {
    fields: [reservations.id],
    references: [reservationCancellations.reservationId],
  }),
  statusHistory: many(reservationStatusHistory),
}));

// ================================
// ✅ NEW: RESERVATION STATUS HISTORY (unchanged)
// ================================

export const reservationStatusHistory = pgTable("reservation_status_history", {
  id: serial("id").primaryKey(),
  reservationId: integer("reservation_id").references(() => reservations.id, { onDelete: 'cascade' }).notNull(),
  fromStatus: reservationStatusEnum("from_status"),
  toStatus: reservationStatusEnum("to_status").notNull(),
  changedBy: text("changed_by"),
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
// ✅ NEW: FLEXIBLE MENU MANAGEMENT SYSTEM (unchanged)
// ================================

// Restaurant-specific menu categories (flexible, not hardcoded)
export const restaurantMenuCategories = pgTable("restaurant_menu_categories", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurants.id, { onDelete: 'cascade' }).notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  displayOrder: integer("display_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  color: text("color"),
  icon: text("icon"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueRestaurantSlug: unique().on(table.restaurantId, table.slug)
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
  categoryId: integer("category_id").references(() => restaurantMenuCategories.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  shortDescription: text("short_description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(), // ✅ CURRENCY FIX: decimal type
  originalPrice: decimal("original_price", { precision: 10, scale: 2 }), // ✅ CURRENCY FIX: decimal type
  subcategory: text("subcategory"),
  allergens: allergenEnum("allergens").array(),
  dietaryTags: text("dietary_tags").array(),
  spicyLevel: integer("spicy_level").default(0),
  isAvailable: boolean("is_available").default(true).notNull(),
  isPopular: boolean("is_popular").default(false).notNull(),
  isNew: boolean("is_new").default(false).notNull(),
  isSeasonal: boolean("is_seasonal").default(false).notNull(),
  preparationTime: integer("preparation_time"),
  calories: integer("calories"),
  servingSize: text("serving_size"),
  displayOrder: integer("display_order").default(0),
  availableFrom: time("available_from"),
  availableTo: time("available_to"),
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

// Menu item customization options
export const menuItemOptions = pgTable("menu_item_options", {
  id: serial("id").primaryKey(),
  menuItemId: integer("menu_item_id").references(() => menuItems.id, { onDelete: 'cascade' }).notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
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

// Values for menu item options
export const menuItemOptionValues = pgTable("menu_item_option_values", {
  id: serial("id").primaryKey(),
  optionId: integer("option_id").references(() => menuItemOptions.id, { onDelete: 'cascade' }).notNull(),
  value: text("value").notNull(),
  priceModifier: decimal("price_modifier", { precision: 10, scale: 2 }).default('0'), // ✅ CURRENCY FIX: decimal type
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
  source: text("source").notNull(),
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
  templateName: text("template_name").notNull(),
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
// 🔒 CURRENCY FIX: AUDIT TABLES WITH PROPER DECIMAL TYPES
// ================================

export const reservationModifications = pgTable("reservation_modifications", {
  id: serial("id").primaryKey(),
  reservationId: integer("reservation_id").references(() => reservations.id).notNull(),
  fieldChanged: text("field_changed").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  modifiedBy: text("modified_by"),
  modifiedAt: timestamp("modified_at").defaultNow().notNull(),
  reason: text("reason"),
  source: text("source"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const reservationCancellations = pgTable("reservation_cancellations", {
  id: serial("id").primaryKey(),
  reservationId: integer("reservation_id").references(() => reservations.id).notNull(),
  cancelledAt: timestamp("cancelled_at").defaultNow().notNull(),
  cancelledBy: text("cancelled_by"),
  reason: text("reason"),
  cancellationPolicy: text("cancellation_policy"),
  // 🚨 CRITICAL CURRENCY FIX: Change from text to decimal for financial calculations
  feeAmount: decimal("fee_amount", { precision: 10, scale: 2 }),
  refundStatus: text("refund_status"),
  refundAmount: decimal("refund_amount", { precision: 10, scale: 2 }),
  source: text("source"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const restaurantPolicies = pgTable("restaurant_policies", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurants.id).notNull(),
  policyType: text("policy_type").notNull(),
  policyData: json("policy_data").$type<{
    freeModificationHours?: number;
    maxModificationsPerReservation?: number;
    allowedModifications?: string[];
    freeCancellationHours?: number;
    cancellationFeePercentage?: number;
    noRefundHours?: number;
    verificationRequired?: boolean;
    verificationMethods?: string[];
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
  type: text("type").notNull(),
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
  type: text("type").notNull(),
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
// 🔒 SECURITY ENHANCED: INSERT SCHEMAS WITH RESTAURANT VALIDATION
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
  subdomain: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, "Subdomain must contain only lowercase letters, numbers, and hyphens").optional(),
  aiTemperature: z.string().optional(),
  maxTablesAllowed: z.number().min(1).optional(),
  maxMonthlyReservations: z.number().min(1).optional(),
  maxStaffAccounts: z.number().min(1).optional(),
}).omit({ id: true, createdAt: true });

// Multi-tenant table schemas
export const insertSuperAdminSchema = createInsertSchema(superAdmins).omit({ id: true, createdAt: true });
export const insertTenantAuditLogSchema = createInsertSchema(tenantAuditLogs).omit({ id: true, timestamp: true });
export const insertTenantUsageMetricsSchema = createInsertSchema(tenantUsageMetrics).omit({ id: true, createdAt: true });
export const insertPlanLimitsSchema = createInsertSchema(planLimits).omit({ id: true, createdAt: true });

export const insertTableSchema = createInsertSchema(tables).omit({ id: true, createdAt: true });
export const insertTimeslotSchema = createInsertSchema(timeslots).omit({ id: true, createdAt: true });

// 🔒 SECURITY FIX: Guest schema with required restaurant ID
export const insertGuestSchema = createInsertSchema(guests, {
  restaurantId: z.number().min(1, "Restaurant ID is required"), // ✅ SECURITY: Require restaurant ID
  visit_count: z.number().min(0).optional(),
  no_show_count: z.number().min(0).optional(),
  total_spent: z.string().optional(), // ✅ CURRENCY: Validated as decimal string
  vip_level: z.number().min(0).max(5).optional(),
  reputation_score: z.number().min(0).max(100).optional(),
}).omit({ id: true, createdAt: true });

// ✅ CURRENCY FIX: Proper decimal validation for reservations
export const insertReservationSchema = createInsertSchema(reservations, {
  booking_guest_name: z.string().optional().nullable(),
  reservation_utc: z.string().datetime({ message: "Invalid ISO 8601 UTC timestamp format" }),
  totalAmount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid currency format").optional(), // ✅ CURRENCY: Decimal validation
  lastModifiedAt: z.date().optional(),
}).omit({ id: true, createdAt: true });

// ✅ NEW: Status history schema
export const insertReservationStatusHistorySchema = createInsertSchema(reservationStatusHistory).omit({ 
  id: true, 
  timestamp: true 
});

// ✅ NEW: Menu category schemas with currency validation
export const insertRestaurantMenuCategorySchema = createInsertSchema(restaurantMenuCategories, {
  name: z.string().min(1, "Category name is required"),
  slug: z.string().min(1).regex(/^[a-z0-9-_]+$/, "Slug must contain only lowercase letters, numbers, hyphens, and underscores"),
  displayOrder: z.number().min(0).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a valid hex color").optional(),
}).omit({ id: true, createdAt: true, updatedAt: true });

// ✅ CURRENCY FIX: Menu item schema with decimal price validation
export const insertMenuItemSchema = createInsertSchema(menuItems, {
  price: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid price format"), // ✅ CURRENCY: Decimal validation
  originalPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid price format").optional(), // ✅ CURRENCY: Decimal validation
  spicyLevel: z.number().min(0).max(5).optional(),
  displayOrder: z.number().min(0).optional(),
  categoryId: z.number().min(1, "Category is required"),
}).omit({ id: true, createdAt: true, updatedAt: true });

export const insertMenuItemOptionSchema = createInsertSchema(menuItemOptions).omit({ id: true });

// ✅ CURRENCY FIX: Menu option value schema with decimal validation
export const insertMenuItemOptionValueSchema = createInsertSchema(menuItemOptionValues, {
  priceModifier: z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Invalid price modifier format").optional(), // ✅ CURRENCY: Decimal validation
}).omit({ id: true });

export const insertMenuSearchLogSchema = createInsertSchema(menuSearchLog).omit({ id: true, timestamp: true });
export const insertMenuCategoryTemplateSchema = createInsertSchema(menuCategoryTemplates).omit({ 
  id: true, 
  createdAt: true 
});

// ✅ CURRENCY FIX: Audit schemas with decimal validation
export const insertReservationModificationSchema = createInsertSchema(reservationModifications).omit({ 
  id: true, 
  createdAt: true 
});

export const insertReservationCancellationSchema = createInsertSchema(reservationCancellations, {
  feeAmount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid fee amount format").optional(), // ✅ CURRENCY: Decimal validation
  refundAmount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid refund amount format").optional(), // ✅ CURRENCY: Decimal validation
}).omit({ 
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

// Multi-tenant types
export type SuperAdmin = typeof superAdmins.$inferSelect;
export type InsertSuperAdmin = z.infer<typeof insertSuperAdminSchema>;

export type TenantAuditLog = typeof tenantAuditLogs.$inferSelect;
export type InsertTenantAuditLog = z.infer<typeof insertTenantAuditLogSchema>;

export type TenantUsageMetrics = typeof tenantUsageMetrics.$inferSelect;
export type InsertTenantUsageMetrics = z.infer<typeof insertTenantUsageMetricsSchema>;

export type PlanLimits = typeof planLimits.$inferSelect;
export type InsertPlanLimits = z.infer<typeof insertPlanLimitsSchema>;

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