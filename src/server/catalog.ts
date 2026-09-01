import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { CODE_LOW_RATIO } from "@/lib/api/bankCatalog";
import type {
  Bank,
  BankForm,
  CodeScope,
  CodeStatus,
  ReferralCode,
  ReferralCodeForm,
  ReferralCodeSort,
} from "@/lib/api/bankCatalog";
import type { Page } from "@/lib/api/pagination";
import type { PageArgs } from "./pagination";
import type { Channel, ChannelForm } from "@/lib/api/channelCatalog";
import type { Hospital, HospitalForm } from "@/lib/api/hospitalCatalog";
import type {
  Hamlet,
  Province,
  ReferenceProvince,
  ReferenceWard,
  Ward,
} from "@/lib/api/wardCatalog";
import type {
  CatalogItemForm,
  GiftItem,
  InsurancePackage,
  InsurancePackageForm,
  InsurancePackageLeg,
  KpiTarget,
  KpiTargetForm,
  ServiceTypeForm,
  ServiceTypeRow,
} from "@/lib/api/settings";
import { businessMonth, uniqueCode } from "@/lib/format";
import { db, uniqueViolationOf } from "./db/client";
import { recomputeKpiForMonth } from "./kpi";
import { imageKeyOf, imageUrl } from "./storage";
import {
  bankGuidePhotos,
  banks,
  channels,
  giftItems,
  hospitals,
  insurancePackageLegs,
  insurancePackages,
  hamlets,
  kpiTargets,
  provinces,
  refProvinces,
  refWards,
  referralCodeDepartments,
  referralCodes,
  userManagedBanks,
  userPermissions,
  users,
  serviceTypes,
  wards,
} from "./db/schema";

/**
 * Danh mục cấu hình — bản DB của các màn trong nhóm Cấu hình.
 *
 * ⚠️ `channels`, `gift_items`, `insurance_packages` đều có cột `code` BẮT BUỘC
 * mà biểu mẫu không gửi lên (form chỉ có tên). Mã sinh ở đây từ tên, nối số khi
 * đụng — cùng cách `org.ts` sinh mã phòng ban. Mã KHÔNG đổi theo tên về sau:
 * bản ghi nghiệp vụ và module luật theo kỳ đối chiếu bằng mã, đổi mã là cắt đứt
 * mọi thứ đang trỏ vào.
 */

/** Trùng khoá duy nhất → kết quả route đọc được, thay vì 500. */
export type CatalogOutcome<T> =
  | { ok: true; item: T }
  | { ok: false; reason: "code-taken" | "name-taken" };

/**
 * Chạy một lệnh ghi danh mục, đổi lỗi trùng khoá của Postgres thành `ok: false`.
 *
 * Không bắt thì Next trả 500 kèm trang HTML, tầng api không parse nổi JSON nên
 * người dùng chỉ nhận đúng câu "Không lưu được" và không biết mình trùng tên.
 * Gõ tên khác cũng thấy y hệt vì thông báo không nói gì.
 *
 * Phân biệt bằng tên ràng buộc: `*_name_unique` là người dùng gõ trùng tên, còn
 * lại là mã tự sinh đụng nhau khi hai request chạy song song.
 */
async function catalogWrite<T>(run: () => Promise<T>): Promise<CatalogOutcome<T>> {
  try {
    return { ok: true, item: await run() };
  } catch (e) {
    const constraint = uniqueViolationOf(e);
    if (constraint === null) throw e;
    return { ok: false, reason: constraint.includes("name") ? "name-taken" : "code-taken" };
  }
}

/* ── Ngân hàng ────────────────────────────────────────────────────────── */

type BankManager = { id: string; fullName: string };

const toBank = (
  r: typeof banks.$inferSelect,
  managers: BankManager[] = [],
  guidePhotoKeys: string[] = [],
): Bank => ({
  id: r.id,
  code: r.code,
  active: r.active,
  requiredPhotos: r.requiredPhotos,
  accountNumberMethod: r.accountNumberMethod,
  coefficient: Number(r.coefficient),
  countsAsApp: r.countsAsApp,
  priority: r.priority,
  minAge: r.minAge,
  maxAge: r.maxAge,
  managers,
  guide: r.guide ?? "",
  // Cột giữ KHOÁ, hợp đồng API trả URL — cùng luật ảnh chứng minh.
  guidePhotoUrls: guidePhotoKeys.map(imageUrl),
});

/**
 * Người quản của từng ngân hàng, nạp MỘT lượt cho cả danh sách.
 *
 * Không truy vấn theo từng ngân hàng: 13 dòng là 13 lượt đi về database cho
 * một màn (N+1), mà cả bảng nối chỉ vài trăm dòng nên lấy trọn rẻ hơn hẳn.
 */
