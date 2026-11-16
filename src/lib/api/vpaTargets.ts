import { z } from 'zod';
import type { ColumnSpec } from '@/lib/readExcelRows';
import { CasaPreviewRow } from './casa';

/**
 * File chốt chỉ tiêu VPBank tháng M, sheet "DS T09" (chốt 2026-11-15). File
 * tháng M ghi vào lương tháng M+1, vì lương tháng M đã chốt khi file về.
 * - Cột TMDK không có số 1: tài khoản VPa không đạt, người lập hồ sơ khách bị
 *   trừ phần điểm combo khách đó mất, và tài khoản không tính CASA.
 * - Cột TMDK có số 1 và CASA XÉT từ 500.000: tài khoản đạt CASA.
 */

export const VPA_TARGET_FILE_COLUMNS = {
  fullName: { headers: ['TÊN KHÁCH HÀNG', 'HỌ VÀ TÊN', 'HỌ TÊN'], required: false },
  idNumber: { headers: ['SỐ CCCD/CMND', 'SỐ CCCD', 'CCCD'], required: true, anchor: true },
  accountNumber: { headers: ['STK', 'SỐ TÀI KHOẢN'], required: false },
  staffCode: { headers: ['MÃ NHÂN VIÊN'], required: false },
  qualified: { headers: ['TMDK'], required: true },
  casa: { headers: ['CASA XÉT'], required: true },
} satisfies ColumnSpec<string>;

/** Ngưỡng số dư CASA XÉT để tính CASA. */
export const CASA_MIN_BALANCE = 500_000;

export const isQualifiedValue = (value: string) => value.trim() === '1';

const cell = z.string().max(500);

export const VpaTargetFileRow = z.object({
  row: z.number().int(),
  fullName: cell,
  idNumber: cell,
  accountNumber: cell,
  staffCode: cell,
  qualified: cell,
  casa: cell,
});
export type VpaTargetFileRow = z.infer<typeof VpaTargetFileRow>;

/** File tháng 9/2026 có 9.355 dòng. */
export const VPA_TARGET_MAX_ROWS = 20000;

export const VpaTargetImportRequest = z.object({
  rows: z.array(VpaTargetFileRow).min(1).max(VPA_TARGET_MAX_ROWS),
  commit: z.boolean(),
});
export type VpaTargetImportRequest = z.infer<typeof VpaTargetImportRequest>;

/** Một dòng TMDK không đạt. */
export const UnqualifiedRow = z.object({
  row: z.number(),
  fullName: z.string(),
  idNumberTail: z.string(),
  staffCode: z.string(),
  /** Người lập hồ sơ khách trên app, người nhận điểm trừ. */
  ownerCode: z.string(),
  accountNumber: z.string(),
  /** Điểm combo khách mất. `null` khi dòng không tính điểm trừ. */
  points: z.number().nullable(),
  /** Vì sao dòng không tính điểm trừ. Rỗng khi có tính. */
  note: z.string(),
  /** Tài khoản đang có CASA ở tháng lương chưa chốt, lượt này bỏ CASA đó. */
  casaRemovedMonth: z.string().nullable(),
  /** Có một lỗi thì cả file không ghi được. */
  errors: z.array(z.string()),
});
export type UnqualifiedRow = z.infer<typeof UnqualifiedRow>;

/** Tổng điểm trừ của một nhân viên. */
export const StaffDeduction = z.object({
  userId: z.string(),
  staffCode: z.string(),
  fullName: z.string(),
  accounts: z.number(),
  points: z.number(),
});
export type StaffDeduction = z.infer<typeof StaffDeduction>;

export const VpaTargetImportResult = z.object({
  /** Lý do ghi vào dòng điểm trừ, cùng câu với đợt trừ điểm VPBa tháng 08. */
  reason: z.string(),
  staff: z.array(StaffDeduction),
  unqualified: z.array(UnqualifiedRow),
  casa: z.array(CasaPreviewRow),
  written: z.object({ staff: z.number(), accounts: z.number(), casa: z.number(), casaRemoved: z.number() }),
});
export type VpaTargetImportResult = z.infer<typeof VpaTargetImportResult>;

export async function importVpaTargets(month: string, request: VpaTargetImportRequest): Promise<VpaTargetImportResult> {
  const res = await fetch(`/api/settings/quota/vpa-targets?month=${month}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? 'Không nhập được file chốt chỉ tiêu');
  return VpaTargetImportResult.parse(data);
}
