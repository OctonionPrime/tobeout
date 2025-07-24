import { pgTable, serial, text, json, boolean, timestamp, unique, integer, numeric, foreignKey, time, date, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const allergen = pgEnum("allergen", ['gluten', 'dairy', 'eggs', 'nuts', 'peanuts', 'soy', 'fish', 'shellfish'])
export const reservationStatus = pgEnum("reservation_status", ['created', 'confirmed', 'seated', 'in_progress', 'completed', 'canceled', 'no_show', 'archived'])
export const tableStatus = pgEnum("table_status", ['free', 'occupied', 'reserved', 'unavailable'])
export const tenantPlan = pgEnum("tenant_plan", ['free', 'starter', 'professional', 'enterprise'])
export const tenantStatus = pgEnum("tenant_status", ['active', 'suspended', 'trial', 'inactive'])
export const timeslotStatus = pgEnum("timeslot_status", ['free', 'pending', 'occupied'])
export const userRole = pgEnum("user_role", ['admin', 'restaurant', 'staff'])


export const menuCategoryTemplates = pgTable("menu_category_templates", {
	id: serial().primaryKey().notNull(),
	templateName: text("template_name").notNull(),
	description: text().notNull(),
	categories: json().notNull(),
	isDefault: boolean("is_default").default(false).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
});

export const planLimits = pgTable("plan_limits", {
	id: serial().primaryKey().notNull(),
	planName: text("plan_name").notNull(),
	maxTables: integer("max_tables").notNull(),
	maxMonthlyReservations: integer("max_monthly_reservations").notNull(),
	maxStaffAccounts: integer("max_staff_accounts").notNull(),
	maxStorageMb: integer("max_storage_mb").notNull(),
	features: json().notNull(),
	monthlyPrice: numeric("monthly_price", { precision: 10, scale:  2 }).notNull(),
	yearlyPrice: numeric("yearly_price", { precision: 10, scale:  2 }).notNull(),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("plan_limits_plan_name_unique").on(table.planName),
]);

export const superAdmins = pgTable("super_admins", {
	id: serial().primaryKey().notNull(),
	email: text().notNull(),
	passwordHash: text("password_hash").notNull(),
	name: text().notNull(),
	role: text().default('super_admin'),
	lastLoginAt: timestamp("last_login_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("super_admins_email_unique").on(table.email),
]);

export const restaurants = pgTable("restaurants", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	name: text().notNull(),
	description: text(),
	country: text(),
	city: text(),
	address: text(),
	photo: text(),
	openingTime: time("opening_time"),
	closingTime: time("closing_time"),
	cuisine: text(),
	atmosphere: text(),
	features: text().array(),
	tags: text().array(),
	languages: text().array(),
	avgReservationDuration: integer("avg_reservation_duration").default(120),
	minGuests: integer("min_guests").default(1),
	maxGuests: integer("max_guests").default(12),
	phone: text(),
	googleMapsLink: text("google_maps_link"),
	tripAdvisorLink: text("trip_advisor_link"),
	timezone: text().default('Europe/Moscow').notNull(),
	slotInterval: integer("slot_interval").default(30),
	allowAnyTime: boolean("allow_any_time").default(true),
	minTimeIncrement: integer("min_time_increment").default(15),
	subdomain: text(),
	tenantStatus: tenantStatus("tenant_status").default('trial'),
	tenantPlan: tenantPlan("tenant_plan").default('free'),
	trialEndsAt: timestamp("trial_ends_at", { mode: 'string' }),
	suspendedAt: timestamp("suspended_at", { mode: 'string' }),
	suspendedReason: text("suspended_reason"),
	primaryAiModel: text("primary_ai_model").default('gpt-4'),
	fallbackAiModel: text("fallback_ai_model").default('gpt-3.5-turbo'),
	aiTemperature: numeric("ai_temperature", { precision: 2, scale:  1 }).default('0.7'),
	maxTablesAllowed: integer("max_tables_allowed").default(10),
	maxMonthlyReservations: integer("max_monthly_reservations").default(1000),
	maxStaffAccounts: integer("max_staff_accounts").default(5),
	enableAiChat: boolean("enable_ai_chat").default(true),
	enableTelegramBot: boolean("enable_telegram_bot").default(false),
	enableMenuManagement: boolean("enable_menu_management").default(true),
	enableGuestAnalytics: boolean("enable_guest_analytics").default(true),
	enableAdvancedReporting: boolean("enable_advanced_reporting").default(false),
	monthlyReservationCount: integer("monthly_reservation_count").default(0),
	lastBillingResetDate: timestamp("last_billing_reset_date", { mode: 'string' }).defaultNow(),
	totalReservationsAllTime: integer("total_reservations_all_time").default(0),
	onboardingCompleted: boolean("onboarding_completed").default(false),
	onboardingStep: text("onboarding_step").default('restaurant_info'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "restaurants_user_id_users_id_fk"
		}),
	unique("restaurants_subdomain_unique").on(table.subdomain),
]);

