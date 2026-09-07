/**
 * WORKER PVI ĐƯỜNG API — lấy đơn từ hàng chờ, gọi API đối tác, lấy giấy chứng nhận.
 *
 *   bun run pvi:api-worker                  # chạy mãi
 *   bun run pvi:api-worker -- --mot-vong    # chạy đúng một vòng rồi thoát
 *   bun run pvi:api-check                   # chỉ kiểm cấu hình và kết nối PVI, dùng lúc deploy
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
 * Kế hoạch đầy đủ ở `docs/plan-pvi-api-noi-luong-2026-09-03.md`, các quyết định
 * về mã lỗi ở `docs/review-pvi-api-flow-2026-09-07.md`.
 */

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { Client } from "pg";
import { ZodError } from "zod";
import { CERTIFICATE_MAX_ATTEMPTS } from "../src/lib/api/insuranceOrders";
import { db } from "../src/server/db/client";
import {
  customers,
  insuranceOrders,
  insuranceOrderStatusHistory,
} from "../src/server/db/schema";
import { checkPviAccess } from "../src/server/pvi-api/catalog";
import { saveCertificateFrom } from "../src/server/pvi-api/certificate";
import { PviApiError } from "../src/server/pvi-api/client";
import { orderForPviColumns, type OrderForPvi } from "../src/server/pvi-api/from-order";
import { getPolicyNumber, type PolicyLookupResult } from "../src/server/pvi-api/policy";
import { preparePviOrder, type PreparedPviOrder } from "../src/server/pvi-api/products";
import { PVI_NEW_ORDER_CHANNEL } from "../src/server/pvi-api/route";

const SLEEP_SECONDS = Number(process.env.PVI_API_WORKER_SLEEP ?? 10);

/** Mỗi vòng lấy tối đa ngần này đơn, gọi PVI TUẦN TỰ trong cùng vòng. */
const CREATE_BATCH = Number(process.env.PVI_API_CREATE_BATCH ?? 10);
const CERTIFICATE_BATCH = Number(process.env.PVI_API_CERTIFICATE_BATCH ?? 20);
/**
 * Số lệnh `GetPolicyNumber` gửi cùng lúc (chốt 2026-09-07). Đo cùng ngày: 11
 * lượt × 10 lệnh cùng lúc, không lỗi, mỗi lượt dưới 1,6 giây. Chỉ là chờ mạng,
 * không tốn CPU hay RAM như bước chụp ảnh.
 */
const POLICY_LOOKUP_PARALLEL = Number(process.env.PVI_API_POLICY_LOOKUP_PARALLEL ?? 10);

/**
 * Số lần gọi tạo đơn mà KHÔNG BIẾT kết quả trước khi bỏ đơn sang làm tay.
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

/** Khoảng cách giữa hai lần hỏi `GetPolicyNumber` cho cùng một đơn, trong `CERTIFICATE_MAX_ATTEMPTS` lần đầu. */
const CERTIFICATE_RETRY_SECONDS = Number(process.env.PVI_API_CERTIFICATE_RETRY_SECONDS ?? 30);
/**
 * Nhịp hỏi sau khi đã quá `CERTIFICATE_MAX_ATTEMPTS` lần (chốt 2026-09-07).
 *
 * Đo thật PVI cấp trong vài phút. Sau 30 phút mà chưa có thì hỏi 30 giây một
 * lần cũng không ra thông tin mới, chỉ tốn lượt gọi. KHÔNG có trần: đơn đã có
 * bên PVI, thôi hỏi là bắt người làm tay tạo lại một đơn đã tạo xong.
 */
const CERTIFICATE_SLOW_RETRY_SECONDS = Number(
  process.env.PVI_API_CERTIFICATE_SLOW_RETRY_SECONDS ?? 300,
);

const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

type OrderStatus = (typeof insuranceOrders.$inferSelect)["status"];

const describeError = (e: unknown): string =>
  e instanceof PviApiError
    ? `${e.kind}${e.status ? ` ${e.status}` : ""} - ${e.message}`
    : e instanceof ZodError
      // `message` của ZodError là cả mảng issue dạng JSON, người xử lý tay không đọc nổi.
      ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      : e instanceof Error
        ? e.message
        : String(e);

