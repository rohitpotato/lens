DROP INDEX IF EXISTS "prompt_hints_lookup_idx";--> statement-breakpoint
ALTER TABLE "prompt_hints" ADD COLUMN "status" text DEFAULT 'suggested' NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_hints" ADD COLUMN "evidence_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_hints" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "prompt_hints" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompt_hints_status_idx" ON "prompt_hints" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompt_hints_lookup_idx" ON "prompt_hints" USING btree ("document_type","matching_key","status");