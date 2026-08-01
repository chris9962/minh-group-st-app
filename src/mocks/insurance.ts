import type { InsuranceDetail, InsuranceListRow, InsuranceQuery } from "@/lib/api/insurance";
import { allManualOrders } from "./insuranceOrders";
import { departments } from "./data";
import { ALL } from "./people";
import { insuranceOf } from "./person";

/**
 * P-13 · Danh sách đơn bảo hiểm — gộp đơn giả lập (12 nhân viên P-51) với đơn
 * THẬT tạo qua P-11/Tặng quà (`insuranceOrders.ts`), giống cách các màn P-31/
 * P-21 khác đã gộp.
 */

const THIS_MONTH = (() => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
})();

const departmentIdByName = (name: string): string | null =>
  departments.find((d) => d.name === name)?.id ?? null;

/** DH-YYMM-NNN giả cho đơn giả lập — thật sự sinh ở `insuranceOrders.ts` cho đơn thật. */
const fakeOrderCode = (date: string, i: number): string =>
  `DH-${date.slice(2, 4)}${date.slice(5, 7)}-${String((i % 900) + 1).padStart(3, "0")}`;

type TaggedRow = InsuranceDetail & { departmentId: string | null };

function allRows(): TaggedRow[] {
  const rows: TaggedRow[] = [];

  for (const p of ALL) {
    const departmentId = departmentIdByName(p.departmentName);
    for (const ins of insuranceOf(p.fullName, THIS_MONTH, p.insuranceOrders)) {
      rows.push({
        id: `${p.id}-${ins.id}`,
        orderCode: fakeOrderCode(ins.date, rows.length),
        customerId: null,
        customerName: ins.customerName,
        product: ins.product,
        packageName: ins.packageName,
        status: ins.status,
        date: ins.date,
        endDate: null,
        source: "self",
        beneficiaryName: ins.customerName,
        beneficiaryDob: "",
        beneficiaryIdNumber: "",
        beneficiaryPhone: "",
        licensePlate: "",
        chassisNumber: "",
        engineNumber: "",
        createdById: p.id,
        createdByName: p.fullName,
        createdByDepartmentId: departmentId,
        certificatePhotoUrl: null,
        departmentId,
      });
    }
  }

  for (const o of allManualOrders()) {
    rows.push({
      id: o.id,
      orderCode: o.orderCode,
      customerId: o.customerId,
      customerName: o.customerName,
      product: o.product,
      packageName: o.packageName,
      status: o.status,
      date: o.date,
      endDate: o.endDate,
      source: o.source,
      beneficiaryName: o.beneficiaryName,
      beneficiaryDob: o.beneficiaryDob,
      beneficiaryIdNumber: o.beneficiaryIdNumber,
      beneficiaryPhone: o.beneficiaryPhone,
      licensePlate: o.licensePlate,
      chassisNumber: o.chassisNumber,
      engineNumber: o.engineNumber,
      createdById: o.createdById,
      createdByName: o.createdByName,
      createdByDepartmentId: o.createdByDepartmentId,
      certificatePhotoUrl: o.certificatePhotoUrl,
      departmentId: o.createdByDepartmentId,
    });
  }

  return rows;
}

export function insuranceOrdersFor(
  query: InsuranceQuery,
  visibleDepartmentIds: string[] | null,
): { rows: InsuranceListRow[]; summary: { total: number } } {
  const rows = allRows()
    .filter(
      (r) =>
        visibleDepartmentIds === null ||
        (r.departmentId !== null && visibleDepartmentIds.includes(r.departmentId)),
    )
    .filter((r) => !query.status || r.status === query.status)
    .filter((r) => !query.product || r.product === query.product)
    .filter((r) => !query.from || r.date >= query.from)
    .filter((r) => !query.to || r.date <= query.to)
    .filter((r) => !query.staffId || r.createdById === query.staffId)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map(
      (r): InsuranceListRow => ({
        id: r.id,
        orderCode: r.orderCode,
        customerName: r.customerName,
        product: r.product,
        packageName: r.packageName,
        status: r.status,
        date: r.date,
        createdById: r.createdById,
        createdByName: r.createdByName,
        certificatePhotoUrl: r.certificatePhotoUrl,
      }),
    );

  return { rows, summary: { total: rows.length } };
}

/**
 * P-14 · Chi tiết — kiểm phạm vi Ở ĐÂY, không chỉ ở danh sách P-13 (spec
 * §1.1.6: đổi id trên URL không được lộ đơn ngoài phạm vi).
 */
export function insuranceDetailFor(
  id: string,
  visibleDepartmentIds: string[] | null,
): InsuranceDetail | null {
  const row = allRows().find((r) => r.id === id);
  if (!row) return null;
  if (
    visibleDepartmentIds !== null &&
    (row.departmentId === null || !visibleDepartmentIds.includes(row.departmentId))
  ) {
    return null;
  }

  return {
    id: row.id,
    orderCode: row.orderCode,
    customerId: row.customerId,
    customerName: row.customerName,
    product: row.product,
    packageName: row.packageName,
    status: row.status,
    date: row.date,
    endDate: row.endDate,
    source: row.source,
    beneficiaryName: row.beneficiaryName,
    beneficiaryDob: row.beneficiaryDob,
    beneficiaryIdNumber: row.beneficiaryIdNumber,
    beneficiaryPhone: row.beneficiaryPhone,
    licensePlate: row.licensePlate,
    chassisNumber: row.chassisNumber,
    engineNumber: row.engineNumber,
    createdById: row.createdById,
    createdByName: row.createdByName,
    createdByDepartmentId: row.createdByDepartmentId,
    certificatePhotoUrl: row.certificatePhotoUrl,
  };
}
