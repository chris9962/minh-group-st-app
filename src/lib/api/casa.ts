import { z } from 'zod';
import type { ColumnSpec } from '@/lib/readExcelRows';

/**
 * Tài khoản VPa đạt CASA, nhập từ sheet "CHI TIẾT CASA ĐẠT" của file ngân hàng
 * gửi (chốt 2026-11-09). File tháng M tính vào lương tháng M+1. Hồ sơ phải khớp
 * CCCD và chính hồ sơ đó có tài khoản VPa. Mỗi tài khoản chỉ nhập một lần.
 */

export const CASA_FILE_COLUMNS = {
  fullName: { headers: ['TÊN KHÁCH HÀNG', 'HỌ VÀ TÊN', 'HỌ TÊN'], required: false },
  idNumber: { headers: ['SỐ CCCD/CMND', 'SỐ CCCD', 'CCCD'], required: true, anchor: true },
  accountNumber: { headers: ['STK', 'SỐ TÀI KHOẢN'], required: false },
  staffCode: { headers: ['MÃ NHÂN VIÊN'], required: false },
} satisfies ColumnSpec<string>;

const cell = z.string().max(500);

export const CasaFileRow = z.object({
  row: z.number().int(),
  fullName: cell,
  idNumber: cell,
  accountNumber: cell,
  staffCode: cell,
});
export type CasaFileRow = z.infer<typeof CasaFileRow>;

/** Trần một lượt tải: cả file ghi trong một transaction. */
export const CASA_IMPORT_MAX_ROWS = 3000;

export const CasaImportRequest = z.object({
  rows: z.array(CasaFileRow).min(1).max(CASA_IMPORT_MAX_ROWS),
  commit: z.boolean(),
});
export type CasaImportRequest = z.infer<typeof CasaImportRequest>;

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
  /** Có một lỗi thì cả file không ghi được. */
  errors: z.array(z.string()),
  /** Chỉ báo, vẫn ghi được. */
  differences: z.array(z.string()),
});
export type CasaPreviewRow = z.infer<typeof CasaPreviewRow>;

export const CasaImportResult = z.object({
  rows: z.array(CasaPreviewRow),
  written: z.number(),
});
export type CasaImportResult = z.infer<typeof CasaImportResult>;

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

export async function importCasa(month: string, request: CasaImportRequest): Promise<CasaImportResult> {
  const res = await fetch(`/api/settings/quota/casa?month=${month}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? 'Không nhập được file CASA');
  return CasaImportResult.parse(data);
}
