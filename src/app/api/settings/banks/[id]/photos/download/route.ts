import { zipSync, type Zippable } from "fflate";
import { PhotoDownloadForm } from "@/lib/api/bankPhotos";
import { searchKey } from "@/lib/format";
import { canManageBank, canOpenBankAdmin } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, isUuid, jsonBody, notFound, unauthorized } from "@/server/auth";
import { photosForDownload } from "@/server/banking";
import { readImage } from "@/server/storage";

/** `Nguyễn Văn An` → `nguyen-van-an` — tên file phải sống được qua zip và Windows. */
const slug = (raw: string): string =>
  searchKey(raw).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "khach";

/**
 * Tải hàng loạt ảnh của MỘT ngân hàng — nhận danh sách ảnh đã chọn, trả về
 * MỘT file zip. Chốt phân quyền như route `/accounts`: `canManageBank`.
 *
 * Ảnh đã là webp/jpeg nén sẵn nên zip ở mức `level: 0` (chỉ đóng gói, không nén
 * lại) — nén lần hai tốn CPU mà không nhỏ thêm. Trần 200 ảnh một lượt nằm ở
 * `PhotoDownloadForm`: toàn bộ ảnh phải vào RAM trước khi đóng gói.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!canOpenBankAdmin(actor)) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  if (!canManageBank(actor, id)) return forbidden();

  const parsed = PhotoDownloadForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const photoIds = [...new Set(parsed.data.photoIds)];
  const photos = await photosForDownload(id, photoIds);
  // Thiếu dòng nghĩa là có ảnh không thuộc ngân hàng này (hoặc đã bị xoá) —
  // từ chối cả lượt chứ không đóng gói thiếu: file thiếu ảnh trông y hệt file đủ.
  if (photos.length !== photoIds.length) {
    return badRequest("Danh sách có ảnh không thuộc ngân hàng này. Tải lại trang rồi chọn lại.");
  }

  const entries: Zippable = {};
  const missing: string[] = [];
  /** Hai khách trùng tên thì nối số để không ghi đè nhau trong zip. */
  const taken = new Set<string>();

  const contents = await Promise.all(photos.map((p) => readImage(p.key)));
  for (const [i, image] of contents.entries()) {
    const photo = photos[i];
    const ext = photo.key.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "webp";
    const base = [
      slug(photo.customerName),
      photo.accountNumber || "chua-co-stk",
      photo.kind === "transaction" ? "giao-dich" : "",
    ]
      .filter(Boolean)
      .join("-");

    let name = `${base}.${ext}`;
    for (let n = 2; taken.has(name); n += 1) name = `${base}-${n}.${ext}`;
    taken.add(name);

    if (!image) {
      missing.push(name);
      continue;
    }
    const bytes =
      image.body instanceof ArrayBuffer
        ? new Uint8Array(image.body)
        : new Uint8Array(await new Response(image.body).arrayBuffer());
    entries[name] = [bytes, { level: 0 }];
  }

  if (Object.keys(entries).length === 0) return notFound();
  // Ảnh mất khỏi kho vẫn phải được nói ra — file thiếu ảnh trông y hệt file đủ.
  if (missing.length > 0) {
    entries["anh-thieu.txt"] = [
      new TextEncoder().encode(
        `Các ảnh sau không còn trong kho, không có trong file này:\n${missing.join("\n")}\n`,
      ),
      { level: 0 },
    ];
  }

  const zip = zipSync(entries);
  const bankCode = photos[0]?.bankCode ?? "";

  // Ảnh chứng minh là dữ liệu cá nhân — lượt tải hàng loạt phải tra lại được.
  await logAudit(actor, {
    module: "banking",
    action: "export",
    targetLabel: `Tải ${photos.length - missing.length} ảnh của ngân hàng ${bankCode}`,
    targetTable: "bank_account_photos",
    targetId: id,
  });

  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="anh-ngan-hang.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
