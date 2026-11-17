import { readFile } from "node:fs/promises";
import { and, eq, inArray, sql } from "drizzle-orm";
import { BANK_ACCOUNT_STATUS_LABEL } from "../src/lib/api/bankAccounts";
import { isQualifiedValue } from "../src/lib/api/vpaTargets";
import { formatPoints, roundPoints } from "../src/lib/format";
import { readExcelRows, type ColumnSpec } from "../src/lib/readExcelRows";
import { CASA_BANK_CODE, normalizeIdNumber, pickAccount } from "../src/server/casa";
import { isMonthClosed, lockSalaryMonth } from "../src/server/closedMonths";
import { customerDayText } from "../src/server/customerDay";
import { db } from "../src/server/db/client";
import { bankAccounts, banks, customers, kpiAdjustments, users, vpaUnqualifiedAccounts } from "../src/server/db/schema";
import { comboLossByAccount, type ComboLoss } from "../src/server/kpi";
import { notify } from "../src/server/notifications";

/**
 * Ngoại lệ cho nhân sự đã nghỉ (chủ dự án chốt 2026-11-17): tài khoản VPa của
 * khách tháng M không đạt TMDK thì trừ điểm vào lương CHÍNH tháng M, không
 * chờ lương tháng M+1 như nút "Nhập file chốt chỉ tiêu VPa". Người đã nghỉ
 * không còn lương tháng sau để trừ.
 *
 * Cách tính và cách ghi giống nút nhập file (`server/vpaTargets.ts`): điểm trừ
 * là phần tổ hợp khách mất khi VPa không đạt (`comboLossByAccount`), mỗi người
 * một dòng `kpi_adjustments`, mỗi tài khoản một dòng `vpa_unqualified_accounts`.
 * Khác ba chỗ: chỉ nhận hồ sơ khách của tháng M; chỉ trừ khi người lập hồ sơ
 * trùng mã nhân viên trong file; không đụng CASA, vì file không có cột CASA XÉT.
 *
 * Dòng "Chưa khớp" với HO mặc định đứng ngoài, thêm `--include-unmatched` để trừ.
 * Chạy lại được: tài khoản đã trừ thì bỏ qua.
 *
 *   bun --env-file=.env.local scripts/db-vpa-deduction-resigned.ts --file=<xlsx> --month=2026-10
 *   … --apply --as=admin [--notify]
 */

const spec: ColumnSpec<"fullName" | "idNumber" | "accountNumber" | "staffCode" | "qualified" | "matchStatus"> = {
  fullName: { headers: ["TÊN KHÁCH HÀNG"], required: false },
  idNumber: { headers: ["SỐ CCCD/CMND"], required: true, anchor: true },
  accountNumber: { headers: ["STK"], required: false },
  staffCode: { headers: ["MÃ NHÂN VIÊN"], required: true },
  qualified: { headers: ["TMDK"], required: true },
  matchStatus: { headers: ["TRẠNG THÁI ĐỐI CHIẾU"], required: true },
};

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";

