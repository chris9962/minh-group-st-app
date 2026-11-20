import { and, eq } from "drizzle-orm";
import type { MyBlanks, MyBlanksForm } from "@/lib/api/myBlanks";
import type { User } from "@/lib/types";
import { ownBankBlanks, reportOwnBankBlanks } from "./bankBlanks";
import { db } from "./db/client";
import { departments, users } from "./db/schema";
import { lockDepartments, ownBlanks, Refused, reportOwnBlanks, type Db } from "./insuranceBlanks";

/**
 * Nhân viên tự báo số phôi bảo hiểm và phiếu ngân hàng còn lại (chủ dự án chốt
 * 2026-11-20). Kế hoạch ở `docs/plan-phoi-nhap-con-lai-2026-11-20.md` mục 3.3, 3.7.
 */

/** Phòng kinh doanh hiện tại của người này, đọc từ hồ sơ chứ không từ phiên. */
async function salesDepartmentOf(conn: Db, userId: string): Promise<string | null> {
  const [row] = await conn
    .select({ id: departments.id })
    .from(users)
    .innerJoin(departments, eq(departments.id, users.departmentId))
    .where(and(eq(users.id, userId), eq(departments.type, "sales")));
  return row?.id ?? null;
}

export async function myBlanks(actor: User): Promise<MyBlanks> {
  const departmentId = await salesDepartmentOf(db, actor.id);
  if (!departmentId) return null;
  const [insurance, bank] = await Promise.all([
    ownBlanks(db, actor.id, departmentId),
    ownBankBlanks(db, actor.id, departmentId),
  ]);
  return { insurance, bank };
}

export async function saveMyBlanks(
  actor: User,
  form: MyBlanksForm,
): Promise<{ ok: true; departmentId: string } | { ok: false; message: string }> {
  const departmentId = await salesDepartmentOf(db, actor.id);
  if (!departmentId) return { ok: false, message: "Bạn không thuộc phòng kinh doanh nào." };
  try {
    await db.transaction(async (tx) => {
      await lockDepartments(tx, [departmentId]);
      // Lượt chuyển phòng giữ khoá phòng cũ tới lúc xong, nên đọc lại sau khi khoá mới biết người này còn ở phòng đó.
      if ((await salesDepartmentOf(tx, actor.id)) !== departmentId)
        throw new Refused("Bạn vừa chuyển phòng. Bạn tải lại trang rồi báo lại.");
      await reportOwnBlanks(tx, actor.id, departmentId, form.insurance);
      await reportOwnBankBlanks(tx, actor.id, departmentId, form.bank);
    });
  } catch (e) {
    if (e instanceof Refused) return { ok: false, message: e.message };
    throw e;
  }
  return { ok: true, departmentId };
}
