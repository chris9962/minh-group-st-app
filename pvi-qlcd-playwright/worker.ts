/**
 * WORKER PVI — vòng lặp tự lấy đơn, tạo, duyệt, rồi lấy giấy chứng nhận.
 *
 *   bun run pvi:worker                       # chạy mãi, quét mỗi 10 giây
 *   bun run pvi:worker -- --mot-vong         # chạy đúng một vòng rồi thoát
 *   bun run pvi:worker -- --chi-chung-nhan   # bỏ bước tạo đơn, chỉ tải file
 *   bun run pvi:worker -- --thu              # điền form rồi dừng, không bấm gì
 *
 * ⚠️ Worker chạy là chạy THẬT: nó tạo đơn và duyệt đơn trên PVI. Đó là việc của
 * nó, nên bật sẵn hai điều kiện `PVI_CHO_PHEP_LUU` và `PVI_CHO_PHEP_DUYET` —
 * hai biến ấy sinh ra để chặn script chạy tay gõ nhầm, không phải để chặn worker.
 *
 * `--thu` tắt cả hai: worker vẫn lấy đơn và điền 26 ô, nhưng dừng trước lúc bấm.
 * Dùng để xem nó chọn đúng đơn và điền đúng dữ liệu chưa.
 *
 * Đơn chỉ vào hàng chờ của worker khi `PVI_WORKER_BAT=1`; xem `newOrderStatus`
 * ở `src/server/insurance.ts`. Hai container phải cùng đọc biến đó.
 *
 * Tên trường trong kết quả trả về từ `pvi-qlcd-playwright/lib/*` giữ nguyên
 * tiếng Việt — đó là hợp đồng của thư mục ấy, không phải tên biến ở đây.
 *
 * Xem `pvi-qlcd-playwright/LUONG-TAO-VA-DUYET.md`.
 */

