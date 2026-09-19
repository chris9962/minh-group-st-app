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
 * Tiến trình Python mở MỘT LẦN ở lượt gọi đầu rồi giữ suốt: nạp model mất
 * khoảng 4 giây, mở lại mỗi ảnh thì mỗi ảnh tốn thêm chừng đó. Các lượt gọi
 * xếp hàng, một ảnh một lúc; song song thì mở thêm tiến trình, chưa cần.
 *
 * Tiến trình chết giữa chừng: lượt đang đọc ném lỗi, lượt sau tự mở lại. Mở
 * không được (thiếu python, thiếu thư viện) thì ném lỗi để lượt kiểm ghi
 * `failed` kèm lý do, không trả chuỗi rỗng.
 *
 * Biến môi trường: `OCR_PYTHON` (mặc định `python3`), `OCR_SERVER`
 * (mặc định `scripts/ocr-server.py` cạnh mã nguồn). Các biến `OCR_*` khác
 * đi thẳng xuống tiến trình Python, xem đầu file đó.
 */

type Reply = { lines?: string[]; ms?: number; error?: string; ready?: boolean };

type Server = {
  child: ChildProcessByStdio<Writable, Readable, null>;
  /** Lượt đang chờ trả lời; một lúc chỉ một. */
  waiting: ((reply: Reply) => void) | null;
  /** Lỗi làm tiến trình chết, để lượt đang chờ và lượt sau biết vì sao. */
  died: Error | null;
};

let server: Promise<Server> | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function start(): Promise<Server> {
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
      server = null;
    });
  });
  return ready;
}

async function ask(image: Buffer): Promise<string[]> {
  if (!server) server = start().catch((e) => {
    server = null;
    throw e;
  });
  const s = await server;
  if (s.died) throw s.died;

  const dir = await mkdtemp(path.join(tmpdir(), "mgst-ocr-"));
  const file = path.join(dir, "anh.webp");
  try {
    await writeFile(file, image);
    const reply = await new Promise<Reply>((resolve) => {
      s.waiting = resolve;
      s.child.stdin.write(JSON.stringify({ path: file }) + "\n");
    });
    if (reply.error) throw new Error(`OCR lỗi: ${reply.error}`);
    return reply.lines ?? [];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Các dòng chữ trong ảnh, đã bỏ dòng rỗng. Lỗi ném ra, không trả rỗng. */
export function ocrLines(image: Buffer): Promise<string[]> {
  const turn = queue.then(() => ask(image));
  queue = turn.catch(() => undefined);
  return turn;
}

/** Đóng tiến trình Python, gọi khi worker dừng. */
export async function closeOcr(): Promise<void> {
  const s = await server?.catch(() => null);
  server = null;
  s?.child.stdin.end();
}