export const aiActivities = pgTable("ai_activities", {
	id: serial().primaryKey().notNull(),
	restaurantId: integer("restaurant_id").notNull(),
	type: text().notNull(),
	description: text().notNull(),
	data: json(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "ai_activities_restaurant_id_restaurants_id_fk"
		}),
]);

export const integrationSettings = pgTable("integration_settings", {
	id: serial().primaryKey().notNull(),
	restaurantId: integer("restaurant_id").notNull(),
	type: text().notNull(),
	apiKey: text("api_key"),
	token: text(),
	enabled: boolean().default(false),
	settings: json(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "integration_settings_restaurant_id_restaurants_id_fk"
		}),
]);

export const menuItemOptions = pgTable("menu_item_options", {
	id: serial().primaryKey().notNull(),
	menuItemId: integer("menu_item_id").notNull(),
	name: text().notNull(),
	type: text().notNull(),
	isRequired: boolean("is_required").default(false).notNull(),
	displayOrder: integer("display_order").default(0),
}, (table) => [
	foreignKey({
			columns: [table.menuItemId],
			foreignColumns: [menuItems.id],
			name: "menu_item_options_menu_item_id_menu_items_id_fk"
		}).onDelete("cascade"),
]);

export const menuItemOptionValues = pgTable("menu_item_option_values", {
	id: serial().primaryKey().notNull(),
	optionId: integer("option_id").notNull(),
	value: text().notNull(),
	priceModifier: numeric("price_modifier", { precision: 10, scale:  2 }).default('0'),
	displayOrder: integer("display_order").default(0),
}, (table) => [
	foreignKey({
			columns: [table.optionId],
			foreignColumns: [menuItemOptions.id],
			name: "menu_item_option_values_option_id_menu_item_options_id_fk"
		}).onDelete("cascade"),
]);

export const menuItems = pgTable("menu_items", {
	id: serial().primaryKey().notNull(),
	restaurantId: integer("restaurant_id").notNull(),
	categoryId: integer("category_id").notNull(),
	name: text().notNull(),
	description: text(),
	shortDescription: text("short_description"),
	price: numeric({ precision: 10, scale:  2 }).notNull(),
	originalPrice: numeric("original_price", { precision: 10, scale:  2 }),
	subcategory: text(),
	allergens: allergen().array(),
	dietaryTags: text("dietary_tags").array(),
	spicyLevel: integer("spicy_level").default(0),
	isAvailable: boolean("is_available").default(true).notNull(),
	isPopular: boolean("is_popular").default(false).notNull(),
	isNew: boolean("is_new").default(false).notNull(),
	isSeasonal: boolean("is_seasonal").default(false).notNull(),
	preparationTime: integer("preparation_time"),
	calories: integer(),
	servingSize: text("serving_size"),
	displayOrder: integer("display_order").default(0),
	availableFrom: time("available_from"),
	availableTo: time("available_to"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "menu_items_restaurant_id_restaurants_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [restaurantMenuCategories.id],
			name: "menu_items_category_id_restaurant_menu_categories_id_fk"
		}),
]);

