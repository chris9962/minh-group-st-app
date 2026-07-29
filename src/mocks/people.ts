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

export function peopleFor(scope: Scope, month: string): PeopleData {
  const lastDay = new Date(
    Number(month.slice(0, 4)),
    Number(month.slice(5, 7)),
    0,
  ).getDate();
  const today = new Date();
  const isCurrentMonth =
    month === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  return {
    month,
    daysLeft: isCurrentMonth ? Math.max(0, lastDay - today.getDate()) : 0,
    people: ALL.slice(0, TAKE[scope] ?? ALL.length),
  };
}