import { and, eq, lt, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { CERTIFICATE_MAX_ATTEMPTS } from "../src/lib/api/insuranceOrders";
import { insuranceOrders } from "../src/server/db/schema";
import { downloadCertificate, pdfToWebp } from "./lib/certificate";
import { putImage } from "../src/server/storage";

const { taoDon } = require("./lib/order");
const { dongBrowser } = require("./lib/browser");
const { baoDamPhien } = require("./lib/phien");
const { docBangHienTai, timDongVuaTao, duyetTheoPrKey } = require("./lib/duyet");

type Db = ReturnType<typeof drizzle>;
type Order = typeof insuranceOrders.$inferSelect;

/** Dòng bảng Manager mà `lib/duyet.js` trả về. */
type PviRow = { soDonDienTu: string; prKey: string };
/** Kết quả bấm Duyệt mà `lib/duyet.js` trả về. */
type PviApproval = { daDuyet?: boolean; khongDuyetVi?: string; thongDiep?: string };

const SLEEP_SECONDS = Number(process.env.PVI_WORKER_NGHI ?? 10);
const MAX_ATTEMPTS = Number(process.env.PVI_CERTIFICATE_MAX_ATTEMPTS ?? CERTIFICATE_MAX_ATTEMPTS);
const RETRY_AFTER_SECONDS = Number(process.env.PVI_CERTIFICATE_RETRY_SECONDS ?? 90);

/** Đơn nằm ở `creating` lâu hơn ngần này thì coi như worker giữ nó đã chết. */
const STALE_AFTER_MINUTES = Number(process.env.PVI_WORKER_QUA_HAN_PHUT ?? 10);

const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

/** Số năm hiệu lực của đơn, suy từ hai cột ngày. PVI cấp tối đa 3 năm một đơn. */
function yearsOf(order: Order): number {
  const [from, to] = [new Date(order.startDate), new Date(order.endDate)];
  const years = Math.round((to.getTime() - from.getTime()) / (365.25 * 24 * 3600 * 1000));
  return Math.min(Math.max(years, 1), 3);
}

/**
 * Dựng payload cho `lib/flows/<sản phẩm>.js` từ một dòng `insurance_orders`.
 *
 * Hai sản phẩm hỏi hai bộ trường khác nhau, nên bảng ánh xạ nằm ở đây chứ không
 * ở flow: flow không biết database, database không biết tên ô của PVI.
 */
function payloadFor(order: Order): Record<string, unknown> {
  const common = {
    orderId: order.orderCode,
    product: order.product,
    hoTen: order.beneficiaryName,
    diaChi: order.beneficiaryAddress,
    ngayBatDau: order.startDate,
  };

  if (order.product === "motorbike")
    return {
      ...common,
      bienSo: order.licensePlate,
      soMay: order.engineNumber,
      soKhung: order.chassisNumber,
      loaiXe: order.vehicleType || undefined,
      soDienThoai: order.beneficiaryPhone || undefined,
      soNam: yearsOf(order),
    };

  return { ...common, soThanhVien: order.householdSize, soTienBaoHiem: order.sumInsured };
}

/** `2026-09-01` → `01/09/2026`, để so với cột "Ngày chứng từ" của bảng Manager. */
const pviDate = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

/**
 * Đưa đơn bị bỏ rơi ở `creating` về hàng chờ.
 *
 * `claimOrder` COMMIT trạng thái `creating` rồi mới mở trình duyệt, nên khoảng
 * 10–15 giây sau đó là lúc worker chết thì đơn nằm lại mãi: database không biết
 * worker còn sống hay không.
 *
 * Ngưỡng rộng gấp nhiều lần thời gian chạy thật của một đơn. Hẹp quá thì worker
 * khác cướp một đơn ĐANG chạy, và PVI nhận hai đơn giống nhau.
 */
async function reclaimStaleOrders(db: Db) {
  const cutoff = new Date(Date.now() - STALE_AFTER_MINUTES * 60 * 1000);
  const reclaimed = await db
    .update(insuranceOrders)
    .set({ status: "queued", updatedAt: new Date() })
    .where(
      and(
        eq(insuranceOrders.status, "creating"),
        or(sql`${insuranceOrders.updatedAt} is null`, lt(insuranceOrders.updatedAt, cutoff)),
      ),
    )
    .returning({ orderCode: insuranceOrders.orderCode });

  for (const r of reclaimed)
    log(`${r.orderCode}: mắc ở creating quá ${STALE_AFTER_MINUTES} phút → trả về hàng chờ`);
  return reclaimed.length;
}

/**
 * Lấy MỘT đơn chờ tạo và đánh dấu đang chạy, trong cùng một transaction.
 *
 * `for update skip locked` làm hai worker không bao giờ lấy trùng: worker tới
 * trước khoá dòng, worker sau bỏ qua và lấy dòng kế tiếp.
 */
async function claimOrder(db: Db): Promise<Order | null> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(insuranceOrders)
      .where(eq(insuranceOrders.status, "queued"))
      .orderBy(sql`${insuranceOrders.orderDate} asc, ${insuranceOrders.createdAt} asc`)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!order) return null;

    await tx
      .update(insuranceOrders)
      .set({ status: "creating", updatedAt: new Date() })
      .where(eq(insuranceOrders.id, order.id));
    return order;
  });
}