async function bankManagers(): Promise<Map<string, BankManager[]>> {
  const rows = await db
    .select({
      bankId: userManagedBanks.bankId,
      id: users.id,
      fullName: users.fullName,
    })
    .from(userManagedBanks)
    .innerJoin(users, eq(users.id, userManagedBanks.userId))
    .orderBy(asc(users.fullName));

  const byBank = new Map<string, BankManager[]>();
  for (const r of rows) {
    const list = byBank.get(r.bankId) ?? [];
    list.push({ id: r.id, fullName: r.fullName });
    byBank.set(r.bankId, list);
  }
  return byBank;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Thu hồi quyền của người vừa bị bỏ khỏi ngân hàng CUỐI CÙNG họ quản.
 *
 * Đối xứng với nhịp thêm: vào danh sách người quản thì được cấp
 * `manage-assigned-banks`, ra khỏi danh sách cuối cùng thì trả lại. Không thu
 * hồi thì họ giữ một quyền không dùng được — mục sidebar vẫn hiện, vào màn thấy
 * bảng trống vì `visibleBankIds` trả mảng rỗng, và không ai hiểu vì sao.
 *
 * ⚠️ CHỈ đụng `manage-assigned-banks`. Người mang `manage-bank` quản mọi ngân
 * hàng và quyền đó không đến từ danh sách này — bỏ họ khỏi một ngân hàng mà thu
 * hồi luôn là cắt quyền họ vốn có từ bộ quyền chức vụ.
 */
async function revokeOrphanBankManagers(tx: Tx, droppedIds: string[]) {
  if (droppedIds.length === 0) return;

  // Ai trong số đó CÒN quản ngân hàng khác thì giữ nguyên.
  const stillManaging = await tx
    .selectDistinct({ userId: userManagedBanks.userId })
    .from(userManagedBanks)
    .where(inArray(userManagedBanks.userId, droppedIds));
  const keeps = new Set(stillManaging.map((r) => r.userId));

  const orphans = droppedIds.filter((id) => !keeps.has(id));
  if (orphans.length === 0) return;

  await tx
    .delete(userPermissions)
    .where(
      and(
        inArray(userPermissions.userId, orphans),
        eq(userPermissions.action, "manage-assigned-banks"),
        eq(userPermissions.module, "system"),
      ),
    );
}

/**
 * Ảnh mẫu của từng ngân hàng, nạp MỘT lượt cho cả danh sách.
 *
 * Không truy vấn theo từng ngân hàng: 13 dòng là 13 lượt đi về database cho một
 * màn (N+1), mà cả bảng chỉ vài chục dòng nên lấy trọn rẻ hơn hẳn.
 */
async function guidePhotos(): Promise<Map<string, string[]>> {
  const rows = await db
    .select()
    .from(bankGuidePhotos)
    .orderBy(asc(bankGuidePhotos.bankId), asc(bankGuidePhotos.sortOrder));
  const byBank = new Map<string, string[]>();
  for (const r of rows) {
    const list = byBank.get(r.bankId) ?? [];
    list.push(r.url);
    byBank.set(r.bankId, list);
  }
  return byBank;
}

/** Ảnh mẫu của MỘT ngân hàng, đúng thứ tự người nhập xếp. */
async function guidePhotosOf(runner: Tx | typeof db, bankId: string): Promise<string[]> {
  const rows = await runner
    .select({ url: bankGuidePhotos.url })
    .from(bankGuidePhotos)
    .where(eq(bankGuidePhotos.bankId, bankId))
    .orderBy(asc(bankGuidePhotos.sortOrder));
  return rows.map((r) => r.url);
}

/**
 * Ghi lại ảnh mẫu của một ngân hàng: xoá sạch rồi chèn lại theo đúng thứ tự.
 *
 * THỨ TỰ là phần của dữ liệu, không phải chuyện trình bày: người nhập viết
 * "Ảnh 1: lúc nhập mã" trong `guide`, nên đảo thứ tự là đổi nghĩa của cả đoạn
 * hướng dẫn.
 *
 * Chuỗi nào không phải ảnh trong kho của mình thì `imageKeyOf` trả `null` và
 * dòng đó bị bỏ — chốt chặn giống `qrImageKey`.
 */
async function writeGuidePhotos(tx: Tx, bankId: string, urls: string[]) {
  await tx.delete(bankGuidePhotos).where(eq(bankGuidePhotos.bankId, bankId));

  const keys = urls.map(imageKeyOf).filter((k): k is string => k !== null);
  if (keys.length === 0) return;

  await tx
    .insert(bankGuidePhotos)
    .values(keys.map((url, i) => ({ bankId, url, sortOrder: i })));
}

/** Người quản của MỘT ngân hàng, kèm tên. Dùng khi trả một bản ghi ra ngoài. */
async function bankManagersOf(runner: Tx | typeof db, bankId: string): Promise<BankManager[]> {
  return runner
    .select({ id: users.id, fullName: users.fullName })
    .from(userManagedBanks)
    .innerJoin(users, eq(users.id, userManagedBanks.userId))
    .where(eq(userManagedBanks.bankId, bankId))
    .orderBy(asc(users.fullName));
}

/** Ai đang quản một ngân hàng cụ thể. Dùng khi giữ nguyên danh sách đang có. */
export async function bankManagerIds(bankId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: userManagedBanks.userId })
    .from(userManagedBanks)
    .where(eq(userManagedBanks.bankId, bankId));
  return rows.map((r) => r.userId);
}

/**
 * Ghi lại danh sách người quản của một ngân hàng: xoá sạch rồi chèn lại.
 *
 * Cùng cách `writeCodeDepartments` làm — danh sách nhiều nhất vài chục người,
 * mà phép so từng dòng để chèn/xoá phần chênh là chỗ dễ sai hơn một lượt ghi đè.
 *
 * ⚠️ Hàm này CẤP và THU HỒI quyền của người khác, nên nơi gọi phải truyền
 * `canAssign` — chỉ người có `system:grant-permission` mới bật nó. Bản trước
 * chạy nhánh cấp quyền cho mọi lượt lưu: một người quản ngân hàng bấm Lưu là
 * dựng lại quyền mà quản trị vừa thu hồi ở màn nhân sự.
 */
async function writeBankManagers(
  tx: Tx,
  bankId: string,
  managerIds: string[],
  canAssign: boolean,
) {
  /**
   * Không có `grant-permission` thì KHÔNG đụng gì — cả bảng nối lẫn quyền.
   *
   * Route đã thay `managerIds` bằng danh sách cũ cho người như vậy, nên về lý
   * thuyết ghi lại cũng ra kết quả cũ. Nhưng dừng hẳn ở đây rẻ hơn và không phụ
   * thuộc vào việc route nhớ làm đúng: hàm này cấp và thu hồi quyền của người
   * khác, nên nó tự kiểm chứ không tin nơi gọi.
   */
  if (!canAssign) return;

  // Đọc TRƯỚC khi xoá: cần biết ai vừa bị bỏ ra để còn thu hồi quyền cho họ.
  const before = (
    await tx
      .select({ userId: userManagedBanks.userId })
      .from(userManagedBanks)
      .where(eq(userManagedBanks.bankId, bankId))
  ).map((r) => r.userId);

  await tx.delete(userManagedBanks).where(eq(userManagedBanks.bankId, bankId));
  if (managerIds.length > 0) {
    await tx
      .insert(userManagedBanks)
      .values(managerIds.map((userId) => ({ userId, bankId })))
      .onConflictDoNothing();
  }

  await revokeOrphanBankManagers(tx, before.filter((id) => !managerIds.includes(id)));
  if (managerIds.length === 0) return;

  /**
   * Người được giao mà CHƯA có quyền nào về ngân hàng thì cấp
   * `manage-assigned-banks`.
   *
   * Ô chọn cho tìm trong toàn bộ nhân viên, nên người vừa chọn thường chưa có
   * quyền gì. Chỉ ghi bảng nối thì tên họ nằm đó mà vẫn không mở được màn nào —
   * người giao tưởng đã xong việc, còn người được giao không hiểu vì sao không
   * vào được.
   *
   * ⚠️ Ai đã có `manage-bank` thì KHÔNG đụng. Họ quản mọi ngân hàng; thêm quyền
   * hẹp hơn vào chỉ làm lưới cấp quyền hiện hai ô cùng bật mà không nói thêm gì.
   */
  const already = await tx
    .select({ userId: userPermissions.userId })
    .from(userPermissions)
    .where(
      and(
        inArray(userPermissions.userId, managerIds),
        sql`${userPermissions.action} in ('manage-bank', 'manage-assigned-banks')`,
        sql`${userPermissions.module} in ('system', '*')`,
      ),
    );
  const has = new Set(already.map((r) => r.userId));

  /**
   * Chỉ cấp cho tài khoản ĐANG HOẠT ĐỘNG.
   *
   * Ô chọn ở giao diện đã lọc, nhưng đó là lọc ở trình duyệt — một body nặn tay
   * gửi uuid của người đã nghỉ việc thì quyền nằm im tới ngày ai đó mở khoá lại
   * tài khoản (AGENTS.md §6).
   */
  const fresh = (
    await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          inArray(users.id, managerIds.filter((id) => !has.has(id))),
          eq(users.active, true),
        ),
      )
  ).map((r) => r.id);
  if (fresh.length === 0) return;

  await tx
    .insert(userPermissions)
    .values(
      fresh.map((userId) => ({
        userId,
        module: "system" as const,
        action: "manage-assigned-banks" as const,
        scope: "company" as const,
      })),
    )
    .onConflictDoNothing();
}

