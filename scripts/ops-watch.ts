/**
 * ĐO MÁY CHỦ VÀ ĐẨY CẢNH BÁO VẬN HÀNH — nuôi màn P-99.
 *
 *   bun run ops:watch                  # chạy mãi, mỗi 60 giây một vòng
 *   bun run ops:watch -- --mot-vong    # chạy đúng một vòng rồi thoát
 *
 * ⚠️ CHẠY THẲNG TRÊN MÁY CHỦ bằng systemd, KHÔNG bỏ vào container. Trong
 * container thì `df` ra ổ đĩa của container chứ không ra ổ đĩa máy chủ, và số
 * hiện trên màn sẽ không khớp bảng điều khiển FPT. Unit mẫu ở
 * `docs/deploy-fpt-cloud.md`.
 *
 * Mỗi vòng làm bốn việc:
 *
 *   1. đo CPU, RAM, ổ đĩa rồi ghi một dòng `host_metrics`
 *   2. mỗi `OPS_S3_EVERY_MINUTES` phút thì đo thêm dung lượng bucket S3
 *   3. gom cảnh báo: đơn chờ giấy chứng nhận quá 10 và 15 phút, tài nguyên quá 80%
 *   4. đẩy TỐI ĐA MỘT thông báo cho người cầm `system:view-ops`
 *
 * Trần một thông báo mỗi vòng là chốt của người dùng: 20 đơn kẹt cùng lúc thì
 * 20 gói tin đẩy liên tiếp làm điện thoại rung không dứt, mà nội dung thì cùng
 * một chuyện.
 */

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { sql } from "drizzle-orm";
import {
  OPS_CERT_REMIND_MINUTES,
  OPS_CERT_WARN_MINUTES,
  OPS_RESOURCE_PERCENT,
} from "../src/lib/api/ops";
import { formatBytes } from "../src/lib/format";
import { db } from "../src/server/db/client";
import { hostMetrics } from "../src/server/db/schema";
import { notifyUsers, recipientsFor } from "../src/server/notifications";

const SLEEP_SECONDS = Number(process.env.OPS_WATCH_SLEEP ?? 60);
/** Đo S3 thưa hơn hẳn: một lượt phải duyệt hết object trong bucket. */
const S3_EVERY_MINUTES = Number(process.env.OPS_S3_EVERY_MINUTES ?? 60);
/** Ổ đĩa cần theo dõi. Máy chủ FPT để mọi thứ trên phân vùng gốc. */
const DISK_PATH = process.env.OPS_DISK_PATH ?? "/";
/** Tài nguyên vẫn quá ngưỡng thì nhắc lại sau ngần này phút, không nhắc mỗi vòng. */
const RESOURCE_COOLDOWN_MINUTES = Number(process.env.OPS_RESOURCE_COOLDOWN_MINUTES ?? 30);
/** Số đo cũ hơn ngần này ngày thì xoá — bảng này chỉ để nhìn hiện tại. */
const KEEP_DAYS = Number(process.env.OPS_KEEP_DAYS ?? 7);

const log = (line: string) => console.log(`[${new Date().toISOString()}] ${line}`);

/* ── Đo máy ─────────────────────────────────────────────────────────────── */

type CpuSample = { idle: number; total: number };

/**
 * Đọc `/proc/stat` dòng `cpu` — tổng thời gian và phần rảnh, tính từ lúc khởi
 * động máy. Một mẫu đơn lẻ không nói được gì; phần trăm là HIỆU của hai mẫu.
 */
async function cpuSample(): Promise<CpuSample | null> {
  const text = await readFile("/proc/stat", "utf8").catch(() => "");
  const line = text.split("\n").find((l) => l.startsWith("cpu "));
  if (!line) return null;

  const parts = line.split(/\s+/).slice(1).map(Number).filter((n) => Number.isFinite(n));
  if (parts.length < 5) return null;

  // Cột 4 là `idle`, cột 5 là `iowait`. Máy đang chờ đĩa thì CPU vẫn rảnh.
  const idle = parts[3] + parts[4];
  return { idle, total: parts.reduce((a, b) => a + b, 0) };
}

const cpuPercentBetween = (before: CpuSample, after: CpuSample): number => {
  const total = after.total - before.total;
  const idle = after.idle - before.idle;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, ((total - idle) / total) * 100));
};

/**
 * RAM đang dùng theo cách `free` tính: tổng trừ `MemAvailable`.
 *
 * KHÔNG dùng `MemFree`: Linux mượn RAM rảnh làm bộ đệm đĩa, nên `MemFree` luôn
 * gần 0 trên máy chạy lâu và cảnh báo sẽ kêu suốt ngày mà không có việc gì.
 */
