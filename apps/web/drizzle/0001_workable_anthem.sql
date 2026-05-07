CREATE TABLE "email_blocklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inbox_id" uuid NOT NULL,
	"value" varchar(255) NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "direction" varchar(10) DEFAULT 'inbound' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "resend_message_id" varchar(255);--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "to_address" varchar(255);--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "raw_payload" jsonb;--> statement-breakpoint
ALTER TABLE "email_blocklist" ADD CONSTRAINT "email_blocklist_inbox_id_email_inboxes_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."email_inboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_blocklist_inbox_idx" ON "email_blocklist" USING btree ("inbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_blocklist_inbox_value_uniq" ON "email_blocklist" USING btree ("inbox_id","value");--> statement-breakpoint
CREATE UNIQUE INDEX "email_msg_resend_message_uniq" ON "email_messages" USING btree ("resend_message_id");