/**
 * Ưu tiên cao lên trước, rồi tới mã.
 *
 * Thứ tự này đi thẳng vào ô chọn ngân hàng ở bước 1 của P-20 — sắp ở máy chủ
 * chứ không sắp lại ở trình duyệt (AGENTS.md §5.1). Bảng P-60 tự sắp theo cột
 * người dùng bấm nên không bị thứ tự này ràng buộc.
 */
export async function listBanks(): Promise<Bank[]> {
  const [rows, managers, photos] = await Promise.all([
    db.select().from(banks).orderBy(desc(banks.priority), asc(banks.code)),
    bankManagers(),
    guidePhotos(),
  ]);
  return rows.map((r) => toBank(r, managers.get(r.id) ?? [], photos.get(r.id) ?? []));
}

/**
 * Mã ngân hàng do người dùng nhập (khác các danh mục kia) — spec §2.6 liệt kê
 * đích danh 13 mã, đây là danh sách phẳng có thật chứ không phải danh mục tự do.
 *
 * KHÔNG nhận `coefficient`: hệ số điểm hết tác dụng từ 03/08, xem
 * `docs/plan-module-cau-hinh.md`. Dòng mới lấy mặc định 1 của DB.
 */
export async function createBank(
  form: BankForm,
  canAssign: boolean,
): Promise<CatalogOutcome<Bank>> {
  try {
    /**
     * Một transaction cho cả hai bảng.
     *
     * Bản trước chèn ngân hàng rồi mới ghi người quản. Một uuid không có trong
     * `users` sinh lỗi khoá ngoại, `uniqueViolationOf` trả `null` nên lỗi ném
     * ra 500 — mà ngân hàng thì đã nằm trong bảng. Người dùng bấm Lưu lại nhận
     * "Mã ngân hàng này đã có" và không đoán ra vì sao.
     */
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(banks)
        .values({
          code: form.code,
          requiredPhotos: form.requiredPhotos,
          accountNumberMethod: form.accountNumberMethod,
          countsAsApp: form.countsAsApp,
          priority: form.priority,
          minAge: form.minAge,
          maxAge: form.maxAge,
          guide: form.guide || null,
        })
        .returning();
      await writeBankManagers(tx, row.id, form.managerIds, canAssign);
      await writeGuidePhotos(tx, row.id, form.guidePhotoUrls);
      return {
        ok: true as const,
        item: toBank(row, await bankManagersOf(tx, row.id), await guidePhotosOf(tx, row.id)),
      };
    });
  } catch (e) {
    if (uniqueViolationOf(e) !== null) return { ok: false, reason: "code-taken" };
    throw e;
  }
}

/**
 * ⚠️ KHÔNG ghi `code`. Mã ngân hàng là DANH TÍNH, không phải cấu hình.
 *
 * Module luật theo kỳ khớp bằng chính chuỗi mã (`TIER_OF`, `REQUIRES_APP`,
 * `CASH_OF` trong `src/rules/`), và file luật đã đóng băng. Đổi `VPa` thành
 * `VPA` là xếp lại hạng cho MỌI tài khoản đã ghi từ trước — điểm KPI và rổ quà
 * của các tháng đã chốt đổi theo, mà không lượt tính lại nào chạy. Nhật ký chỉ
 * ghi "Sửa ngân hàng <mã>" nên sau đó cũng không lần ra đã đổi từ gì sang gì.
 *
 * Spec §2.6 liệt kê đúng năm trường cấu hình sửa được; `mã` không nằm trong đó.
 * Cùng lối với `departments.code` — sinh một lần lúc lập, P-91 chỉ cho đổi TÊN.
 *
 * Mã gửi lên bị bỏ qua trong im lặng, không trả lỗi: ô đã khoá ở giao diện nên
 * đây chỉ là chốt chặn phía máy chủ (AGENTS.md §6), không phải đường người dùng
 * đi tới được.
 */
export async function updateBank(
  id: string,
  form: BankForm,
  canAssign: boolean,
): Promise<CatalogOutcome<Bank> | null> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(banks)
        .set({
          requiredPhotos: form.requiredPhotos,
          accountNumberMethod: form.accountNumberMethod,
          countsAsApp: form.countsAsApp,
          priority: form.priority,
          minAge: form.minAge,
          maxAge: form.maxAge,
          guide: form.guide || null,
        })
        .where(eq(banks.id, id))
        .returning();
      if (!row) return null;
      await writeBankManagers(tx, id, form.managerIds, canAssign);
      await writeGuidePhotos(tx, id, form.guidePhotoUrls);
      return {
        ok: true as const,
        item: toBank(row, await bankManagersOf(tx, id), await guidePhotosOf(tx, id)),
      };
    });
  } catch (e) {
    if (uniqueViolationOf(e) !== null) return { ok: false, reason: "code-taken" };
    throw e;
  }
}

export async function setBankActive(id: string, active: boolean): Promise<Bank | null> {
  const [row] = await db.update(banks).set({ active }).where(eq(banks.id, id)).returning();
  if (!row) return null;
  return toBank(row, await bankManagersOf(db, id), await guidePhotosOf(db, id));
}

/* ── Mã giới thiệu ────────────────────────────────────────────────────── */

/**
 * `used` = số đã tiêu TRƯỚC khi nhập mã vào hệ thống (`imported_used`, P-62)
 * cộng số tài khoản `done` đang mang mã.
 *
 * Vế thứ hai đọc từ cột lưu sẵn `used_count` do trigger giữ, KHÔNG đếm sống nữa
 * (lý do đầy đủ ở `db/schema.ts`, bảng `referral_codes`). Bản cũ nối cả bảng
 * `bank_accounts` rồi GROUP BY để đếm — mà bộ lọc trạng thái và kiểu sắp theo
 * tiến độ đều suy từ chính con số đó, nên phải gộp xong TOÀN BỘ kho tài khoản
 * mới biết 15 dòng đầu là ai, và câu đếm tổng chạy lại y nguyên phép gộp ấy.
 *
 * `holding` = số tài khoản `creating` đang giữ chỗ mã này. Dòng `creating` sinh
 * ra ở bước 1 của P-20 và chiếm chỗ ngay từ lúc đó (spec §4.5); chỗ quay lại
 * kho khi dòng ấy bị xoá, hoặc chuyển sang `used` khi tài khoản hoàn thành.
 *
 * Trạng thái tính luôn trong SQL chứ không để trình duyệt tự suy. Bắt buộc phải
 * vậy: có lọc theo trạng thái thì máy chủ phải hiểu trạng thái mới cắt đúng
 * trang. Trước đây công thức nằm ở giao diện nên máy chủ cắt trang mù — trang 1
 * lọc xong còn 3 dòng, mà tổng vẫn ghi 240.
 */
const usedExpr = sql<number>`(${referralCodes.importedUsed} + ${referralCodes.usedCount})`;

/**
 * Chỗ THẬT SỰ còn nhận được tài khoản mới: tổng trừ phần đã tiêu và phần đang giữ.
 *
 * Hai người mở dở cùng một mã đã chiếm hai chỗ — ô chọn trừ chúng ra thì con số
 * hiện lên mới là số chỗ người thứ ba nhận được.
 */
const remainingExpr = sql<number>`(${referralCodes.total} - ${referralCodes.importedUsed} - ${referralCodes.usedCount} - ${referralCodes.holdingCount})`;

