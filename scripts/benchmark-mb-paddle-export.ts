import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { db } from "../src/server/db/client";
import {
  bankAccountChecks,
  bankAccountPhotos,
  bankAccounts,
  banks,
  customers,
  referralCodes,
} from "../src/server/db/schema";
import { imageKeyOf, readImage } from "../src/server/storage";

/** Xuất ảnh của đúng lô MB đã kiểm sang thư mục tạm để so OCR; không ghi DB. */
const root = "/private/tmp/mgst-ocr-bench.QB38nP";
const imagesDir = path.join(root, "mb50-images");

async function main() {
  const checks = await db
    .select({
      accountId: bankAccountChecks.accountId,
      result: bankAccountChecks.result,
      customerName: customers.fullName,
      accountNumber: bankAccounts.accountNumber,
      referralCode: referralCodes.code,
      referralName: referralCodes.displayName,
      province: referralCodes.province,
      supportBranch: referralCodes.supportBranch,
    })
    .from(bankAccountChecks)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankAccountChecks.accountId))
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
    .innerJoin(referralCodes, eq(referralCodes.id, bankAccounts.referralCodeId))
    .where(eq(banks.code, "MB"))
    .orderBy(asc(bankAccountChecks.createdAt));
  if (checks.length !== 50) throw new Error(`Mong đợi đúng 50 lượt MB, hiện có ${checks.length}.`);

  await mkdir(imagesDir, { recursive: true });
  const manifest = [];
  for (const [index, check] of checks.entries()) {
    const photos = await db
      .select({ key: bankAccountPhotos.url })
      .from(bankAccountPhotos)
      .where(eq(bankAccountPhotos.accountId, check.accountId))
      .orderBy(asc(bankAccountPhotos.kind), asc(bankAccountPhotos.sortOrder));
    const files = await Promise.all(photos.map(async ({ key }, imageIndex) => {
      if (!imageKeyOf(key)) throw new Error("Khoá ảnh trong DB không hợp lệ.");
      const stored = await readImage(key);
      if (!stored) throw new Error(`Không đọc được ảnh thứ ${imageIndex + 1} của đơn ${index + 1}.`);
      const body = stored.body instanceof ArrayBuffer
        ? Buffer.from(stored.body)
        : Buffer.from(await new Response(stored.body).arrayBuffer());
      const file = `${String(index).padStart(2, "0")}-${imageIndex}.${path.extname(key).slice(1)}`;
      await writeFile(path.join(imagesDir, file), body);
      return file;
    }));
    manifest.push({
      accountId: check.accountId,
      oldItems: (check.result as { items?: unknown[] } | null)?.items ?? [],
      context: {
        customerName: check.customerName,
        accountNumber: check.accountNumber ?? "",
        referralCode: check.referralCode ?? "",
        referralName: check.referralName,
        province: check.province,
        supportBranch: check.supportBranch,
      },
      files,
    });
    if ((index + 1) % 10 === 0) console.log(`Đã xuất ${index + 1}/50 đơn.`);
  }
  await writeFile(path.join(root, "mb50-manifest.json"), JSON.stringify(manifest));
  console.log(`Đã xuất ${manifest.length} đơn, ${manifest.reduce((n, row) => n + row.files.length, 0)} ảnh.`);
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
