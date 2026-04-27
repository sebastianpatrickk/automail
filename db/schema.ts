import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const inboundEmails = pgTable(
  "inbound_emails",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: varchar("source", { length: 64 })
      .default("n8n_email_trigger_imap")
      .notNull(),
    messageId: text("message_id"),
    uid: text("uid"),
    mailbox: text("mailbox"),
    subject: text("subject"),
    fromAddress: jsonb("from_address").$type<JsonValue>(),
    toAddress: jsonb("to_address").$type<JsonValue>(),
    ccAddress: jsonb("cc_address").$type<JsonValue>(),
    bccAddress: jsonb("bcc_address").$type<JsonValue>(),
    replyToAddress: jsonb("reply_to_address").$type<JsonValue>(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    textPlain: text("text_plain"),
    textHtml: text("text_html"),
    headers: jsonb("headers").$type<JsonValue>(),
    rawJson: jsonb("raw_json").$type<JsonValue>().notNull(),
    attachmentCount: integer("attachment_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("inbound_emails_message_id_idx").on(table.messageId),
    index("inbound_emails_sent_at_idx").on(table.sentAt),
    index("inbound_emails_received_at_idx").on(table.receivedAt),
  ],
);

export const inboundEmailAttachments = pgTable(
  "inbound_email_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    emailId: uuid("email_id")
      .notNull()
      .references(() => inboundEmails.id, { onDelete: "cascade" }),
    binaryKey: text("binary_key"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    fileExtension: text("file_extension"),
    contentId: text("content_id"),
    contentDisposition: text("content_disposition"),
    fileSize: integer("file_size").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("inbound_email_attachments_email_id_idx").on(table.emailId),
    index("inbound_email_attachments_checksum_idx").on(table.checksumSha256),
  ],
);
