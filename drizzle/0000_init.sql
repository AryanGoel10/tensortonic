CREATE TABLE "activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_email" text,
	"level" text DEFAULT 'info' NOT NULL,
	"kind" text NOT NULL,
	"spreadsheet_id" text,
	"tab" text,
	"row_key" text,
	"message" text NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "connected_sheets" (
	"spreadsheet_id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"row_key" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"spreadsheet_id" text NOT NULL,
	"tab" text NOT NULL,
	"campaign" text NOT NULL,
	"total" integer NOT NULL,
	"started_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_packs" (
	"id" serial PRIMARY KEY NOT NULL,
	"spreadsheet_id" text NOT NULL,
	"tab" text NOT NULL,
	"row_key" text NOT NULL,
	"pack" jsonb NOT NULL,
	"draft" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "send_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"spreadsheet_id" text NOT NULL,
	"tab" text NOT NULL,
	"row_key" text NOT NULL,
	"campaign" text NOT NULL,
	"sender_email" text NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"kind" text DEFAULT 'prospect' NOT NULL,
	"status" text NOT NULL,
	"zoho_message_id" text,
	"error" text,
	"queued_by" text NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"email" text PRIMARY KEY NOT NULL,
	"name" text,
	"image" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zoho_accounts" (
	"user_email" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"from_address" text NOT NULL,
	"display_name" text,
	"refresh_token_enc" text NOT NULL,
	"access_token_enc" text,
	"access_expires_at" timestamp with time zone,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "activity_at_idx" ON "activity" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_items_run_row_idx" ON "job_items" USING btree ("run_id","row_key");--> statement-breakpoint
CREATE UNIQUE INDEX "research_packs_row_idx" ON "research_packs" USING btree ("spreadsheet_id","tab","row_key");--> statement-breakpoint
CREATE INDEX "send_queue_sender_idx" ON "send_queue" USING btree ("sender_email","sent_at");--> statement-breakpoint
CREATE INDEX "settings_history_key_idx" ON "settings_history" USING btree ("key","updated_at");