async function readMemory(): Promise<{ used: number; total: number } | null> {
  const text = await readFile("/proc/meminfo", "utf8").catch(() => "");
  if (!text) return null;

  const kb = (key: string): number => {
    const line = text.split("\n").find((l) => l.startsWith(`${key}:`));
    return line ? Number(line.replace(/\D+/g, "")) : 0;
  };

  const total = kb("MemTotal") * 1024;
  const available = kb("MemAvailable") * 1024;
  if (total <= 0) return null;
  return { used: total - available, total };
}

/** Ổ đĩa qua `df -kP`: cùng con số người quản trị đọc khi gõ tay trên máy chủ. */
function readDisk(): { used: number; total: number } | null {
  try {
    const out = execFileSync("df", ["-kP", DISK_PATH], { encoding: "utf8" });
    const cols = out.trim().split("\n")[1]?.split(/\s+/);
    if (!cols || cols.length < 4) return null;
    return { used: Number(cols[2]) * 1024, total: Number(cols[1]) * 1024 };
  } catch {
    return null;
  }
}

/**
 * Dung lượng bucket: cộng `Size` của mọi object, 1000 khoá một lượt gọi.
 *
 * S3 không có lệnh "cho tôi dung lượng bucket", nên đây là cách duy nhất đo
 * đúng. 367.000 ảnh tính tới 2026-09-22 là khoảng 370 lượt gọi, nên nó chạy
 * theo nhịp riêng chứ không chạy mỗi phút.
 */
