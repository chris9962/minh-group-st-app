import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

/**
 * Đọc chữ trong một ảnh — CHỈ CHẠY Ở MÁY CHỦ.
 *
 * Tầng này không biết ảnh của ngân hàng nào, không tiền xử lý, không nhận màn.
 * Nó đưa ảnh cho `scripts/ocr-server.py` (PaddleOCR dò vùng + VietOCR đọc) và
 * trả về danh sách dòng chữ theo thứ tự trên xuống, trái sang. So với hệ
 * thống là việc của `banks/<mã>.ts`.
 *
 * Tiến trình Python mở ở lượt gọi đầu rồi giữ suốt: nạp model mất khoảng 4
 * giây, mở lại mỗi ảnh thì mỗi ảnh tốn thêm chừng đó. Một tiến trình đọc MỘT
 * ảnh một lúc, nên `OCR_PROCESSES` mở nhiều tiến trình song song (chốt
 * 2026-09-22). Mỗi tiến trình một hàng chờ riêng; lượt mới vào hàng ngắn nhất.
 *
 * Số tiến trình là trần tốc độ thật. Tăng `OCR_THREADS` chỉ chia nhỏ việc
 * TRONG một ảnh nên được ít, còn thêm tiến trình thì mỗi tiến trình đọc một
 * ảnh khác nhau. Đổi lại mỗi tiến trình giữ một bộ model trong RAM, đo trên
 * máy chủ 2026-09-22 khoảng 0,9 GB, nên `OCR_PROCESSES` phải đi cùng
 * `--cpus` và `--memory` của container — xem `deploy/worker-photo.sh`. Lượt
 * MSBb đầu tiên nạp thêm `vgg_seq2seq`: đo ở máy local 2026-09-25, RAM mỗi
 * tiến trình tăng từ 1,9 GB lên 2,3 GB.
 *
 * Tiến trình chết giữa chừng: lượt đang đọc ném lỗi, lượt sau tự mở lại, và
 * chỉ tiến trình đó mở lại chứ không kéo theo các tiến trình còn lại. Mở
 * không được (thiếu python, thiếu thư viện) thì ném lỗi để lượt kiểm ghi
 * `failed` kèm lý do, không trả chuỗi rỗng.
 *
 * Biến môi trường: `OCR_PROCESSES` (mặc định 1), `OCR_PYTHON` (mặc định
 * `python3`), `OCR_SERVER` (mặc định `scripts/ocr-server.py` cạnh mã nguồn).
 * Các biến `OCR_*` khác đi thẳng xuống tiến trình Python, xem đầu file đó.
 */

type Reply = { lines?: string[]; ms?: number; error?: string; ready?: boolean };

/** Model VietOCR đọc vùng chữ, khoá `REC_MODELS` trong `ocr-server.py`. */
export type OcrModel = "transformer" | "seq2seq";

type Server = {
  child: ChildProcessByStdio<Writable, Readable, null>;
  /** Lượt đang chờ trả lời; một lúc chỉ một. */
  waiting: ((reply: Reply) => void) | null;
  /** Lỗi làm tiến trình chết, để lượt đang chờ và lượt sau biết vì sao. */
  died: Error | null;
};

/** Một tiến trình Python cùng hàng chờ của riêng nó. */
type Lane = {
  server: Promise<Server> | null;
  queue: Promise<unknown>;
  /** Số lượt đang xếp ở đây, để lượt mới chọn hàng ngắn nhất. */
  pending: number;
};

// Số hỏng hay bằng 0 thì về 1: một tiến trình vẫn chạy được, không tiến trình
// nào thì mọi lượt kiểm ảnh treo mà container vẫn Up.
const POOL_SIZE = Math.max(1, Math.trunc(Number(process.env.OCR_PROCESSES)) || 1);
const pool: Lane[] = Array.from({ length: POOL_SIZE }, () => ({
  server: null,
  queue: Promise.resolve(),
  pending: 0,
}));

async function start(lane: Lane): Promise<Server> {
  const python = process.env.OCR_PYTHON ?? "python3";
  const script = process.env.OCR_SERVER ?? path.join(process.cwd(), "scripts", "ocr-server.py");
  const child = spawn(python, [script], { stdio: ["pipe", "pipe", "inherit"] });
  const state: Server = { child, waiting: null, died: null };
  // Ghi vào stdin của tiến trình vừa chết là EPIPE; sự kiện `exit` bên dưới đã lo phần báo lỗi.
  child.stdin.on("error", () => undefined);

  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let reply: Reply;
    try {
      reply = JSON.parse(line) as Reply;
    } catch {
      return;
    }
    const waiting = state.waiting;
    state.waiting = null;
    waiting?.(reply);
  });

  const ready = new Promise<Server>((resolve, reject) => {
    state.waiting = (reply) => (reply.ready ? resolve(state) : reject(new Error(reply.error ?? "OCR không sẵn sàng")));
    child.once("error", (e) => reject(new Error(`Không mở được OCR (${python} ${script}): ${e.message}`)));
    child.once("exit", (code, signal) => {
      state.died = new Error(`Tiến trình OCR thoát (${signal ?? code}).`);
      reject(state.died);
      state.waiting?.({ error: state.died.message });
      state.waiting = null;
      // Lượt sau mở lại từ đầu.
      lane.server = null;
    });
  });
  return ready;
}

async function ask(lane: Lane, image: Buffer, model: OcrModel): Promise<string[]> {
  if (!lane.server) lane.server = start(lane).catch((e) => {
    lane.server = null;
    throw e;
  });
  const s = await lane.server;
  if (s.died) throw s.died;

  const dir = await mkdtemp(path.join(tmpdir(), "mgst-ocr-"));
  const file = path.join(dir, "anh.webp");
  try {
    await writeFile(file, image);
    const reply = await new Promise<Reply>((resolve) => {
      s.waiting = resolve;
      s.child.stdin.write(JSON.stringify({ path: file, model }) + "\n");
    });
    if (reply.error) throw new Error(`OCR lỗi: ${reply.error}`);
    return reply.lines ?? [];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Các dòng chữ trong ảnh, đã bỏ dòng rỗng. Lỗi ném ra, không trả rỗng.
 *
 * Chọn hàng NGẮN NHẤT chứ không chia vòng tròn: ảnh dài ngắn khác nhau tới
 * vài giây, chia vòng tròn thì một hàng đọng lại trong khi hàng khác rỗi.
 */
export function ocrLines(image: Buffer, model: OcrModel = "transformer"): Promise<string[]> {
  const lane = pool.reduce((min, l) => (l.pending < min.pending ? l : min));
  lane.pending += 1;
  const turn = lane.queue.then(() => ask(lane, image, model));
  lane.queue = turn.catch(() => undefined).finally(() => {
    lane.pending -= 1;
  });
  return turn;
}

/** Đóng mọi tiến trình Python, gọi khi worker dừng. */
export async function closeOcr(): Promise<void> {
  await Promise.all(
    pool.map(async (lane) => {
      const s = await lane.server?.catch(() => null);
      lane.server = null;
      s?.child.stdin.end();
    }),
  );
}