/**
 * Nhãn trạng thái ở P-61 — đo mã đã TIÊU tới đâu, nên chỉ đọc `used` và `total`.
 * Cùng ngưỡng với `CODE_LOW_RATIO`.
 *
 * Đây là tín hiệu để đi xin ngân hàng cấp mã mới, mà chỗ đang giữ thì nhả lại
 * được bất cứ lúc nào — tính nó vào thì một mã đầy tạm mười phút cũng kêu
 * "Đã đầy". Số chỗ trống thật để mở tài khoản là `remainingExpr` bên trên.
 */
const statusExpr = sql<CodeStatus>`case
  when ${usedExpr} >= ${referralCodes.total} then 'full'
  when ${usedExpr}::float / ${referralCodes.total} >= ${CODE_LOW_RATIO} then 'low'
  else 'available'
end`;

const codeColumns = {
  id: referralCodes.id,
  bankId: referralCodes.bankId,
  bankCode: banks.code,
  code: referralCodes.code,
  total: referralCodes.total,
  used: usedExpr,
  holding: referralCodes.holdingCount,
  status: statusExpr,
  // Cột nullable, nhưng hợp đồng API trả chuỗi — `''` đọc ra "không có link"
  // ở mọi nơi dùng, khỏi phải kiểm `null` riêng.
  openUrl: sql<string>`coalesce(${referralCodes.openUrl}, '')`,
  // Khoá trần, không phải URL. `toCode` dựng URL — cùng luật với ảnh chứng minh
  // ở `banking.ts`, và đổi đường đọc ảnh thì chỉ sửa `storage.ts`.
  qrImage: referralCodes.qrImage,
  priority: referralCodes.priority,
  scope: sql<CodeScope>`${referralCodes.scope}`,
  province: referralCodes.province,
  supportBranch: referralCodes.supportBranch,
  active: referralCodes.active,
  /**
   * Gom phòng trong CÙNG câu chọn, không gọi thêm lượt nào cho mỗi dòng.
   *
   * `filter (where … is not null)` bỏ dòng NULL do phép nối trái sinh ra với mã
   * `all` — thiếu nó thì mảng ra `[null]` chứ không phải rỗng.
   */
  departmentIds: sql<string[]>`coalesce(
    array_agg(${referralCodeDepartments.departmentId})
      filter (where ${referralCodeDepartments.departmentId} is not null),
    '{}'
  )`,
};

/**
 * Nhóm theo mọi cột KHÔNG gộp — bắt buộc vì `departmentIds` là `array_agg`.
 *
 * Liệt kê tay chứ không `group by 1,2,3…`: thêm cột vào `codeColumns` mà quên
 * chỗ này thì Postgres báo lỗi ngay, còn số thứ tự thì lệch trong im lặng.
 */
const codeGroupBy = [
  referralCodes.id,
  banks.code,
  referralCodes.bankId,
  referralCodes.code,
  referralCodes.total,
  referralCodes.importedUsed,
  referralCodes.usedCount,
  referralCodes.holdingCount,
  referralCodes.openUrl,
  referralCodes.qrImage,
  referralCodes.priority,
  referralCodes.scope,
  referralCodes.province,
  referralCodes.supportBranch,
  referralCodes.active,
] as const;

type CodeRow = Omit<ReferralCode, "qrImageUrl"> & { qrImage: string | null };

/**
 * Dòng thô → hợp đồng API: khoá ảnh thành URL đọc được, `null` thành `''`.
 *
 * Mọi đường trả mã ra ngoài phải đi qua đây. Trả thẳng dòng thô thì FE nhận
 * khoá trần và `<img src>` trỏ vào một đường không tồn tại.
 */
const toCode = ({ qrImage, ...rest }: CodeRow): ReferralCode => ({
  ...rest,
  qrImageUrl: qrImage ? imageUrl(qrImage) : "",
});

/**
 * Vô hiệu ký tự đại diện của `ILIKE` trong chữ người dùng gõ.
 *
 * Không thoát thì gõ `%` ra nguyên cả kho thay vì "không có kết quả", còn `_`
 * lặng lẽ khớp một ký tự bất kỳ nên tìm `ABC_1` ra cả `ABC-1`.
 */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function codeFilters(query: ReferralCodeFilters): SQL | undefined {
  const parts = [
    query.bankId ? eq(referralCodes.bankId, query.bankId) : undefined,
    query.status ? eq(statusExpr, query.status) : undefined,
    // Tìm trên mã lẫn tên ngân hàng: gõ "VPa" ra cả kho của ngân hàng đó, gõ
    // "884" ra đúng mã chứa số ấy.
    query.search
      ? (() => {
          const needle = `%${likeEscape(query.search)}%`;
          return sql`(${referralCodes.code} ilike ${needle} escape '\\' or ${banks.code} ilike ${needle} escape '\\')`;
        })()
      : undefined,
    /**
     * Phạm vi ngân hàng — áp cho CẢ câu lấy dòng lẫn câu đếm tổng, vì cả hai
     * cùng gọi `codeFilters`. Đếm mà không áp thì thanh phân trang hiện tổng
     * của cả kho trong khi bảng chỉ có mã của vài ngân hàng.
     *
     * Danh sách RỖNG khác `null`: rỗng nghĩa là người này chưa được giao ngân
     * hàng nào, và họ phải thấy bảng trống chứ không phải thấy tất cả.
     */
    query.allowedBankIds === null
      ? undefined
      : query.allowedBankIds.length === 0
        ? sql`false`
        : inArray(referralCodes.bankId, query.allowedBankIds),
  ].filter(Boolean) as SQL[];
  return parts.length > 0 ? and(...parts) : undefined;
}

export type ReferralCodeFilters = {
  bankId: string;
  status: CodeStatus | "";
  search: string;
  /**
   * Ngân hàng người gọi được phép thấy; `null` = không giới hạn.
   *
   * Khác `bankId` ở trên: cái đó là bộ lọc người dùng CHỌN, cái này là phạm vi
   * quyền, và người dùng không tắt được nó.
   */
  allowedBankIds: string[] | null;
};

/**
 * MỘT trang mã. Đếm tổng bằng câu thứ hai trên đúng bộ lọc đó — `rows.length`
 * là số dòng của trang, nói ra thì thanh phân trang hiện "1–15 trên 15" ở mọi
 * trang và không ai bấm sang trang sau.
 */
export async function listReferralCodes(
  filters: ReferralCodeFilters,
  page: PageArgs<ReferralCodeSort>,
): Promise<Page<ReferralCode>> {
  const where = codeFilters(filters);
  const direction = page.dir === "asc" ? asc : desc;
  const orderBy = {
    bank: [direction(banks.code), asc(referralCodes.code)],
    code: [direction(referralCodes.code)],
    progress: [direction(sql`${usedExpr}::float / ${referralCodes.total}`), asc(referralCodes.code)],
    priority: [direction(referralCodes.priority), asc(banks.code), asc(referralCodes.code)],
  }[page.sort];

  const [rows, [totals]] = await Promise.all([
    db
      .select(codeColumns)
      .from(referralCodes)
      .innerJoin(banks, eq(banks.id, referralCodes.bankId))
      .leftJoin(
        referralCodeDepartments,
        eq(referralCodeDepartments.referralCodeId, referralCodes.id),
      )
      .where(where)
      .groupBy(...codeGroupBy)
      .orderBy(...orderBy)
      .limit(page.limit)
      .offset(page.offset),
    // Phép nối `banks` phải giữ cả ở câu đếm — ô tìm kiếm soi cả tên ngân hàng,
    // bỏ nó đi thì `where` trỏ vào một bảng không có trong câu.
    db
      .select({ value: count() })
      .from(referralCodes)
      .innerJoin(banks, eq(banks.id, referralCodes.bankId))
      .where(where),
  ]);

  return { rows: rows.map(toCode), total: totals?.value ?? 0 };
}