/**
 * Đổi trạng thái một đơn VÀ ghi một dòng lịch sử, trong cùng transaction.
 *
 * MỌI lượt đổi trạng thái của worker phải đi qua đây (chốt 2026-09-06). Bản
 * trước chỉ `update` cột `status`, nên người xử lý tay mở đơn ra thấy "Chờ làm
 * tay" mà không biết vì sao — lý do PVI trả về chỉ nằm trong log container.
 *
 * Kẹp theo trạng thái NGUỒN (chốt 2026-09-07): người có quyền vừa nhận đơn về
 * làm tay, hay vừa đặt tay trạng thái khác, thì worker không được ghi đè, kể cả
 * khi PVI trả kết quả đúng lúc đó. Trả `false` khi không ghi được dòng nào.
 *
 * `changedBy` để null: cột đó nhận null nghĩa là máy tự chuyển, không phải
 * người bấm.
 *
 * Vòng tra giấy chứng nhận KHÔNG gọi hàm này khi chỉ tăng `certificate_attempts`
 * — trạng thái không đổi, mà ghi hàng trăm dòng "vẫn đang đợi" là chôn mất ba
 * dòng đáng đọc.
 */
async function setStatus(
  id: string,
  from: OrderStatus,
  to: OrderStatus,
  extra: { note: string } & Partial<typeof insuranceOrders.$inferInsert>,
): Promise<boolean> {
  const { note, ...columns } = extra;
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(insuranceOrders)
      .set({ ...columns, status: to, updatedAt: new Date() })
      .where(and(eq(insuranceOrders.id, id), eq(insuranceOrders.status, from)))
      .returning({ id: insuranceOrders.id });
    if (updated.length === 0) {
      log(`${id}: không còn ở ${from}, bỏ lượt chuyển sang ${to}`);
      return false;
    }
    await tx.insert(insuranceOrderStatusHistory).values({
      orderId: id,
      fromStatus: from,
      toStatus: to,
      note,
    });
    return true;
  });
}

/**
 * Đưa đơn bị bỏ rơi ở `creating` về hàng chờ.
 *
 * Worker dừng giữa một lệnh gọi thì database không biết PVI đã nhận đơn hay
 * chưa. Trả đơn về `queued` là an toàn: lượt sau gửi lại ĐÚNG `ma_giaodich` cũ,
 * PVI trả `-555` nếu đơn đã có và `00` nếu chưa.
 */
async function reclaimStaleOrders() {
  const cutoff = new Date(Date.now() - STALE_AFTER_MINUTES * 60 * 1000);
  const stale = await db
    .select({ id: insuranceOrders.id, orderCode: insuranceOrders.orderCode })
    .from(insuranceOrders)
    .where(
      and(
        eq(insuranceOrders.status, "creating"),
        eq(insuranceOrders.pviRoute, "api"),
        or(isNull(insuranceOrders.updatedAt), lt(insuranceOrders.updatedAt, cutoff)),
      ),
    );

  for (const row of stale) {
    await setStatus(row.id, "creating", "queued", {
      note: `Mắc ở Đang tạo quá ${STALE_AFTER_MINUTES} phút, worker giữ đơn đã dừng.`,
    });
    log(`${row.orderCode}: mắc ở creating quá ${STALE_AFTER_MINUTES} phút, trả về hàng chờ`);
  }
  return stale.length;
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
    await tx.insert(insuranceOrderStatusHistory).values({
      orderId: id,
      fromStatus: "queued",
      toStatus: "creating",
      note: "Hệ thống API xử lý đơn",
    });
    return true;
  });
}

/** Gọi PVI tạo một đơn rồi ghi kết quả. Trả trạng thái mới. */
async function createOne(order: OrderForPvi) {
  if (!(await claim(order.id))) return null;

  /**
   * Dựng payload TRƯỚC, ngoài `try` của lệnh gọi. Lỗi ở đây là zod hoặc
   * `pviPeriod` từ chối dữ liệu đơn: chưa có lệnh gọi nào, chắc chắn PVI chưa
   * có đơn, người làm tay lập thẳng. Gộp chung với lỗi gọi PVI thì ghi chú ghi
   * "PVI từ chối" cho một thứ PVI chưa hề thấy.
   */
  let prepared: PreparedPviOrder;
  try {
    prepared = preparePviOrder(order);
  } catch (e) {
    await setStatus(order.id, "creating", "manual-queued", {
      note: `Dữ liệu đơn không hợp lệ: ${describeError(e)}`,
    });
    log(`${order.orderCode}: dữ liệu không hợp lệ, ${describeError(e)} → làm tay`);
    return "manual-queued";
  }

  try {
    const result = await prepared.send();

    await setStatus(order.id, "creating", "awaiting-certificate", {
      pviPrKeyNumber: result.prKey,
      // Về null để vòng tra giấy chứng nhận hỏi ngay, không đợi hết chu kỳ.
      certificateCheckedAt: null,
      note: `PVI nhận đơn, Pr_key ${result.prKey ?? "(không có)"}.`,
    });
    log(`${order.orderCode}: tạo xong, Pr_key ${result.prKey ?? "(không có)"}`);
    return "awaiting-certificate";
  } catch (e) {
    return failed(order, e);
  }
}

