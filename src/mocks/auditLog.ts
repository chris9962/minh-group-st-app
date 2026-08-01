import type { AuditLogEntry, AuditLogQuery } from "@/lib/api/auditLog";
import type { Action, ModuleKey } from "@/lib/types";
import { seed } from "./activity";
import { mockUsers } from "./data";

/**
 * P-93 · Nhật ký truy vết — dữ liệu giả lập, không tra động từ các mock khác.
 *
 * Ghi sẵn một loạt hành động lịch sử để màn có gì mà lọc/xem ngay từ đầu,
 * cộng thêm `logAudit()` để các luồng NHẠY CẢM nhất (tạo/sửa nhân viên, cấp
 * quyền) tự thêm dòng mới khi thao tác thật trong lúc test — không cần
 * instrument lại toàn bộ handler chỉ để có một trang demo sống động.
 */

const actorRef = (username: string) => {
  const u = mockUsers.find((m) => m.username === username);
  return { actorId: u?.id ?? "", actorName: u?.fullName ?? username, actorUsername: username };
};

/** Rải mốc thời gian trong quá khứ, có giờ phút cho giống log thật. */
const atFor = (key: string, index: number): string => {
  const daysAgo = 1 + ((seed(key, 7) * 11 + index * 17) % 89);
  const hour = 8 + (seed(key, index) % 10);
  const minute = seed(key, index + 3) % 60;
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

type Seed = { username: string; module: ModuleKey; action: Action; target: string };

const SEED: Seed[] = [
  { username: "quantri", module: "staff", action: "create", target: "Nhân viên Nguyễn Thị Bích Trâm" },
  { username: "tpkd2", module: "staff", action: "update", target: "Nhân viên Võ Thanh Hải — đổi chức danh" },
  { username: "giamdoc", module: "staff", action: "delete", target: "Nhân viên Đặng Quốc Anh — khoá tài khoản" },
  { username: "quantri", module: "system", action: "grant-permission", target: "Cấp `banking, export, company` cho Huỳnh Kim Ngân" },
  { username: "giamdoc", module: "system", action: "manage-org", target: "Phòng Kinh doanh 9 — mở phòng mới" },
  { username: "quantri", module: "system", action: "configure-catalog", target: "Danh mục xã/ấp — thêm 3 ấp Phòng Dự Án" },
  { username: "giamdoc", module: "system", action: "configure-gift-rules", target: "Bảng quy tắc quà — sửa dòng #3 (Rổ 1 năm)" },
  { username: "ntbtram", module: "banking", action: "create", target: "Tài khoản MB của Nguyễn Thị Bích Trâm" },
  { username: "tpkd2", module: "banking", action: "delete", target: "Tài khoản VPa của Trần Thị Diễm — xoá bản nháp" },
  { username: "ntbtram", module: "banking", action: "grant-gift", target: "Chốt quà cho khách Phạm Minh Tuấn" },
  { username: "kdth", module: "banking", action: "manage-referral-codes", target: "Nạp thêm 20 mã MSBa-2026-03" },
  { username: "kdth", module: "banking", action: "manage-bank-catalog", target: "Bật lại ngân hàng TPB" },
  { username: "taodon", module: "insurance", action: "handle-fallback", target: "Đơn BH-2607-014 — đính ảnh chứng nhận tay" },
  { username: "ntbtram", module: "insurance", action: "create", target: "Đơn BH tai nạn điện cho khách Lý Hoàng Nam" },
  { username: "tpkd2", module: "insurance", action: "update", target: "Đơn BH-2606-091 — sửa số CCCD người thụ hưởng" },
  { username: "ntbtram", module: "customer", action: "create", target: "Hồ sơ khách Bùi Thị Kim Chi" },
  { username: "pgd2", module: "customer", action: "update", target: "Hồ sơ khách Ngô Văn Thắng — sửa địa chỉ" },
  { username: "ktth", module: "services", action: "export", target: "Xuất báo cáo dịch vụ theo xã, tháng trước" },
  { username: "covan", module: "banking", action: "export", target: "Xuất danh sách tài khoản gộp theo khách" },
  { username: "quyenpgd", module: "staff", action: "update", target: "Nhân viên Lý Hoàng Nam — đổi đơn vị" },
];

let log: AuditLogEntry[] = SEED.map((s, i) => ({
  id: `a${i + 1}`,
  at: atFor(s.username, i),
  ...actorRef(s.username),
  module: s.module,
  action: s.action,
  targetLabel: s.target,
}));

let nextId = log.length + 1;

export function auditLogFor(query: AuditLogQuery): { rows: AuditLogEntry[]; summary: { total: number } } {
  const rows = log
    .filter((e) => !query.staffId || e.actorId === query.staffId)
    .filter((e) => !query.action || e.action === query.action)
    .filter((e) => !query.from || e.at.slice(0, 10) >= query.from)
    .filter((e) => !query.to || e.at.slice(0, 10) <= query.to)
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  return { rows, summary: { total: rows.length } };
}

/** Gọi từ các luồng ghi/sửa nhạy cảm để nhật ký có dòng mới ngay khi thao tác thật. */
export function logAudit(entry: Omit<AuditLogEntry, "id" | "at">): void {
  log = [{ ...entry, id: `a-live-${nextId++}`, at: new Date().toISOString() }, ...log];
}
