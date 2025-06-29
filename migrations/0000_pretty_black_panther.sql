CREATE TYPE "public"."reservation_status" AS ENUM('created', 'confirmed', 'canceled', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."table_status" AS ENUM('free', 'occupied', 'reserved', 'unavailable');--> statement-breakpoint
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
	"created_at" timestamp DEFAULT now() NOT NULL
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
	"created_at" timestamp DEFAULT now() NOT NULL
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
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_timeslot_id_timeslots_id_fk" FOREIGN KEY ("timeslot_id") REFERENCES "public"."timeslots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeslots" ADD CONSTRAINT "timeslots_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeslots" ADD CONSTRAINT "timeslots_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE no action ON UPDATE no action;