/**
 * Chỉ TÊN mã, cho các ô lọc ở màn báo cáo và xuất Excel.
 *
 * `distinct` vì hai ngân hàng được phép trùng tên mã (khoá duy nhất là bank +
 * code) — để lọt thì ô chọn hiện hai dòng y hệt nhau.
 */
export async function listReferralCodeOptions(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ code: referralCodes.code })
    .from(referralCodes)
    .orderBy(asc(referralCodes.code));
  return rows.map((r) => r.code);
}

/**
 * Mã còn chỗ của một ngân hàng, nhiều chỗ trống lên trước. Ô chọn nên không cắt trang.
 *
 * "Còn chỗ" ở đây trừ CẢ phần đang giữ (`holding`), khác với nhãn trạng thái ở
 * bảng P-61. Đây là danh sách để đi mở tài khoản ngay bây giờ, nên chỗ người
 * khác đang mở dở không phải là chỗ trống.
 */
/**
 * `departmentId` là phòng GHI NHẬN của bản ghi sắp tạo (spec §4.4d, chốt câu 1).
 *
 * Rỗng nghĩa là người gọi không thuộc phòng nào VÀ chưa chọn phòng — khi đó chỉ
 * còn mã `all`. Không mở rộng thành "thấy mọi mã": mã giới hạn phải giới hạn
 * thật, kể cả với Ban giám đốc.
 */
export const inDepartmentScope = (departmentId: string): SQL =>
  sql`(${referralCodes.scope} = 'all' or exists (
        select 1 from ${referralCodeDepartments}
        where ${referralCodeDepartments.referralCodeId} = ${referralCodes.id}
          and ${referralCodeDepartments.departmentId} = ${departmentId}::uuid
      ))`;

export async function listOpenReferralCodes(
  bankId: string,
  departmentId: string,
): Promise<ReferralCode[]> {
  const rows = await db
    .select(codeColumns)
    .from(referralCodes)
    .innerJoin(banks, eq(banks.id, referralCodes.bankId))
    .leftJoin(
      referralCodeDepartments,
      eq(referralCodeDepartments.referralCodeId, referralCodes.id),
    )
    .where(
      and(
        eq(referralCodes.bankId, bankId),
        // Mã ngừng tay rời ô chọn ngay, kể cả khi còn chỗ. Chốt thật vẫn nằm
        // trong transaction của `startBankAccount`.
        eq(referralCodes.active, true),
        sql`${remainingExpr} > 0`,
        departmentId
          ? inDepartmentScope(departmentId)
          : sql`${referralCodes.scope} = 'all'`,
      ),
    )
    .groupBy(...codeGroupBy)
    // Ưu tiên do người dùng đặt đứng trước, rồi mới tới số chỗ trống. Mã đã
    // đầy không nằm trong câu này nên ưu tiên cao cũng không kéo nó trở lại.
    .orderBy(desc(referralCodes.priority), desc(remainingExpr), asc(referralCodes.code));

  return rows.map(toCode);
}

/**
 * Ghi lại danh sách phòng của một mã: xoá sạch rồi chèn lại.
 *
 * Không so từng dòng để chèn/xoá phần chênh: danh sách nhiều nhất là 15 phòng,
 * mà phép so đó là chỗ dễ sai hơn hẳn một lượt ghi đè.
 */
async function writeCodeDepartments(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  codeId: string,
  form: ReferralCodeForm,
) {
  await tx
    .delete(referralCodeDepartments)
    .where(eq(referralCodeDepartments.referralCodeId, codeId));

  if (form.scope !== "departments" || form.departmentIds.length === 0) return;

  await tx.insert(referralCodeDepartments).values(
    form.departmentIds.map((departmentId) => ({ referralCodeId: codeId, departmentId })),
  );
}

/** Đọc lại một mã bằng chính `codeColumns` — trạng thái chỉ có một định nghĩa. */
async function readCode(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  codeId: string,
): Promise<ReferralCode> {
  const [item] = await tx
    .select(codeColumns)
    .from(referralCodes)
    .innerJoin(banks, eq(banks.id, referralCodes.bankId))
    .leftJoin(
      referralCodeDepartments,
      eq(referralCodeDepartments.referralCodeId, referralCodes.id),
    )
    .where(eq(referralCodes.id, codeId))
    .groupBy(...codeGroupBy);
  return toCode(item);
}

/**
 * URL ảnh FE gửi lên → KHOÁ để ghi database; `null` khi không có ảnh.
 *
 * `imageKeyOf` trả `null` cho mọi chuỗi ngoài kho ảnh của mình, nên đây cũng là
 * chốt chặn: một body nặn tay chứa `javascript:` hay `../../.env.local` lưu về
 * thành "không có ảnh", không vào nổi database.
 */
const qrImageKey = (form: ReferralCodeForm): string | null =>
  form.qrImageUrl ? imageKeyOf(form.qrImageUrl) : null;

/**
 * Ngân hàng của một mã, đọc thẳng từ database. `null` = không có mã này.
 *
 * Chốt phạm vi ở đường SỬA phải hỏi hàm này, KHÔNG đọc `form.bankId`: thân
 * request là thứ người gọi tự đặt, còn thứ quyết định ai được sửa là ngân hàng
 * THẬT của mã đang nằm trong kho.
 */
export async function bankIdOfReferralCode(id: string): Promise<string | null> {
  const [row] = await db
    .select({ bankId: referralCodes.bankId })
    .from(referralCodes)
    .where(eq(referralCodes.id, id))
    .limit(1);
  return row?.bankId ?? null;
}

export async function createReferralCode(
  form: ReferralCodeForm,
): Promise<CatalogOutcome<ReferralCode>> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(referralCodes)
      .values({
        bankId: form.bankId,
        code: form.code,
        total: form.total,
        // Chuỗi rỗng thành NULL: cột này là "có link hay không", và hai cách
        // biểu diễn cho cùng một trạng thái sớm muộn lệch nhau khi lọc.
        openUrl: form.openUrl || null,
        qrImage: qrImageKey(form),
        priority: form.priority,
        scope: form.scope,
        province: form.province,
        supportBranch: form.supportBranch,
      })
      .returning();

      await writeCodeDepartments(tx, row.id, form);
      return { ok: true as const, item: await readCode(tx, row.id) };
    });
  } catch (e) {
    if (uniqueViolationOf(e) !== null) return { ok: false, reason: "code-taken" };
    throw e;
  }
}

/**
 * Kết quả sửa mã: `null` = không có mã này, `message` = lời từ chối đọc được.
 *
 * Không dùng `CatalogOutcome` như các danh mục khác: ngoài lỗi trùng mã, hàm
 * này còn từ chối vì tổng số nhỏ hơn phần đã tiêu — hai lý do khác nhau nên
 * route phải nói lại đúng lý do, chứ không quy về một câu chung.
 */