export const restaurantMenuCategories = pgTable("restaurant_menu_categories", {
	id: serial().primaryKey().notNull(),
	restaurantId: integer("restaurant_id").notNull(),
	name: text().notNull(),
	slug: text().notNull(),
	description: text(),
	displayOrder: integer("display_order").default(0).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	color: text(),
	icon: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "restaurant_menu_categories_restaurant_id_restaurants_id_fk"
		}).onDelete("cascade"),
	unique("restaurant_menu_categories_restaurant_id_slug_unique").on(table.restaurantId, table.slug),
]);

export const menuSearchLog = pgTable("menu_search_log", {
	id: serial().primaryKey().notNull(),
	restaurantId: integer("restaurant_id").notNull(),
	query: text().notNull(),
	resultsCount: integer("results_count").notNull(),
	clickedItemId: integer("clicked_item_id"),
	source: text().notNull(),
	timestamp: timestamp({ mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "menu_search_log_restaurant_id_restaurants_id_fk"
		}),
	foreignKey({
			columns: [table.clickedItemId],
			foreignColumns: [menuItems.id],
			name: "menu_search_log_clicked_item_id_menu_items_id_fk"
		}),
]);

export const reservations = pgTable("reservations", {
	id: serial().primaryKey().notNull(),
	restaurantId: integer("restaurant_id").notNull(),
	guestId: integer("guest_id").notNull(),
	tableId: integer("table_id"),
	timeslotId: integer("timeslot_id"),
	reservationUtc: timestamp("reservation_utc", { withTimezone: true, mode: 'string' }).notNull(),
	duration: integer().default(120),
	guests: integer().notNull(),
	status: reservationStatus().default('created'),
	bookingGuestName: text("booking_guest_name"),
	comments: text(),
	specialRequests: text("special_requests"),
	staffNotes: text("staff_notes"),
	totalAmount: text("total_amount"),
	currency: text().default('USD'),
	guestRating: integer("guest_rating"),
	confirmation24H: boolean("confirmation_24h").default(false),
	confirmation2H: boolean("confirmation_2h").default(false),
	source: text().default('direct'),
	lastModifiedAt: timestamp("last_modified_at", { mode: 'string' }).defaultNow(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "reservations_restaurant_id_restaurants_id_fk"
		}),
	foreignKey({
			columns: [table.guestId],
			foreignColumns: [guests.id],
			name: "reservations_guest_id_guests_id_fk"
		}),
	foreignKey({
			columns: [table.tableId],
			foreignColumns: [tables.id],
			name: "reservations_table_id_tables_id_fk"
		}),
	foreignKey({
			columns: [table.timeslotId],
			foreignColumns: [timeslots.id],
			name: "reservations_timeslot_id_timeslots_id_fk"
		}),
]);

export const reservationCancellations = pgTable("reservation_cancellations", {
	id: serial().primaryKey().notNull(),
	reservationId: integer("reservation_id").notNull(),
	cancelledAt: timestamp("cancelled_at", { mode: 'string' }).defaultNow().notNull(),
	cancelledBy: text("cancelled_by"),
	reason: text(),
	cancellationPolicy: text("cancellation_policy"),
	feeAmount: text("fee_amount"),
	refundStatus: text("refund_status"),
	refundAmount: text("refund_amount"),
	source: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.reservationId],
			foreignColumns: [reservations.id],
			name: "reservation_cancellations_reservation_id_reservations_id_fk"
		}),
]);

export const reservationModifications = pgTable("reservation_modifications", {
	id: serial().primaryKey().notNull(),
	reservationId: integer("reservation_id").notNull(),
	fieldChanged: text("field_changed").notNull(),
	oldValue: text("old_value"),
	newValue: text("new_value"),
	modifiedBy: text("modified_by"),
	modifiedAt: timestamp("modified_at", { mode: 'string' }).defaultNow().notNull(),
	reason: text(),
	source: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.reservationId],
			foreignColumns: [reservations.id],
			name: "reservation_modifications_reservation_id_reservations_id_fk"
		}),
]);

