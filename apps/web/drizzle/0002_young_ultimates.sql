CREATE TABLE "ssl_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"domains" jsonb NOT NULL,
	"certificate_pem_encrypted" text NOT NULL,
	"private_key_pem_encrypted" text NOT NULL,
	"provider" varchar(50) DEFAULT 'letsencrypt' NOT NULL,
	"directory_url" text NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"not_after" timestamp with time zone NOT NULL,
	"renew_after" timestamp with time zone NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_provisioned_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ssl_certificates" ADD CONSTRAINT "ssl_certificates_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ssl_certificates_agent_uniq" ON "ssl_certificates" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "ssl_certificates_renew_after_idx" ON "ssl_certificates" USING btree ("renew_after");--> statement-breakpoint
CREATE INDEX "ssl_certificates_not_after_idx" ON "ssl_certificates" USING btree ("not_after");