export type ReferralCodeUpdate =
  | { ok: true; item: ReferralCode }
  | { ok: false; message: string }
  | null;

/**
 * P-61 · Sửa một mã đã lập. Sửa được `code`, `total`, `openUrl`.
 *
 * KHÔNG đổi ngân hàng. Tài khoản đã mở bằng mã này mang `bank_id` riêng của
 * chúng, kéo mã sang ngân hàng khác là để lại một đống tài khoản trỏ vào mã
 * của nhà băng không liên quan. Ô chọn ngân hàng khoá sẵn ở giao diện, đây là
 * lượt kiểm lại phía máy chủ (AGENTS.md §6).
 *
 * `code` thì đổi được, khác `banks.code`: tài khoản trỏ vào mã bằng `id`, và
 * không file luật nào trong `src/rules/` đối chiếu chuỗi mã giới thiệu. Sửa
 * một mã gõ sai chính là việc màn này cần làm được.
 *
 * Đọc và ghi nằm trong một giao dịch, dòng mã khoá bằng `for update`: đường mở
 * tài khoản khoá đúng dòng đó trước khi chiếm chỗ (`startBankAccount`). Không
 * khoá thì hai bên cùng đọc `holding = 9`, một bên hạ tổng xuống 9 còn bên kia
 * chiếm chỗ thứ 10 — kho quay ra âm chỗ.
 */
export async function updateReferralCode(
  id: string,
  form: ReferralCodeForm,
): Promise<ReferralCodeUpdate> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        bankId: referralCodes.bankId,
        importedUsed: referralCodes.importedUsed,
        usedCount: referralCodes.usedCount,
        holdingCount: referralCodes.holdingCount,
      })
      .from(referralCodes)
      .where(eq(referralCodes.id, id))
      .limit(1)
      .for("update");

    if (!current) return null;

    if (form.bankId !== current.bankId)
      return { ok: false as const, message: "Không đổi được ngân hàng của mã đã lập" };

    // Phần đã tiêu CỘNG phần đang giữ. Hạ tổng xuống dưới con số này là kho
    // hiện "còn -2 chỗ", và mọi tài khoản đang mở dở mất chỗ đã chiếm.
    const taken = current.importedUsed + current.usedCount + current.holdingCount;
    if (form.total < taken)
      return {
        ok: false as const,
        message: `Mã này đã dùng và đang giữ ${taken} lượt — tổng số không được nhỏ hơn ${taken}`,
      };

    try {
      await tx
        .update(referralCodes)
        .set({
          code: form.code,
          total: form.total,
          openUrl: form.openUrl || null,
          qrImage: qrImageKey(form),
          priority: form.priority,
          scope: form.scope,
          province: form.province,
          supportBranch: form.supportBranch,
        })
        .where(eq(referralCodes.id, id));

      // Đổi phạm vi KHÔNG đụng tài khoản đã mở (spec §4.4d, chốt câu 3): phạm
      // vi là cấu hình nhất thời, chỉ chặn lượt mở mới.
      await writeCodeDepartments(tx, id, form);
    } catch (e) {
      if (uniqueViolationOf(e) !== null)
        return { ok: false as const, message: "Mã này đã có trong kho của ngân hàng đó" };
      throw e;
    }

    return { ok: true as const, item: await readCode(tx, id) };
  });
}

/**
 * P-61 · Ngừng / dùng lại một mã. Tắt là mã rời ô chọn ngay; chỗ đang giữ và
 * tài khoản đã mở không bị đụng — bật lại là kho trở về đúng trạng thái cũ.
 */
export async function setReferralCodeActive(
  id: string,
  active: boolean,
): Promise<ReferralCode | null> {
  const [row] = await db
    .update(referralCodes)
    .set({ active })
    .where(eq(referralCodes.id, id))
    .returning({ id: referralCodes.id });
  if (!row) return null;
  return db.transaction((tx) => readCode(tx, id));
}

/* ── Kênh ─────────────────────────────────────────────────────────────── */

const toChannel = (r: typeof channels.$inferSelect): Channel => ({
  id: r.id,
  code: r.code,
  name: r.name,
  inputKind: r.inputKind,
});

export async function listChannels(): Promise<Channel[]> {
  return (await db.select().from(channels).orderBy(asc(channels.name))).map(toChannel);
}

export async function createChannel(form: ChannelForm): Promise<CatalogOutcome<Channel>> {
  return catalogWrite(async () => {
    const taken = new Set((await db.select({ code: channels.code }).from(channels)).map((r) => r.code));
    const [row] = await db
      .insert(channels)
      .values({ code: uniqueCode(form.name, "KENH", taken), name: form.name, inputKind: form.inputKind })
      .returning();
    return toChannel(row);
  });
}

/** Đổi tên KHÔNG đổi mã — bản ghi cũ trỏ vào mã, đổi là cắt đứt chúng. */
export async function updateChannel(
  id: string,
  form: ChannelForm,
): Promise<CatalogOutcome<Channel | null>> {
  return catalogWrite(async () => {
    const [row] = await db
      .update(channels)
      .set({ name: form.name, inputKind: form.inputKind })
      .where(eq(channels.id, id))
      .returning();
    return row ? toChannel(row) : null;
  });
}

/* ── Bệnh viện ────────────────────────────────────────────────────────── */

