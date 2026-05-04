CREATE TABLE "transcript_segment" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"speaker_label" text NOT NULL,
	"original_text" text NOT NULL,
	"translated_text" text,
	"start_time" double precision,
	"end_time" double precision,
	"is_final" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcription_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'Untitled Session' NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"source_language" text DEFAULT 'auto-detected',
	"target_language" text NOT NULL,
	"duration_seconds" integer DEFAULT 0,
	"speaker_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"default_target_language" text DEFAULT 'en',
	"selected_microphone_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transcript_segment" ADD CONSTRAINT "transcript_segment_session_id_transcription_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."transcription_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_session" ADD CONSTRAINT "transcription_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transcript_segment_session_id_idx" ON "transcript_segment" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "transcript_segment_session_created_idx" ON "transcript_segment" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "transcription_session_user_id_idx" ON "transcription_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transcription_session_created_at_idx" ON "transcription_session" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_settings_user_id_idx" ON "user_settings" USING btree ("user_id");