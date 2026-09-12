import { and, asc, desc, eq, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import {
  PHOTO_CHECK_LABEL,
  PhotoCheckFilter,
  PhotoCheckResult,
  type PhotoCheck,
  type PhotoCheckItem,
  type PhotoCheckStatus,
} from "@/lib/api/photoCheck";
import { db } from "./db/client";
import {
  bankAccountChecks,
  bankAccountPhotos,
  bankAccounts,
  banks,
  customers,
  referralCodes,
} from "./db/schema";
import { notify } from "./notifications";
import { checkTpbank, type TpbCheckContext } from "./ocr/banks/tpbank";
import { ocrImage } from "./ocr/image";
import { readImage } from "./storage";

/**
 * Kiểm ảnh chứng minh tài khoản ngân hàng bằng OCR (chốt 2026-09-11).
 *
 * Hai nửa: nửa ghi hàng chờ chạy trong app lúc nhân viên hoàn thành hay đổi
 * ảnh (`enqueuePhotoCheck`), nửa xử lý chạy trong worker riêng
 * (`scripts/photo-check-worker.ts` gọi `runPhotoCheck`). Tách vì Tesseract mất
 * khoảng 1 giây một ảnh, không để nhân viên đợi ở nút Hoàn thành.
 *
 * Kết quả chỉ để GỢI Ý cho người duyệt. Không tự đổi `bank_accounts.status`.
 */

export const PHOTO_CHECK_CHANNEL = "bank_photo_check";

type Checker = (texts: string[], ctx: TpbCheckContext) => PhotoCheckItem[];

/** Ngân hàng đã có bộ nhãn, khoá là `banks.code`. Thêm ngân hàng là thêm một dòng. */
const CHECKERS: Record<string, Checker> = {
  TPB: checkTpbank,
};

export const hasPhotoChecker = (bankCode: string): boolean => bankCode in CHECKERS;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Ghi một dòng chờ kiểm cho tài khoản, trong transaction của nơi gọi.
 *
 * Bỏ qua khi ngân hàng chưa có bộ nhãn, hoặc đã có dòng `pending` chưa chạy:
 * worker đọc ảnh lúc nó chạy nên một dòng chờ là đủ cho mọi lượt đổi ảnh dồn
 * trước đó. `pg_notify` trong transaction thì Postgres chỉ phát khi commit, nên
 * worker không bao giờ dậy trước lúc dòng có thật.
 */
export async function enqueuePhotoCheck(tx: Tx, accountId: string): Promise<void> {
  const [row] = await tx
    .select({ bankCode: banks.code, status: bankAccounts.status })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .where(eq(bankAccounts.id, accountId))
    .limit(1);
  if (!row || !hasPhotoChecker(row.bankCode) || row.status === "creating") return;

  const [waiting] = await tx
    .select({ id: bankAccountChecks.id })
    .from(bankAccountChecks)
    .where(and(eq(bankAccountChecks.accountId, accountId), eq(bankAccountChecks.status, "pending")))
    .limit(1);
  if (waiting) return;

  await tx.insert(bankAccountChecks).values({ accountId });
  await tx.execute(sql`select pg_notify(${PHOTO_CHECK_CHANNEL}, '')`);
}

/**
 * Câu con "lượt kiểm mới nhất" để `leftJoinLateral` vào một trang tài khoản:
 * một lượt tra chỉ mục `bank_account_checks_account_time` cho mỗi dòng của
 * trang, không phải phép gộp trên cả bảng (AGENTS.md §5.2 cách A).
 */
export const latestPhotoCheck = (accountId: SQLWrapper) =>
  db
    .select({
      status: bankAccountChecks.status,
      result: bankAccountChecks.result,
      error: bankAccountChecks.error,
      checkedAt: bankAccountChecks.checkedAt,
      passed: bankAccountChecks.passed,
      total: bankAccountChecks.total,
    })
    .from(bankAccountChecks)
    .where(eq(bankAccountChecks.accountId, accountId))
    .orderBy(desc(bankAccountChecks.createdAt))
    .limit(1)
    .as("photo_check");

/**
 * Điều kiện lọc theo lượt kiểm MỚI NHẤT của từng tài khoản, đặt trong `where`
 * của `bank_accounts`. Một lượt tra chỉ mục `bank_account_checks_account_time`
 * cho mỗi dòng Postgres xét; giá trị lạ hay rỗng = không lọc.
 */
export function photoCheckFilter(raw: string): SQL | undefined {
  const parsed = PhotoCheckFilter.safeParse(raw);
  if (!parsed.success) return undefined;
  const latest = sql`(
    select c.status = 'done' and ${parsed.data === "fail" ? sql`c.passed < c.total` : sql`c.total > 0 and c.passed = c.total`}
    from ${bankAccountChecks} c
    where c.account_id = ${bankAccounts.id}
    order by c.created_at desc
    limit 1
  )`;
  return sql`${latest} is true`;
}

/** Dòng lateral sang hợp đồng `PhotoCheck`; mọi cột null = chưa có lượt nào. */
export function toPhotoCheck(row: {
  status: PhotoCheckStatus | null;
  result: unknown;
  error: string | null;
  checkedAt: Date | null;
  passed: number | null;
  total: number | null;
}): PhotoCheck | null {
  if (!row.status) return null;
  const parsed = PhotoCheckResult.safeParse(row.result);
  return {
    status: row.status,
    checkedAt: row.checkedAt?.toISOString() ?? "",
    error: row.error ?? "",
    items: parsed.success ? parsed.data.items : [],
    passed: row.passed ?? 0,
    total: row.total ?? 0,
  };
}

/* ── Nửa worker ───────────────────────────────────────────────────────── */

async function imageBuffer(key: string): Promise<Buffer | null> {
  const stored = await readImage(key);
  if (!stored) return null;
  if (stored.body instanceof ArrayBuffer) return Buffer.from(stored.body);
  return Buffer.from(await new Response(stored.body).arrayBuffer());
}

export type PhotoCheckRun = {
  checkId: string;
  accountId: string;
  /** Xong mà có dòng không đạt thì báo nhân viên tạo tài khoản không. */
  notify: boolean;
};

/** Dòng `pending` cũ nhất, tối đa `limit`. */
export async function pendingPhotoChecks(limit: number): Promise<PhotoCheckRun[]> {
  const rows = await db
    .select({
      checkId: bankAccountChecks.id,
      accountId: bankAccountChecks.accountId,
      notify: bankAccountChecks.notify,
    })
    .from(bankAccountChecks)
    .where(eq(bankAccountChecks.status, "pending"))
    .orderBy(asc(bankAccountChecks.createdAt))
    .limit(limit);
  return rows;
}

/**
 * Chạy MỘT lượt kiểm: đọc ảnh từ kho, OCR, so với hệ thống, ghi kết quả.
 *
 * Lỗi ném ra ngoài để worker ghi `failed` kèm lý do; không thử lại tự động,
 * vì lỗi ở đây là lỗi máy mình (thiếu tesseract, kho ảnh không đọc được), thử
 * lại cũng ra y vậy. Nhân viên đổi ảnh thì có lượt mới.
 */
export async function runPhotoCheck(run: PhotoCheckRun): Promise<PhotoCheckItem[]> {
  const [account] = await db
    .select({
      bankCode: banks.code,
      accountNumber: bankAccounts.accountNumber,
      customerName: customers.fullName,
      referralCode: referralCodes.code,
    })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
    .innerJoin(referralCodes, eq(referralCodes.id, bankAccounts.referralCodeId))
    .where(eq(bankAccounts.id, run.accountId))
    .limit(1);
  if (!account) throw new Error("Tài khoản không còn.");

  const check = CHECKERS[account.bankCode];
  if (!check) throw new Error(`Ngân hàng ${account.bankCode} chưa có bộ nhãn OCR.`);

  // Cả ảnh mở tài khoản lẫn ảnh giao dịch: nhân viên hay nộp màn chuyển khoản
  // vào nhóm nào cũng có, bộ kiểm tự nhận ra từng màn.
  const photos = await db
    .select({ key: bankAccountPhotos.url })
    .from(bankAccountPhotos)
    .where(eq(bankAccountPhotos.accountId, run.accountId))
    .orderBy(asc(bankAccountPhotos.kind), asc(bankAccountPhotos.sortOrder));

  const texts: string[] = [];
  for (const { key } of photos) {
    const image = await imageBuffer(key);
    if (!image) throw new Error(`Không đọc được ảnh ${key} từ kho.`);
    texts.push(await ocrImage(image));
  }

  return check(texts, {
    referralCode: account.referralCode ?? "",
    customerName: account.customerName,
    accountNumber: account.accountNumber ?? "",
  });
}

export async function finishPhotoCheck(run: PhotoCheckRun, items: PhotoCheckItem[]): Promise<void> {
  const failing = items.filter((i) => i.verdict !== "pass");
  await db
    .update(bankAccountChecks)
    .set({
      status: "done",
      result: { items },
      passed: items.length - failing.length,
      total: items.length,
      error: "",
      checkedAt: new Date(),
    })
    .where(eq(bankAccountChecks.id, run.checkId));

  if (run.notify && failing.length > 0) await notifyCreator(run.accountId, failing);
}

/**
 * Báo cho nhân viên đã mở tài khoản: dòng nào không đạt hay thiếu ảnh, để họ
 * thay ảnh trong ngày trước khi người duyệt đánh lỗi.
 *
 * Thân tin chỉ có tên phép kiểm, KHÔNG có tên khách, số tài khoản hay mã trên
 * ảnh: thông báo hiện trên màn hình khoá. Chi tiết nằm ở màn tài khoản, đường
 * dẫn kèm theo. `notify()` tự hỏi công tắc `bank-photo-fail` của người nhận.
 *
 * Nuốt lỗi: kết quả đã ghi xong, báo tin hỏng không được làm lượt kiểm thành
 * `failed`.
 */
async function notifyCreator(accountId: string, failing: PhotoCheckItem[]): Promise<void> {
  try {
    const [row] = await db
      .select({
        createdBy: bankAccounts.createdBy,
        bankCode: banks.code,
        referral: referralCodes.displayName,
      })
      .from(bankAccounts)
      .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
      .innerJoin(referralCodes, eq(referralCodes.id, bankAccounts.referralCodeId))
      .where(eq(bankAccounts.id, accountId))
      .limit(1);
    if (!row?.createdBy) return;

    const parts = failing.map(
      (i) => `${PHOTO_CHECK_LABEL[i.key]} ${i.verdict === "missing" ? "thiếu ảnh" : "không đạt"}`,
    );
    await notify(row.createdBy, "bank-photo-fail", {
      title: "Ảnh tài khoản ngân hàng không đạt",
      body: `${row.bankCode} - ${row.referral}: ${parts.join(", ")}.`,
      url: `/banking/${accountId}`,
    });
  } catch (e) {
    console.warn("[photo-check] không gửi được thông báo:", e instanceof Error ? e.message : e);
  }
}

export async function failPhotoCheck(checkId: string, error: string): Promise<void> {
  await db
    .update(bankAccountChecks)
    .set({ status: "failed", error, checkedAt: new Date() })
    .where(eq(bankAccountChecks.id, checkId));
}