export async function listHospitals(): Promise<Hospital[]> {
  const rows = await db.select().from(hospitals).orderBy(asc(hospitals.name));
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

export async function createHospital(form: HospitalForm): Promise<CatalogOutcome<Hospital>> {
  return catalogWrite(async () => {
    const [row] = await db.insert(hospitals).values({ name: form.name }).returning();
    return { id: row.id, name: row.name };
  });
}

/* ── Danh mục quà ─────────────────────────────────────────────────────── */

const toGiftItem = (r: typeof giftItems.$inferSelect): GiftItem => ({
  id: r.id,
  name: r.name,
  active: r.active,
});

export async function listGiftItems(): Promise<GiftItem[]> {
  return (await db.select().from(giftItems).orderBy(asc(giftItems.name))).map(toGiftItem);
}

export async function createGiftItem(form: CatalogItemForm): Promise<CatalogOutcome<GiftItem>> {
  return catalogWrite(async () => {
    const taken = new Set((await db.select({ code: giftItems.code }).from(giftItems)).map((r) => r.code));
    const [row] = await db
      .insert(giftItems)
      .values({ code: uniqueCode(form.name, "QUA", taken), name: form.name })
      .returning();
    return toGiftItem(row);
  });
}

export async function setGiftItemActive(id: string, active: boolean): Promise<GiftItem | null> {
  const [row] = await db.update(giftItems).set({ active }).where(eq(giftItems.id, id)).returning();
  return row ? toGiftItem(row) : null;
}

/* ── Gói bảo hiểm ─────────────────────────────────────────────────────── */

/**
 * Gói kèm danh sách leg. Hai câu cho cả bảng rồi gộp ở app — không truy vấn
 * leg theo từng gói (§11.1 cấm N+1).
 */
export async function listInsurancePackages(): Promise<InsurancePackage[]> {
  const [packageRows, legRows] = await Promise.all([
    db.select().from(insurancePackages).orderBy(asc(insurancePackages.name)),
    db.select().from(insurancePackageLegs).orderBy(asc(insurancePackageLegs.ord)),
  ]);

  const legsByPackage = new Map<string, InsurancePackageLeg[]>();
  for (const l of legRows) {
    const list = legsByPackage.get(l.packageId) ?? [];
    list.push({ product: l.product, years: l.years, fee: l.fee });
    legsByPackage.set(l.packageId, list);
  }

  return packageRows.map((p) => ({
    id: p.id,
    name: p.name,
    active: p.active,
    legs: legsByPackage.get(p.id) ?? [],
  }));
}

async function packageWithLegs(id: string): Promise<InsurancePackage | null> {
  return (await listInsurancePackages()).find((p) => p.id === id) ?? null;
}

/** Ghi gói + legs trong MỘT transaction — gói không có leg là gói không dùng được. */
async function writeLegs(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  packageId: string,
  legs: InsurancePackageForm["legs"],
): Promise<void> {
  await tx.delete(insurancePackageLegs).where(eq(insurancePackageLegs.packageId, packageId));
  await tx.insert(insurancePackageLegs).values(
    legs.map((leg, i) => ({
      packageId,
      ord: i + 1,
      product: leg.product,
      years: leg.years,
      fee: leg.fee,
    })),
  );
}

export async function createInsurancePackage(
  form: InsurancePackageForm,
): Promise<CatalogOutcome<InsurancePackage>> {
  return catalogWrite(async () => {
    const taken = new Set(
      (await db.select({ code: insurancePackages.code }).from(insurancePackages)).map((r) => r.code),
    );

    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(insurancePackages)
        .values({ code: uniqueCode(form.name, "GOI", taken), name: form.name })
        .returning();
      await writeLegs(tx, row.id, form.legs);
      return row.id;
    });

    return (await packageWithLegs(id))!;
  });
}

/** Đổi tên KHÔNG đổi mã: file luật theo kỳ trỏ vào mã, đổi là gãy. */
export async function updateInsurancePackage(
  id: string,
  form: InsurancePackageForm,
): Promise<CatalogOutcome<InsurancePackage | null>> {
  return catalogWrite(async () => {
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(insurancePackages)
        .set({ name: form.name, updatedAt: new Date() })
        .where(eq(insurancePackages.id, id))
        .returning({ id: insurancePackages.id });
      if (!row) return false;
      await writeLegs(tx, id, form.legs);
      return true;
    });

    return updated ? packageWithLegs(id) : null;
  });
}

export async function setInsurancePackageActive(
  id: string,
  active: boolean,
): Promise<InsurancePackage | null> {
  const [row] = await db
    .update(insurancePackages)
    .set({ active })
    .where(eq(insurancePackages.id, id))
    .returning({ id: insurancePackages.id });
  return row ? packageWithLegs(id) : null;
}

/* ── Loại dịch vụ ─────────────────────────────────────────────────────── */

const toServiceType = (r: typeof serviceTypes.$inferSelect): ServiceTypeRow => ({
  id: r.id,
  name: r.name,
  active: r.active,
  coefficient: Number(r.coefficient),
});

export async function listServiceTypes(): Promise<ServiceTypeRow[]> {
  return (await db.select().from(serviceTypes).orderBy(asc(serviceTypes.name))).map(toServiceType);
}

export async function createServiceType(
  form: ServiceTypeForm,
): Promise<CatalogOutcome<ServiceTypeRow>> {
  return catalogWrite(async () => {
    const [row] = await db
      .insert(serviceTypes)
      .values({ name: form.name, coefficient: String(form.coefficient) })
      .returning();
    return toServiceType(row);
  });
}

/**
 * Hệ số loại dịch vụ VẪN còn tác dụng (spec §7.2 — dịch vụ giữ cách cũ), khác
 * hẳn `banks.coefficient` đã bỏ. Nên sửa nó là ĐỔI ĐIỂM KPI THẬT.
 *
 * Vì vậy phải tính lại điểm ngay sau khi ghi. Không gọi thì điểm đã lưu giữ
 * nguyên hệ số cũ, và không có gì báo — người quản trị kéo hệ số từ 1 lên 2 rồi
 * mở bảng nhân sự, thấy số không nhúc nhích, tưởng mình bấm hụt.
 *
 * Chỉ tính lại THÁNG HIỆN TẠI. Tháng cũ giữ nguyên là cố ý: đổi hệ số hôm nay
 * mà chấm lại quá khứ thì báo cáo đã chốt tự viết lại, và người đã nhận lương
 * theo con số cũ bỗng có con số khác.
 *
 * Chạy tuần tự cho vài trăm người nên chậm — chấp nhận được, đây là thao tác
 * cấu hình hiếm khi làm, không phải đường đi hằng ngày.
 */
export async function updateServiceType(
  id: string,
  form: ServiceTypeForm,
): Promise<CatalogOutcome<ServiceTypeRow | null>> {
  return catalogWrite(async () => {
    const [current] = await db
      .select({ coefficient: serviceTypes.coefficient })
      .from(serviceTypes)
      .where(eq(serviceTypes.id, id))
      .limit(1);

    const [row] = await db
      .update(serviceTypes)
      .set({ name: form.name, coefficient: String(form.coefficient) })
      .where(eq(serviceTypes.id, id))
      .returning();
    if (!row) return null;

    // Chỉ tính lại khi HỆ SỐ đổi. Sửa mỗi cái tên mà chạy lại điểm của cả công
    // ty là trả giá cho một thao tác không đụng tới con số nào.
    if (current && Number(current.coefficient) !== form.coefficient)
      await recomputeKpiForMonth(businessMonth());

    return toServiceType(row);
  });
}

export async function setServiceTypeActive(
  id: string,
  active: boolean,
): Promise<ServiceTypeRow | null> {
  const [row] = await db
    .update(serviceTypes)
    .set({ active })
    .where(eq(serviceTypes.id, id))
    .returning();
  return row ? toServiceType(row) : null;
}

/* ── Chỉ tiêu KPI ─────────────────────────────────────────────────────── */

/**
 * Mốc của THÁNG HIỆN TẠI, rơi về mốc chung gần nhất không vượt tháng này.
 *
 * Cùng chuỗi rơi với `people.ts` — hai nơi lệch nhau thì màn cấu hình hiện một
 * số mà bảng KPI chấm theo số khác.
 *
 * Chưa có mốc nào thì trả `null`, KHÔNG bịa 100/7. Bịa thì màn P-83 hiện hai
 * con số trông y như đã lưu, quản trị bấm Lưu là ghi đè bằng số máy tự nghĩ ra
 * — đúng cái mà chốt chặn ở `KpiTargetSection` dựng ra để tránh, chỉ là đi vòng
 * từ phía máy chủ nên chốt đó không bắt được.
 */
export async function getKpiTarget(): Promise<KpiTarget | null> {
  const month = businessMonth();
  const [row] = await db
    .select()
    .from(kpiTargets)
    .where(sql`${kpiTargets.departmentId} is null and ${kpiTargets.yearMonth} <= ${month}`)
    .orderBy(desc(kpiTargets.yearMonth))
    .limit(1);
  return row ? { monthlyPoints: row.monthlyPoints } : null;
}

