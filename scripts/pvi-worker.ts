/**
 * WORKER PVI — vòng lặp tự lấy đơn, tạo, duyệt, rồi lấy giấy chứng nhận.
 *
 *   bun run pvi:worker                 # chạy mãi, quét mỗi 10 giây
 *   bun run pvi:worker -- --mot-vong   # chạy đúng một vòng rồi thoát
 *
 * ⚠️ Mặc định KHÔNG tạo và KHÔNG duyệt đơn thật. Muốn chạy thật phải đặt cả hai:
 *
 *   PVI_CHO_PHEP_LUU=1 PVI_CHO_PHEP_DUYET=1 bun run pvi:worker
 *
 * Thiếu chúng thì worker vẫn quét và điền form, nhưng dừng trước lúc bấm — dùng
 * để xem nó chọn đúng đơn và điền đúng dữ liệu chưa.
 *
 * Xem `pvi-qlcd-playwright/LUONG-TAO-VA-DUYET.md`.
 */

import { and, eq, lt, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { CERTIFICATE_MAX_ATTEMPTS } from "../src/lib/api/insuranceOrders";
import { insuranceOrders } from "../src/server/db/schema";
import { downloadCertificate, pdfToPng } from "../src/server/pvi-certificate";
import { putImage } from "../src/server/storage";

const { taoDon } = require("../pvi-qlcd-playwright/lib/order");
const { dongBrowser } = require("../pvi-qlcd-playwright/lib/browser");
const { baoDamPhien } = require("../pvi-qlcd-playwright/lib/phien");
const { docBangHienTai, timDongVuaTao, duyetTheoPrKey } = require("../pvi-qlcd-playwright/lib/duyet");

type Db = ReturnType<typeof drizzle>;
type Order = typeof insuranceOrders.$inferSelect;

const NGHI_GIAY = Number(process.env.PVI_WORKER_NGHI ?? 10);
const MAX_ATTEMPTS = Number(process.env.PVI_CERTIFICATE_MAX_ATTEMPTS ?? CERTIFICATE_MAX_ATTEMPTS);
const RETRY_AFTER_SECONDS = Number(process.env.PVI_CERTIFICATE_RETRY_SECONDS ?? 90);

/** Đơn nằm ở `creating` lâu hơn ngần này thì coi như worker giữ nó đã chết. */
const QUA_HAN_PHUT = Number(process.env.PVI_WORKER_QUA_HAN_PHUT ?? 10);

const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

/** Số năm hiệu lực của đơn, suy từ hai cột ngày. PVI cấp tối đa 3 năm một đơn. */
function soNam(order: Order): number {
  const [d1, d2] = [new Date(order.startDate), new Date(order.endDate)];
  const nam = Math.round((d2.getTime() - d1.getTime()) / (365.25 * 24 * 3600 * 1000));
  return Math.min(Math.max(nam, 1), 3);
}

/**
 * Dựng payload cho `lib/flows/<sản phẩm>.js` từ một dòng `insurance_orders`.
 *
 * Hai sản phẩm hỏi hai bộ trường khác nhau, nên bảng ánh xạ nằm ở đây chứ không
 * ở flow: flow không biết database, database không biết tên ô của PVI.
 */
function payloadFor(order: Order): Record<string, unknown> {
  const chung = {
    orderId: order.orderCode,
    product: order.product,
    hoTen: order.beneficiaryName,
    diaChi: order.beneficiaryAddress,
  };

  if (order.product === "motorbike")
    return {
      ...chung,
      bienSo: order.licensePlate,
      soMay: order.engineNumber,
      soKhung: order.chassisNumber,
      loaiXe: order.vehicleType || undefined,
      soDienThoai: order.beneficiaryPhone || undefined,
      soNam: soNam(order),
      ngayBatDau: order.startDate,
    };

  return {
    ...chung,
    soThanhVien: order.householdSize,
    soTienBaoHiem: order.sumInsured,
    ngayBatDau: order.startDate,
  };
}

/** `2026-09-01` → `01/09/2026`, để so với cột "Ngày chứng từ" của bảng Manager. */
const ngayKieuPvi = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

/**
 * Đưa đơn bị bỏ rơi ở `creating` về hàng chờ.
 *
 * `nhanDon` COMMIT trạng thái `creating` rồi mới mở trình duyệt, nên khoảng
 * 10–15 giây sau đó là lúc worker chết thì đơn nằm lại mãi: database không biết
 * worker còn sống hay không.
 *
 * Ngưỡng rộng gấp nhiều lần thời gian chạy thật của một đơn. Hẹp quá thì worker
 * khác cướp một đơn ĐANG chạy, và PVI nhận hai đơn giống nhau.
 */
async function thuHoiDonBoRoi(db: Db) {
  const cutoff = new Date(Date.now() - QUA_HAN_PHUT * 60 * 1000);
  const thuHoi = await db
    .update(insuranceOrders)
    .set({ status: "queued", updatedAt: new Date() })
    .where(
      and(
        eq(insuranceOrders.status, "creating"),
        or(
          sql`${insuranceOrders.updatedAt} is null`,
          lt(insuranceOrders.updatedAt, cutoff),
        ),
      ),
    )
    .returning({ orderCode: insuranceOrders.orderCode });

  for (const d of thuHoi)
    log(`${d.orderCode}: mắc ở creating quá ${QUA_HAN_PHUT} phút → trả về hàng chờ`);
  return thuHoi.length;
}

/**
 * Lấy MỘT đơn chờ tạo và đánh dấu đang chạy, trong cùng một transaction.
 *
 * `for update skip locked` làm hai worker không bao giờ lấy trùng: worker tới
 * trước khoá dòng, worker sau bỏ qua và lấy dòng kế tiếp.
 */
async function nhanDon(db: Db): Promise<Order | null> {
  return db.transaction(async (tx) => {
    const [don] = await tx
      .select()
      .from(insuranceOrders)
      .where(eq(insuranceOrders.status, "queued"))
      .orderBy(sql`${insuranceOrders.orderDate} asc, ${insuranceOrders.createdAt} asc`)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!don) return null;

    await tx
      .update(insuranceOrders)
      .set({ status: "creating", updatedAt: new Date() })
      .where(eq(insuranceOrders.id, don.id));
    return don;
  });
}