type Counted = {
  accountId: string;
  customerId: string;
  customerName: string;
  ownerId: string;
  ownerCode: string;
  ownerName: string;
  ownerActive: boolean;
  combo: ComboLoss;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const withNotify = process.argv.includes("--notify");
  const includeUnmatched = process.argv.includes("--include-unmatched");
  const asArg = arg("as");
  const month = arg("month");
  const file = arg("file");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Thiếu --month=YYYY-MM, là tháng của hồ sơ khách và cũng là tháng lương bị trừ.");
  if (!file) throw new Error("Thiếu --file=<đường dẫn file xlsx>.");
  if (await isMonthClosed(month)) throw new Error(`Lương tháng ${month} đã chốt, không trừ được.`);

  const rows = await readExcelRows(new File([await readFile(file)], "vpa.xlsx"), spec, { anySheet: true, headerAcrossRows: true });
  const failing = rows.filter((r) => !isQualifiedValue(r.qualified));
  const odd = failing.filter((r) => r.qualified.trim() !== "");
  const unmatched = failing.filter((r) => r.matchStatus.trim() !== "Đã khớp");
  const taken = includeUnmatched ? failing : failing.filter((r) => r.matchStatus.trim() === "Đã khớp");

  const idNumbers = [...new Set(taken.map((r) => normalizeIdNumber(r.idNumber)).filter(Boolean))];
  const found = idNumbers.length
    ? await db
        .select({
          idNumber: customers.idNumber,
          customerId: customers.id,
          customerName: customers.fullName,
          ownerId: customers.createdBy,
          ownerCode: users.username,
          ownerName: users.fullName,
          ownerActive: users.active,
          id: bankAccounts.id,
          accountNumber: bankAccounts.accountNumber,
          status: bankAccounts.status,
          accountType: bankAccounts.accountType,
          createdAt: bankAccounts.createdAt,
          deductedMonth: vpaUnqualifiedAccounts.yearMonth,
        })
        .from(customers)
        .leftJoin(
          bankAccounts,
          and(
            eq(bankAccounts.customerId, customers.id),
            eq(bankAccounts.bankId, sql`(select ${banks.id} from ${banks} where ${banks.code} = ${CASA_BANK_CODE})`),
          ),
        )
        .leftJoin(users, eq(users.id, customers.createdBy))
        .leftJoin(vpaUnqualifiedAccounts, eq(vpaUnqualifiedAccounts.bankAccountId, bankAccounts.id))
        // Một CCCD có thể có hồ sơ ở nhiều tháng; file này chỉ nói về hồ sơ tháng `month`.
        .where(and(inArray(customers.idNumber, idNumbers), sql`${customerDayText} like ${`${month}-%`}`))
    : [];

  const skipped: string[] = [];
  const picked = new Map<string, Omit<Counted, "combo">>();
  const seen = new Set<string>();
  for (const r of taken) {
    const idNumber = normalizeIdNumber(r.idNumber);
    const label = `dòng ${r.row} ${r.fullName} (${r.staffCode})`;
    if (!idNumber) { skipped.push(`${label}: thiếu CCCD`); continue; }
    if (seen.has(idNumber)) { skipped.push(`${label}: CCCD trùng dòng trước`); continue; }
    seen.add(idNumber);

    const ofCustomer = found.filter((f) => f.idNumber === idNumber);
    if (ofCustomer.length === 0) { skipped.push(`${label}: không có hồ sơ tháng ${month} khớp CCCD`); continue; }
    const candidates = ofCustomer.flatMap((f) =>
      f.id && f.status && f.accountType && f.createdAt
        ? [{ ...f, id: f.id, status: f.status, accountType: f.accountType, createdAt: f.createdAt, creatorUsername: f.ownerCode, casaMonth: null }]
        : [],
    );
    if (candidates.length === 0) { skipped.push(`${label}: hồ sơ không có tài khoản VPa`); continue; }

    const account = pickAccount(candidates, r.accountNumber);
    if (account.deductedMonth) { skipped.push(`${label}: đã trừ điểm lương tháng ${account.deductedMonth}`); continue; }
    if (account.status !== "done") { skipped.push(`${label}: tài khoản đang ở trạng thái ${BANK_ACCOUNT_STATUS_LABEL[account.status]}`); continue; }
    if (!account.ownerId) { skipped.push(`${label}: hồ sơ không có người lập`); continue; }
    if ((account.ownerCode ?? "").toUpperCase() !== r.staffCode.trim().toUpperCase()) {
      skipped.push(`${label}: người lập hồ sơ trong app là ${account.ownerCode?.toUpperCase()}, khác file`);
      continue;
    }
    if (picked.has(account.customerId)) { skipped.push(`${label}: khách đã có một tài khoản trong lượt này`); continue; }
    picked.set(account.customerId, {
      accountId: account.id,
      customerId: account.customerId,
      customerName: account.customerName,
      ownerId: account.ownerId,
      ownerCode: (account.ownerCode ?? "").toUpperCase(),
      ownerName: account.ownerName ?? "",
      ownerActive: account.ownerActive ?? false,
    });
  }

  const loss = await comboLossByAccount(db, new Map([...picked.values()].map((p) => [p.customerId, p.accountId])));
  const counted: Counted[] = [];
  for (const p of picked.values()) {
    const combo = loss.get(p.accountId);
    if (!combo) skipped.push(`${p.customerName} (${p.ownerCode}): không tính được tổ hợp`);
    // Có tổ hợp luật kỳ chấm 0 điểm (MB + VPa từ 2026-10-11): mất VPa thì điểm không giảm, và không được thành điểm cộng.
    else if (combo.points <= 0)
      skipped.push(`${p.customerName} (${p.ownerCode}): khách đang ${formatPoints(combo.before)} điểm, không còn điểm tổ hợp để trừ`);
    else counted.push({ ...p, combo });
  }

  const staff = [...new Set(counted.map((c) => c.ownerId))]
    .map((ownerId) => {
      const own = counted.filter((c) => c.ownerId === ownerId);
      return {
        userId: ownerId,
        code: own[0].ownerCode,
        fullName: own[0].ownerName,
        active: own[0].ownerActive,
        accounts: own.length,
        points: roundPoints(own.reduce((s, c) => s + c.combo.points, 0)),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
  const deducted = staff.filter((s) => s.points > 0);
  const reason = `điểm trừ lỗi VPBa tháng ${month.slice(5)} không ghi nhận đủ giao dịch khác ngày`;

  console.log(`File: ${rows.length} tài khoản, TMDK không đạt ${failing.length}. Tháng hồ sơ và tháng lương: ${month}${apply ? "" : " (CHẠY KHÔ, không ghi gì)"}.`);
  if (odd.length > 0) console.log(`  CẢNH BÁO: ${odd.length} dòng TMDK ghi khác số 1 và khác trống, tính là không đạt.`);
  console.log(`  "Chưa khớp" với HO: ${unmatched.length} dòng, ${includeUnmatched ? "CÓ trừ" : "KHÔNG trừ"}.`);
  for (const r of unmatched) console.log(`    dòng ${r.row} ${r.fullName} (${r.staffCode})`);
  console.log(`  Trừ điểm: ${counted.length} tài khoản. Bỏ qua: ${skipped.length}.`);
  for (const line of skipped) console.log(`    BỎ QUA  ${line}`);
  console.log(`Lý do ghi: ${reason}`);
  console.log(`Nhân viên bị trừ: ${deducted.length}, tổng ${formatPoints(roundPoints(deducted.reduce((s, x) => s + x.points, 0)))} điểm.`);
  for (const s of staff)
    console.log(`  ${s.code} ${s.fullName}${s.active ? "" : " [đã khoá]"}: -${formatPoints(s.points)} (${s.accounts} tài khoản)`);
  console.log("Chi tiết từng khách:");
  for (const c of [...counted].sort((a, b) => a.ownerCode.localeCompare(b.ownerCode) || a.customerName.localeCompare(b.customerName)))
    console.log(
      `  ${c.ownerCode} | ${c.customerName} | ${c.combo.banksBefore.join(" + ")} = ${formatPoints(c.combo.before)} → ${c.combo.banksAfter.join(" + ") || "không còn"} = ${formatPoints(c.combo.after)} | trừ ${formatPoints(c.combo.points)}`,
    );
  if (!apply) return;
  if (counted.length === 0) {
    console.log("Không có gì để ghi.");
    return;
  }

  if (!asArg) throw new Error("Thiếu --as=<tên đăng nhập>. Trừ điểm KPI đổi lương, phải có người chịu trách nhiệm.");
  const [actor] = await db.select({ id: users.id }).from(users).where(sql`${users.username} = ${asArg} and ${users.active}`).limit(1);
  if (!actor) throw new Error(`Không tìm thấy tài khoản đang hoạt động nào có tên đăng nhập "${asArg}".`);

  await db.transaction(async (tx) => {
    await lockSalaryMonth(tx, month);
    if (await isMonthClosed(month, tx)) throw new Error(`Lương tháng ${month} đã chốt, không trừ được.`);

    const adjustmentOf = new Map<string, string>();
    for (const s of deducted) {
      const [row] = await tx
        .insert(kpiAdjustments)
        .values({ userId: s.userId, yearMonth: month, points: (-s.points).toFixed(2), reason, createdBy: actor.id })
        .returning({ id: kpiAdjustments.id });
      adjustmentOf.set(s.userId, row.id);
      await tx.execute(sql`
        insert into audit_log (actor_id, module, action, target_label, target_table, target_id)
        values (
          ${actor.id}, 'system'::module_key, 'adjust-kpi'::action_key,
          ${`Trừ ${formatPoints(s.points)} điểm KPI tháng ${month} cho ${s.fullName}`},
          'kpi_adjustments', ${row.id}
        )
      `);
    }

    // Khoá chính là tài khoản: tài khoản vừa bị lượt khác trừ thì lệnh này lỗi và cả lượt huỷ.
    await tx.insert(vpaUnqualifiedAccounts).values(
      counted.map((c) => ({
        bankAccountId: c.accountId,
        yearMonth: month,
        points: c.combo.points.toFixed(2),
        adjustmentId: adjustmentOf.get(c.ownerId) ?? null,
        pointsBefore: c.combo.before.toFixed(2),
        pointsAfter: c.combo.after.toFixed(2),
        banksBefore: c.combo.banksBefore,
        banksAfter: c.combo.banksAfter,
        createdBy: actor.id,
      })),
    );
  });
  console.log(`Đã ghi ${deducted.length} dòng điểm trừ và ${counted.length} tài khoản, kèm nhật ký truy vết.`);

  if (!withNotify) {
    console.log("Không gửi thông báo (thiếu --notify).");
    return;
  }
  const salaryMonth = `${month.slice(5)}/${month.slice(0, 4)}`;
  let sent = 0;
  for (const s of deducted.filter((x) => x.active)) {
    const ok = await notify(s.userId, "announcement", {
      title: `Đã tính lại điểm KPI tháng ${salaryMonth}`,
      body: `Điểm KPI tháng ${salaryMonth} của bạn bị trừ ${formatPoints(s.points)} điểm cho ${s.accounts} tài khoản. Lý do: ${reason}.`,
      url: `/users/${s.userId}?month=${month}`,
    }).catch(() => false);
    if (ok) sent++;
  }
  console.log(`Đã gửi thông báo cho ${sent} người. ${deducted.filter((x) => !x.active).length} tài khoản đã khoá không nhận.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
