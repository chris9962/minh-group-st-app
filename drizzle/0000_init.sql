CREATE TYPE "public"."account_number_method" AS ENUM('phone-match', 'manual');--> statement-breakpoint
CREATE TYPE "public"."action_key" AS ENUM('view-summary', 'view-detail', 'create', 'update', 'delete', 'export', 'handle-fallback', 'grant-gift', 'manage-referral-codes', 'manage-bank-catalog', 'configure-catalog', 'configure-gift-rules', 'manage-org', 'grant-permission', 'access-id-number');--> statement-breakpoint
CREATE TYPE "public"."app_count_comparator" AS ENUM('none', 'eq', 'gte');--> statement-breakpoint
CREATE TYPE "public"."bank_account_status" AS ENUM('creating', 'done');--> statement-breakpoint
CREATE TYPE "public"."bank_account_type" AS ENUM('none', 'CNKD', 'HKD');--> statement-breakpoint
CREATE TYPE "public"."channel_input_kind" AS ENUM('ward-hamlet', 'hospital', 'free-text', 'none');--> statement-breakpoint
CREATE TYPE "public"."gift_group" AS ENUM('cash', 'choice');--> statement-breakpoint
CREATE TYPE "public"."gift_rule_mode" AS ENUM('accumulate', 'tiered', 'addon');--> statement-breakpoint
CREATE TYPE "public"."insurance_order_source" AS ENUM('self', 'gift');--> statement-breakpoint
CREATE TYPE "public"."insurance_order_status" AS ENUM('queued', 'creating', 'pending-approval', 'manual-queued', 'manual-progress', 'done');--> statement-breakpoint
CREATE TYPE "public"."insurance_product" AS ENUM('motorbike', 'electric-accident');--> statement-breakpoint
CREATE TYPE "public"."manage_scope" AS ENUM('none', 'listed', 'company');--> statement-breakpoint
CREATE TYPE "public"."module_key" AS ENUM('customer', 'insurance', 'banking', 'services', 'staff', 'system', '*');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('order-done', 'order-manual', 'code-low');--> statement-breakpoint
CREATE TYPE "public"."role_key" AS ENUM('director', 'deputy-director', 'head', 'deputy-head', 'staff');--> statement-breakpoint
CREATE TYPE "public"."scope_key" AS ENUM('own', 'managed', 'company');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text NOT NULL,
	"module" "module_key" NOT NULL,
	"action" "action_key" NOT NULL,
	"target_label" text NOT NULL,
	"target_table" text,
	"target_id" text,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "departments_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"remember" boolean NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_managed_departments" (
	"user_id" text NOT NULL,
	"department_id" text NOT NULL,
	CONSTRAINT "user_managed_departments_user_id_department_id_pk" PRIMARY KEY("user_id","department_id")
);
--> statement-breakpoint
CREATE TABLE "user_permissions" (
	"user_id" text NOT NULL,
	"module" "module_key" NOT NULL,
	"action" "action_key" NOT NULL,
	"scope" "scope_key" NOT NULL,
	CONSTRAINT "user_permissions_user_id_module_action_pk" PRIMARY KEY("user_id","module","action")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"role" "role_key" NOT NULL,
	"title" text NOT NULL,
	"department_id" text,
	"manage_scope" "manage_scope" DEFAULT 'none' NOT NULL,
	"ward_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"failed_attempts" smallint DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_managed_departments" ADD CONSTRAINT "user_managed_departments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_managed_departments" ADD CONSTRAINT "user_managed_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at" ON "audit_log" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_actor" ON "audit_log" USING btree ("actor_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "users_department" ON "users" USING btree ("department_id");