/** Tạo đơn trên PVI rồi duyệt luôn. Trả trạng thái mới của đơn. */
async function createAndApprove(db: Db, order: Order) {
  const today = pviDate(new Date());

  const result = await taoDon(payloadFor(order), {
    bamLuu: true,
    chupAnh: true,
    moc: (step: string) => log(`  ${order.orderCode}: ${step}`),
    // Chạy lúc trang còn ở /Service/Manager, ngay sau khi PVI nhận đơn.
    sauKhiLuu: async (page: unknown, ctx: { kq?: { kiemChung?: Record<string, string> } }) => {
      const table = await docBangHienTai(page);
      if (table.loi) return { loi: table.loi };

      const row = timDongVuaTao(table.dong, {
        tenKhach: order.beneficiaryName,
        product: order.product,
        ngayChungTu: today,
        tongPhi: ctx.kq?.kiemChung?.tongPhi,
      });
      if (!row)
        return {
          loi: "Không dòng nào khớp năm điều kiện",
          soDongCho: table.dong.length,
          tongPhiDocDuoc: ctx.kq?.kiemChung?.tongPhi,
          viSao: timDongVuaTao.viSao ?? [],
        };

      return { dong: row, duyet: await duyetTheoPrKey(page, row.prKey, { thatSuBam: true }) };
    },
  });

  const after = result.daLuu?.sauKhiLuu as
    | { dong?: PviRow; duyet?: PviApproval; loi?: string }
    | undefined;
  const matched = after?.dong ?? null;
  const approval = after?.duyet ?? null;

  if (!result.daLuu) {
    // Không bấm được nút: form còn ô hỏng, hoặc thiếu PVI_CHO_PHEP_LUU.
    await db
      .update(insuranceOrders)
      .set({ status: "manual-queued", updatedAt: new Date() })
      .where(eq(insuranceOrders.id, order.id));
    log(`${order.orderCode}: không tạo được — ${result.khongBamLuuVi ?? result.thongDiep} → làm tay`);
    return "manual-queued";
  }

  if (!matched) {
    // Đơn ĐÃ tạo bên PVI nhưng bot không nhận ra dòng nào là của nó. Không duyệt
    // bừa: duyệt nhầm đơn người khác là thao tác không đảo ngược.
    await db
      .update(insuranceOrders)
      .set({ status: "pending-approval", updatedAt: new Date() })
      .where(eq(insuranceOrders.id, order.id));
    log(`${order.orderCode}: đã tạo nhưng không khớp được dòng → chờ người duyệt tay`);
    const chuanDoan = after as { soDongCho?: number; tongPhiDocDuoc?: string; viSao?: string[] };
    log(`  ${order.orderCode}: bảng có ${chuanDoan?.soDongCho ?? "?"} dòng Chờ, phí đọc từ form: "${chuanDoan?.tongPhiDocDuoc ?? "?"}"`);
    for (const v of chuanDoan?.viSao ?? []) log(`  ${order.orderCode}: ${v}`);
    return "pending-approval";
  }

  const approved = approval?.daDuyet === true;
  await db
    .update(insuranceOrders)
    .set({
      pviElectronicOrderNo: matched.soDonDienTu,
      pviPrKey: matched.prKey,
      // Duyệt không thành thì đơn vẫn đang "Chờ" bên PVI — người duyệt tay.
      status: approved ? "awaiting-certificate" : "pending-approval",
      updatedAt: new Date(),
    })
    .where(eq(insuranceOrders.id, order.id));

  const why = approval?.khongDuyetVi ?? approval?.thongDiep;
  log(`${order.orderCode}: ${matched.soDonDienTu} · ${approved ? "đã duyệt" : `chưa duyệt (${why})`}`);
  return approved ? "awaiting-certificate" : "pending-approval";
}

