-- =====================================================================
-- DATABASE MIGRATION SCRIPT (Final, Simplified Version)
-- Migrates the schema to support multi-tenant guests and fix currency data types.
-- =====================================================================

BEGIN;

-- =====================================================================
-- STEP 1: Fix Currency Data Types
-- =====================================================================

ALTER TABLE "reservations"
ALTER COLUMN "total_amount" TYPE DECIMAL(10, 2) USING (total_amount::DECIMAL(10, 2));

ALTER TABLE "reservation_cancellations"
ALTER COLUMN "fee_amount" TYPE DECIMAL(10, 2) USING (fee_amount::DECIMAL(10, 2)),
ALTER COLUMN "refund_amount" TYPE DECIMAL(10, 2) USING (refund_amount::DECIMAL(10, 2));

ALTER TABLE "menu_items"
ALTER COLUMN "price" TYPE DECIMAL(10, 2) USING (price::DECIMAL(10, 2)),
ALTER COLUMN "original_price" TYPE DECIMAL(10, 2) USING (original_price::DECIMAL(10, 2));

ALTER TABLE "menu_item_option_values"
ALTER COLUMN "price_modifier" TYPE DECIMAL(10, 2) USING (price_modifier::DECIMAL(10, 2));

-- =====================================================================
-- STEP 2: Implement Guest Tenant Isolation
-- =====================================================================

ALTER TABLE "guests"
ADD COLUMN "restaurant_id" INTEGER;

-- Assuming the table is empty, we can set a temporary default to make it NOT NULL
UPDATE "guests" SET "restaurant_id" = 0 WHERE "restaurant_id" IS NULL;
ALTER TABLE "guests" ALTER COLUMN "restaurant_id" SET NOT NULL;

ALTER TABLE "guests"
ADD CONSTRAINT "guests_restaurant_id_restaurants_id_fk"
FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE cascade;

-- This DO block is valid because RAISE NOTICE is inside a procedural block
DO $$
BEGIN
   IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guests_telegram_user_id_unique') THEN
      ALTER TABLE "guests" DROP CONSTRAINT "guests_telegram_user_id_unique";
      RAISE NOTICE 'Dropped old unique constraint on telegram_user_id.';
   ELSE
      RAISE NOTICE 'Old unique constraint on telegram_user_id not found, skipping drop.';
   END IF;
END;
$$;

ALTER TABLE "guests"
ADD CONSTRAINT "guests_phone_restaurant_id_unique" UNIQUE ("phone", "restaurant_id"),
ADD CONSTRAINT "guests_telegram_user_id_restaurant_id_unique" UNIQUE ("telegram_user_id", "restaurant_id");

COMMIT;