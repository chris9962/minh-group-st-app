CREATE TABLE "kpi_scores" (
	"user_id" uuid NOT NULL,
	"year_month" text NOT NULL,
	"banking_points" numeric(10, 2) DEFAULT '0' NOT NULL,
	"service_points" numeric(10, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "kpi_scores_user_id_year_month_pk" PRIMARY KEY("user_id","year_month")
);
--> statement-breakpoint
ALTER TABLE "kpi_scores" ADD CONSTRAINT "kpi_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kpi_scores_month" ON "kpi_scores" USING btree ("year_month");