/** Ghi mốc cho THÁNG HIỆN TẠI. Tháng cũ không sửa — sửa là chấm lại quá khứ. */
export async function setKpiTarget(form: KpiTargetForm, updatedBy: string): Promise<KpiTarget> {
  const month = businessMonth();
  const [existing] = await db
    .select({ id: kpiTargets.id })
    .from(kpiTargets)
    .where(sql`${kpiTargets.yearMonth} = ${month} and ${kpiTargets.departmentId} is null`)
    .limit(1);

  const values = {
    yearMonth: month,
    departmentId: null,
    monthlyPoints: form.monthlyPoints,
    updatedBy,
    updatedAt: new Date(),
  };

  const [row] = existing
    ? await db.update(kpiTargets).set(values).where(eq(kpiTargets.id, existing.id)).returning()
    : await db.insert(kpiTargets).values(values).returning();

  return { monthlyPoints: row.monthlyPoints };
}

/* ── Địa bàn: tỉnh · xã/phường · ấp ───────────────────────────────────── */

/**
 * Hai tầng tách bạch (`wardCatalog.ts`):
 *
 * `ref_provinces` / `ref_wards` — bảng THAM CHIẾU, 34 tỉnh + 3.321 xã của cả
 * nước, chỉ đọc, seed một lần. Dùng để CHỌN.
 *
 * `provinces` / `wards` / `hamlets` — địa bàn công ty THẬT sự hoạt động, admin
 * thêm dần từ bảng tham chiếu. Ấp thì không có trong dữ liệu nhà nước nên nhập
 * tay. Ô chọn địa chỉ của khách hàng đọc tầng này, không đọc tầng tham chiếu —
 * đưa cả 3.321 xã ra cho nhân viên tự tìm là chỗ nhập sai.
 */

/** Cả cây địa bàn công ty. Ba câu, gộp ở app — không N+1 theo tỉnh. */
export async function listProvinceTree(): Promise<Province[]> {
  const [provinceRows, wardRows, hamletRows] = await Promise.all([
    db.select().from(provinces).orderBy(asc(provinces.name)),
    db.select().from(wards).orderBy(asc(wards.name)),
    db.select().from(hamlets).orderBy(asc(hamlets.name)),
  ]);

  const hamletsByWard = new Map<string, Hamlet[]>();
  for (const h of hamletRows) {
    const list = hamletsByWard.get(h.wardId) ?? [];
    list.push({ id: h.id, name: h.name });
    hamletsByWard.set(h.wardId, list);
  }

  const wardsByProvince = new Map<string, Ward[]>();
  for (const w of wardRows) {
    const list = wardsByProvince.get(w.provinceId) ?? [];
    list.push({ id: w.id, refId: w.refId, name: w.name, hamlets: hamletsByWard.get(w.id) ?? [] });
    wardsByProvince.set(w.provinceId, list);
  }

  return provinceRows.map((p) => ({
    id: p.id,
    refId: p.refId,
    name: p.name,
    wards: wardsByProvince.get(p.id) ?? [],
  }));
}

/**
 * Đưa một tỉnh từ bảng tham chiếu vào địa bàn công ty. Đã có thì im lặng bỏ qua.
 *
 * Trả về ĐÚNG tỉnh vừa thêm, không trả cả cây — hợp đồng ở `wardCatalog.ts`
 * parse một `Province`, nơi dùng chỉ cần nạp lại khoá `['provinces']`.
 */
export async function addProvince(refId: string): Promise<Province | null> {
  const [ref] = await db.select().from(refProvinces).where(eq(refProvinces.id, refId)).limit(1);
  if (!ref) return null;

  await db
    .insert(provinces)
    .values({ refId: ref.id, name: ref.name })
    .onConflictDoNothing({ target: provinces.refId });

  return provinceByRefId(refId);
}

/** Một tỉnh kèm xã/ấp của nó. */
async function provinceByRefId(refId: string): Promise<Province | null> {
  const [row] = await db.select().from(provinces).where(eq(provinces.refId, refId)).limit(1);
  if (!row) return null;
  return (await listProvinceTree()).find((p) => p.id === row.id) ?? null;
}

async function provinceById(id: string): Promise<Province | null> {
  return (await listProvinceTree()).find((p) => p.id === id) ?? null;
}

/** `provinceId` là uuid tỉnh công ty; `wardRefId` là mã xã ở bảng tham chiếu. */
export async function addWard(provinceId: string, wardRefId: string): Promise<Province | null> {
  const [province] = await db
    .select()
    .from(provinces)
    .where(eq(provinces.id, provinceId))
    .limit(1);
  const [ref] = await db.select().from(refWards).where(eq(refWards.id, wardRefId)).limit(1);
  if (!province || !ref) return null;

  await db
    .insert(wards)
    .values({ provinceId: province.id, refId: ref.id, name: ref.name })
    .onConflictDoNothing({ target: wards.refId });

  return provinceById(province.id);
}

/**
 * Ấp không có trong dữ liệu nhà nước — nhập tay.
 *
 * Trùng tên trong CÙNG một xã thì chặn (chỉ mục `hamlets_ward_name`), và báo ra
 * chứ không nuốt: nuốt thì người dùng nhận "Đã lưu" mà danh sách không đổi, bấm
 * lại vài lần rồi đi hỏi. Trùng tên giữa hai xã khác nhau thì vẫn cho — "Ấp 3"
 * là tên phổ biến, xã nào cũng có.
 */
export async function addHamlet(
  wardId: string,
  name: string,
): Promise<CatalogOutcome<Province | null>> {
  return catalogWrite(async () => {
    const [ward] = await db.select().from(wards).where(eq(wards.id, wardId)).limit(1);
    if (!ward) return null;

    await db.insert(hamlets).values({ wardId, name });
    return provinceById(ward.provinceId);
  });
}

/* ── Tham chiếu hành chính — chỉ đọc ──────────────────────────────────── */

export async function listReferenceProvinces(): Promise<ReferenceProvince[]> {
  return db.select({ id: refProvinces.id, name: refProvinces.name }).from(refProvinces).orderBy(asc(refProvinces.name));
}

/**
 * Xã/phường tham chiếu, lọc theo TỈNH CÔNG TY (uuid trong `provinces`).
 *
 * Nhận uuid chứ không nhận mã tham chiếu: nơi gọi là hộp thoại thêm xã, nó chỉ
 * có đối tượng `Province` của công ty. Bắt nó tự biết mã tham chiếu là rò một
 * chi tiết lưu trữ ra giao diện — và đó chính là chỗ đã sai: truyền uuid vào
 * `ref_wards.province_id` (kiểu text `"01"`) thì không khớp dòng nào, ô tìm xã
 * không ra gì.
 */
export async function listReferenceWards(provinceId: string): Promise<ReferenceWard[]> {
  if (!provinceId) return [];
  const [province] = await db
    .select({ refId: provinces.refId })
    .from(provinces)
    .where(eq(provinces.id, provinceId))
    .limit(1);
  if (!province) return [];

  return db
    .select({ id: refWards.id, name: refWards.name, provinceId: refWards.provinceId })
    .from(refWards)
    .where(eq(refWards.provinceId, province.refId))
    .orderBy(asc(refWards.name));
}
