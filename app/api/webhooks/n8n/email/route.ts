import { timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { normalizeN8nEmailPayload, WebhookPayloadError } from "@/lib/n8n-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = verifyWebhookSecret(request);

  if (!auth.ok) {
    return Response.json(
      { error: auth.error },
      { status: auth.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_json" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  let emails: ReturnType<typeof normalizeN8nEmailPayload>;

  try {
    emails = normalizeN8nEmailPayload(payload);
  } catch (error) {
    if (error instanceof WebhookPayloadError) {
      return Response.json(
        { error: "invalid_payload", issues: error.issues },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    throw error;
  }

  const saved = await db.transaction(async (tx) => {
    const results = [];

    for (const email of emails) {
      const [emailRow] = await tx
        .insert(schema.inboundEmails)
        .values({
          messageId: email.messageId,
          uid: email.uid,
          mailbox: email.mailbox,
          subject: email.subject,
          fromAddress: email.fromAddress,
          toAddress: email.toAddress,
          ccAddress: email.ccAddress,
          bccAddress: email.bccAddress,
          replyToAddress: email.replyToAddress,
          sentAt: email.sentAt,
          textPlain: email.textPlain,
          textHtml: email.textHtml,
          headers: email.headers,
          rawJson: email.rawJson,
          attachmentCount: email.attachments.length,
        })
        .onConflictDoUpdate({
          target: schema.inboundEmails.messageId,
          set: {
            uid: email.uid,
            mailbox: email.mailbox,
            subject: email.subject,
            fromAddress: email.fromAddress,
            toAddress: email.toAddress,
            ccAddress: email.ccAddress,
            bccAddress: email.bccAddress,
            replyToAddress: email.replyToAddress,
            sentAt: email.sentAt,
            textPlain: email.textPlain,
            textHtml: email.textHtml,
            headers: email.headers,
            rawJson: email.rawJson,
            attachmentCount: email.attachments.length,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: schema.inboundEmails.id });

      if (!emailRow) {
        throw new Error("Failed to persist inbound email");
      }

      await tx
        .delete(schema.inboundEmailAttachments)
        .where(eq(schema.inboundEmailAttachments.emailId, emailRow.id));

      if (email.attachments.length > 0) {
        await tx.insert(schema.inboundEmailAttachments).values(
          email.attachments.map((attachment) => ({
            emailId: emailRow.id,
            binaryKey: attachment.binaryKey,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            fileExtension: attachment.fileExtension,
            contentId: attachment.contentId,
            contentDisposition: attachment.contentDisposition,
            fileSize: attachment.fileSize,
            checksumSha256: attachment.checksumSha256,
            data: attachment.data,
          })),
        );
      }

      results.push({
        emailId: emailRow.id,
        messageId: email.messageId,
        attachments: email.attachments.length,
      });
    }

    return results;
  });

  return Response.json(
    {
      ok: true,
      received: emails.length,
      saved,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function verifyWebhookSecret(
  request: Request,
): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.N8N_EMAIL_WEBHOOK_SECRET;

  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return {
        ok: false,
        status: 500,
        error: "webhook_secret_not_configured",
      };
    }

    return { ok: true };
  }

  const authorization = request.headers.get("authorization");
  const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
  const provided = bearerToken ?? request.headers.get("x-webhook-secret");

  if (!provided || !safeEqual(provided, expected)) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  return { ok: true };
}

function safeEqual(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  return (
    valueBuffer.length === expectedBuffer.length &&
    timingSafeEqual(valueBuffer, expectedBuffer)
  );
}
