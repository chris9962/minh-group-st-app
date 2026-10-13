import { sql } from "drizzle-orm";
import { ATTENDANCE_MODE_LABEL, type AttendanceMode } from "../src/lib/types";
import { db } from "../src/server/db/client";

/**
 * Đặt cách chấm công cho hai phòng đã chấm công trước migration 0139, chạy ngay
 * sau `db:migrate`. Thiếu bước này thì từ lúc migrate tới lúc admin vào P-91,
 * nhân viên ATM và An Sinh bị từ chối chấm công, và lượt tính lại nào chạy trong
 * lúc đó đẩy ngày công tháng 2026-10 của họ về luật theo khách.
 *
 * Phòng khác (Phòng Y) admin bật ở P-91: lượt lưu ở đó tính lại ngày công tháng
 * đang chạy của cả phòng. Script này không tính lại gì, vì hai phòng dưới đây đã
 * có ngày công theo lượt chấm.
 *
 * Chạy khô, không ghi gì:
 *   bun run db:seed-attendance-mode
 * Ghi thật:
 *   bun run db:seed-attendance-mode -- --apply
 */
const MODES: Record<string, AttendanceMode> = {
  "PHONG-ATM-CONG-DONG": "slots",
  "PHONG-AN-SINH": "daily",
};

async function main() {
  const apply = process.argv.includes("--apply");
  const codes = Object.keys(MODES);
  const rows = await db.execute<{ code: string; name: string; attendance_mode: AttendanceMode | null }>(sql`
    select code, name, attendance_mode from departments
    where code in (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})
    order by code
  `);
  const found = new Set(rows.rows.map((r) => r.code));
  for (const code of codes) if (!found.has(code)) console.warn(`Không có phòng mã ${code}, bỏ qua.`);

  const changes = rows.rows.filter((r) => r.attendance_mode !== MODES[r.code]);
  if (changes.length === 0) {
    console.log("Các phòng đã đúng cách chấm công.");
    process.exit(0);
  }
  console.log(`${changes.length} phòng sắp đổi cách chấm công${apply ? "" : " (CHẠY KHÔ, không ghi gì)"}:`);
  for (const r of changes)
    console.log(`  ${r.name}: ${ATTENDANCE_MODE_LABEL[r.attendance_mode ?? ""]} sang ${ATTENDANCE_MODE_LABEL[MODES[r.code]]}`);
  if (!apply) process.exit(0);

  for (const r of changes)
    await db.execute(
      sql`update departments set attendance_mode = ${MODES[r.code]}::attendance_mode, updated_at = now() where code = ${r.code}`,
    );
  console.log("Đã ghi.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
