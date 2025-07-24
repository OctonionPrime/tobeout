CREATE TYPE "public"."allergen" AS ENUM('gluten', 'dairy', 'eggs', 'nuts', 'peanuts', 'soy', 'fish', 'shellfish');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('created', 'confirmed', 'seated', 'in_progress', 'completed', 'canceled', 'no_show', 'archived');--> statement-breakpoint
CREATE TYPE "public"."table_status" AS ENUM('free', 'occupied', 'reserved', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."tenant_plan" AS ENUM('free', 'starter', 'professional', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended', 'trial', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."timeslot_status" AS ENUM('free', 'pending', 'occupied');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'restaurant', 'staff');--> statement-breakpoint
CREATE TABLE "ai_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"data" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"telegram_user_id" text,
	"language" text DEFAULT 'en',
	"birthday" date,
	"comments" text,
	"tags" text[],
	"visit_count" integer DEFAULT 0 NOT NULL,
	"no_show_count" integer DEFAULT 0 NOT NULL,
	"total_spent" numeric(10, 2) DEFAULT '0' NOT NULL,
	"average_duration" integer DEFAULT 120,
	"preferences" json,
	"vip_level" integer DEFAULT 0,
	"last_visit_date" timestamp,
	"reputation_score" integer DEFAULT 100,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "guests_telegram_user_id_unique" UNIQUE("telegram_user_id")
);
--> statement-breakpoint
CREATE TABLE "integration_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"type" text NOT NULL,
	"api_key" text,
	"token" text,
	"enabled" boolean DEFAULT false,
	"settings" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_category_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_name" text NOT NULL,
	"description" text NOT NULL,
	"categories" json NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_item_option_values" (
	"id" serial PRIMARY KEY NOT NULL,
	"option_id" integer NOT NULL,
	"value" text NOT NULL,
	"price_modifier" numeric(10, 2) DEFAULT '0',
	"display_order" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "menu_item_options" (
	"id" serial PRIMARY KEY NOT NULL,
	"menu_item_id" integer NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"short_description" text,
	"price" numeric(10, 2) NOT NULL,
	"original_price" numeric(10, 2),
	"subcategory" text,
	"allergens" "allergen"[],
	"dietary_tags" text[],
	"spicy_level" integer DEFAULT 0,
	"is_available" boolean DEFAULT true NOT NULL,
	"is_popular" boolean DEFAULT false NOT NULL,
	"is_new" boolean DEFAULT false NOT NULL,
	"is_seasonal" boolean DEFAULT false NOT NULL,
	"preparation_time" integer,
	"calories" integer,
	"serving_size" text,
	"display_order" integer DEFAULT 0,
	"available_from" time,
	"available_to" time,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_search_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"query" text NOT NULL,
	"results_count" integer NOT NULL,
	"clicked_item_id" integer,
	"source" text NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_name" text NOT NULL,
	"max_tables" integer NOT NULL,
	"max_monthly_reservations" integer NOT NULL,
	"max_staff_accounts" integer NOT NULL,
	"max_storage_mb" integer NOT NULL,
	"features" json NOT NULL,
	"monthly_price" numeric(10, 2) NOT NULL,
	"yearly_price" numeric(10, 2) NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plan_limits_plan_name_unique" UNIQUE("plan_name")
);
--> statement-breakpoint
CREATE TABLE "reservation_cancellations" (
	"id" serial PRIMARY KEY NOT NULL,
	"reservation_id" integer NOT NULL,
	"cancelled_at" timestamp DEFAULT now() NOT NULL,
	"cancelled_by" text,
	"reason" text,
	"cancellation_policy" text,
	"fee_amount" text,
	"refund_status" text,
	"refund_amount" text,
	"source" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservation_modifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"reservation_id" integer NOT NULL,
	"field_changed" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"modified_by" text,
	"modified_at" timestamp DEFAULT now() NOT NULL,
	"reason" text,
	"source" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservation_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"reservation_id" integer NOT NULL,
	"from_status" "reservation_status",
	"to_status" "reservation_status" NOT NULL,
	"changed_by" text,
	"change_reason" text,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"metadata" json
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"guest_id" integer NOT NULL,
	"table_id" integer,
	"timeslot_id" integer,
	"reservation_utc" timestamp with time zone NOT NULL,
	"duration" integer DEFAULT 120,
	"guests" integer NOT NULL,
	"status" "reservation_status" DEFAULT 'created',
	"booking_guest_name" text,
	"comments" text,
	"special_requests" text,
	"staff_notes" text,
	"total_amount" text,
	"currency" text DEFAULT 'USD',
	"guest_rating" integer,
	"confirmation_24h" boolean DEFAULT false,
	"confirmation_2h" boolean DEFAULT false,
	"source" text DEFAULT 'direct',
	"last_modified_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restaurant_menu_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"color" text,
	"icon" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_menu_categories_restaurant_id_slug_unique" UNIQUE("restaurant_id","slug")
);
--> statement-breakpoint
CREATE TABLE "restaurant_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"policy_type" text NOT NULL,
	"policy_data" json,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restaurants" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"country" text,
	"city" text,
	"address" text,
	"photo" text,
	"opening_time" time,
	"closing_time" time,
	"cuisine" text,
	"atmosphere" text,
	"features" text[],
	"tags" text[],
	"languages" text[],
	"avg_reservation_duration" integer DEFAULT 120,
	"min_guests" integer DEFAULT 1,
	"max_guests" integer DEFAULT 12,
	"phone" text,
	"google_maps_link" text,
	"trip_advisor_link" text,
	"timezone" text DEFAULT 'Europe/Moscow' NOT NULL,
	"slot_interval" integer DEFAULT 30,
	"allow_any_time" boolean DEFAULT true,
	"min_time_increment" integer DEFAULT 15,
	"subdomain" text,
	"tenant_status" "tenant_status" DEFAULT 'trial',
	"tenant_plan" "tenant_plan" DEFAULT 'free',
	"trial_ends_at" timestamp,
	"suspended_at" timestamp,
	"suspended_reason" text,
	"primary_ai_model" text DEFAULT 'gpt-4',
	"fallback_ai_model" text DEFAULT 'gpt-3.5-turbo',
	"ai_temperature" numeric(2, 1) DEFAULT '0.7',
	"max_tables_allowed" integer DEFAULT 10,
	"max_monthly_reservations" integer DEFAULT 1000,
	"max_staff_accounts" integer DEFAULT 5,
	"enable_ai_chat" boolean DEFAULT true,
	"enable_telegram_bot" boolean DEFAULT false,
	"enable_menu_management" boolean DEFAULT true,
	"enable_guest_analytics" boolean DEFAULT true,
	"enable_advanced_reporting" boolean DEFAULT false,
	"monthly_reservation_count" integer DEFAULT 0,
	"last_billing_reset_date" timestamp DEFAULT now(),
	"total_reservations_all_time" integer DEFAULT 0,
	"onboarding_completed" boolean DEFAULT false,
	"onboarding_step" text DEFAULT 'restaurant_info',
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "restaurants_subdomain_unique" UNIQUE("subdomain")
);
--> statement-breakpoint
CREATE TABLE "super_admins" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'super_admin',
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "super_admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "tables" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"name" text NOT NULL,
	"min_guests" integer DEFAULT 1 NOT NULL,
	"max_guests" integer NOT NULL,
	"status" "table_status" DEFAULT 'free',
	"features" text[],
	"comments" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer,
	"action" text NOT NULL,
	"performed_by" text NOT NULL,
	"performed_by_type" text NOT NULL,
	"details" json,
	"ip_address" text,
	"user_agent" text,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_usage_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"metric_date" date NOT NULL,
	"reservation_count" integer DEFAULT 0,
	"guest_count" integer DEFAULT 0,
	"ai_request_count" integer DEFAULT 0,
	"storage_used_mb" numeric(10, 2) DEFAULT '0',
	"active_table_count" integer DEFAULT 0,
	"active_staff_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_usage_metrics_restaurant_id_metric_date_unique" UNIQUE("restaurant_id","metric_date")
);
--> statement-breakpoint
CREATE TABLE "timeslots" (
	"id" serial PRIMARY KEY NOT NULL,
	"restaurant_id" integer NOT NULL,
	"table_id" integer NOT NULL,
	"date" date NOT NULL,
	"time" time NOT NULL,
	"status" timeslot_status DEFAULT 'free',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"role" "user_role" DEFAULT 'restaurant' NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "ai_activities" ADD CONSTRAINT "ai_activities_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_settings" ADD CONSTRAINT "integration_settings_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_option_values" ADD CONSTRAINT "menu_item_option_values_option_id_menu_item_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."menu_item_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_options" ADD CONSTRAINT "menu_item_options_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_id_restaurant_menu_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."restaurant_menu_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_search_log" ADD CONSTRAINT "menu_search_log_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_search_log" ADD CONSTRAINT "menu_search_log_clicked_item_id_menu_items_id_fk" FOREIGN KEY ("clicked_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_cancellations" ADD CONSTRAINT "reservation_cancellations_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_modifications" ADD CONSTRAINT "reservation_modifications_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_status_history" ADD CONSTRAINT "reservation_status_history_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_timeslot_id_timeslots_id_fk" FOREIGN KEY ("timeslot_id") REFERENCES "public"."timeslots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_menu_categories" ADD CONSTRAINT "restaurant_menu_categories_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_policies" ADD CONSTRAINT "restaurant_policies_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_audit_logs" ADD CONSTRAINT "tenant_audit_logs_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_usage_metrics" ADD CONSTRAINT "tenant_usage_metrics_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeslots" ADD CONSTRAINT "timeslots_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeslots" ADD CONSTRAINT "timeslots_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE no action ON UPDATE no action;