async function measureS3(): Promise<{ bytes: number; objects: number } | null> {
  const endpoint = (process.env.S3_ENDPOINT ?? "").replace(/\/+$/, "");
  const region = process.env.S3_REGION ?? "";
  const bucket = process.env.S3_BUCKET ?? "";
  const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? "";
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? "";
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return null;

  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  let bytes = 0;
  let objects = 0;
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
    for (const item of page.Contents ?? []) {
      bytes += item.Size ?? 0;
      objects += 1;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  return { bytes, objects };
}

/* ── Sổ chống gửi trùng ─────────────────────────────────────────────────── */

/**
 * Ghi mốc cảnh báo, trả `true` khi đây là lần ĐẦU của mốc đó.
 *
 * `cooldownMinutes` bằng 0 nghĩa là báo đúng một lần rồi thôi — dùng cho hai
 * mốc của đơn chờ giấy chứng nhận. Khác 0 thì mốc cũ hơn ngần đó phút được
 * báo lại, dùng cho ngưỡng tài nguyên.
 */
async function claimAlert(key: string, cooldownMinutes: number): Promise<boolean> {
  const rows = await db.execute<{ key: string }>(sql`
    insert into ops_alerts (key, at) values (${key}, now())
    on conflict (key) do update set at = now()
      where ${cooldownMinutes}::int > 0
        and ops_alerts.at < now() - ${`${cooldownMinutes} minutes`}::interval
    returning key
  `);
  return rows.rows.length > 0;
}

/* ── Cảnh báo ───────────────────────────────────────────────────────────── */

/** Đơn chờ giấy chứng nhận quá mốc mà chưa báo mốc đó. */
async function certificateAlerts(): Promise<string[]> {
  const rows = await db.execute<{ id: string; order_code: string; minutes: string }>(sql`
    select o.id, o.order_code,
      floor(extract(epoch from now() - coalesce(h.changed_at, o.created_at)) / 60) as minutes
    from insurance_orders o
    left join lateral (
      select max(s.changed_at) as changed_at
      from insurance_order_status_history s
      where s.order_id = o.id and s.to_status = 'awaiting-certificate'
    ) h on true
    where o.status = 'awaiting-certificate'
      and coalesce(h.changed_at, o.created_at) < now() - ${`${OPS_CERT_WARN_MINUTES} minutes`}::interval
    order by minutes desc
    limit 200
  `);

  const lines: string[] = [];
  for (const r of rows.rows) {
    const minutes = Number(r.minutes);
    const mark = minutes >= OPS_CERT_REMIND_MINUTES ? OPS_CERT_REMIND_MINUTES : OPS_CERT_WARN_MINUTES;
    if (await claimAlert(`cert:${r.id}:${mark}`, 0))
      lines.push(`${r.order_code} chờ ${minutes} phút`);
  }
  return lines;
}

/** Tài nguyên quá ngưỡng, mỗi loại một dòng. */
async function resourceAlerts(
  measures: { key: string; label: string; percent: number; detail: string }[],
): Promise<string[]> {
  const lines: string[] = [];
  for (const m of measures) {
    if (m.percent < OPS_RESOURCE_PERCENT) {
      // Về dưới ngưỡng thì xoá mốc: lần vượt sau phải báo ngay, không phải đợi
      // hết thời gian chờ của lần trước.
      await db.execute(sql`delete from ops_alerts where key = ${`res:${m.key}`}`);
      continue;
    }
    if (await claimAlert(`res:${m.key}`, RESOURCE_COOLDOWN_MINUTES))
      lines.push(`${m.label} ${Math.round(m.percent)}% (${m.detail})`);
  }
  return lines;
}

const percentOf = (used: number, total: number): number => (total > 0 ? (used / total) * 100 : 0);

/* ── Một vòng ───────────────────────────────────────────────────────────── */

let lastCpu: CpuSample | null = null;
let lastS3At = 0;

async function runOnce(): Promise<void> {
  const before = lastCpu ?? (await cpuSample());
  if (!before) {
    log("Không đọc được /proc/stat — script này chỉ chạy trên Linux.");
    return;
  }
  // Mẫu đầu tiên chưa có mẫu trước để trừ, nên lấy thêm một mẫu cách 1 giây.
  const after = lastCpu ? await cpuSample() : await new Promise<CpuSample | null>((resolve) =>
    setTimeout(() => cpuSample().then(resolve), 1000),
  );
  if (!after) return;
  lastCpu = after;

  const memory = await readMemory();
  const disk = readDisk();
  if (!memory || !disk) {
    log("Không đọc được RAM hoặc ổ đĩa, bỏ vòng này.");
    return;
  }

  const cpuPercent = cpuPercentBetween(before, after);
  const dueS3 = Date.now() - lastS3At >= S3_EVERY_MINUTES * 60_000;
  const s3 = dueS3 ? await measureS3().catch((e) => {
    log(`Đo S3 hỏng: ${(e as Error).message}`);
    return null;
  }) : null;
  if (s3) lastS3At = Date.now();

  await db.insert(hostMetrics).values({
    cpuPercent: cpuPercent.toFixed(2),
    ramUsed: memory.used,
    ramTotal: memory.total,
    diskUsed: disk.used,
    diskTotal: disk.total,
    s3Bytes: s3?.bytes ?? null,
    s3Objects: s3?.objects ?? null,
    s3At: s3 ? new Date() : null,
  });

  const quotaBytes = Math.max(0, Number(process.env.S3_QUOTA_GB ?? 0)) * 1024 ** 3;
  const lines = [
    ...(await certificateAlerts()),
    ...(await resourceAlerts([
      { key: "cpu", label: "CPU", percent: cpuPercent, detail: `${Math.round(cpuPercent)}%` },
      {
        key: "ram",
        label: "RAM",
        percent: percentOf(memory.used, memory.total),
        detail: `${formatBytes(memory.used)} / ${formatBytes(memory.total)}`,
      },
      {
        key: "disk",
        label: "Ổ đĩa",
        percent: percentOf(disk.used, disk.total),
        detail: `${formatBytes(disk.used)} / ${formatBytes(disk.total)}`,
      },
      // S3 chỉ so được khi biết hạn mức, và chỉ so trên lượt đo mới.
      ...(s3 && quotaBytes > 0
        ? [
            {
              key: "s3",
              label: "S3",
              percent: percentOf(s3.bytes, quotaBytes),
              detail: `${formatBytes(s3.bytes)} / ${formatBytes(quotaBytes)}`,
            },
          ]
        : []),
    ])),
  ];

  if (lines.length > 0) {
    const people = await recipientsFor("system", "view-ops", "ops-alert");
    // Gộp mọi dòng vào MỘT tin: trần một thông báo mỗi vòng, và vòng là 60 giây.
    const sent = await notifyUsers(people, "ops-alert", {
      title: "Cảnh báo vận hành",
      body: lines.slice(0, 5).join(" · ") + (lines.length > 5 ? ` và ${lines.length - 5} mục nữa` : ""),
      url: "/ops",
    });
    log(`Cảnh báo ${lines.length} mục, gửi cho ${sent} người.`);
  }

  await db.execute(sql`delete from host_metrics where at < now() - ${`${KEEP_DAYS} days`}::interval`);
  // Mốc của đơn đã xong không còn ý nghĩa gì, mà mỗi đơn kẹt để lại hai dòng.
  await db.execute(
    sql`delete from ops_alerts where key like 'cert:%' and at < now() - ${`${KEEP_DAYS} days`}::interval`,
  );
}

async function main() {
  const once = process.argv.includes("--mot-vong");
  log(once ? "Chạy một vòng." : `Chạy mỗi ${SLEEP_SECONDS} giây.`);

  let stopping = false;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });

  do {
    try {
      await runOnce();
    } catch (e) {
      log(`Lỗi trong vòng: ${(e as Error).message}`);
    }
    if (once || stopping) break;
    await new Promise((resolve) => setTimeout(resolve, SLEEP_SECONDS * 1000));
  } while (!stopping);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
