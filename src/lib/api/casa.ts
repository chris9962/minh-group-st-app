import { z } from 'zod';

/**
 * Tài khoản VPa đạt CASA, nhập qua file chốt chỉ tiêu VPa (`vpaTargets.ts`).
 * File tháng M tính vào lương tháng M+1. Hồ sơ phải khớp CCCD và chính hồ sơ
 * đó có tài khoản VPa. Mỗi tài khoản chỉ nhập một lần.
 */

const cell = z.string().max(500);

export const CasaFileRow = z.object({
  row: z.number().int(),
  fullName: cell,
  idNumber: cell,
  accountNumber: cell,
  staffCode: cell,
});
export type CasaFileRow = z.infer<typeof CasaFileRow>;

export const CasaPreviewRow = z.object({
  row: z.number(),
  fullName: z.string(),
  /** 4 số cuối CCCD, cùng luật che CCCD của mọi response khác. */
  idNumberTail: z.string(),
  staffCode: z.string(),
  /** STK của tài khoản VPa sẽ đánh dấu. Rỗng khi dòng lỗi. */
  accountNumber: z.string(),
  /** Tháng lương tài khoản đã được nhập trước đó. Có giá trị thì lượt này không ghi lại. */
  importedMonth: z.string().nullable(),
  /** Dòng không ghi và không chặn file: tài khoản đang ở trạng thái Lỗi. */
  skipped: z.boolean(),
  /** Có một lỗi thì cả file không ghi được. */
  errors: z.array(z.string()),
  /** Chỉ báo, vẫn ghi được. */
  differences: z.array(z.string()),
});
export type CasaPreviewRow = z.infer<typeof CasaPreviewRow>;

export const CasaMonth = z.object({
  month: z.string(),
  count: z.number(),
  locked: z.boolean(),
});
export type CasaMonth = z.infer<typeof CasaMonth>;

export async function fetchCasaMonth(month: string): Promise<CasaMonth> {
  const res = await fetch(`/api/settings/quota/casa?month=${month}`);
  if (!res.ok) throw new Error('Không đọc được số tài khoản CASA');
  return CasaMonth.parse(await res.json());
}
