/**
 * Worker kiểm ảnh chứng minh tài khoản ngân hàng bằng OCR (chốt 2026-09-11).
 *
 * Đọc dòng `pending` ở `bank_account_checks`, OCR từng ảnh của tài khoản, so
 * với hệ thống rồi ghi kết quả. Kết quả chỉ để gợi ý cho người duyệt, worker
 * không đổi `bank_accounts.status`.
 *
 * Chạy trong container riêng `mgst-photo-check`, cùng image với
 * `mgst-api-worker`, đổi entrypoint. Dựng và thay bằng `deploy/worker-photo.sh`,
 * không gõ tay `docker run`.
 *
 * Tách container khỏi worker PVI để OCR hỏng không kéo theo tạo đơn bảo hiểm.
 *
 * Cờ:
 *   --mot-vong   chạy một vòng rồi thoát, để thử tay
 *
 * Tesseract mất khoảng 0,55 giây một lượt trên máy chủ, mỗi ảnh ba lượt chạy
 * song song. `PARALLEL` tài khoản chạy cùng lúc, mỗi tài khoản đọc ảnh tuần
 * tự: 4 × 3 = 12 tiến trình Tesseract là trần, container giới hạn `--cpus 4`.
 */

import { Client } from "pg";
import {
  failPhotoCheck,
  finishPhotoCheck,
  pendingPhotoChecks,
  PHOTO_CHECK_CHANNEL,
  runPhotoCheck,
  type PhotoCheckRun,
} from "../src/server/photoCheck";

const SLEEP_SECONDS = Number(process.env.PHOTO_CHECK_SLEEP ?? 30);
const BATCH = Number(process.env.PHOTO_CHECK_BATCH ?? 20);
/** Mỗi tài khoản mở 3 tiến trình Tesseract; 4 tài khoản là 12, trong `--cpus 4`. */
const PARALLEL = Number(process.env.PHOTO_CHECK_PARALLEL ?? 4);

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

const describeError = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

async function runOne(run: PhotoCheckRun): Promise<void> {
  try {
    const items = await runPhotoCheck(run);
    await finishPhotoCheck(run.checkId, items);
    log(`${run.accountId}  ${items.map((i) => `${i.key}:${i.verdict}`).join(" ")}`);
  } catch (e) {
    const reason = describeError(e);
    await failPhotoCheck(run.checkId, reason).catch((err) =>
      log(`Không ghi được lỗi cho ${run.checkId}: ${describeError(err)}`),
    );
    log(`${run.accountId}  HỎNG  ${reason}`);
  }
}

/** Một vòng: lấy một lô `pending`, chạy `PARALLEL` cái cùng lúc. Trả `true` khi lô đầy. */
async function runOnce(reason: string): Promise<boolean> {
  const pending = await pendingPhotoChecks(BATCH);
  if (pending.length === 0) return false;
  log(`Vòng ${reason}: ${pending.length} lượt chờ.`);

  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const run = pending[next];
      next += 1;
      await runOne(run);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return pending.length >= BATCH;
}

/**
 * Kết nối `LISTEN` để dậy ngay khi có lượt mới. Chép từ `pvi-api-worker.ts`:
 * kết nối riêng ngoài pool, ba lớp phát hiện đứt, hàng chờ thật nằm ở cột
 * `status` nên thông báo mất trong lúc đứt vẫn được vòng quét kế lấy lên.
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
      await c.query(`LISTEN ${PHOTO_CHECK_CHANNEL}`);
      c.on("notification", onNotify);
      backoffMs = 1000;
      log(`LISTEN ${PHOTO_CHECK_CHANNEL} sẵn sàng.`);
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

  if (process.argv.includes("--mot-vong")) {
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

  let wake: (() => void) | null = null;
  let notifiedWhileBusy = false;
  const stopListener = startListener(() => {
    if (wake) wake();
    else notifiedWhileBusy = true;
  });

  let reason = "khởi động";
  while (!stopping) {
    notifiedWhileBusy = false;
    let full = false;
    try {
      full = await runOnce(reason);
    } catch (e) {
      log(`Lỗi trong vòng quét: ${describeError(e)}`);
    }
    if (stopping) break;
    if (full || notifiedWhileBusy) {
      reason = full ? "lô đầy" : "thông báo";
      continue;
    }
    reason = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => {
        wake = null;
        resolve("hết giờ");
      }, SLEEP_SECONDS * 1000);
      wake = () => {
        clearTimeout(timer);
        wake = null;
        resolve("thông báo");
      };
    });
  }
  stopListener();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
