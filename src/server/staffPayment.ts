import { eq } from "drizzle-orm";
import type { StaffPayment, StaffPaymentForm } from "@/lib/api/staffPayment";
import { db } from "./db/client";
import { staffProfiles, users } from "./db/schema";

/** `null` khi không có người này. Người chưa có dòng `staff_profiles` thì ra ba ô null. */
export async function staffPaymentOf(userId: string): Promise<{ fullName: string; payment: StaffPayment } | null> {
  const [row] = await db
    .select({
      fullName: users.fullName,
      bankAccountNumber: staffProfiles.bankAccountNumber,
      bankName: staffProfiles.bankName,
      bankCode: staffProfiles.bankCode,
    })
    .from(users)
    .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  const { fullName, ...payment } = row;
  return { fullName, payment };
}

const digits = (text: string) => text.replace(/\s+/g, "") || null;

export async function saveStaffPayment(
  userId: string,
  form: StaffPaymentForm,
): Promise<{ fullName: string; before: StaffPayment; after: StaffPayment } | null> {
  const found = await staffPaymentOf(userId);
  if (!found) return null;
  const after: StaffPayment = {
    bankAccountNumber: digits(form.bankAccountNumber),
    bankName: form.bankName || null,
    bankCode: digits(form.bankCode),
  };
  await db
    .insert(staffProfiles)
    .values({ userId, ...after })
    .onConflictDoUpdate({ target: staffProfiles.userId, set: after });
  return { fullName: found.fullName, before: found.payment, after };
}
