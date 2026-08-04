import { compare, hashSync } from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { LOGIN_ERROR } from "@/lib/types";
import { badRequest, createSession, jsonBody } from "@/server/auth";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { loadUser } from "@/server/users";

/**
 * C-01 · Đăng nhập — sai 5 lần liên tiếp khoá 15 phút, quản trị mở lại
 * (mở lại = set locked_until về null ở luồng quản trị, chưa có màn riêng).
 */

const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

const Body = z.object({
  username: z.string(),
  password: z.string(),
  remember: z.boolean().optional(),
});

/**
 * Băm giả để nhánh "không có tài khoản" vẫn tốn thời gian bằng nhánh sai mật
 * khẩu. Thoát sớm thì bcrypt không chạy, và chênh lệch ~80ms đó đủ để dò ra
 * tên đăng nhập nào có thật — đúng thứ mà thông báo lỗi chung đang cố giấu.
 */
const DUMMY_HASH = hashSync("mgst-dummy-password", 10);

export async function POST(request: Request) {
  const parsed = Body.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();
  const { username, password, remember } = parsed.data;

  const key = username.trim().toLowerCase();

  const rows = await db.select().from(users).where(eq(users.username, key)).limit(1);
  const account = rows[0];

  // Không tiết lộ "tên đăng nhập không tồn tại" — kẻ dò tên sẽ biết tên nào có thật.
  if (!account || !account.active) {
    await compare(password, DUMMY_HASH);
    return Response.json(
      {
        code: LOGIN_ERROR.BAD_CREDENTIALS,
        message: "Tên đăng nhập hoặc mật khẩu không đúng.",
      },
      { status: 401 },
    );
  }

  if (account.lockedUntil && account.lockedUntil > new Date()) {
    const minutes = Math.ceil((account.lockedUntil.getTime() - Date.now()) / 60_000);
    return Response.json(
      {
        code: LOGIN_ERROR.LOCKED,
        message: `Tài khoản đang bị khoá. Thử lại sau ${minutes} phút hoặc liên hệ quản trị hệ thống.`,
        lockedUntil: account.lockedUntil.toISOString(),
      },
      { status: 423 },
    );
  }

  const ok = await compare(password, account.passwordHash);

  if (!ok) {
    /**
     * Đếm và khoá trong MỘT câu lệnh.
     *
     * Trước đây `attempts` tính từ bản đọc ở trên, ngoài transaction: bắn N
     * request sai cùng lúc thì cả N đều thấy `failed_attempts` cũ, cả N đều
     * kết luận "chưa tới 5", và không request nào vào nhánh khoá. Bộ đếm leo
     * còn khoá thì không bao giờ nổ — dò mật khẩu không giới hạn.
     */
    const [locked] = await db
      .update(users)
      .set({
        failedAttempts: sql`case when ${users.failedAttempts} + 1 >= ${MAX_ATTEMPTS} then 0 else ${users.failedAttempts} + 1 end`,
        lockedUntil: sql`case when ${users.failedAttempts} + 1 >= ${MAX_ATTEMPTS} then now() + interval '${sql.raw(String(LOCK_MS / 60000))} minutes' else ${users.lockedUntil} end`,
      })
      .where(eq(users.id, account.id))
      .returning({ lockedUntil: users.lockedUntil });

    if (locked?.lockedUntil && locked.lockedUntil > new Date()) {
      return Response.json(
        {
          code: LOGIN_ERROR.LOCKED,
          message:
            "Sai 5 lần liên tiếp — tài khoản bị khoá 15 phút. Liên hệ quản trị hệ thống để mở lại.",
          lockedUntil: locked.lockedUntil.toISOString(),
        },
        { status: 423 },
      );
    }

    // KHÔNG trả `attemptsLeft`: trường này chỉ xuất hiện khi tài khoản có thật,
    // nên chỉ một request là biết tên nào tồn tại — phá đúng ý định giấu tên ở
    // nhánh trên. Số lần còn lại chỉ có ý nghĩa với chủ tài khoản, mà chủ tài
    // khoản thì thấy thông báo khoá khi chạm ngưỡng.
    return Response.json(
      {
        code: LOGIN_ERROR.BAD_CREDENTIALS,
        message: "Tên đăng nhập hoặc mật khẩu không đúng.",
      },
      { status: 401 },
    );
  }

  await db
    .update(users)
    .set({ failedAttempts: 0, lockedUntil: null })
    .where(eq(users.id, account.id));

  // Dựng User TRƯỚC khi phát cookie: `loadUser` trả null được (hàng vừa bị xoá
  // giữa chừng), mà `Response.json` nhận any nên TypeScript không chặn. Phát
  // cookie rồi mới thiếu user thì client ôm phiên sống cho một tài khoản mà
  // giao diện chưa từng biết, và zod phía client ném lỗi không ai bắt.
  const user = await loadUser(account.id);
  if (!user) return new Response(null, { status: 500 });

  const { cookie, expiresAt } = await createSession(account.id, Boolean(remember));

  return Response.json(
    { user, expiresAt: expiresAt.toISOString() },
    { headers: { "Set-Cookie": cookie } },
  );
}
