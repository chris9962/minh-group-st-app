/**
 * LUỒNG 3 — tải giấy chứng nhận của đơn đã duyệt xong bên PVI.
 *
 *   bun run pvi:chung-nhan              # quét một vòng rồi thoát
 *   bun run pvi:chung-nhan -- --lap=120 # quét lại mỗi 120 giây, chạy mãi
 *
 * Đọc đơn ở `awaiting-certificate`, hỏi `/Service/DownloadFile`. Có file thì đổi
 * PDF sang PNG, đẩy lên kho, ghi khoá vào `certificate_photo_url` rồi chuyển đơn
 * sang `done`. Chưa có file thì tăng số lần thử và bỏ qua — vòng sau hỏi lại.
 *
 * Hỏi đủ `CERTIFICATE_MAX_ATTEMPTS` lần mà vẫn chưa có thì luồng NGỪNG hỏi đơn
 * đó, nhưng KHÔNG đổi trạng thái. Đơn đã duyệt xong bên PVI rồi; đẩy nó về hàng
 * chờ làm tay là bắt người ta tạo lại từ đầu một đơn đã tạo xong. Giao diện đọc
 * `certificate_attempts` rồi hiện lời nhắc đi hỏi người có thẩm quyền.
 *
 * PVI không sinh file ngay lúc duyệt. Đo 2026-08-23: duyệt xong 11 phút mà vẫn
 * chưa có. Vì vậy luồng này là vòng lặp, không phải một lượt tải.
 *
 * Xem `pvi-qlcd-playwright/LUONG-TAO-VA-DUYET.md`.
 */

import { and, eq, lt, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { CERTIFICATE_MAX_ATTEMPTS } from "../src/lib/api/insuranceOrders";
import { insuranceOrders } from "../src/server/db/schema";
import { downloadCertificate, pdfToWebp } from "../src/server/pvi-certificate";
import { putImage } from "../src/server/storage";

/** Số đơn xử lý mỗi vòng. Giữ nhỏ để một vòng không chạy quá lâu. */
const BATCH = 20;

/**
 * Hỏi đủ số lần này thì ngừng hỏi đơn đó. Ngưỡng nằm ở `lib/api/insuranceOrders`
 * vì giao diện cũng đọc nó để biết dòng nào cần hiện lời nhắc.
 */
const MAX_ATTEMPTS = Number(
  process.env.PVI_CERTIFICATE_MAX_ATTEMPTS ?? CERTIFICATE_MAX_ATTEMPTS,
);

/** Đơn vừa hỏi hụt thì đợi bấy nhiêu giây mới hỏi lại, kể cả khi vòng quét dày hơn. */
const RETRY_AFTER_SECONDS = Number(process.env.PVI_CERTIFICATE_RETRY_SECONDS ?? 90);

type Db = ReturnType<typeof drizzle>;

type Summary = { taken: number; done: number; waiting: number; stalled: number; failed: number };

async function fetchOne(db: Db, order: {
  id: string;
  orderCode: string;
  pviPrKey: string;
  certificateAttempts: number;
}): Promise<keyof Omit<Summary, "taken">> {
  const got = await downloadCertificate(order.pviPrKey);

  if (!got.ready) {
    const attempts = order.certificateAttempts + 1;
    // Chạm ngưỡng thì thôi hỏi, KHÔNG đổi trạng thái: đơn đã duyệt xong bên PVI,
    // đẩy về hàng chờ làm tay là bắt tạo lại một đơn đã tạo xong.
    const stalled = attempts >= MAX_ATTEMPTS;
    await db
      .update(insuranceOrders)
      .set({ certificateAttempts: attempts, certificateCheckedAt: new Date() })
      .where(eq(insuranceOrders.id, order.id));

    console.log(
      `${order.orderCode}: ${got.reason} (lần ${attempts}/${MAX_ATTEMPTS})${stalled ? " → ngừng hỏi, cần người kiểm tra" : ""}`,
    );
    return stalled ? "stalled" : "waiting";
  }

  let key: string;
  try {
    const webp = await pdfToWebp(got.pdf);
    const file = new File([new Uint8Array(webp)], `${order.orderCode}.webp`, { type: "image/webp" });
    const put = await putImage(file, "insurance-certificates");
    if (!put.ok) throw new Error(put.message);
    key = put.key;
  } catch (e) {
    // Tải được PDF rồi mà đổi ảnh hỏng thì KHÔNG tăng số lần thử: lỗi nằm ở máy
    // mình, không phải ở PVI. Tăng nữa là đơn bị đẩy sang làm tay vì lỗi của bot.
    await db
      .update(insuranceOrders)
      .set({ certificateCheckedAt: new Date() })
      .where(eq(insuranceOrders.id, order.id));
    console.error(`${order.orderCode}: tải được PDF nhưng không lưu được ảnh — ${(e as Error).message}`);
    return "failed";
  }

  await db
    .update(insuranceOrders)
    .set({
      certificatePhotoUrl: key,
      status: "done",
      certificateCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(insuranceOrders.id, order.id));

  console.log(`${order.orderCode}: đã lưu giấy chứng nhận → ${key}`);
  return "done";
}

async function sweep(db: Db): Promise<Summary> {
  const cutoff = new Date(Date.now() - RETRY_AFTER_SECONDS * 1000);

  const orders = await db
    .select({
      id: insuranceOrders.id,
      orderCode: insuranceOrders.orderCode,
      pviPrKey: insuranceOrders.pviPrKey,
      certificateAttempts: insuranceOrders.certificateAttempts,
    })
    .from(insuranceOrders)
    .where(
      and(
        eq(insuranceOrders.status, "awaiting-certificate"),
        ne(insuranceOrders.pviPrKey, ""),
        // Đơn đã hỏi đủ ngưỡng thì luồng không đụng tới nữa. Nó vẫn nằm ở
        // `awaiting-certificate` cho người có thẩm quyền xem và xử lý.
        lt(insuranceOrders.certificateAttempts, MAX_ATTEMPTS),
        // Đơn chưa hỏi lần nào đứng đầu hàng; đơn vừa hỏi hụt phải đợi đủ nhịp.
        or(
          sql`${insuranceOrders.certificateCheckedAt} is null`,
          lt(insuranceOrders.certificateCheckedAt, cutoff),
        ),
      ),
    )
    .orderBy(sql`${insuranceOrders.certificateCheckedAt} asc nulls first`)
    .limit(BATCH);

  const sum: Summary = { taken: orders.length, done: 0, waiting: 0, stalled: 0, failed: 0 };
  // Tuần tự chứ không song song: PVI là hệ thống của đối tác, và một vòng 20 đơn
  // chạy tuần tự đã xong trong vài giây.
  for (const o of orders) sum[await fetchOne(db, o)] += 1;
  return sum;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  const every = /--lap=(\d+)/.exec(process.argv.join(" "));
  const loopSeconds = every ? Number(every[1]) : 0;

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  let stop = false;
  process.on("SIGINT", () => {
    stop = true;
    console.log("Nhận tín hiệu dừng, kết thúc sau vòng này.");
  });

  do {
    const s = await sweep(db);
    console.log(
      `Vòng quét: lấy ${s.taken} đơn · xong ${s.done} · còn đợi ${s.waiting} · ngừng hỏi ${s.stalled} · lỗi ${s.failed}`,
    );
    if (loopSeconds && !stop) await new Promise((r) => setTimeout(r, loopSeconds * 1000));
  } while (loopSeconds && !stop);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
