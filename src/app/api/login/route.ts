import { compare, hashSync } from "bcryptjs";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
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

  const LOCKED_MESSAGE =
    "Sai 5 lần liên tiếp — tài khoản bị khoá 15 phút. Liên hệ quản trị hệ thống để mở lại.";

  /** Đọc mốc hết khoá từ DB rồi báo 423 — không tự sửa gì. */
  const reportLock = async (message: string) => {
    const [row] = await db
      .select({ lockedUntil: users.lockedUntil })
      .from(users)
      .where(eq(users.id, account.id))
      .limit(1);
    const until = row?.lockedUntil ?? new Date(Date.now() + LOCK_MS);
    return Response.json(
      { code: LOGIN_ERROR.LOCKED, message, lockedUntil: until.toISOString() },
      { status: 423 },
    );
  };

  /** Khoá hàng lại. Bộ đếm về 0 để hết 15 phút là có đủ 5 lượt mới. */
  const lockNow = async () => {
    const [row] = await db
      .update(users)
      .set({
        failedAttempts: 0,
        lockedUntil: sql`now() + interval '${sql.raw(String(LOCK_MS / 60000))} minutes'`,
      })
      .where(eq(users.id, account.id))
      .returning({ lockedUntil: users.lockedUntil });
    const until = row?.lockedUntil ?? new Date(Date.now() + LOCK_MS);
    return Response.json(
      { code: LOGIN_ERROR.LOCKED, message: LOCKED_MESSAGE, lockedUntil: until.toISOString() },
      { status: 423 },
    );
  };

  /**
   * Nhận MỘT lượt thử, nguyên tử, TRƯỚC khi băm.
   *
   * Gác bằng `account` đọc ở trên là gác trên ảnh chụp cũ: bắn N request cùng
   * lúc thì cả N đều thấy `locked_until` rỗng, cả N đều lọt xuống `compare`, và
   * cả N mật khẩu đều thật sự được thử — khoá 5 lần chỉ chặn được người thử
   * tuần tự. Tăng bộ đếm bằng một câu lệnh nguyên tử trước khi băm thì mỗi
   * request nhận một số thứ tự riêng, và cái vượt ngưỡng bị chặn mà KHÔNG tốn
   * lần băm nào. Đó mới là thứ giới hạn số mật khẩu được thử mỗi 15 phút.
   */
  const stillOpen = or(isNull(users.lockedUntil), lte(users.lockedUntil, sql`now()`));

  const [slot] = await db
    .update(users)
    .set({ failedAttempts: sql`${users.failedAttempts} + 1` })
    .where(and(eq(users.id, account.id), stillOpen))
    .returning({ attempts: users.failedAttempts });

  // Không giành được lượt nào = hàng đang khoá.
  if (!slot) {
    const [row] = await db
      .select({ lockedUntil: users.lockedUntil })
      .from(users)
      .where(eq(users.id, account.id))
      .limit(1);
    const until = row?.lockedUntil ?? new Date(Date.now() + LOCK_MS);
    const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
    return reportLock(
      `Tài khoản đang bị khoá. Thử lại sau ${minutes} phút hoặc liên hệ quản trị hệ thống.`,
    );
  }

  // Quá ngưỡng mà hàng chưa kịp khoá — cả đợt bắn cùng lúc còn đang băm. Khoá
  // ngay và không băm: đây chính là chỗ chặn kiểu tấn công đó.
  if (slot.attempts > MAX_ATTEMPTS) return lockNow();

  const ok = await compare(password, account.passwordHash);

  if (!ok) {
    if (slot.attempts >= MAX_ATTEMPTS) return lockNow();

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

  // Xoá bộ đếm, nhưng CHỈ khi hàng chưa bị khoá trong lúc mình đang băm. Xoá
  // vô điều kiện thì lần đoán trúng trong một đợt bắn song song vừa lấy được
  // phiên vừa gỡ luôn khoá vừa đặt.
  const [cleared] = await db
    .update(users)
    .set({ failedAttempts: 0, lockedUntil: null })
    .where(and(eq(users.id, account.id), stillOpen))
    .returning({ id: users.id });

  if (!cleared) return reportLock(LOCKED_MESSAGE);

  // Dựng User TRƯỚC khi phát cookie: `loadUser` trả null được (hàng vừa bị xoá
  // giữa chừng), mà `Response.json` nhận any nên TypeScript không chặn. Phát
  // cookie rồi mới thiếu user thì client ôm phiên sống cho một tài khoản mà
  // giao diện chưa từng biết, và zod phía client ném lỗi không ai bắt.
  const user = await loadUser(account.id);
  if (!user)
    return Response.json(
      {
        code: LOGIN_ERROR.BAD_CREDENTIALS,
        message: "Không đăng nhập được, thử lại sau ít phút.",
      },
      { status: 500 },
    );

  const { cookie, expiresAt } = await createSession(account.id, Boolean(remember));

  return Response.json(
    { user, expiresAt: expiresAt.toISOString() },
    { headers: { "Set-Cookie": cookie } },
  );
}
