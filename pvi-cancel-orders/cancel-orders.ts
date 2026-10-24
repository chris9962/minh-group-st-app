/**
 * Huỷ trên PVI Connect các đơn bảo hiểm đã huỷ trong mgst-app. Chỉ lấy đơn của ngày hiện tại
 * (chốt 2026-10-23).
 *
 * Đơn huỷ trong mgst-app vẫn còn hiệu lực trên PVI. Mỗi tối nhân viên phải gom các đơn đó thành
 * đơn gom, lập SĐBS "0401 - Hủy đơn" cho đơn gom, rồi ký. Việc này phải xong trước lượt gom tự
 * động của PVI, khoảng 21:00; sau lượt đó PVI gom đơn huỷ chung với đơn còn hiệu lực.
 *
 * Timer `mgst-pvi-cancel.timer` gọi job mỗi ngày qua `docker run`. Xem README.md cùng thư mục.
 *
 *   bun cancel-orders.ts                         # chỉ kiểm tra: in đơn nào gom được, vào đơn gom nào
 *   PVI_CANCEL_ENABLED=1 bun cancel-orders.ts    # gom, lập SĐBS và ký thật
 *
 * Kết quả từng ngày ghi ở `<PVI_CANCEL_DATA_DIR>/results-<ngày>.json`, ghi lại ngay sau mỗi lệnh
 * ghi lên PVI. Chạy lại trong ngày thì job đọc file đó và làm tiếp từ chỗ dừng.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Pool } from "pg";
import { login, PviClient, refreshSession, expiresAtMs, type MergeCandidate, type PviSession } from "./pvi-connect";

const DATA_DIR = process.env.PVI_CANCEL_DATA_DIR ?? "/data";
const ENABLED = process.env.PVI_CANCEL_ENABLED === "1";
const SDBS_NOTE = "Hủy do sai thông tin khách hàng";
const SIGN_NOTE = "ok";
/** Giá trị ô "Thời hạn bảo hiểm" của trang Gom đơn xe máy: <= 12 tháng, 12-24 tháng, trên 24 tháng. */
const MOTORBIKE_TERMS = [1, 2, 3];
const PRODUCT_CODE = { motorbike: "050201", "electric-accident": "010206" } as const;
/** Còn ít hơn ngần này thì làm mới access token trước khi chạy. */
const SESSION_MARGIN_MS = 10 * 60 * 1000;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(DATA_DIR, "session.json");
const execFileAsync = promisify(execFile);

type Product = "motorbike" | "electric-accident";

type CancelledOrder = {
  product: Product;
  orderCode: string;
  serial: string;
  policyNumber: string;
};

type OrderStatus = "skipped" | "planned" | "merged" | "failed";

/** Đơn gom đang chứa một đơn bị bỏ qua, và đơn gom đó đã huỷ chưa. */
type Holder = { number: string; state: "cancelled" | "unsigned" | "partial" | "active"; amendments: string[] };

type OrderResult = CancelledOrder & {
  status: OrderStatus;
  reason?: string;
  group?: string;
  mergedNumber?: string;
  holders?: Holder[];
};

type MergedResult = {
  product: Product;
  number: string;
  prKey: number;
  orderCodes: string[];
  /** Chỉ đơn điện: đơn gom điện tạo ra ở trạng thái Chờ duyệt, phải ký trước khi lập SĐBS. */
  mergedSigned?: boolean;
  sdbsPrKey?: number;
  signed?: boolean;
  error?: string;
};

type DayResult = {
  date: string;
  runs: string[];
  orders: Record<string, OrderResult>;
  merged: Record<string, MergedResult>;
};

type Plan = { candidate: MergeCandidate; order: CancelledOrder; term?: number };

