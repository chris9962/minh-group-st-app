import { compare } from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { LOGIN_ERROR } from "@/lib/types";
import { createSession } from "@/server/auth";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { loadUser } from "@/server/users";

/**
 * C-01 · Đăng nhập — sai 5 lần liên tiếp khoá 15 phút, quản trị mở lại
 * (mở lại = set locked_until về null ở luồng quản trị, chưa có màn riêng).
 */

const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  const { username, password, remember } = (await request.json()) as {
    username?: string;
    password?: string;
    remember?: boolean;
  };

  const key = (username ?? "").trim().toLowerCase();

  const rows = await db.select().from(users).where(eq(users.username, key)).limit(1);
  const account = rows[0];

  // Không tiết lộ "tên đăng nhập không tồn tại" — kẻ dò tên sẽ biết tên nào có thật.
  if (!account || !account.active) {
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

  const ok = await compare(password ?? "", account.passwordHash);

  if (!ok) {
    const attempts = account.failedAttempts + 1;

    if (attempts >= MAX_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCK_MS);
      await db
        .update(users)
        .set({ failedAttempts: 0, lockedUntil })
        .where(eq(users.id, account.id));
      return Response.json(
        {
          code: LOGIN_ERROR.LOCKED,
          message:
            "Sai 5 lần liên tiếp — tài khoản bị khoá 15 phút. Liên hệ quản trị hệ thống để mở lại.",
          lockedUntil: lockedUntil.toISOString(),
        },
        { status: 423 },
      );
    }

    await db
      .update(users)
      .set({ failedAttempts: sql`${users.failedAttempts} + 1` })
      .where(eq(users.id, account.id));
    return Response.json(
      {
        code: LOGIN_ERROR.BAD_CREDENTIALS,
        message: "Tên đăng nhập hoặc mật khẩu không đúng.",
        attemptsLeft: MAX_ATTEMPTS - attempts,
      },
      { status: 401 },
    );
  }

  await db
    .update(users)
    .set({ failedAttempts: 0, lockedUntil: null })
    .where(eq(users.id, account.id));

  const user = await loadUser(account.id);
  const { cookie, expiresAt } = await createSession(account.id, Boolean(remember));

  return Response.json(
    { user, expiresAt: expiresAt.toISOString() },
    { headers: { "Set-Cookie": cookie } },
  );
}
