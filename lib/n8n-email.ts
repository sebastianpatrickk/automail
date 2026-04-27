import { createHash } from "node:crypto";
import type { JsonValue } from "@/db/schema";

type UnknownRecord = Record<string, unknown>;

export class WebhookPayloadError extends Error {
  constructor(readonly issues: string[]) {
    super("Invalid n8n email webhook payload");
    this.name = "WebhookPayloadError";
  }
}

export type NormalizedEmailAttachment = {
  binaryKey: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileExtension: string | null;
  contentId: string | null;
  contentDisposition: string | null;
  fileSize: number;
  checksumSha256: string;
  data: Buffer;
};

export type NormalizedEmail = {
  messageId: string | null;
  uid: string | null;
  mailbox: string | null;
  subject: string | null;
  fromAddress: JsonValue | null;
  toAddress: JsonValue | null;
  ccAddress: JsonValue | null;
  bccAddress: JsonValue | null;
  replyToAddress: JsonValue | null;
  sentAt: Date | null;
  textPlain: string | null;
  textHtml: string | null;
  headers: JsonValue | null;
  rawJson: JsonValue;
  attachments: NormalizedEmailAttachment[];
};

export function normalizeN8nEmailPayload(payload: unknown): NormalizedEmail[] {
  const issues: string[] = [];
  const items = extractItems(payload);

  if (items.length === 0) {
    throw new WebhookPayloadError(["payload must contain at least one item"]);
  }

  const emails = items.map((item, index) =>
    normalizeEmailItem(item, `items[${index}]`, issues),
  );

  if (issues.length > 0) {
    throw new WebhookPayloadError(issues);
  }

  return emails;
}

function extractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [payload];
  }

  if (Array.isArray(payload.items)) {
    return payload.items;
  }

  if (Array.isArray(payload.data) && payload.data.every(looksLikeN8nItem)) {
    return payload.data;
  }

  if (isRecord(payload.body)) {
    if (Array.isArray(payload.body.items)) {
      return payload.body.items;
    }

    if (looksLikeN8nItem(payload.body)) {
      return [payload.body];
    }
  }

  return [payload];
}

function looksLikeN8nItem(value: unknown): value is UnknownRecord {
  return (
    isRecord(value) &&
    (isRecord(value.json) || isRecord(value.binary) || isRecord(value.email))
  );
}

function normalizeEmailItem(
  item: unknown,
  path: string,
  issues: string[],
): NormalizedEmail {
  if (!isRecord(item)) {
    issues.push(`${path} must be an object`);
    return emptyEmail();
  }

  const json = getEmailJson(item);
  const binary = getBinaryData(item);
  const headers = isRecord(json.headers) ? json.headers : null;
  const attachments = [
    ...normalizeBinaryAttachments(binary, `${path}.binary`, issues),
    ...normalizeJsonAttachments(
      json.attachments,
      `${path}.json.attachments`,
      issues,
    ),
  ];

  return {
    messageId: firstString(
      json.messageId,
      json.messageID,
      json["message-id"],
      readHeader(headers, "message-id"),
    ),
    uid: firstString(
      json.uid,
      getNested(json, "attributes", "uid"),
      getNested(json, "metadata", "uid"),
    ),
    mailbox: firstString(
      json.mailbox,
      json.folder,
      getNested(json, "metadata", "mailbox"),
    ),
    subject: firstString(json.subject),
    fromAddress: toJsonValue(json.from ?? json.fromAddress),
    toAddress: toJsonValue(json.to ?? json.toAddress),
    ccAddress: toJsonValue(json.cc ?? json.ccAddress),
    bccAddress: toJsonValue(json.bcc ?? json.bccAddress),
    replyToAddress: toJsonValue(
      json.replyTo ?? json.replyToAddress ?? json.reply_to,
    ),
    sentAt: firstDate(json.date, json.sentAt, json.sentDate),
    textPlain: firstString(json.textPlain, json.text, json.plainText),
    textHtml: firstString(json.textHtml, json.html, json.textAsHtml),
    headers: toJsonValue(json.headers),
    rawJson: toJsonValue(json) ?? {},
    attachments,
  };
}

function getEmailJson(item: UnknownRecord): UnknownRecord {
  if (isRecord(item.json)) {
    return item.json;
  }

  if (isRecord(item.email)) {
    return item.email;
  }

  if (isRecord(item.body) && isRecord(item.body.json)) {
    return item.body.json;
  }

  if (isRecord(item.body) && isRecord(item.body.email)) {
    return item.body.email;
  }

  return item;
}

function getBinaryData(item: UnknownRecord): UnknownRecord | null {
  if (isRecord(item.binary)) {
    return item.binary;
  }

  if (isRecord(item.body) && isRecord(item.body.binary)) {
    return item.body.binary;
  }

  if (isRecord(item.attachments) && !Array.isArray(item.attachments)) {
    return item.attachments;
  }

  return null;
}

