CREATE TABLE "inbound_email_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_id" uuid NOT NULL,
	"binary_key" text,
	"file_name" text,
	"mime_type" text,
	"file_extension" text,
	"content_id" text,
	"content_disposition" text,
	"file_size" integer NOT NULL,
	"checksum_sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(64) DEFAULT 'n8n_email_trigger_imap' NOT NULL,
	"message_id" text,
	"uid" text,
	"mailbox" text,
	"subject" text,
	"from_address" jsonb,
	"to_address" jsonb,
	"cc_address" jsonb,
	"bcc_address" jsonb,
	"reply_to_address" jsonb,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"text_plain" text,
	"text_html" text,
	"headers" jsonb,
	"raw_json" jsonb NOT NULL,
	"attachment_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbound_email_attachments" ADD CONSTRAINT "inbound_email_attachments_email_id_inbound_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."inbound_emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbound_email_attachments_email_id_idx" ON "inbound_email_attachments" USING btree ("email_id");--> statement-breakpoint
CREATE INDEX "inbound_email_attachments_checksum_idx" ON "inbound_email_attachments" USING btree ("checksum_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_emails_message_id_idx" ON "inbound_emails" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "inbound_emails_sent_at_idx" ON "inbound_emails" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "inbound_emails_received_at_idx" ON "inbound_emails" USING btree ("received_at");