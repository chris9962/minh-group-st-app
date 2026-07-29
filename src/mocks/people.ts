import type { PeopleData, PersonScore } from "@/lib/api/people";
import type { Scope } from "@/lib/types";

/** Dữ liệu giả cho P-51. Chỉ tiêu hiện tại là 100 điểm mỗi người mỗi tháng. */

const TARGET = 100;

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

/** Số cố định theo tên để bảng không nhảy mỗi lần render. */
const seed = (s: string, salt: number) =>
  (s.split("").reduce((a, c) => a + c.charCodeAt(0), 0) * 13 + salt * 29) % 97;

function person([fullName, departmentName]: [string, string], i: number): PersonScore {
  const banking = 28 + (seed(fullName, 1) % 88);
  const service = seed(fullName, 2) % 22;
  const accounts = Math.round(banking / 2.6);
  return {
    id: `p${i + 1}`,
    fullName,
    departmentName,
    bankingPoints: banking,
    servicePoints: service,
    accounts,
    apps: Math.round(accounts * (0.62 + (seed(fullName, 3) % 32) / 100)),
    insuranceOrders: seed(fullName, 4) % 8,
    target: TARGET,
  };
}

const ALL = NAMES.map(person);

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

export function peopleFor(
  scope: Scope,
  period: string,
  summaryMonth: string,
): PeopleData {
  const monthly = ALL.slice(0, TAKE[scope] ?? ALL.length);

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

  return {
    summaryMonth,
    daysLeft: isCurrentMonth ? Math.max(0, lastDay - now.getDate()) : 0,
    summary: {
      headcount: monthly.length,
      onTarget,
      offTarget: monthly.length - onTarget,
      averagePoints: average,
    },
    people: period === "today" ? monthly.map(toDaily) : monthly,
  };
}
