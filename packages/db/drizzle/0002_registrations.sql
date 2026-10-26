CREATE TABLE "registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "registrations_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"promoted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "registrations_status_check" CHECK (status in ('confirmed', 'waitlisted', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_org_fk" FOREIGN KEY ("event_id","organization_id") REFERENCES "public"."events"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_event_user_active_uniq" ON "registrations" USING btree ("event_id","user_id") WHERE status in ('confirmed', 'waitlisted');--> statement-breakpoint
CREATE INDEX "registrations_event_status_seq_idx" ON "registrations" USING btree ("event_id","status","seq");