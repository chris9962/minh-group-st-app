import type { PeopleData, PersonScore } from "@/lib/api/people";
import { matchesSearch } from "@/lib/format";
import type { Scope } from "@/lib/types";
import { accountCountOf, bankPointsOf, buildAccounts, seed } from "./activity";
import { departments as allDepartments } from "./data";
import { kpiTargetFor } from "./settings";

/** Dữ liệu giả cho P-51. Chỉ tiêu đọc từ P-83 (`kpiTargetFor`), không hằng số cứng. */

const NAMES: [string, string][] = [
  ["Lê Thị Hồng", "Phòng Kinh doanh 2"],
  ["Nguyễn Thị Bích Trâm", "Phòng Kinh doanh 2"],
  ["Võ Thanh Hải", "Phòng Kinh doanh 2"],
  ["Phạm Minh Tuấn", "Phòng Kinh doanh 2"],
  ["Trần Thị Diễm", "Phòng Kinh doanh 6"],
  ["Huỳnh Văn Lộc", "Phòng Kinh doanh 6"],
  ["Đặng Quốc Anh", "Phòng Kinh doanh 6"],
  ["Bùi Thị Kim Chi", "Phòng Kinh doanh 7"],
  ["Ngô Văn Thắng", "Phòng Kinh doanh 7"],
  ["Trương Mỹ Duyên", "Phòng Kinh doanh 7"],
  ["Lý Hoàng Nam", "Phòng Kinh doanh 1"],
  ["Phan Thị Tuyết", "Phòng Kinh doanh 1"],
];

/**
 * Điểm ngân hàng TÍNH TỪ chính danh sách tài khoản mà P-52 sẽ hiện, không bịa
 * một con số riêng. Bịa riêng thì màn này báo 99 điểm còn màn kia tách ra chỉ
 * được 61, và chẳng có cách nào biết bên nào đúng.
 */
function person([fullName, departmentName]: [string, string], i: number): PersonScore {
  const accounts = buildAccounts(fullName, accountCountOf(fullName));
  return {
    id: `p${i + 1}`,
    fullName,
    departmentName,
    bankingPoints: bankPointsOf(accounts),
    servicePoints: seed(fullName, 2) % 22,
    accounts: accounts.length,
    apps: accounts.filter((a) => a.appInstalled).length,
    insuranceOrders: seed(fullName, 4) % 8,
    target: kpiTargetFor().monthlyPoints,
  };
}

export const ALL = NAMES.map(person);

/** Dữ liệu giả gắn nhân viên với phòng bằng TÊN; bản thật sẽ dùng id. */
const departmentName = (id: string): string =>
  allDepartments.find((d) => d.id === id)?.name ?? "";

/** Phạm vi hẹp hơn thì ít người hơn — để thấy thanh chọn phạm vi có tác dụng. */
const TAKE: Record<Scope, number> = { own: 1, managed: 6, company: ALL.length };

/** Số liệu trong MỘT ngày nhỏ hơn hẳn số liệu cả tháng. */
const toDaily = (p: PersonScore): PersonScore => ({
  ...p,
  bankingPoints: Math.round(p.bankingPoints / 22),
  servicePoints: Math.round(p.servicePoints / 22),
  accounts: Math.round(p.accounts / 22),
  apps: Math.round(p.apps / 22),
  insuranceOrders: Math.round(p.insuranceOrders / 22),
});

export function peopleFor({
  scope,
  period,
  summaryMonth,
  departmentId,
  search = "",
}: {
  scope: Scope;
  period: string;
  summaryMonth: string;
  departmentId?: string;
  search?: string;
}): PeopleData {
  // Đọc lại chỉ tiêu mỗi lần gọi — admin đổi ở P-83 thì bảng này phải thấy
  // ngay, không phải giá trị đóng băng lúc `ALL` dựng lên.
  const inScope = ALL.slice(0, TAKE[scope] ?? ALL.length).map((p) => ({
    ...p,
    target: kpiTargetFor().monthlyPoints,
  }));
  // Lọc đơn vị áp lên CẢ phần tóm tắt, không chỉ bảng — nếu không thì "12 nhân
  // viên" sẽ mâu thuẫn với bảng đang hiện 4 người của một phòng.
  const monthly = departmentId
    ? inScope.filter((p) => departmentName(departmentId) === p.departmentName)
    : inScope;

  const lastDay = new Date(
    Number(summaryMonth.slice(0, 4)),
    Number(summaryMonth.slice(5, 7)),
    0,
  ).getDate();
  const now = new Date();
  const isCurrentMonth =
    summaryMonth ===
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Phần tóm tắt LUÔN tính theo tháng, kể cả khi bảng đang xem theo ngày —
  // chỉ tiêu là chỉ tiêu tháng, không có "chỉ tiêu hôm nay".
  const onTarget = monthly.filter((p) => p.bankingPoints + p.servicePoints >= p.target).length;
  const average = monthly.length
    ? Math.round(
        monthly.reduce((sum, p) => sum + p.bankingPoints + p.servicePoints, 0) /
          monthly.length,
      )
    : 0;

  const rows = period === "today" ? monthly.map(toDaily) : monthly;
  // Tìm kiếm KHÔNG áp lên phần tóm tắt: gõ tên một người không có nghĩa là
  // phòng chỉ còn một người, và "điểm trung bình" của đúng một người thì vô
  // nghĩa. Lọc đơn vị thì ngược lại — nó đổi hẳn nhóm người đang xem.
  const found = search
    ? rows.filter((p) => matchesSearch(`${p.fullName} ${p.departmentName}`, search))
    : rows;

  return {
    summaryMonth,
    daysLeft: isCurrentMonth ? Math.max(0, lastDay - now.getDate()) : 0,
    summary: {
      headcount: monthly.length,
      onTarget,
      offTarget: monthly.length - onTarget,
      averagePoints: average,
    },
    people: found,
  };
}
