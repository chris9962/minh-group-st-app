/**
 * WORKER PVI ĐƯỜNG API — lấy đơn từ hàng chờ, gọi API đối tác, lấy giấy chứng nhận.
 *
 *   bun run pvi:api-worker                  # chạy mãi
 *   bun run pvi:api-worker -- --mot-vong    # chạy đúng một vòng rồi thoát
 *
 * ⚠️ Worker chạy là tạo đơn THẬT trên PVI. Xem `PVI_API_BASE_URL` trỏ đâu trước
 * khi bật: `piastest.pvi.com.vn` là môi trường thử.
 *
 * ⚠️ PVI chặn theo IP. Worker phải chạy trên máy chủ đã whitelist, chạy ở máy
 * khác thì mọi lệnh gọi hết giờ chờ mà không có thông báo nào rõ hơn.
 *
 * Đơn chỉ vào hàng chờ của worker này khi `PVI_ROUTE=api`; xem `newOrderRoute`
 * ở `src/server/insurance.ts`. Hai container phải cùng đọc biến đó.
 *
 * Khác bot Playwright ở `pvi-qlcd-playwright/worker.ts`: không mở trình duyệt,
 * không có bước duyệt tay, không có trạng thái `pending-approval`. Bốn đơn thử
 * trên `piastest` ngày 2026-09-03 ra giấy chứng nhận mà không ai duyệt.
 *
 * Kế hoạch đầy đủ ở `docs/plan-pvi-api-noi-luong-2026-09-03.md`.
 */

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { Client } from "pg";
import { CERTIFICATE_MAX_ATTEMPTS } from "../src/lib/api/insuranceOrders";
import { db } from "../src/server/db/client";
import { customers, insuranceOrders } from "../src/server/db/schema";
import { saveCertificateFrom } from "../src/server/pvi-api/certificate";
import { PviApiError } from "../src/server/pvi-api/client";
import { createElectricAccidentOrder } from "../src/server/pvi-api/electric";
import {
  electricInputFor,
  motorbikeInputFor,
  orderForPviColumns,
  type OrderForPvi,
} from "../src/server/pvi-api/from-order";
import { createMotorbikeOrder } from "../src/server/pvi-api/motorbike";
import { getPolicyNumber } from "../src/server/pvi-api/policy";
import { PVI_NEW_ORDER_CHANNEL } from "../src/server/pvi-api/route";

const SLEEP_SECONDS = Number(process.env.PVI_API_WORKER_SLEEP ?? 10);

/** Mỗi vòng lấy tối đa ngần này đơn, gọi PVI TUẦN TỰ trong cùng vòng. */
const CREATE_BATCH = Number(process.env.PVI_API_CREATE_BATCH ?? 10);
const CERTIFICATE_BATCH = Number(process.env.PVI_API_CERTIFICATE_BATCH ?? 20);

/**
 * Số lần gọi tạo đơn hỏng vì MẠNG trước khi bỏ đơn sang làm tay.
 *
 * Lỗi nghiệp vụ không đếm ở đây: PVI trả mã rõ thì đơn về `manual-queued` ngay
 * lượt đầu, thử lại cũng ra cùng kết quả.
 */
const MAX_CREATE_ATTEMPTS = Number(process.env.PVI_API_MAX_CREATE_ATTEMPTS ?? 5);

/**
 * Đơn nằm ở `creating` lâu hơn ngần này thì coi như worker giữ nó đã chết.
 *
 * Một lệnh gọi tối đa 30 giây theo `PVI_API_TIMEOUT_MS`. Worker còn sống thì
 * không đơn nào ở `creating` quá ngần đó cộng một lần ghi database, nên 2 phút
 * là chắc chắn worker đã dừng. Bot dùng 10 phút vì nó phải mở Chromium.
 */
const STALE_AFTER_MINUTES = Number(process.env.PVI_API_STALE_MINUTES ?? 2);

/** Khoảng cách giữa hai lần hỏi `GetPolicyNumber` cho cùng một đơn. */
const CERTIFICATE_RETRY_SECONDS = Number(process.env.PVI_API_CERTIFICATE_RETRY_SECONDS ?? 60);
const MAX_CERTIFICATE_ATTEMPTS = Number(
  process.env.PVI_API_MAX_CERTIFICATE_ATTEMPTS ?? CERTIFICATE_MAX_ATTEMPTS * 5,
);

const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

const describeError = (e: unknown): string =>
  e instanceof PviApiError
    ? `${e.kind}${e.status ? ` ${e.status}` : ""} - ${e.message}`
    : e instanceof Error
      ? e.message
      : String(e);