/** Tải giấy chứng nhận cho các đơn đã duyệt xong. */
async function fetchCertificates(db: Db) {
  const cutoff = new Date(Date.now() - RETRY_AFTER_SECONDS * 1000);
  const waiting = await db
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
        lt(insuranceOrders.certificateAttempts, MAX_ATTEMPTS),
        or(
          sql`${insuranceOrders.certificateCheckedAt} is null`,
          lt(insuranceOrders.certificateCheckedAt, cutoff),
        ),
      ),
    )
    .orderBy(sql`${insuranceOrders.certificateCheckedAt} asc nulls first`)
    .limit(20);

  for (const row of waiting) {
    const got = await downloadCertificate(row.pviPrKey);
    if (!got.ready) {
      const attempts = row.certificateAttempts + 1;
      await db
        .update(insuranceOrders)
        .set({ certificateAttempts: attempts, certificateCheckedAt: new Date() })
        .where(eq(insuranceOrders.id, row.id));
      log(`${row.orderCode}: ${got.reason} (lần ${attempts}/${MAX_ATTEMPTS})`);
      continue;
    }

    try {
      const webp = await pdfToWebp(got.pdf);
      const file = new File([new Uint8Array(webp)], `${row.orderCode}.webp`, { type: "image/webp" });
      const put = await putImage(file, "insurance-certificates");
      if (!put.ok) throw new Error(put.message);

      await db
        .update(insuranceOrders)
        .set({
          certificatePhotoUrl: put.key,
          status: "done",
          certificateCheckedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(insuranceOrders.id, row.id));
      log(`${row.orderCode}: đã lưu giấy chứng nhận → ${put.key}`);
    } catch (e) {
      // Lỗi ở máy mình, không ở PVI — không tăng số lần thử.
      await db
        .update(insuranceOrders)
        .set({ certificateCheckedAt: new Date() })
        .where(eq(insuranceOrders.id, row.id));
      log(`${row.orderCode}: tải được PDF nhưng không lưu được ảnh — ${(e as Error).message}`);
    }
  }
  return waiting.length;
}

/**
 * `--chi-chung-nhan` bỏ hẳn bước tạo đơn, chỉ chạy phần tải giấy chứng nhận.
 *
 * Dùng khi PVI chưa sinh file cho một loạt đơn cũ và người vận hành muốn hỏi
 * lại mà không đụng tới hàng chờ tạo đơn.
 */
const CERTIFICATES_ONLY = process.argv.includes("--chi-chung-nhan");

/** `--thu` giữ worker ở chế độ điền-rồi-dừng. Xem chú thích đầu file. */
const DRY_RUN = process.argv.includes("--thu");

async function runOnce(db: Db) {
  if (CERTIFICATES_ONLY) {
    const only = await fetchCertificates(db);
    if (!only) log("Không có đơn nào đang đợi giấy chứng nhận.");
    return;
  }

  // Trước khi nhận đơn mới: trả lại đơn mà worker chết giữa chừng bỏ lại.
  await reclaimStaleOrders(db);

  const order = await claimOrder(db);
  if (order) {
    const session = await baoDamPhien({ orderId: order.orderCode });
    if (session.ma !== 0) {
      // Không vào được PVI thì trả đơn về hàng chờ, đừng để nó mắc ở `creating`.
      await db
        .update(insuranceOrders)
        .set({ status: "queued", updatedAt: new Date() })
        .where(eq(insuranceOrders.id, order.id));
      log(`Phiên đăng nhập không dùng được: ${session.bao?.thongDiep}. Trả đơn về hàng chờ.`);
      return;
    }
    await createAndApprove(db, order);
    await dongBrowser();
  }

  const asked = await fetchCertificates(db);
  if (!order && !asked) log("Không có việc.");
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  const onceOnly = process.argv.includes("--mot-vong");
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
    log("Nhận tín hiệu dừng, kết thúc sau vòng này.");
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  // `duocBamLuu` và `duocBamDuyet` đọc hai biến này lúc GỌI, không lúc nạp
  // module — nên đặt ở đây là đủ, không cần truyền qua dòng lệnh.
  if (!DRY_RUN) {
    process.env.PVI_CHO_PHEP_LUU = "1";
    process.env.PVI_CHO_PHEP_DUYET = "1";
  }

  log(
    DRY_RUN
      ? "Worker chạy ở chế độ THỬ: điền form rồi dừng, không tạo và không duyệt đơn nào."
      : "Worker chạy THẬT: tạo đơn và duyệt đơn trên PVI.",
  );

  do {
    try {
      await runOnce(db);
    } catch (e) {
      // Một vòng hỏng không được làm chết worker: vòng sau thử lại.
      log(`Lỗi trong vòng quét: ${(e as Error).message}`);
      await dongBrowser().catch(() => {});
    }
    if (!onceOnly && !stopping) await new Promise((r) => setTimeout(r, SLEEP_SECONDS * 1000));
  } while (!onceOnly && !stopping);

  await dongBrowser().catch(() => {});
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