function normalizeBinaryAttachments(
  binary: UnknownRecord | null,
  path: string,
  issues: string[],
): NormalizedEmailAttachment[] {
  if (!binary) {
    return [];
  }

  return Object.entries(binary).flatMap(([binaryKey, value]) => {
    const attachmentPath = `${path}.${binaryKey}`;

    if (!isRecord(value)) {
      issues.push(`${attachmentPath} must be an object`);
      return [];
    }

    const data = decodeRequiredAttachmentData(
      value.data,
      `${attachmentPath}.data`,
      issues,
    );

    if (!data) {
      return [];
    }

    return [
      buildAttachment({
        record: value,
        binaryKey,
        data,
      }),
    ];
  });
}

function normalizeJsonAttachments(
  attachments: unknown,
  path: string,
  issues: string[],
): NormalizedEmailAttachment[] {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments.flatMap((value, index) => {
    const attachmentPath = `${path}[${index}]`;

    if (!isRecord(value)) {
      issues.push(`${attachmentPath} must be an object`);
      return [];
    }

    const encoded = value.data ?? value.content ?? value.base64;
    const data = decodeOptionalAttachmentData(
      encoded,
      `${attachmentPath}.data`,
      issues,
    );

    if (!data) {
      return [];
    }

    return [
      buildAttachment({
        record: value,
        binaryKey:
          firstString(value.binaryKey, value.name) ?? `attachment_${index}`,
        data,
      }),
    ];
  });
}

function buildAttachment({
  record,
  binaryKey,
  data,
}: {
  record: UnknownRecord;
  binaryKey: string | null;
  data: Buffer;
}): NormalizedEmailAttachment {
  return {
    binaryKey,
    fileName: firstString(record.fileName, record.filename),
    mimeType: firstString(record.mimeType, record.contentType),
    fileExtension: firstString(record.fileExtension, record.extension),
    contentId: firstString(record.contentId, record.cid, record.id),
    contentDisposition: firstString(
      record.contentDisposition,
      record.disposition,
    ),
    fileSize:
      firstNumber(record.fileSize, record.size, record.length) ?? data.length,
    checksumSha256: createHash("sha256").update(data).digest("hex"),
    data,
  };
}

function decodeRequiredAttachmentData(
  value: unknown,
  path: string,
  issues: string[],
): Buffer | null {
  const data = decodeOptionalAttachmentData(value, path, issues);

  if (!data) {
    issues.push(`${path} must contain base64 attachment data`);
  }

  return data;
}

function decodeOptionalAttachmentData(
  value: unknown,
  path: string,
  issues: string[],
): Buffer | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    return decodeBase64(value, path, issues);
  }

  if (Array.isArray(value) && value.every(isByte)) {
    return Buffer.from(value);
  }

  if (
    isRecord(value) &&
    value.type === "Buffer" &&
    Array.isArray(value.data) &&
    value.data.every(isByte)
  ) {
    return Buffer.from(value.data);
  }

  issues.push(`${path} must be a base64 string or byte array`);
  return null;
}

function decodeBase64(
  value: string,
  path: string,
  issues: string[],
): Buffer | null {
  const base64 = value
    .replace(/^data:[^,]+,/, "")
    .replace(/\s/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  if (base64.length === 0) {
    return Buffer.alloc(0);
  }

  if (base64.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    issues.push(`${path} is not valid base64`);
    return null;
  }

  return Buffer.from(base64, "base64");
}

function emptyEmail(): NormalizedEmail {
  return {
    messageId: null,
    uid: null,
    mailbox: null,
    subject: null,
    fromAddress: null,
    toAddress: null,
    ccAddress: null,
    bccAddress: null,
    replyToAddress: null,
    sentAt: null,
    textPlain: null,
    textHtml: null,
    headers: null,
    rawJson: {},
    attachments: [],
  };
}

function readHeader(headers: UnknownRecord | null, name: string): unknown {
  if (!headers) {
    return undefined;
  }

  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );

  if (!entry) {
    return undefined;
  }

  return Array.isArray(entry[1]) ? entry[1][0] : entry[1];
}

function getNested(record: UnknownRecord, ...keys: string[]): unknown {
  let current: unknown = record;

  for (const key of keys) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && /^\d+$/.test(value)) {
      return Number(value);
    }
  }

  return null;
}

function firstDate(...values: unknown[]): Date | null {
  const value = firstString(...values);

  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toJsonValue(value: unknown): JsonValue | null {
  if (value === undefined) {
    return null;
  }

  try {
    const serialized = JSON.stringify(value);

    if (!serialized) {
      return null;
    }

    return JSON.parse(serialized) as JsonValue;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isByte(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 255
  );
}