const log = (line: string) => console.log(`[${new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}] ${line}`);
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Thiếu biến môi trường ${name}`);
  return value;
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

async function loadCancelledOrders(date: string): Promise<CancelledOrder[]> {
  const pool = new Pool({ connectionString: requireEnv("DATABASE_URL") });
  try {
    const { rows } = await pool.query(
      `select product, order_code, pvi_serial_number, pvi_policy_number
         from insurance_orders
        where product in ('motorbike', 'electric-accident')
          and status = 'cancelled'
          and coalesce(pvi_serial_number, '') <> ''
          and order_date = $1
        order by product, order_code`,
      [date],
    );
    return rows.map((r) => ({
      product: r.product,
      orderCode: r.order_code,
      serial: String(r.pvi_serial_number),
      policyNumber: r.pvi_policy_number ?? "",
    }));
  } finally {
    await pool.end();
  }
}

/** Ghi kết quả lượt chạy vào `pvi_cancel_runs`. Worker Zalo đọc bảng này để gửi thông báo. */
async function saveRunReport(result: DayResult, error: string) {
  const pool = new Pool({ connectionString: requireEnv("DATABASE_URL") });
  try {
    const report = { date: result.date, orders: Object.values(result.orders), merged: Object.values(result.merged) };
    await pool.query(`insert into pvi_cancel_runs (run_date, mode, report, error) values ($1, $2, $3, $4)`, [
      result.date,
      ENABLED ? "write" : "check",
      JSON.stringify(report),
      error,
    ]);
  } finally {
    await pool.end();
  }
}

async function solveCaptcha(png: Buffer) {
  const file = path.join(tmpdir(), `pvi-captcha-${process.pid}.png`);
  await writeFile(file, png);
  try {
    const { stdout } = await execFileAsync("python3", [path.join(HERE, "solve-captcha.py"), file]);
    return stdout.trim();
  } finally {
    await rm(file, { force: true });
  }
}

/**
 * Dùng lại phiên đã lưu; sắp hết hạn thì làm mới bằng refresh token; không được nữa thì đăng
 * nhập lại bằng captcha. Phiên lưu ở DATA_DIR, quyền 600, vì token thay cho mật khẩu.
 */
async function openClient(): Promise<PviClient> {
  let session: PviSession | null = await readFile(SESSION_FILE, "utf8")
    .then((text) => JSON.parse(text) as PviSession)
    .catch(() => null);
  if (session && expiresAtMs(session.expiresAt) - Date.now() < SESSION_MARGIN_MS) session = await refreshSession(session);

  if (session) {
    const client = new PviClient(session);
    try {
      await client.ping();
      await writeFile(SESSION_FILE, JSON.stringify(session), { mode: 0o600 });
      return client;
    } catch (e) {
      if ((e as { status?: number }).status !== 401) throw e;
      log("Phiên đã lưu không còn dùng được, đăng nhập lại.");
    }
  }

  session = await login(requireEnv("PVI_CONNECT_USERNAME"), requireEnv("PVI_CONNECT_PASSWORD"), solveCaptcha);
  await writeFile(SESSION_FILE, JSON.stringify(session), { mode: 0o600 });
  return new PviClient(session);
}

async function loadDayResult(date: string): Promise<DayResult> {
  const file = path.join(DATA_DIR, `results-${date}.json`);
  const saved = await readFile(file, "utf8")
    .then((text) => JSON.parse(text) as DayResult)
    .catch(() => null);
  return saved ?? { date, runs: [], orders: {}, merged: {} };
}

async function saveDayResult(result: DayResult) {
  await writeFile(path.join(DATA_DIR, `results-${result.date}.json`), JSON.stringify(result, null, 2));
}

/** Xe máy: tìm từng seri trong danh sách chờ gom, thử lần lượt từng giá trị thời hạn. */
async function planMotorbike(client: PviClient, orders: CancelledOrder[], date: string, result: DayResult) {
  const plans: Plan[] = [];
  for (const order of orders) {
    let found: MergeCandidate[] = [];
    let term = 0;
    for (const t of MOTORBIKE_TERMS) {
      found = await client.searchMotorbikeCandidates(order.serial, t, date);
      if (found.length) {
        term = t;
        break;
      }
    }
    if (found.length === 1) {
      plans.push({ candidate: found[0], order, term });
      result.orders[order.orderCode] = { ...order, status: "planned", group: found[0].group };
      continue;
    }
    result.orders[order.orderCode] = found.length
      ? { ...order, status: "skipped", reason: `ra ${found.length} dòng chờ gom` }
      : await skippedNotWaiting(client, order, date);
  }
  return plans;
}

/**
 * Đơn không còn trong danh sách chờ gom: ghi lại đơn gom đang chứa nó, và đơn gom đó đã huỷ chưa.
 * Lệnh tra chỉ để báo cáo, nên tra lỗi thì ghi lý do rồi làm tiếp, không dừng lượt huỷ.
 */
async function skippedNotWaiting(client: PviClient, order: CancelledOrder, date: string): Promise<OrderResult> {
  const product = PRODUCT_CODE[order.product];
  const holders: Holder[] = [];
  try {
    for (const number of await client.findPolicyNumbers(product, order.serial, date.slice(0, 4))) {
      holders.push({ number, ...(await client.mergedOrderState(product, number)) });
    }
  } catch (e) {
    return { ...order, status: "skipped", reason: `không còn chờ gom, tra đơn gom chứa seri lỗi: ${(e as Error).message}` };
  }
  const reason = holders.length ? `không còn chờ gom, đang ở ${holders.map((h) => h.number).join(", ")}` : "không còn chờ gom";
  return { ...order, status: "skipped", reason, holders };
}

/** Đơn điện: tải cả danh sách chờ gom của ngày, khớp số đơn lẻ với `pvi_policy_number`. */
async function planElectric(client: PviClient, orders: CancelledOrder[], date: string, result: DayResult) {
  const byPolicy = groupBy(await client.listElectricCandidates(date), (c) => c.policyNumber);
  const plans: Plan[] = [];
  for (const order of orders) {
    const found = byPolicy.get(order.policyNumber) ?? [];
    if (found.length === 1) {
      plans.push({ candidate: found[0], order });
      result.orders[order.orderCode] = { ...order, status: "planned", group: found[0].group };
    } else {
      result.orders[order.orderCode] = found.length
        ? { ...order, status: "skipped", reason: `ra ${found.length} dòng chờ gom` }
        : await skippedNotWaiting(client, order, date);
    }
  }
  return plans;
}

/**
 * Gom xe máy: mỗi thời hạn một lệnh "Tạo đơn", vì trang chỉ cho chọn một thời hạn mỗi lần tìm.
 * Phản hồi không nói seri nào vào đơn gom nào, nên tra lại từng seri.
 */
async function mergeMotorbike(client: PviClient, plans: Plan[], date: string, result: DayResult) {
  for (const lot of groupBy(plans, (p) => String(p.term)).values()) {
    const created = await client.createMergedOrders(
      "MOTO",
      "050201",
      lot.map((p) => ({ group: p.candidate.group, prKey: p.candidate.prKey, policyNumber: p.candidate.policyNumber, unit: p.candidate.unit })),
    );
    for (const merged of created) result.merged[merged.number] = { product: "motorbike", ...merged, orderCodes: [] };
    for (const plan of lot) {
      const holders = await client.findPolicyNumbers(PRODUCT_CODE.motorbike, plan.order.serial, date.slice(0, 4));
      const merged = created.find((m) => holders.includes(m.number));
      const order = result.orders[plan.order.orderCode];
      if (merged) {
        result.merged[merged.number].orderCodes.push(plan.order.orderCode);
        Object.assign(order, { status: "merged", mergedNumber: merged.number });
      } else {
        Object.assign(order, { status: "failed", reason: "đã gửi lệnh gom nhưng không tìm thấy seri trong đơn gom mới" });
      }
    }
    await saveDayResult(result);
  }
}

/** Gom đơn điện: một lệnh "Tạo đơn" cho mọi nhóm. Chi tiết đơn gom điện có danh sách seri thật. */
async function mergeElectric(client: PviClient, plans: Plan[], result: DayResult) {
  const created = await client.createMergedOrders(
    "TNCG",
    "010206",
    plans.map((p) => ({ group: p.candidate.group, prKey: p.candidate.prKey, policyNumber: p.candidate.policyNumber, unit: p.candidate.unit })),
  );
  for (const merged of created) {
    const serials = new Set(await client.electricMergedSerials(merged.prKey));
    const inside = plans.filter((p) => serials.has(p.order.serial));
    result.merged[merged.number] = { product: "electric-accident", ...merged, orderCodes: inside.map((p) => p.order.orderCode) };
    for (const p of inside) Object.assign(result.orders[p.order.orderCode], { status: "merged", mergedNumber: merged.number });
  }
  for (const p of plans) {
    const order = result.orders[p.order.orderCode];
    if (order.status === "planned") {
      Object.assign(order, { status: "failed", reason: "đã gửi lệnh gom nhưng không tìm thấy seri trong đơn gom mới" });
    }
  }
  await saveDayResult(result);
}

/**
 * Lập SĐBS huỷ rồi ký cho từng đơn gom chưa ký, kể cả đơn gom của lượt chạy trước trong ngày.
 * Đơn gom điện phải ký trước khi lập SĐBS.
 */
async function cancelMerged(client: PviClient, date: string, result: DayResult) {
  for (const merged of Object.values(result.merged)) {
    if (merged.signed) continue;
    const electric = merged.product === "electric-accident";
    try {
      if (electric && !merged.mergedSigned) {
        await client.signElectric(merged.prKey, SIGN_NOTE);
        merged.mergedSigned = true;
        await saveDayResult(result);
      }
      if (!merged.sdbsPrKey) {
        merged.sdbsPrKey = electric
          ? await client.createElectricCancellation(merged.prKey, SDBS_NOTE, date)
          : await client.createMotorbikeCancellation(merged.prKey, SDBS_NOTE, date);
        await saveDayResult(result);
      }
      const message = electric
        ? await client.signElectric(merged.sdbsPrKey, SIGN_NOTE)
        : await client.signMotorbikeCancellation(merged.sdbsPrKey, SIGN_NOTE);
      merged.signed = true;
      delete merged.error;
      log(`${merged.number}: ${message}`);
    } catch (e) {
      merged.error = (e as Error).message;
      log(`${merged.number}: lỗi ${merged.error}`);
    }
    await saveDayResult(result);
  }
}

function printSummary(result: DayResult) {
  const orders = Object.values(result.orders);
  for (const product of ["motorbike", "electric-accident"] as const) {
    const mine = orders.filter((o) => o.product === product);
    if (!mine.length) continue;
    log(`${product === "motorbike" ? "Xe máy" : "Đơn điện"}: ${mine.length} đơn huỷ`);
    for (const [group, rows] of groupBy(mine.filter((o) => o.status === "planned"), (o) => o.group ?? "")) {
      log(`  sẽ vào chung 1 đơn gom (${group}): ${rows.map((o) => o.orderCode).join(", ")}`);
    }
    for (const merged of Object.values(result.merged).filter((m) => m.product === product)) {
      const state = merged.signed ? "đã huỷ và ký" : merged.error ? `lỗi: ${merged.error}` : "chưa huỷ";
      log(`  ${merged.number} (${state}): ${merged.orderCodes.join(", ")}`);
    }
    for (const o of mine.filter((o) => o.status === "skipped" || o.status === "failed")) {
      log(`  bỏ qua ${o.orderCode} ${o.serial}: ${o.reason}`);
    }
  }
}

async function main() {
  const date = today();
  await mkdir(DATA_DIR, { recursive: true });
  const result = await loadDayResult(date);
  result.runs.push(new Date().toISOString());
  try {
    await run(date, result);
  } catch (e) {
    await saveRunReport(result, (e as Error).message).catch((saveError) => console.error(saveError));
    throw e;
  }
  await saveRunReport(result, "");

  const failed = Object.values(result.orders).some((o) => o.status === "failed") || Object.values(result.merged).some((m) => m.error);
  if (failed) process.exit(1);
}

async function run(date: string, result: DayResult) {
  const done = new Set(Object.values(result.orders).filter((o) => o.status === "merged").map((o) => o.orderCode));
  const orders = (await loadCancelledOrders(date)).filter((o) => !done.has(o.orderCode));
  log(`Ngày ${date}, ${ENABLED ? "GHI THẬT lên PVI" : "chỉ kiểm tra"}. ${orders.length} đơn huỷ chưa gom.`);

  const client = await openClient();
  log(`Đăng nhập PVI: ${client.user.ma_user} ${client.user.full_name}`);
  // SĐBS chỉ ký được bởi người tạo có ma_tthai 02, nên cả lượt phải dùng một tài khoản đó.
  if (ENABLED && client.user.ma_tthai !== "02") {
    throw new Error(`Tài khoản ${client.user.ma_user} có ma_tthai ${client.user.ma_tthai}, không ký được SĐBS.`);
  }

  const motorbikePlans = await planMotorbike(client, orders.filter((o) => o.product === "motorbike"), date, result);
  const electricPlans = await planElectric(client, orders.filter((o) => o.product === "electric-accident"), date, result);
  await saveDayResult(result);

  if (ENABLED) {
    if (motorbikePlans.length) await mergeMotorbike(client, motorbikePlans, date, result);
    if (electricPlans.length) await mergeElectric(client, electricPlans, result);
    await cancelMerged(client, date, result);
  }

  await saveDayResult(result);
  printSummary(result);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