/** Tạo đơn trên PVI rồi duyệt luôn. Trả trạng thái mới của đơn. */
async function taoVaDuyet(db: Db, order: Order) {
  const homNay = ngayKieuPvi(new Date());

  const kq = await taoDon(payloadFor(order), {
    bamLuu: true,
    chupAnh: true,
    moc: (ten: string) => log(`  ${order.orderCode}: ${ten}`),
    // Chạy lúc trang còn ở /Service/Manager, ngay sau khi PVI nhận đơn.
    sauKhiLuu: async (page: unknown, ctx: { v: { tongPhi?: string }; kq: { kiemChung?: Record<string, string> } }) => {
      const bang = await docBangHienTai(page);
      if (bang.loi) return { loi: bang.loi };

      const dong = timDongVuaTao(bang.dong, {
        tenKhach: order.beneficiaryName,
        product: order.product,
        ngayChungTu: homNay,
        tongPhi: ctx.kq?.kiemChung?.tongPhi,
      });
      if (!dong) return { loi: "Không dòng nào khớp năm điều kiện", soDongCho: bang.dong.length };

      return { dong, duyet: await duyetTheoPrKey(page, dong.prKey, { thatSuBam: true }) };
    },
  });

  const sau = kq.daLuu?.sauKhiLuu as
    | {
        dong?: { soDonDienTu: string; prKey: string };
        duyet?: { daDuyet?: boolean; khongDuyetVi?: string; thongDiep?: string };
        loi?: string;
      }
    | undefined;
  const khop = sau?.dong ?? null;
  const duyet = sau?.duyet ?? null;

  if (!kq.daLuu) {
    // Không bấm được nút: form còn ô hỏng, hoặc thiếu PVI_CHO_PHEP_LUU.
    await db
      .update(insuranceOrders)
      .set({ status: "manual-queued", updatedAt: new Date() })
      .where(eq(insuranceOrders.id, order.id));
    log(`${order.orderCode}: không tạo được — ${kq.khongBamLuuVi ?? kq.thongDiep} → làm tay`);
    return "manual-queued";
  }

  if (!khop) {
    // Đơn ĐÃ tạo bên PVI nhưng bot không nhận ra dòng nào là của nó. Không duyệt
    // bừa: duyệt nhầm đơn người khác là thao tác không đảo ngược.
    await db
      .update(insuranceOrders)
      .set({ status: "pending-approval", updatedAt: new Date() })
      .where(eq(insuranceOrders.id, order.id));
    log(`${order.orderCode}: đã tạo nhưng không khớp được dòng → chờ người duyệt tay`);
    return "pending-approval";
  }

  const daDuyet = duyet?.daDuyet === true;
  await db
    .update(insuranceOrders)
    .set({
      pviElectronicOrderNo: khop.soDonDienTu,
      pviPrKey: khop.prKey,
      // Duyệt không thành thì đơn vẫn đang "Chờ" bên PVI — người duyệt tay.
      status: daDuyet ? "awaiting-certificate" : "pending-approval",
      updatedAt: new Date(),
    })
    .where(eq(insuranceOrders.id, order.id));

  log(
    `${order.orderCode}: ${khop.soDonDienTu} · ${daDuyet ? "đã duyệt" : `chưa duyệt (${duyet?.khongDuyetVi ?? duyet?.thongDiep})`}`,
  );
  return daDuyet ? "awaiting-certificate" : "pending-approval";
}

