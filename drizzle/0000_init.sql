-- Extension + hàm chuẩn hoá cho C-06 (mgst-db-design.md §8) — phải có TRƯỚC
-- generated column customers.search_name và index trigram bên dưới.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE OR REPLACE FUNCTION mgst_normalize(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$fn$ SELECT lower(public.unaccent('public.unaccent', translate($1, 'đĐ', 'dD'))) $fn$;
--> statement-breakpoint
CREATE TYPE "public"."account_number_method" AS ENUM('phone-match', 'manual');--> statement-breakpoint
CREATE TYPE "public"."action_key" AS ENUM('view-summary', 'view-detail', 'create', 'update', 'delete', 'export', 'handle-fallback', 'grant-gift', 'manage-referral-codes', 'manage-bank-catalog', 'configure-catalog', 'configure-gift-rules', 'manage-org', 'grant-permission', 'access-id-number');--> statement-breakpoint
CREATE TYPE "public"."bank_account_status" AS ENUM('creating', 'done');--> statement-breakpoint
CREATE TYPE "public"."bank_account_type" AS ENUM('none', 'CNKD', 'HKD');--> statement-breakpoint
CREATE TYPE "public"."channel_input_kind" AS ENUM('ward-hamlet', 'hospital', 'free-text', 'none');--> statement-breakpoint
CREATE TYPE "public"."insurance_order_source" AS ENUM('self', 'gift');--> statement-breakpoint
CREATE TYPE "public"."insurance_order_status" AS ENUM('queued', 'creating', 'pending-approval', 'manual-queued', 'manual-progress', 'done');--> statement-breakpoint
CREATE TYPE "public"."insurance_product" AS ENUM('motorbike', 'electric-accident');--> statement-breakpoint
CREATE TYPE "public"."manage_scope" AS ENUM('none', 'listed', 'company');--> statement-breakpoint
CREATE TYPE "public"."module_key" AS ENUM('customer', 'insurance', 'banking', 'services', 'staff', 'system', '*');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('order-done', 'order-manual', 'code-low');--> statement-breakpoint
CREATE TYPE "public"."photo_kind" AS ENUM('opening', 'transaction');--> statement-breakpoint
CREATE TYPE "public"."role_key" AS ENUM('director', 'deputy-director', 'head', 'deputy-head', 'staff');--> statement-breakpoint
CREATE TYPE "public"."scope_key" AS ENUM('own', 'managed', 'company');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid NOT NULL,
	"module" "module_key" NOT NULL,
	"action" "action_key" NOT NULL,
	"target_label" text NOT NULL,
	"target_table" text,
	"target_id" text,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "bank_account_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "photo_kind" DEFAULT 'opening' NOT NULL,
	"url" text NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"bank_id" uuid NOT NULL,
	"referral_code_id" uuid NOT NULL,
	"status" "bank_account_status" DEFAULT 'creating' NOT NULL,
	"account_number" text,
	"opened_date" date,
	"app_installed" boolean DEFAULT false NOT NULL,
	"transaction_at" date,
	"account_type" "bank_account_type" DEFAULT 'none' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"channel_id" uuid,
	"channel_detail" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_by_department_id" uuid,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "bank_accounts_done_filled" CHECK (status = 'creating' or (account_number is not null and opened_date is not null)),
	CONSTRAINT "bank_accounts_transaction_other_day" CHECK (transaction_at is null or transaction_at <> opened_date)
);
--> statement-breakpoint
CREATE TABLE "banks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"required_photos" smallint DEFAULT 3 NOT NULL,
	"account_number_method" "account_number_method" DEFAULT 'phone-match' NOT NULL,
	"coefficient" numeric(4, 2) DEFAULT '1' NOT NULL,
	"counts_as_app" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "banks_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"input_kind" "channel_input_kind" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_code_unique" UNIQUE("code"),
	CONSTRAINT "channels_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "customer_phones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"number" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"search_name" text GENERATED ALWAYS AS (mgst_normalize(full_name)) STORED,
	"dob" date,
	"id_number" text,
	"address" text DEFAULT '' NOT NULL,
	"channel_id" uuid,
	"channel_detail" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "departments_code_unique" UNIQUE("code"),
	CONSTRAINT "departments_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "gift_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cash_total" integer DEFAULT 0 NOT NULL,
	"chosen_item" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "gift_grants_customer_id_unique" UNIQUE("customer_id")
);
--> statement-breakpoint
CREATE TABLE "gift_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_items_code_unique" UNIQUE("code"),
	CONSTRAINT "gift_items_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "hamlets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ward_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hospitals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospitals_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "insurance_order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "insurance_order_status",
	"to_status" "insurance_order_status" NOT NULL,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_code" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"product" "insurance_product" NOT NULL,
	"package_id" uuid,
	"package_name" text NOT NULL,
	"fee" integer DEFAULT 0 NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "insurance_order_status" DEFAULT 'queued' NOT NULL,
	"source" "insurance_order_source" NOT NULL,
	"gift_grant_id" uuid,
	"beneficiary_name" text NOT NULL,
	"beneficiary_dob" date,
	"beneficiary_id_number" text DEFAULT '' NOT NULL,
	"beneficiary_phone" text DEFAULT '' NOT NULL,
	"beneficiary_address" text DEFAULT '' NOT NULL,
	"license_plate" text DEFAULT '' NOT NULL,
	"vehicle_type" text DEFAULT '' NOT NULL,
	"chassis_number" text DEFAULT '' NOT NULL,
	"engine_number" text DEFAULT '' NOT NULL,
	"certificate_photo_url" text,
	"handled_by" uuid,
	"created_by" uuid,
	"created_by_department_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "insurance_orders_order_code_unique" UNIQUE("order_code"),
	CONSTRAINT "insurance_orders_motorbike_plate" CHECK (product <> 'motorbike' or license_plate <> ''),
	CONSTRAINT "insurance_orders_motorbike_vehicle_type" CHECK (product <> 'motorbike' or vehicle_type <> ''),
	CONSTRAINT "insurance_orders_fee_positive" CHECK (fee >= 0)
);
--> statement-breakpoint
CREATE TABLE "insurance_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"yearly_fee" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "insurance_packages_code_unique" UNIQUE("code"),
	CONSTRAINT "insurance_packages_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "kpi_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year_month" text NOT NULL,
	"department_id" uuid,
	"monthly_points" integer NOT NULL,
	"warn_days_left" smallint DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone,
	CONSTRAINT "kpi_targets_points_positive" CHECK (monthly_points > 0)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_code_counters" (
	"year_month" text PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provinces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provinces_ref_id_unique" UNIQUE("ref_id")
);
--> statement-breakpoint
CREATE TABLE "pvi_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_encrypted" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pvi_accounts_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "ref_provinces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_wards" (
	"id" text PRIMARY KEY NOT NULL,
	"province_id" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_id" uuid NOT NULL,
	"code" text NOT NULL,
	"total" integer NOT NULL,
	"imported_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_codes_total_positive" CHECK (total > 0)
);
--> statement-breakpoint
CREATE TABLE "service_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"coefficient" numeric(4, 2) DEFAULT '1' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "service_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"service_type_id" uuid NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"service_date" date DEFAULT current_date NOT NULL,
	"created_by" uuid NOT NULL,
	"created_by_department_id" uuid,
	"ward_id" uuid,
	"ward_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"remember" boolean NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_managed_departments" (
	"user_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	CONSTRAINT "user_managed_departments_user_id_department_id_pk" PRIMARY KEY("user_id","department_id")
);
--> statement-breakpoint
CREATE TABLE "user_permissions" (
	"user_id" uuid NOT NULL,
	"module" "module_key" NOT NULL,
	"action" "action_key" NOT NULL,
	"scope" "scope_key" NOT NULL,
	CONSTRAINT "user_permissions_user_id_module_action_pk" PRIMARY KEY("user_id","module","action")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"staff_code" text,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"role" "role_key" NOT NULL,
	"title" text NOT NULL,
	"department_id" uuid,
	"manage_scope" "manage_scope" DEFAULT 'none' NOT NULL,
	"ward_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"failed_attempts" smallint DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "wards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"province_id" uuid NOT NULL,
	"ref_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wards_ref_id_unique" UNIQUE("ref_id")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_account_photos" ADD CONSTRAINT "bank_account_photos_account_id_bank_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_referral_code_id_referral_codes_id_fk" FOREIGN KEY ("referral_code_id") REFERENCES "public"."referral_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_created_by_department_id_departments_id_fk" FOREIGN KEY ("created_by_department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_phones" ADD CONSTRAINT "customer_phones_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_grants" ADD CONSTRAINT "gift_grants_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_grants" ADD CONSTRAINT "gift_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hamlets" ADD CONSTRAINT "hamlets_ward_id_wards_id_fk" FOREIGN KEY ("ward_id") REFERENCES "public"."wards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_order_status_history" ADD CONSTRAINT "insurance_order_status_history_order_id_insurance_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."insurance_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_order_status_history" ADD CONSTRAINT "insurance_order_status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_orders" ADD CONSTRAINT "insurance_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_orders" ADD CONSTRAINT "insurance_orders_package_id_insurance_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."insurance_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_orders" ADD CONSTRAINT "insurance_orders_gift_grant_id_gift_grants_id_fk" FOREIGN KEY ("gift_grant_id") REFERENCES "public"."gift_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_orders" ADD CONSTRAINT "insurance_orders_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_orders" ADD CONSTRAINT "insurance_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_orders" ADD CONSTRAINT "insurance_orders_created_by_department_id_departments_id_fk" FOREIGN KEY ("created_by_department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_targets" ADD CONSTRAINT "kpi_targets_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_targets" ADD CONSTRAINT "kpi_targets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provinces" ADD CONSTRAINT "provinces_ref_id_ref_provinces_id_fk" FOREIGN KEY ("ref_id") REFERENCES "public"."ref_provinces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_wards" ADD CONSTRAINT "ref_wards_province_id_ref_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."ref_provinces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_created_by_department_id_departments_id_fk" FOREIGN KEY ("created_by_department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_ward_id_wards_id_fk" FOREIGN KEY ("ward_id") REFERENCES "public"."wards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_managed_departments" ADD CONSTRAINT "user_managed_departments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_managed_departments" ADD CONSTRAINT "user_managed_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_ward_id_wards_id_fk" FOREIGN KEY ("ward_id") REFERENCES "public"."wards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wards" ADD CONSTRAINT "wards_province_id_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wards" ADD CONSTRAINT "wards_ref_id_ref_wards_id_fk" FOREIGN KEY ("ref_id") REFERENCES "public"."ref_wards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at" ON "audit_log" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_actor" ON "audit_log" USING btree ("actor_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bank_account_photos_account" ON "bank_account_photos" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "bank_accounts_customer" ON "bank_accounts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "bank_accounts_referral" ON "bank_accounts" USING btree ("referral_code_id","status");--> statement-breakpoint
CREATE INDEX "bank_accounts_dept_date" ON "bank_accounts" USING btree ("created_by_department_id","opened_date");--> statement-breakpoint
CREATE INDEX "customer_phones_number" ON "customer_phones" USING btree ("number");--> statement-breakpoint
CREATE INDEX "customer_phones_customer" ON "customer_phones" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_phones_one_primary" ON "customer_phones" USING btree ("customer_id") WHERE is_primary;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_id_number" ON "customers" USING btree ("id_number") WHERE id_number is not null;--> statement-breakpoint
CREATE INDEX "customers_search_name_trgm" ON "customers" USING gin (search_name gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customers_id_last4" ON "customers" USING btree (right(id_number, 4)) WHERE id_number is not null;--> statement-breakpoint
CREATE INDEX "insurance_history_order" ON "insurance_order_status_history" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "insurance_orders_customer" ON "insurance_orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "insurance_orders_status" ON "insurance_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "insurance_orders_dept_date" ON "insurance_orders" USING btree ("created_by_department_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_targets_month_dept" ON "kpi_targets" USING btree ("year_month","department_id") WHERE department_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_targets_month_company" ON "kpi_targets" USING btree ("year_month") WHERE department_id is null;--> statement-breakpoint
CREATE INDEX "notifications_user" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ref_wards_province" ON "ref_wards" USING btree ("province_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_codes_bank_code" ON "referral_codes" USING btree ("bank_id","code");--> statement-breakpoint
CREATE INDEX "services_dept_date" ON "services" USING btree ("created_by_department_id","service_date");--> statement-breakpoint
CREATE INDEX "services_customer" ON "services" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "users_department" ON "users" USING btree ("department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_staff_code" ON "users" USING btree ("staff_code") WHERE staff_code is not null;