/**
 * Đưa đơn bị bỏ rơi ở `creating` về hàng chờ.
 *
 * Worker dừng giữa một lệnh gọi thì database không biết PVI đã nhận đơn hay
 * chưa. Trả đơn về `queued` là an toàn: lượt sau gửi lại ĐÚNG `ma_giaodich` cũ,
 * PVI trả `-555` nếu đơn đã có và `00` nếu chưa.
 */
async function reclaimStaleOrders() {
  const cutoff = new Date(Date.now() - STALE_AFTER_MINUTES * 60 * 1000);
  const reclaimed = await db
    .update(insuranceOrders)
    .set({ status: "queued", updatedAt: new Date() })
    .where(
      and(
        eq(insuranceOrders.status, "creating"),
        eq(insuranceOrders.pviRoute, "api"),
        or(isNull(insuranceOrders.updatedAt), lt(insuranceOrders.updatedAt, cutoff)),
      ),
    )
    .returning({ orderCode: insuranceOrders.orderCode });

  for (const r of reclaimed)
    log(`${r.orderCode}: mắc ở creating quá ${STALE_AFTER_MINUTES} phút, trả về hàng chờ`);
  return reclaimed.length;
}

/** Danh sách đơn chờ tạo. KHÔNG đổi trạng thái ở đây — xem `claim`. */
async function pendingOrders(): Promise<OrderForPvi[]> {
  return db
    .select(orderForPviColumns)
    .from(insuranceOrders)
    .innerJoin(customers, eq(customers.id, insuranceOrders.customerId))
    .where(
      and(eq(insuranceOrders.status, "queued"), eq(insuranceOrders.pviRoute, "api")),
    )
    .orderBy(sql`${insuranceOrders.orderDate} asc, ${insuranceOrders.createdAt} asc`)
    .limit(CREATE_BATCH);
}

/**
 * Khoá một đơn ngay TRƯỚC lệnh gọi của chính nó, không khoá cả lô lúc lấy.
 *
 * Khoá cả lô thì đơn thứ 10 đứng ở `creating` suốt lúc 9 đơn trước đang gọi, có
 * thể vượt `STALE_AFTER_MINUTES` và bị `reclaimStaleOrders` thu hồi trong khi
 * worker vẫn sống. Trạng thái `creating` phải gắn với ĐÚNG một lệnh gọi HTTP.
 *
 * `for update skip locked` làm hai worker không bao giờ lấy trùng.
 */
async function claim(id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: insuranceOrders.id })
      .from(insuranceOrders)
      .where(and(eq(insuranceOrders.id, id), eq(insuranceOrders.status, "queued")))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row) return false;

    await tx
      .update(insuranceOrders)
      .set({ status: "creating", updatedAt: new Date() })
      .where(eq(insuranceOrders.id, id));
    return true;
  });
}

