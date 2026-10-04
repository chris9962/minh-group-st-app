import { recountEmployeeWorkDays } from "../src/server/workDays";

/**
 * Dựng lại ngày công từ một tháng trở đi, chỉ các tháng chưa chốt lương. Khác
 * `db:recount`: không đụng mã giới thiệu, rổ quà, và không đụng tháng trước
 * `--from`.
 *
 * Dùng sau khi deploy luật ngày công theo chấm công (migration 0124): ngày công
 * tháng 2026-10 của nhân viên Điểm ATM và Phòng An Sinh đang ghi theo luật cũ.
 *
 * Chạy khô, in dòng lệch, không ghi gì:
 *   bun run db:recount-work-days -- --from=2026-10
 *
 * Ghi thật:
 *   bun run db:recount-work-days -- --from=2026-10 --apply
 */

async function main() {
  const fromMonth = process.argv.find((a) => a.startsWith("--from="))?.slice(7) ?? "";
  const apply = process.argv.includes("--apply");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(fromMonth))
    throw new Error("Thiếu --from=YYYY-MM. Ví dụ: bun run db:recount-work-days -- --from=2026-10");

  const drift = (await recountEmployeeWorkDays({ fromMonth, apply })) as Record<string, unknown>[];
  if (drift.length === 0) {
    console.log(`Không có ngày công nào lệch từ tháng ${fromMonth}.`);
    process.exit(0);
  }
  console.log(`${drift.length} ngày công lệch từ tháng ${fromMonth}${apply ? "" : " (CHẠY KHÔ, không ghi gì)"}:`);
  for (const r of drift) console.log(" ", JSON.stringify(r));
  console.log(apply ? "Đã dựng lại ngày công." : "Thêm --apply để ghi.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
