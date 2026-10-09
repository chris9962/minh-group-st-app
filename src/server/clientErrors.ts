import type { ClientErrorBody } from "@/lib/api/clientErrors";
import type { User } from "@/lib/types";
import { db } from "./db/client";
import { clientErrors } from "./db/schema";

export async function logClientError(actor: User, body: ClientErrorBody, userAgent: string): Promise<void> {
  await db.insert(clientErrors).values({
    userId: actor.id,
    source: body.source,
    message: body.message,
    detail: body.detail,
    userAgent: userAgent.slice(0, 500),
    path: body.path,
  });
}
