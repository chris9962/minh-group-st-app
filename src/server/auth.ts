import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "./db/client";
import { sessions, users } from "./db/schema";
import { relationsFor, toUser } from "./users";
import { can } from "@/lib/permissions";
import type { Action, ModuleKey, User } from "@/lib/types";

/**
 * Phiên đăng nhập phía máy chủ (C-01): cookie httpOnly mang token trần,
 * DB chỉ giữ băm sha256 — lộ bản sao DB không lấy được token đang sống.
 *
 * Actor của MỌI request lấy từ đây. `actorId` client gửi kèm (di sản thời
 * mock): BỎ QUA hoàn toàn — không tin định danh tự khai.
 */

export const SESSION_COOKIE = "mgst_session";

const ONE_MONTH_S = 30 * 24 * 60 * 60;
const ONE_YEAR_S = 365 * 24 * 60 * 60;

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/**
 * `Secure` — cookie chỉ đi trên https.
 *
 * Thiếu nó thì dù trang chạy https, trình duyệt VẪN gửi token kèm bất kỳ URL
 * `http://` nào cùng host (một đường dẫn cũ, một thẻ ảnh ai đó chèn vào), và ai
 * ngồi giữa đường truyền nhặt được phiên sống tới cả năm. `SameSite` không thay
 * được: nó chặn theo site, không chặn theo giao thức.
 *
 * Tắt ở dev vì `http://localhost`. Có `COOKIE_SECURE=false` để chạy thật trong
 * mạng nội bộ không có https — buộc theo `NODE_ENV` thôi thì hôm đó đăng nhập
 * hỏng mà không ai đoán ra vì sao.
 */
const SECURE =
  process.env.COOKIE_SECURE === "false"
    ? ""
    : process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true"
      ? "; Secure"
      : "";

export async function createSession(
  userId: string,
  remember: boolean,
): Promise<{ cookie: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const maxAge = remember ? ONE_YEAR_S : ONE_MONTH_S;
  const expiresAt = new Date(Date.now() + maxAge * 1000);

  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    remember,
    expiresAt,
  });

  const cookie = `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${SECURE}; Max-Age=${maxAge}`;
  return { cookie, expiresAt };
}

/** Xoá phiên hiện tại; cookie trả về đã hết hạn để trình duyệt bỏ luôn. */
export async function destroySession(request: Request): Promise<string> {
  const token = tokenFrom(request);
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${SECURE}; Max-Age=0`;
}

function tokenFrom(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return null;
}

/** Người đang đăng nhập — null khi không có phiên hợp lệ (route trả 401). */
export async function getActor(request: Request): Promise<User | null> {
  const token = tokenFrom(request);
  if (!token) return null;

  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row || !row.user.active) return null;

  const { permissionsOf, managedOf } = await relationsFor([row.user.id]);
  return toUser(
    row.user,
    permissionsOf.get(row.user.id) ?? [],
    managedOf.get(row.user.id) ?? [],
  );
}

/**
 * Gác chung: phải có phiên VÀ đúng quyền.
 *
 * Cùng hình dạng `staffTargetFor` để mọi route đọc như nhau, và để không route
 * nào tự chế một kiểu gác riêng rồi quên một vế (AGENTS.md §6).
 */
export async function actorWith(
  request: Request,
  module: ModuleKey,
  action: Action,
): Promise<{ ok: true; actor: User } | { ok: false; response: Response }> {
  const actor = await getActor(request);
  if (!actor) return { ok: false, response: unauthorized() };
  if (!can(actor, module, action)) return { ok: false, response: forbidden() };
  return { ok: true, actor };
}

export const unauthorized = () =>
  Response.json({ message: "Chưa đăng nhập hoặc phiên đã hết hạn" }, { status: 401 });

export const forbidden = () =>
  Response.json({ message: "Bạn không có quyền thực hiện thao tác này" }, { status: 403 });

export const badRequest = (message = "Dữ liệu không hợp lệ") =>
  Response.json({ message }, { status: 400 });

/**
 * 404 cho bản ghi ngoài tầm nhìn, KHÔNG phải 403.
 *
 * 403 xác nhận "id này có thật, chỉ là bạn không được xem" — đủ để dò ra danh
 * sách id hợp lệ. Ngoài tầm và không tồn tại phải trả lời giống hệt nhau.
 */
export const notFound = () => new Response(null, { status: 404 });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Chặn id sai dạng TRƯỚC khi vào SQL: Postgres ném lỗi cast uuid, Next bắt được
 * thì đã thành 500 — trong khi đúng ra chỉ là "không có bản ghi này".
 */
export const isUuid = (id: string): boolean => UUID.test(id);

/** Đọc JSON an toàn — body rỗng hoặc không phải JSON thì trả null, không ném. */
export const jsonBody = async (request: Request): Promise<unknown> =>
  request.json().catch(() => null);
