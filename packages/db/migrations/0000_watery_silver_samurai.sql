CREATE TABLE IF NOT EXISTS "corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extraction_id" uuid NOT NULL,
	"field_path" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"correction_type" text NOT NULL,
	"note" text,
	"corrected_by" text NOT NULL,
	"became_fixture" boolean DEFAULT false NOT NULL,
	"fixture_id" text,
	"corrected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"storage_path" text NOT NULL,
	"file_hash" text NOT NULL,
	"page_count" integer,
	"detected_type" text,
	"detected_type_confidence" numeric,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_file_hash_uniq" UNIQUE("file_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"canonical_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_type_name_uniq" UNIQUE("entity_type","canonical_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"extraction_id" uuid NOT NULL,
	"field_path" text NOT NULL,
	"raw_value" text NOT NULL,
	"confidence" numeric NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eval_run_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eval_run_id" uuid NOT NULL,
	"artifact_type" text NOT NULL,
	"artifact_name" text NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "eval_run_artifacts_uniq" UNIQUE("eval_run_id","artifact_type","artifact_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fixtures_total" integer NOT NULL,
	"fixtures_passed" integer NOT NULL,
	"overall_f1" numeric,
	"regressions" jsonb,
	"improvements" jsonb,
	"cost_usd" numeric,
	"report_markdown" text,
	"triggered_by" text,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"schema_id" uuid NOT NULL,
	"prompt_id" uuid NOT NULL,
	"extracted_json" jsonb NOT NULL,
	"per_field_confidence" jsonb NOT NULL,
	"overall_confidence" numeric NOT NULL,
	"validation_results" jsonb NOT NULL,
	"model_used" text NOT NULL,
	"tokens_input" integer,
	"tokens_output" integer,
	"cost_usd" numeric,
	"latency_ms" integer,
	"status" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pipeline_steps_completed" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"step_name" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_steps_doc_step_uniq" UNIQUE("document_id","step_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prompt_hints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_type" text NOT NULL,
	"matching_key" text NOT NULL,
	"field_path" text NOT NULL,
	"hint" text NOT NULL,
	"created_from_correction_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompts_name_version_uniq" UNIQUE("name","version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schemas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"yaml_definition" text NOT NULL,
	"compiled_json" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schemas_name_version_uniq" UNIQUE("name","version")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "corrections" ADD CONSTRAINT "corrections_extraction_id_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extractions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_extraction_id_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extractions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "eval_run_artifacts" ADD CONSTRAINT "eval_run_artifacts_eval_run_id_eval_runs_id_fk" FOREIGN KEY ("eval_run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "extractions" ADD CONSTRAINT "extractions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "extractions" ADD CONSTRAINT "extractions_schema_id_schemas_id_fk" FOREIGN KEY ("schema_id") REFERENCES "public"."schemas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "extractions" ADD CONSTRAINT "extractions_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_steps_completed" ADD CONSTRAINT "pipeline_steps_completed_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_hints" ADD CONSTRAINT "prompt_hints_created_from_correction_id_corrections_id_fk" FOREIGN KEY ("created_from_correction_id") REFERENCES "public"."corrections"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "corrections_extraction_field_idx" ON "corrections" USING btree ("extraction_id","field_path");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "corrections_corrected_at_idx" ON "corrections" USING btree ("corrected_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_status_idx" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_mentions_extraction_idx" ON "entity_mentions" USING btree ("extraction_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eval_run_artifacts_run_idx" ON "eval_run_artifacts" USING btree ("eval_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eval_runs_ran_at_idx" ON "eval_runs" USING btree ("ran_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_aggregate_idx" ON "events" USING btree ("aggregate_type","aggregate_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_type_idx" ON "events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "extractions_document_id_idx" ON "extractions" USING btree ("document_id","extracted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "extractions_status_confidence_idx" ON "extractions" USING btree ("status","overall_confidence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompt_hints_lookup_idx" ON "prompt_hints" USING btree ("document_type","matching_key","is_active");