/** Gọi PVI tạo một đơn rồi ghi kết quả. Trả trạng thái mới. */
async function createOne(order: OrderForPvi) {
  if (!(await claim(order.id))) return null;

  try {
    const result =
      order.product === "motorbike"
        ? await createMotorbikeOrder(motorbikeInputFor(order))
        : await createElectricAccidentOrder(electricInputFor(order));

    await db
      .update(insuranceOrders)
      .set({
        pviPrKeyNumber: result.prKey,
        status: "awaiting-certificate",
        // Về null để vòng tra giấy chứng nhận hỏi ngay, không đợi hết chu kỳ.
        certificateCheckedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(insuranceOrders.id, order.id));
    log(`${order.orderCode}: tạo xong, Pr_key ${result.prKey ?? "(không có)"}`);
    return "awaiting-certificate";
  } catch (e) {
    return failed(order, e);
  }
}

/** Ghi kết quả hỏng của một lượt tạo đơn. Ba nhóm lỗi ba đường đi khác nhau. */
async function failed(order: OrderForPvi, e: unknown) {
  const err = e instanceof PviApiError ? e : null;

  /**
   * `-555` là câu trả lời "đơn cũ đã ghi rồi", không phải lỗi.
   *
   * Nó xuất hiện khi lượt trước gửi xong mà worker chết trước lúc ghi kết quả.
   * Không có `Pr_key` để lưu, và không cần: số giấy chứng nhận tra bằng
   * `order_code` qua `GetPolicyNumber`.
   */
  if (err?.status === "-555") {
    await db
      .update(insuranceOrders)
      .set({ status: "awaiting-certificate", certificateCheckedAt: null, updatedAt: new Date() })
      .where(eq(insuranceOrders.id, order.id));
    log(`${order.orderCode}: PVI báo mã giao dịch đã tồn tại, đơn đã tạo ở lượt trước`);
    return "awaiting-certificate";
  }

  // Lỗi mạng: giữ đơn trong hàng chờ và thử lại vòng sau với ĐÚNG mã cũ.
  const transient = err && (err.kind === "network" || err.kind === "http" || err.kind === "malformed");
  if (transient) {
    const attempts = order.pviAttempts + 1;
    const giveUp = attempts >= MAX_CREATE_ATTEMPTS;
    await db
      .update(insuranceOrders)
      .set({
        pviAttempts: attempts,
        status: giveUp ? "manual-queued" : "queued",
        updatedAt: new Date(),
      })
      .where(eq(insuranceOrders.id, order.id));
    log(
      `${order.orderCode}: ${describeError(e)} (lần ${attempts}/${MAX_CREATE_ATTEMPTS})` +
        (giveUp ? " → làm tay" : ""),
    );
    return giveUp ? "manual-queued" : "queued";
  }

  /**
   * `config` là lỗi vận hành, không phải lỗi của đơn.
   *
   * Thiếu `PVI_API_CPID` thì MỌI đơn hỏng. Đẩy cả hàng chờ sang làm tay vì một
   * dòng thiếu trong `.env.local` là hỏng gấp nhiều lần cái nó sửa. Trả đơn về
   * `queued` và để vòng sau thử lại.
   */
  if (err?.kind === "config") {
    await db
      .update(insuranceOrders)
      .set({ status: "queued", updatedAt: new Date() })
      .where(eq(insuranceOrders.id, order.id));
    log(`${order.orderCode}: ${describeError(e)} — trả về hàng chờ, sửa cấu hình rồi worker tự chạy tiếp`);
    return "queued";
  }

  // Còn lại là PVI từ chối vì dữ liệu, hoặc zod chặn ngay trước khi gửi. Thử
  // lại cũng ra cùng kết quả, nên người xử lý tay phải xem.
  await db
    .update(insuranceOrders)
    .set({ status: "manual-queued", updatedAt: new Date() })
    .where(eq(insuranceOrders.id, order.id));
  log(`${order.orderCode}: ${describeError(e)} → làm tay`);
  return "manual-queued";
}

/**
 * Hỏi `GetPolicyNumber` cho các đơn đang đợi, rồi tải giấy chứng nhận.
 *
 * Worker LUÔN hỏi, không chỉ khi callback vắng: mình không lưu địa chỉ file của
 * PVI, mà muốn tải thì phải có địa chỉ đó. Callback chỉ rút ngắn thời gian chờ
 * bằng cách đặt `certificate_checked_at` về null.
 */
async function fetchCertificates() {
  const cutoff = new Date(Date.now() - CERTIFICATE_RETRY_SECONDS * 1000);
  const waiting = await db
    .select({
      id: insuranceOrders.id,
      orderCode: insuranceOrders.orderCode,
      attempts: insuranceOrders.certificateAttempts,
    })
    .from(insuranceOrders)
    .where(
      and(
        eq(insuranceOrders.status, "awaiting-certificate"),
        eq(insuranceOrders.pviRoute, "api"),
        isNull(insuranceOrders.certificatePhotoUrl),
        lt(insuranceOrders.certificateAttempts, MAX_CERTIFICATE_ATTEMPTS),
        or(
          isNull(insuranceOrders.certificateCheckedAt),
          lt(insuranceOrders.certificateCheckedAt, cutoff),
        ),
      ),
    )
    .orderBy(sql`${insuranceOrders.certificateCheckedAt} asc nulls first`)
    .limit(CERTIFICATE_BATCH);

  for (const row of waiting) {
    const missed = async (reason: string, pviFault: boolean) => {
      // Lỗi ở máy mình thì KHÔNG cộng số lần thử: hết `pdftoppm` mà cứ cộng là
      // đơn chạm ngưỡng rồi bị bỏ, dù PVI đã cấp giấy chứng nhận từ lâu.
      const attempts = pviFault ? row.attempts + 1 : row.attempts;
      await db
        .update(insuranceOrders)
        .set({ certificateAttempts: attempts, certificateCheckedAt: new Date() })
        .where(eq(insuranceOrders.id, row.id));
      log(`${row.orderCode}: ${reason} (lần ${attempts}/${MAX_CERTIFICATE_ATTEMPTS})`);
    };

    let policy;
    try {
      policy = await getPolicyNumber({ requestId: row.orderCode });
    } catch (e) {
      // `-500` nghĩa là PVI chưa cấp xong, KHÔNG phải đơn không tồn tại. Đo
      // 2026-09-03: đơn tạo thành công tra ngay vẫn ra `-500`, vài phút sau mới
      // ra đủ trường.
      await missed(describeError(e), true);
      continue;
    }

    if (!policy.issued) {
      await missed("PVI chưa cấp xong giấy chứng nhận", true);
      continue;
    }

    const saved = await saveCertificateFrom(policy.url, row.orderCode);
    if (!saved.ok) {
      await missed(saved.reason, saved.pviFault);
      continue;
    }

    await db
      .update(insuranceOrders)
      .set({
        pviPolicyNumber: policy.policyNumber,
        pviSerialNumber: policy.serialNumber,
        certificatePhotoUrl: saved.photoKey,
        status: "done",
        certificateCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(insuranceOrders.id, row.id));
    log(`${row.orderCode}: ${policy.policyNumber} → done`);
  }

  return waiting.length;
}

async function runOnce() {
  await reclaimStaleOrders();

  const pending = await pendingOrders();
  for (const order of pending) await createOne(order);

  const asked = await fetchCertificates();
  if (!pending.length && !asked) log("Không có việc.");
}

/**
 * Kết nối `LISTEN` để đánh thức worker ngay khi có đơn mới.
 *
 * Kết nối RIÊNG, không lấy từ pool: pool trả kết nối về sau mỗi câu truy vấn,
 * mà `LISTEN` đăng ký trên kết nối nào thì chết theo kết nối đó.
 *
 * Ba lớp phát hiện đứt, lớp sau bắt được thứ lớp trước bỏ sót:
 *
 * 1. Sự kiện `error` và `end` — đứt rõ ràng, Postgres khởi động lại hay mạng đóng.
 * 2. `SELECT 1` mỗi 30 giây — đứt câm, socket còn mở mà bên kia không còn.
 * 3. Vòng lặp định kỳ ở `main` — mọi thông báo mất trong lúc đứt.
 *
 * Không cần cơ chế backfill riêng. Thông báo chỉ là tín hiệu; hàng chờ thật nằm
 * ở cột `status`, nên đơn bỏ sót vẫn được vòng quét kế lấy lên.
 */
function startListener(onNotify: () => void) {
  const connectionString = process.env.DATABASE_URL;
  let client: Client | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let backoffMs = 1000;
  let stopped = false;

  const cleanup = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    const old = client;
    client = null;
    old?.removeAllListeners();
    old?.end().catch(() => {});
  };

  const reconnect = () => {
    if (stopped) return;
    cleanup();
    const wait = backoffMs;
    backoffMs = Math.min(backoffMs * 2, 30_000);
    setTimeout(connect, wait);
  };

  const connect = async () => {
    if (stopped) return;
    const c = new Client({ connectionString });
    client = c;
    c.on("error", (e) => {
      log(`LISTEN đứt: ${e.message}`);
      reconnect();
    });
    c.on("end", reconnect);
    try {
      await c.connect();
      await c.query(`LISTEN ${PVI_NEW_ORDER_CHANNEL}`);
      c.on("notification", onNotify);
      backoffMs = 1000;
      log(`LISTEN ${PVI_NEW_ORDER_CHANNEL} sẵn sàng.`);
      // Nối lại xong thì quét đầy đủ ngay: thông báo phát ra trong lúc đứt đã mất.
      onNotify();

      heartbeat = setInterval(() => {
        c.query("select 1").catch((e) => {
          log(`LISTEN không phản hồi: ${(e as Error).message}`);
          reconnect();
        });
      }, 30_000);
    } catch (e) {
      log(`Không mở được LISTEN: ${(e as Error).message}`);
      reconnect();
    }
  };

  void connect();
  return () => {
    stopped = true;
    cleanup();
  };
}

async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  const onceOnly = process.argv.includes("--mot-vong");

  log(`Worker API chạy THẬT: tạo đơn trên ${process.env.PVI_API_BASE_URL ?? "(chưa cấu hình)"}.`);

  if (onceOnly) {
    await runOnce();
    return;
  }

  let stopping = false;
  const stop = () => {
    stopping = true;
    log("Nhận tín hiệu dừng, kết thúc sau vòng này.");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  /** Đánh thức vòng lặp. Nhiều thông báo dồn lại chỉ thành một lần chạy. */
  let wake: (() => void) | null = null;
  const stopListener = startListener(() => wake?.());

  while (!stopping) {
    try {
      await runOnce();
    } catch (e) {
      // Một vòng hỏng không được làm chết worker: vòng sau thử lại.
      log(`Lỗi trong vòng quét: ${describeError(e)}`);
    }
    if (stopping) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(finish, SLEEP_SECONDS * 1000);
      function finish() {
        clearTimeout(timer);
        wake = null;
        resolve();
      }
      wake = finish;
    });
  }

  stopListener();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