/** Ghi kết quả hỏng của một lượt gọi PVI. Bốn nhóm lỗi bốn đường đi khác nhau. */
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
    await setStatus(order.id, "creating", "awaiting-certificate", {
      certificateCheckedAt: null,
      note: "PVI trả -555 mã giao dịch đã tồn tại.",
    });
    log(`${order.orderCode}: PVI báo mã giao dịch đã tồn tại, đơn đã tạo ở lượt trước`);
    return "awaiting-certificate";
  }

  /**
   * KHÔNG BIẾT PVI đã ghi đơn hay chưa: mạng đứt giữa chừng, HTTP lạ, thân trả
   * về không đọc được, và `-1` là exception bên PVI có thể xảy ra SAU khi họ đã
   * ghi. Giữ đơn trong hàng chờ, thử lại với ĐÚNG mã cũ: đã có thì `-555`.
   * Đủ số lần thì sang làm tay, ghi chú phải nói rõ đơn có thể đã có bên PVI
   * (chốt 2026-09-07).
   */
  const unknownOutcome =
    err &&
    (err.kind === "network" || err.kind === "http" || err.kind === "malformed" || err.status === "-1");
  if (unknownOutcome) {
    const attempts = order.pviAttempts + 1;
    const giveUp = attempts >= MAX_CREATE_ATTEMPTS;
    await setStatus(order.id, "creating", giveUp ? "manual-queued" : "queued", {
      pviAttempts: attempts,
      note: giveUp
        ? `Gọi PVI hỏng ${attempts} lần, lần cuối: ${describeError(e)}. Đơn CÓ THỂ đã có trên PVI, tra GetPolicyNumber trước khi lập tay.`
        : `Gọi PVI hỏng (lần ${attempts}/${MAX_CREATE_ATTEMPTS}): ${describeError(e)}`,
    });
    log(
      `${order.orderCode}: ${describeError(e)} (lần ${attempts}/${MAX_CREATE_ATTEMPTS})` +
        (giveUp ? " → làm tay" : ""),
    );
    return giveUp ? "manual-queued" : "queued";
  }

  /**
   * Lỗi cấu hình: thiếu biến `.env`, hoặc PVI trả `-105 Sai chữ ký`. Mọi đơn
   * hỏng như nhau, làm tiếp là đẩy cả hàng chờ sang làm tay. Trả đơn về hàng
   * chờ rồi THOÁT (chốt 2026-09-07): khởi động lại thì `checkPviAccess` ở
   * `main` chặn cho tới khi sửa xong `.env`, và lịch sử đơn chỉ có một dòng.
   */
  if (err?.kind === "config" || err?.status === "-105") {
    await setStatus(order.id, "creating", "queued", {
      note: `Cấu hình PVI sai: ${describeError(e)}. Worker dừng.`,
    });
    log(`${order.orderCode}: ${describeError(e)} — worker dừng, sửa cấu hình rồi khởi động lại`);
    process.exit(1);
  }

  // Còn lại là PVI từ chối vì dữ liệu. Thử lại cũng ra cùng kết quả, nên người
  // xử lý tay phải xem.
  await setStatus(order.id, "creating", "manual-queued", {
    note: `PVI từ chối: ${describeError(e)}`,
  });
  log(`${order.orderCode}: ${describeError(e)} → làm tay`);
  return "manual-queued";
}

