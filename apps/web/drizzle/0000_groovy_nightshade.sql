CREATE TYPE "public"."agent_status" AS ENUM('pending', 'active', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."dns_record_type" AS ENUM('A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."renewal_status" AS ENUM('scheduled', 'in_progress', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ssl_status" AS ENUM('pending', 'provisioning', 'active', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" varchar(42) NOT NULL,
	"agent_id_nft" integer NOT NULL,
	"domain" varchar(253) NOT NULL,
	"basename" varchar(255),
	"ens_name" varchar(255),
	"status" "agent_status" DEFAULT 'pending' NOT NULL,
	"metadata_uri" varchar(500),
	"metadata_json" jsonb,
	"ssl_status" "ssl_status" DEFAULT 'pending' NOT NULL,
	"dns_target" varchar(500),
	"framework" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key_hash" varchar(255) NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"name" varchar(100) NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dns_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"type" "dns_record_type" NOT NULL,
	"name" varchar(253) NOT NULL,
	"value" text NOT NULL,
	"ttl" integer DEFAULT 3600 NOT NULL,
	"priority" integer,
	"cloudflare_id" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_inboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"email_address" varchar(255) NOT NULL,
	"resend_domain_id" varchar(100),
	"dkim_configured" boolean DEFAULT false NOT NULL,
	"spf_configured" boolean DEFAULT false NOT NULL,
	"dmarc_configured" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inbox_id" uuid NOT NULL,
	"from_address" varchar(255) NOT NULL,
	"subject" text,
	"text" text,
	"html" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid,
	"idempotency_key" varchar(255) NOT NULL,
	"tx_hash" varchar(66),
	"payer_address" varchar(42) NOT NULL,
	"payment_amount" numeric(18, 6) NOT NULL,
	"domain_cost" numeric(18, 6) NOT NULL,
	"basename_cost" numeric(18, 6) DEFAULT '0' NOT NULL,
	"ens_cost" numeric(18, 6) DEFAULT '0' NOT NULL,
	"service_fee" numeric(18, 6) NOT NULL,
	"status" "registration_status" DEFAULT 'pending' NOT NULL,
	"registrar_order_id" varchar(100),
	"error_message" text,
	"request_params" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "renewals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"status" "renewal_status" DEFAULT 'scheduled' NOT NULL,
	"tx_hash" varchar(66),
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reputation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"score_delta" integer NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" varchar(42) NOT NULL,
	"email" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dns_records" ADD CONSTRAINT "dns_records_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_inboxes" ADD CONSTRAINT "email_inboxes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_inbox_id_email_inboxes_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."email_inboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reputation_events" ADD CONSTRAINT "reputation_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_wallet_idx" ON "agents" USING btree ("wallet_address");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_domain_uniq" ON "agents" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_nft_uniq" ON "agents" USING btree ("agent_id_nft");--> statement-breakpoint
CREATE INDEX "agents_status_idx" ON "agents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agents_framework_idx" ON "agents" USING btree ("framework");--> statement-breakpoint
CREATE INDEX "apikeys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "apikeys_hash_uniq" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "dns_agent_idx" ON "dns_records" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_agent_uniq" ON "email_inboxes" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_address_uniq" ON "email_inboxes" USING btree ("email_address");--> statement-breakpoint
CREATE INDEX "email_msg_inbox_idx" ON "email_messages" USING btree ("inbox_id");--> statement-breakpoint
CREATE INDEX "email_msg_received_idx" ON "email_messages" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_idempotency_uniq" ON "registrations" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "registrations_agent_idx" ON "registrations" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "registrations_status_idx" ON "registrations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "renewals_agent_idx" ON "renewals" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "renewals_scheduled_idx" ON "renewals" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "renewals_status_idx" ON "renewals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "rep_agent_idx" ON "reputation_events" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "rep_type_idx" ON "reputation_events" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "users_wallet_uniq" ON "users" USING btree ("wallet_address");