import { and, eq, inArray } from "drizzle-orm";
import { lookupOnlyCustomer } from "@/lib/permissions";
import type { User } from "@/lib/types";
import { db } from "./db/client";
import { customers } from "./db/schema";

/**
 * Id mọi hồ sơ khách mang CCCD này, gồm cả các lần sau của cùng một người.
 *
 * Đi qua hồ sơ GỐC vì chỉ mục `customers_id_number` chỉ phủ dòng gốc. So thẳng
 * `id_number` trên mọi dòng thì Postgres quét cả bảng khách, và nằm trong `or`
 * với bảng tài khoản thì quét luôn cả bảng tài khoản.
 */
export const customerIdsWithIdNumber = (idNumber: string) =>
  db
    .select({ id: customers.id })
    .from(customers)
    .where(
      inArray(
        customers.rootCustomerId,
        db
          .select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.idNumber, idNumber), eq(customers.rootCustomerId, customers.id))),
      ),
    );

/**
 * Câu báo khi người này chỉ thấy khách nhờ quyền `lookup` mà lại ghi bản ghi
 * mới cho khách đó. `null` = được ghi. Gọi ở mọi route tạo bản ghi theo khách.
 */
export async function lookupOnlyMessage(actor: User, customerId: string): Promise<string | null> {
  const [row] = await db
    .select({
      createdById: customers.createdBy,
      createdByDepartmentId: customers.createdByDepartmentId,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  return row && lookupOnlyCustomer(actor, row) ? "Bạn chỉ được xem hồ sơ khách này." : null;
}