/**
 * Hỏi `GetPolicyNumber` cho các đơn đang đợi, rồi tải giấy chứng nhận.
 *
 * Worker LUÔN hỏi, không chỉ khi callback vắng: mình không lưu địa chỉ file của
 * PVI, mà muốn tải thì phải có địa chỉ đó. Callback chỉ rút ngắn thời gian chờ
 * bằng cách đặt `certificate_checked_at` về null.
 *
 * Nhịp hỏi theo số lần đã hỏi: `CERTIFICATE_RETRY_SECONDS` trong
 * `CERTIFICATE_MAX_ATTEMPTS` lần đầu, sau đó `CERTIFICATE_SLOW_RETRY_SECONDS`.
 * Tính trong câu SQL vì mỗi dòng một nhịp.
 *
 * Mốc "bây giờ" lấy từ đồng hồ của worker, KHÔNG dùng `now()` của Postgres:
 * `certificate_checked_at` do worker ghi bằng đồng hồ của nó, so với đồng hồ
 * khác là sai. Đo 2026-09-07: Postgres trong Docker local chậm 21 giờ 47 phút,
 * `now()` làm không đơn nào tới hạn và worker thôi hỏi hẳn.
 */
async function fetchCertificates() {
  const now = new Date();
  const due = sql`(
    ${insuranceOrders.certificateCheckedAt} is null
    or ${insuranceOrders.certificateCheckedAt} < ${now}::timestamptz - make_interval(secs =>
      case when ${insuranceOrders.certificateAttempts} < ${sql.raw(String(CERTIFICATE_MAX_ATTEMPTS))}
        then ${sql.raw(String(CERTIFICATE_RETRY_SECONDS))}
        else ${sql.raw(String(CERTIFICATE_SLOW_RETRY_SECONDS))}
      end)
  )`;
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
        due,
      ),
    )
    .orderBy(sql`${insuranceOrders.certificateCheckedAt} asc nulls first`)
    .limit(CERTIFICATE_BATCH);

  type Waiting = (typeof waiting)[number];
  const missed = async (row: Waiting, reason: string, pviFault: boolean) => {
    // Lỗi ở máy mình thì KHÔNG cộng số lần thử: hết `pdftoppm` mà cứ cộng là
    // đơn chạm ngưỡng nhắc dù PVI đã cấp giấy chứng nhận từ lâu.
    const attempts = pviFault ? row.attempts + 1 : row.attempts;
    await db
      .update(insuranceOrders)
      .set({ certificateAttempts: attempts, certificateCheckedAt: new Date() })
      .where(eq(insuranceOrders.id, row.id));
    log(`${row.orderCode}: ${reason} (lần ${attempts})`);
  };

  // Hỏi PVI song song từng nhóm. Tải PDF và chụp ảnh phía dưới vẫn TUẦN TỰ:
  // mỗi lượt chụp 30 MB RAM, mười lượt cùng lúc là 300 MB trên máy chủ từng OOM.
  const looked: Array<{ row: Waiting; policy?: PolicyLookupResult; error?: unknown }> = [];
  for (let i = 0; i < waiting.length; i += POLICY_LOOKUP_PARALLEL) {
    const chunk = waiting.slice(i, i + POLICY_LOOKUP_PARALLEL);
    looked.push(
      ...(await Promise.all(
        chunk.map(async (row) => {
          try {
            return { row, policy: await getPolicyNumber({ requestId: row.id }) };
          } catch (error) {
            return { row, error };
          }
        }),
      )),
    );
  }

  for (const { row, policy, error } of looked) {
    if (!policy) {
      // `-500` nghĩa là PVI chưa cấp xong, KHÔNG phải đơn không tồn tại. Đo
      // 2026-09-03: đơn tạo thành công tra ngay vẫn ra `-500`, vài phút sau mới
      // ra đủ trường.
      await missed(row, describeError(error), true);
      continue;
    }

    if (!policy.issued) {
      await missed(row, "PVI chưa cấp xong giấy chứng nhận", true);
      continue;
    }

    const saved = await saveCertificateFrom(policy.url, row.orderCode);
    if (!saved.ok) {
      await missed(row, saved.reason, saved.pviFault);
      continue;
    }

    const done = await setStatus(row.id, "awaiting-certificate", "done", {
      pviPolicyNumber: policy.policyNumber,
      pviSerialNumber: policy.serialNumber,
      certificatePhotoUrl: saved.photoKey,
      certificateCheckedAt: new Date(),
      note: `PVI cấp giấy chứng nhận ${policy.policyNumber}.`,
    });
    if (done) log(`${row.orderCode}: ${policy.policyNumber} → done`);
  }

  return waiting.length;
}

