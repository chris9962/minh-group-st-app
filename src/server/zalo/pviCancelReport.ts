import { z } from "zod";
import { formatDate, formatDateTime } from "@/lib/format";

/**
 * Tin Zalo báo kết quả một lượt chạy của job huỷ đơn trên PVI Connect
 * (`pvi-cancel-orders/`). Job ghi `pvi_cancel_runs.report`; hình dạng JSON khai ở
 * `DayResult` của `pvi-cancel-orders/cancel-orders.ts`, đổi một đầu phải đổi đầu kia.
 */

const Product = z.enum(["motorbike", "electric-accident"]);

const Holder = z.object({
  number: z.string(),
  state: z.enum(["cancelled", "unsigned", "partial", "active"]),
  amendments: z.array(z.string()),
});

const Order = z.object({
  product: Product,
  orderCode: z.string(),
  serial: z.string(),
  status: z.enum(["skipped", "planned", "merged", "failed"]),
  reason: z.string().nullish(),
  group: z.string().nullish(),
  // Thiếu `holders` là chưa tra hoặc tra lỗi; mảng rỗng là đã tra và không đơn gom nào chứa seri.
  holders: z.array(Holder).nullish(),
});

const Merged = z.object({
  product: Product,
  number: z.string(),
  orderCodes: z.array(z.string()),
  signed: z.boolean().nullish(),
  error: z.string().nullish(),
});

const Report = z.object({ orders: z.array(Order), merged: z.array(Merged) });

export type PviCancelRun = {
  runDate: string;
  mode: string;
  report: unknown;
  error: string;
  createdAt: Date;
};

const MAX_MESSAGE_CHARS = 1500;

const PRODUCT_TEXT: Record<z.infer<typeof Product>, string> = {
  motorbike: "xe máy",
  "electric-accident": "điện",
};

/** `26/21/14/MOTO/CK15571` thành `CK15571`; `.../CK15571/E01` thành `CK15571/E01`. */
const shortNumber = (n: string) => n.split("/").slice(n.split("/").length > 5 ? -2 : -1).join("/");

function section(title: string, lines: string[]): string[] {
  return lines.length ? ["", title, ...lines] : [];
}

function reportLines(run: PviCancelRun): string[] {
  const day = formatDate(run.runDate);
  const title =
    run.mode === "write"
      ? `Gom và huỷ đơn BH trên PVI Connect ngày ${day}`
      : `Kiểm tra đơn BH huỷ ngày ${day}, chưa ghi lên PVI Connect`;
  const lines = [title, `Lượt chạy xong lúc ${formatDateTime(run.createdAt)}.`];
  if (run.error) lines.push("", `Job dừng vì lỗi: ${run.error}`);

  const parsed = Report.safeParse(run.report);
  if (!parsed.success) return [...lines, "", "Không đọc được kết quả của lượt chạy."];
  const { orders, merged } = parsed.data;
  if (orders.length === 0 && !run.error) return [...lines, "", "Không có đơn huỷ."];

  const order = (o: z.infer<typeof Order>) => `${o.orderCode} (${PRODUCT_TEXT[o.product]})`;
  const skipped = orders.filter((o) => o.status === "skipped");
  const holderText = (h: z.infer<typeof Holder>) => shortNumber(h.number);

  const groups = new Map<string, z.infer<typeof Order>[]>();
  for (const o of orders.filter((x) => x.status === "planned")) {
    const key = `${o.product}|${o.group ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const planned = [...groups.values()].map(
    (rows) => `- ${rows.length} đơn ${PRODUCT_TEXT[rows[0].product]}: ${rows.map((o) => o.orderCode).join(", ")}`,
  );
  const notFound = (o: z.infer<typeof Order>) => o.holders?.length === 0;

  return [
    ...lines,
    ...section(
      "Đã huỷ trên PVI Connect:",
      merged
        .filter((m) => m.signed)
        .map((m) => `- ${shortNumber(m.number)} (${PRODUCT_TEXT[m.product]}, ${m.orderCodes.length} đơn): ${m.orderCodes.join(", ")}`),
    ),
    // Lượt ghi thật mà đơn còn `planned` là job dừng trước bước gom: dòng "Job dừng vì lỗi" ở trên nói lý do.
    ...section(run.mode === "write" ? "Chưa gom:" : "Sẽ gom và huỷ:", planned),
    ...section("Chưa huỷ xong:", [
      ...merged
        .filter((m) => !m.signed)
        .map((m) => `- ${shortNumber(m.number)} (${PRODUCT_TEXT[m.product]}): ${m.error ?? "chưa ký SĐBS huỷ"}`),
      ...orders.filter((o) => o.status === "failed").map((o) => `- ${order(o)}: ${o.reason ?? "lỗi"}`),
    ]),
    ...section(
      "Đã huỷ sẵn:",
      skipped.flatMap((o) => {
        const h = o.holders?.find((x) => x.state === "cancelled");
        return h ? [`- ${order(o)}: trong ${holderText(h)}, đã có ${h.amendments.map(shortNumber).join(", ")}`] : [];
      }),
    ),
    ...section(
      "Cần huỷ tay:",
      skipped.flatMap((o) => {
        if (notFound(o)) return [];
        const hs = o.holders ?? [];
        if (hs.length === 0) return [`- ${order(o)}: ${o.reason ?? "lỗi"}`];
        if (hs.some((h) => h.state === "cancelled")) return [];
        const amendments = (h: z.infer<typeof Holder>) => h.amendments.map(shortNumber).join(", ");
        return hs.map((h) =>
          h.state === "active"
            ? `- ${order(o)}: trong ${holderText(h)}, đơn gom chưa có SĐBS huỷ`
            : h.state === "unsigned"
              ? `- ${order(o)}: trong ${holderText(h)}, ${amendments(h)} chưa ký`
              : `- ${order(o)}: trong ${holderText(h)}, có ${amendments(h)} nhưng phí chưa về 0`,
        );
      }),
    ),
    ...section(
      "Không tìm thấy trên PVI:",
      skipped
        .filter(notFound)
        .map((o) => `- ${order(o)}, seri ${o.serial}: không còn chờ gom, không có đơn gom nào chứa seri`),
    ),
  ];
}

/** Tách theo dòng, mỗi tin tối đa 1.500 ký tự: Zalo từ chối tin quá dài (đo 2026-10-12). */
export function pviCancelReportMessages(run: PviCancelRun): string[] {
  const parts: string[][] = [[]];
  let size = 0;
  for (const line of reportLines(run)) {
    if (size + line.length + 1 > MAX_MESSAGE_CHARS - 10 && parts[parts.length - 1].length > 0) {
      parts.push([]);
      size = 0;
    }
    parts[parts.length - 1].push(line);
    size += line.length + 1;
  }
  if (parts.length === 1) return [parts[0].join("\n")];
  return parts.map((p, i) => `(${i + 1}/${parts.length})\n${p.join("\n")}`);
}
