import type { ServiceForm, ServiceQuery, ServiceRow } from "@/lib/api/services";
import type { Customer } from "@/lib/api/customers";
import { departments } from "./data";
import { ALL } from "./people";
import { servicesOf } from "./person";
import { serviceTypesFor } from "./settings";

/**
 * P-30 · Ghi dịch vụ · P-31 · Danh sách — kho THẬT do người dùng tạo, gộp
 * cùng dịch vụ giả lập sinh cho 12 nhân viên P-51 (giống cách `customers.ts`
 * gộp tài khoản/đơn bảo hiểm thật với dữ liệu giả lập).
 */

let manualServices: ServiceRow[] = [];
let nextId = 1;

const THIS_MONTH = (() => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
})();

const departmentIdByName = (name: string): string | null =>
  departments.find((d) => d.name === name)?.id ?? null;

const serviceTypeIdByName = (name: string): string =>
  serviceTypesFor().find((t) => t.name === name)?.id ?? "";

/**
 * Dịch vụ giả lập cho 12 nhân viên P-51, kèm tên/đơn vị người tạo.
 *
 * Xã CHỈ gán cho người thuộc Phòng Dự Án — ghi lúc tạo, không tra động
 * (spec §6). Hiện chưa có nhân viên nào thuộc Phòng Dự Án trong dữ liệu giả,
 * nên cột xã sẽ trống cho tới khi có — đúng theo tổ chức thật, không phải lỗi.
 */
function generatedServices(): ServiceRow[] {
  const rows: ServiceRow[] = [];
  for (const p of ALL) {
    const isDuAn = p.departmentName === "Phòng Dự Án";
    const departmentId = departmentIdByName(p.departmentName);
    for (const s of servicesOf(p.fullName, THIS_MONTH, p.servicePoints)) {
      rows.push({
        id: `${p.id}-${s.id}`,
        customerName: s.customerName,
        serviceTypeId: serviceTypeIdByName(s.serviceType),
        serviceTypeName: s.serviceType,
        note: "",
        date: s.date,
        createdById: p.id,
        createdByName: p.fullName,
        createdByDepartmentId: departmentId,
        wardName: isDuAn ? s.ward : null,
      });
    }
  }
  return rows;
}

const allServices = (): ServiceRow[] => [...generatedServices(), ...manualServices];

export function servicesFor(
  query: ServiceQuery,
  visibleDepartmentIds: string[] | null,
): { rows: ServiceRow[]; summary: { total: number } } {
  const rows = allServices()
    .filter(
      (r) =>
        visibleDepartmentIds === null ||
        (r.createdByDepartmentId && visibleDepartmentIds.includes(r.createdByDepartmentId)),
    )
    .filter((r) => !query.serviceTypeId || r.serviceTypeId === query.serviceTypeId)
    .filter((r) => !query.from || r.date >= query.from)
    .filter((r) => !query.to || r.date <= query.to)
    .filter((r) => !query.ward || r.wardName === query.ward)
    .filter((r) => !query.staffId || r.createdById === query.staffId)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return { rows, summary: { total: rows.length } };
}

export function createService(
  form: ServiceForm,
  customer: Customer,
  actorId: string,
  actorName: string,
  actorDepartmentId: string | null,
): ServiceRow {
  const serviceType = serviceTypesFor().find((t) => t.id === form.serviceTypeId);
  const row: ServiceRow = {
    id: `sv-new-${nextId++}`,
    customerName: customer.fullName,
    serviceTypeId: form.serviceTypeId,
    serviceTypeName: serviceType?.name ?? "",
    note: form.note,
    date: new Date().toISOString().slice(0, 10),
    createdById: actorId,
    createdByName: actorName,
    createdByDepartmentId: actorDepartmentId,
    wardName: null,
  };
  manualServices = [...manualServices, row];
  return row;
}
