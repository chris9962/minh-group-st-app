import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** Paddle chỉ chạy khi môi trường Python và hai model đã chuẩn bị sẵn tại máy. */
const python = () => process.env.PADDLE_OCR_PYTHON || path.join(process.cwd(), ".paddle-ocr/venv/bin/python");
const cache = () => process.env.PADDLE_OCR_CACHE_HOME || path.join(process.cwd(), ".paddle-ocr/cache");

/**
 * TẮT mặc định. Lượt đọc lại bằng Paddle chỉ bật khi đặt `PHOTO_CHECK_PADDLE=1`.
 *
 * Có model trên máy không đồng nghĩa muốn dùng: máy local đã cài để đo, mà kết
 * quả kiểm ảnh phải giống nhau ở local và máy chủ thì mới so được.
 */
export const paddleAvailable = (): boolean =>
  process.env.PHOTO_CHECK_PADDLE === "1" &&
  existsSync(python()) &&
  existsSync(path.join(cache(), "official_models/PP-OCRv6_medium_det")) &&
  existsSync(path.join(cache(), "official_models/PP-OCRv6_medium_rec")) &&
  existsSync(path.join(process.cwd(), "scripts/paddle-ocr.py"));

/** Một tiến trình Paddle tại một thời điểm để không làm nghẽn CPU/RAM worker. */
let queue: Promise<unknown> = Promise.resolve();

export function ocrWithPaddle(images: Buffer[]): Promise<string[][]> {
  const task = queue.then(() => runPaddle(images));
  queue = task.catch(() => undefined);
  return task;
}

function runPaddle(images: Buffer[]): Promise<string[][]> {
  if (!paddleAvailable()) return Promise.reject(new Error("PaddleOCR chưa cài model hoặc Python tại máy worker."));
  if (images.length < 1 || images.length > 8) return Promise.reject(new Error("Chỉ đọc tối đa 8 ảnh bằng PaddleOCR."));
  return new Promise((resolve, reject) => {
    const child = spawn(python(), [path.join(process.cwd(), "scripts/paddle-ocr.py")], {
      env: { ...process.env, PADDLE_PDX_CACHE_HOME: cache() },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    const finish = (error?: Error, texts?: string[][]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(texts ?? []);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("PaddleOCR quá thời gian đọc ảnh."));
    }, 30_000 + images.length * 35_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 2_000_000) {
        child.kill();
        finish(new Error("PaddleOCR trả quá nhiều dữ liệu."));
      }
    });
    // Bun cần consumer cụ thể để drain stderr; `resume()` một mình có thể làm
    // tiến trình Python kẹt vì pipe đầy sau khi in thông báo nạp model.
    child.stderr.on("data", () => {});
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code !== 0) return finish(new Error(`PaddleOCR thoát với mã ${code}.`));
      const marker = "MGST_PADDLE_JSON:";
      const at = output.lastIndexOf(marker);
      if (at < 0) return finish(new Error("PaddleOCR không trả dữ liệu kết quả."));
      try {
        const value: unknown = JSON.parse(output.slice(at + marker.length).trim());
        if (!Array.isArray(value) || value.length !== images.length ||
            !value.every((lines) => Array.isArray(lines) && lines.every((line) => typeof line === "string"))) {
          throw new Error("PaddleOCR trả sai cấu trúc kết quả.");
        }
        finish(undefined, value as string[][]);
      } catch {
        finish(new Error("PaddleOCR trả JSON không hợp lệ."));
      }
    });
    // `paddleAvailable()` chỉ kiểm file có tồn tại, không kiểm `import` chạy
    // được. Thiếu gói thì Python thoát trước lúc đọc stdin, và ghi vài MB vào
    // pipe đã đóng sinh EPIPE. Không bắt ở đây thì sự kiện lỗi làm sập worker.
    child.stdin.on("error", (error) => finish(error));
    child.stdin.end(JSON.stringify(images.map((image) => image.toString("base64"))));
  });
}