export const reservationStatusHistory = pgTable("reservation_status_history", {
	id: serial().primaryKey().notNull(),
	reservationId: integer("reservation_id").notNull(),
	fromStatus: reservationStatus("from_status"),
	toStatus: reservationStatus("to_status").notNull(),
	changedBy: text("changed_by"),
	changeReason: text("change_reason"),
	timestamp: timestamp({ mode: 'string' }).defaultNow().notNull(),
	metadata: json(),
}, (table) => [
	foreignKey({
			columns: [table.reservationId],
			foreignColumns: [reservations.id],
			name: "reservation_status_history_reservation_id_reservations_id_fk"
		}).onDelete("cascade"),
]);

export const guests = pgTable("guests", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	phone: text(),
	email: text(),
	telegramUserId: text("telegram_user_id"),
	language: text().default('en'),
	birthday: date(),
	comments: text(),
	tags: text().array(),
	visitCount: integer("visit_count").default(0).notNull(),
	noShowCount: integer("no_show_count").default(0).notNull(),
	totalSpent: numeric("total_spent", { precision: 10, scale:  2 }).default('0').notNull(),
	averageDuration: integer("average_duration").default(120),
	preferences: json(),
	vipLevel: integer("vip_level").default(0),
	lastVisitDate: timestamp("last_visit_date", { mode: 'string' }),
	reputationScore: integer("reputation_score").default(100),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("guests_telegram_user_id_unique").on(table.telegramUserId),
]);

export const tables = pgTable("tables", {
	id: serial().primaryKey().notNull(),
	restaurantId: integer("restaurant_id").notNull(),
	name: text().notNull(),
	minGuests: integer("min_guests").default(1).notNull(),
	maxGuests: integer("max_guests").notNull(),
	status: tableStatus().default('free'),
	features: text().array(),
	comments: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "tables_restaurant_id_restaurants_id_fk"
		}),
]);

export const timeslots = pgTable("timeslots", {
	id: serial().primaryKey().notNull(),
	restaurantId: integer("restaurant_id").notNull(),
	tableId: integer("table_id").notNull(),
	date: date().notNull(),
	time: time().notNull(),
	status: timeslotStatus().default('free'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "timeslots_restaurant_id_restaurants_id_fk"
		}),
	foreignKey({
			columns: [table.tableId],
			foreignColumns: [tables.id],
			name: "timeslots_table_id_tables_id_fk"
		}),
]);

export const restaurantPolicies = pgTable("restaurant_policies", {
	id: serial().primaryKey().notNull(),
	restaurantId: integer("restaurant_id").notNull(),
	policyType: text("policy_type").notNull(),
	policyData: json("policy_data"),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "restaurant_policies_restaurant_id_restaurants_id_fk"
		}),
]);

export const users = pgTable("users", {
	id: serial().primaryKey().notNull(),
	email: text().notNull(),
	password: text().notNull(),
	role: userRole().default('restaurant').notNull(),
	name: text().notNull(),
	phone: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("users_email_unique").on(table.email),
]);

export const tenantAuditLogs = pgTable("tenant_audit_logs", {
	id: serial().primaryKey().notNull(),
	restaurantId: integer("restaurant_id"),
	action: text().notNull(),
	performedBy: text("performed_by").notNull(),
	performedByType: text("performed_by_type").notNull(),
	details: json(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	timestamp: timestamp({ mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "tenant_audit_logs_restaurant_id_restaurants_id_fk"
		}),
]);

export const tenantUsageMetrics = pgTable("tenant_usage_metrics", {
	id: serial().primaryKey().notNull(),
	restaurantId: integer("restaurant_id").notNull(),
	metricDate: date("metric_date").notNull(),
	reservationCount: integer("reservation_count").default(0),
	guestCount: integer("guest_count").default(0),
	aiRequestCount: integer("ai_request_count").default(0),
	storageUsedMb: numeric("storage_used_mb", { precision: 10, scale:  2 }).default('0'),
	activeTableCount: integer("active_table_count").default(0),
	activeStaffCount: integer("active_staff_count").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.restaurantId],
			foreignColumns: [restaurants.id],
			name: "tenant_usage_metrics_restaurant_id_restaurants_id_fk"
		}),
	unique("tenant_usage_metrics_restaurant_id_metric_date_unique").on(table.restaurantId, table.metricDate),
]);