/** Một vòng quét. Trả `true` khi vòng lấy đủ lô, tức hàng chờ còn nữa. */
async function runOnce(reason: string): Promise<boolean> {
  await reclaimStaleOrders();

  const pending = await pendingOrders();
  if (pending.length) log(`Vòng chạy vì ${reason}: ${pending.length} đơn chờ tạo.`);
  for (const order of pending) await createOne(order);

  const asked = await fetchCertificates();
  return pending.length >= CREATE_BATCH || asked >= CERTIFICATE_BATCH;
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
  const checkOnly = process.argv.includes("--check");

  log(`Worker API chạy THẬT: tạo đơn trên ${process.env.PVI_API_BASE_URL ?? "(chưa cấu hình)"}.`);

  /**
   * Kiểm cấu hình và kết nối PVI TRƯỚC khi đụng đơn nào (chốt 2026-09-07).
   *
   * Sai cấu hình thì thoát, không đơn nào bị đẩy sang làm tay. Lỗi mạng thì vẫn
   * chạy: đơn tự thử lại theo vòng. `--check` dùng lúc deploy nên mọi lỗi đều
   * thoát mã 1, kể cả lỗi mạng — máy chủ chưa được whitelist cũng là lỗi deploy.
   */
  const access = await checkPviAccess();
  if (!access.ok) {
    log(`Kiểm PVI không qua: ${access.message}`);
    if (access.fatal || checkOnly) process.exit(1);
    log("Lỗi mạng, worker vẫn chạy: đơn tự thử lại theo vòng.");
  } else {
    log("Kiểm PVI: kết nối và chữ ký đúng.");
  }
  if (checkOnly) return;

  if (onceOnly) {
    await runOnce("--mot-vong");
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
  /**
   * Có thông báo tới trong lúc worker ĐANG chạy một vòng.
   *
   * `wake` chỉ khác null lúc worker đang ngủ. Đơn thứ hai lập ngay sau đơn thứ
   * nhất thì thông báo của nó tới đúng lúc worker còn đang gọi PVI cho đơn đầu,
   * và lời gọi rơi vào chỗ trống. Không nhớ lại thì đơn đó đợi hết giấc ngủ,
   * tức mất tác dụng của LISTEN đúng lúc cần nhất.
   */
  let notifiedWhileBusy = false;
  const stopListener = startListener(() => {
    if (wake) wake();
    else notifiedWhileBusy = true;
  });

  /**
   * Lý do vòng này chạy. Ghi ra để đo được `LISTEN` có tác dụng thật hay không.
   *
   * `hết giờ` nhiều mà `thông báo` ít nghĩa là kết nối `LISTEN` đang đứt, hoặc
   * đường tạo đơn quên gọi `pg_notify` — hai hỏng hóc không có triệu chứng nào
   * khác, vì đơn vẫn chạy, chỉ chậm hơn.
   */
  let reason = "khởi động";

  while (!stopping) {
    notifiedWhileBusy = false;
    let full = false;
    try {
      full = await runOnce(reason);
    } catch (e) {
      // Một vòng hỏng không được làm chết worker: vòng sau thử lại.
      log(`Lỗi trong vòng quét: ${describeError(e)}`);
    }
    if (stopping) break;
    // Lô vừa rồi đầy thì hàng chờ còn nữa: 100 đơn mà ngủ 10 giây giữa mỗi lô
    // 10 là mất 90 giây không làm gì (chốt 2026-09-07).
    if (full) {
      reason = "lô đầy";
      continue;
    }
    // Bỏ giấc ngủ, chạy vòng kế ngay.
    if (notifiedWhileBusy) {
      reason = "thông báo tới lúc đang chạy";
      continue;
    }
    const sleptFrom = Date.now();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(finish, SLEEP_SECONDS * 1000);
      function finish() {
        clearTimeout(timer);
        wake = null;
        resolve();
      }
      wake = finish;
    });
    // Ngủ chưa hết giờ nghĩa là có thông báo cắt ngang.
    reason =
      Date.now() - sleptFrom < SLEEP_SECONDS * 1000 - 200 ? "thông báo" : "hết giờ";
  }

  stopListener();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
