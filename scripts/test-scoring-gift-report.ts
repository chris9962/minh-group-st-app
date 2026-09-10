import assert from "node:assert/strict";
import { giftFor, type GiftResult, type ScoringAccount } from "../src/rules";

// `server/exports` nạp pool nhưng ca thuần này không gọi database.
process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
const { giftReportLabel } = await import("../src/server/exports");

const snapshot = (
  name: string,
  caseCode: string | null,
  cash: { bankCode: string; amount: number }[],
) => ({
  caseCode,
  basket: [{ code: "BH-1N", name }],
  cashBreakdown: cash.map((item) => ({
    label: `${item.bankCode}, chi trong 5 ngày`,
    amount: item.amount,
  })),
});

const gift = (cash: { bankCode: string; amount: number }[]): Pick<GiftResult, "cash"> => ({
  cash: cash.map((item) => ({ ...item, withinDays: 5, reason: "test" })),
});

const grant = (cashTotal: number, frozenCash: { bankCode: string; amount: number }[]) => ({
  chosenItem: "BH-1N",
  cashTotal,
  snapshot: snapshot("1 năm bảo hiểm", "TH1", frozenCash),
});

const account = (bankCode: string, appInstalled: boolean): ScoringAccount => ({
  customerId: "khach",
  bankCode,
  appInstalled,
  openedDate: "2026-09-10",
  household: "none",
});

const beforeInstallingVpa = giftFor({
  accounts: [account("MB", true), account("VPa", false)],
  channelCodes: [], departmentCode: null, grantedItem: "BH-1N",
}, "2026-09-10");
const afterInstallingVpa = giftFor({
  accounts: [account("MB", true), account("VPa", true)],
  channelCodes: [], departmentCode: null, grantedItem: "BH-1N",
}, "2026-09-10");
assert.equal(beforeInstallingVpa?.cashTotal, 0);
assert.equal(afterInstallingVpa?.cashTotal, 20_000);

assert.equal(giftReportLabel(undefined, gift([])), "");
assert.equal(
  giftReportLabel(grant(0, []), afterInstallingVpa),
  "1 năm bảo hiểm + 20k",
  "tick app VPa sau khi chốt phải cộng 20k",
);
assert.equal(
  giftReportLabel(grant(20_000, [{ bankCode: "VPa", amount: 20_000 }]), gift([])),
  "1 năm bảo hiểm",
  "20k VPa phải đi theo trạng thái app hiện tại",
);
assert.equal(
  giftReportLabel(
    grant(50_000, [{ bankCode: "MSBa", amount: 50_000 }]),
    gift([{ bankCode: "VPa", amount: 20_000 }]),
  ),
  "1 năm bảo hiểm + 70k",
  "giữ 50k MSBa lúc chốt và cộng 20k VPa động",
);
assert.equal(
  giftReportLabel(
    grant(70_000, [
      { bankCode: "VPa", amount: 20_000 },
      { bankCode: "MSBa", amount: 50_000 },
    ]),
    gift([]),
  ),
  "1 năm bảo hiểm + 50k",
  "bỏ riêng 20k VPa, không làm mất 50k MSBa đã chốt",
);
assert.equal(
  giftReportLabel(grant(20_000, [{ bankCode: "VPa", amount: 20_000 }]), null),
  "1 năm bảo hiểm + 20k",
  "thiếu dữ liệu sống thì giữ số chốt cũ",
);

console.log("PASS: tiền VPa trong báo cáo động; món quà và tiền khác vẫn đóng băng.");
