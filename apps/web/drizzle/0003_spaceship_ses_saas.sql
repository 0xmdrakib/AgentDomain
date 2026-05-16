ALTER TYPE "dns_record_type" ADD VALUE IF NOT EXISTS 'ALIAS';
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'dns_records'
      AND column_name = 'cloudflare_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'dns_records'
      AND column_name = 'provider_record_id'
  ) THEN
    ALTER TABLE "dns_records" RENAME COLUMN "cloudflare_id" TO "provider_record_id";
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "dns_records" ADD COLUMN IF NOT EXISTS "provider" varchar(40) DEFAULT 'spaceship' NOT NULL;
--> statement-breakpoint
UPDATE "dns_records" SET "provider" = 'spaceship' WHERE "provider" IS NULL OR "provider" <> 'spaceship';
--> statement-breakpoint
ALTER TABLE "dns_records" ADD COLUMN IF NOT EXISTS "system_managed" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "dns_records" ADD COLUMN IF NOT EXISTS "purpose" varchar(80);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'email_inboxes'
      AND column_name = 'resend_domain_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'email_inboxes'
      AND column_name = 'ses_identity_arn'
  ) THEN
    ALTER TABLE "email_inboxes" RENAME COLUMN "resend_domain_id" TO "ses_identity_arn";
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "email_inboxes" ADD COLUMN IF NOT EXISTS "ses_verification_status" varchar(50) DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_inboxes" ADD COLUMN IF NOT EXISTS "ses_mail_from_domain" varchar(255);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'email_messages'
      AND column_name = 'resend_message_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'email_messages'
      AND column_name = 'provider_message_id'
  ) THEN
    ALTER TABLE "email_messages" RENAME COLUMN "resend_message_id" TO "provider_message_id";
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "email_messages" DROP COLUMN IF EXISTS "html";
--> statement-breakpoint
ALTER TABLE "email_messages" DROP COLUMN IF EXISTS "raw_payload";
--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN IF NOT EXISTS "verification_codes" jsonb;
--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN IF NOT EXISTS "spam_verdict" varchar(20);
--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN IF NOT EXISTS "virus_verdict" varchar(20);
--> statement-breakpoint
DROP INDEX IF EXISTS "email_msg_resend_message_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_msg_provider_message_uniq" ON "email_messages" USING btree ("provider_message_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ssl_hostnames" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"hostname" varchar(253) NOT NULL,
	"cloudflare_custom_hostname_id" varchar(100) NOT NULL,
	"hostname_status" varchar(50) DEFAULT 'pending' NOT NULL,
	"ssl_status" varchar(50) DEFAULT 'pending' NOT NULL,
	"validation_records" jsonb,
	"validation_errors" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "ssl_hostnames" ADD CONSTRAINT "ssl_hostnames_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ssl_hostnames_agent_uniq" ON "ssl_hostnames" USING btree ("agent_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ssl_hostnames_hostname_uniq" ON "ssl_hostnames" USING btree ("hostname");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ssl_hostnames_status_idx" ON "ssl_hostnames" USING btree ("hostname_status","ssl_status");
--> statement-breakpoint
DROP TABLE IF EXISTS "ssl_certificates";
