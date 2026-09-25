/**
 * Lệnh của bot Zalo. Tin nhắn mở đầu bằng `/` mới là lệnh, tin khác bot bỏ qua.
 *
 * Hàm thuần: nhận chữ, trả câu trả lời. Không import zca-js để thêm lệnh mới
 * không phải đụng tới worker.
 */

export const ZALO_COMMAND_PREFIX = "/";

export type ZaloCommandContext = {
  threadId: string;
  isGroup: boolean;
};

type ZaloCommand = {
  name: string;
  help: string;
  run: (ctx: ZaloCommandContext, args: string) => string;
};

const COMMANDS: ZaloCommand[] = [
  { name: "ping", help: "Kiểm tra bot còn chạy", run: () => "pong" },
  {
    name: "id",
    help: "Xem Thread ID của cuộc trò chuyện này",
    run: (ctx) => `Thread ID: ${ctx.threadId}\nLoại: ${ctx.isGroup ? "Nhóm" : "Cá nhân"}`,
  },
  {
    name: "help",
    help: "Xem danh sách lệnh",
    run: () => COMMANDS.map((c) => `${ZALO_COMMAND_PREFIX}${c.name}: ${c.help}`).join("\n"),
  },
];

/** Câu trả lời cho một tin nhắn, `null` khi tin đó không phải lệnh bot biết. */
export function replyToCommand(text: string, ctx: ZaloCommandContext): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(ZALO_COMMAND_PREFIX)) return null;

  const [head = "", ...rest] = trimmed.slice(ZALO_COMMAND_PREFIX.length).split(/\s+/);
  const command = COMMANDS.find((c) => c.name === head.toLowerCase());
  return command ? command.run(ctx, rest.join(" ")) : null;
}