/** Tải giấy chứng nhận cho các đơn đã duyệt xong. Giống `pvi-fetch-certificates.ts`. */
async function layGiayChungNhan(db: Db) {
  const cutoff = new Date(Date.now() - RETRY_AFTER_SECONDS * 1000);
  const donCho = await db
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

  for (const don of donCho) {
    const got = await downloadCertificate(don.pviPrKey);
    if (!got.ready) {
      const attempts = don.certificateAttempts + 1;
      await db
        .update(insuranceOrders)
        .set({ certificateAttempts: attempts, certificateCheckedAt: new Date() })
        .where(eq(insuranceOrders.id, don.id));
      log(`${don.orderCode}: ${got.reason} (lần ${attempts}/${MAX_ATTEMPTS})`);
      continue;
    }

    try {
      const png = await pdfToPng(got.pdf);
      const file = new File([new Uint8Array(png)], `${don.orderCode}.png`, { type: "image/png" });
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
        .where(eq(insuranceOrders.id, don.id));
      log(`${don.orderCode}: đã lưu giấy chứng nhận → ${put.key}`);
    } catch (e) {
      // Lỗi ở máy mình, không ở PVI — không tăng số lần thử.
      await db
        .update(insuranceOrders)
        .set({ certificateCheckedAt: new Date() })
        .where(eq(insuranceOrders.id, don.id));
      log(`${don.orderCode}: tải được PDF nhưng không lưu được ảnh — ${(e as Error).message}`);
    }
  }
  return donCho.length;
}

async function motVong(db: Db) {
  // Trước khi nhận đơn mới: trả lại đơn mà worker chết giữa chừng bỏ lại.
  await thuHoiDonBoRoi(db);

  const don = await nhanDon(db);
  if (don) {
    const phien = await baoDamPhien({ orderId: don.orderCode });
    if (phien.ma !== 0) {
      // Không vào được PVI thì trả đơn về hàng chờ, đừng để nó mắc ở `creating`.
      await db
        .update(insuranceOrders)
        .set({ status: "queued", updatedAt: new Date() })
        .where(eq(insuranceOrders.id, don.id));
      log(`Phiên đăng nhập không dùng được: ${phien.bao?.thongDiep}. Trả đơn về hàng chờ.`);
      return;
    }
    await taoVaDuyet(db, don);
    await dongBrowser();
  }

  const daHoi = await layGiayChungNhan(db);
  if (!don && !daHoi) log("Không có việc.");
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  const motVongThoi = process.argv.includes("--mot-vong");
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  let dung = false;
  process.on("SIGINT", () => {
    dung = true;
    log("Nhận tín hiệu dừng, kết thúc sau vòng này.");
  });
  process.on("SIGTERM", () => {
    dung = true;
  });

  log(
    `Worker chạy. Tạo đơn thật: ${process.env.PVI_CHO_PHEP_LUU === "1" ? "BẬT" : "tắt"} · Duyệt thật: ${process.env.PVI_CHO_PHEP_DUYET === "1" ? "BẬT" : "tắt"}`,
  );

  do {
    try {
      await motVong(db);
    } catch (e) {
      // Một vòng hỏng không được làm chết worker: vòng sau thử lại.
      log(`Lỗi trong vòng quét: ${(e as Error).message}`);
      await dongBrowser().catch(() => {});
    }
    if (!motVongThoi && !dung) await new Promise((r) => setTimeout(r, NGHI_GIAY * 1000));
  } while (!motVongThoi && !dung);

  await dongBrowser().catch(() => {});
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
