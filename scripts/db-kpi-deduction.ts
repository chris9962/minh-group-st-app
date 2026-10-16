import { sql } from "drizzle-orm";
import { formatPoints, roundPoints } from "../src/lib/format";
import { db } from "../src/server/db/client";
import { kpiAdjustments } from "../src/server/db/schema";
import { notify } from "../src/server/notifications";

/**
 * Trừ điểm KPI hàng loạt: mỗi mã nhân viên trong `BATCH` một dòng
 * `kpi_adjustments` điểm âm vào `BATCH.month`, rồi báo cho người đó.
 *
 * Dữ liệu nằm ngay trong file, không đọc Excel trên máy chủ (chủ dự án chốt
 * 2026-10-16): file báo cáo gửi tới chưa chắc đúng định dạng, nên người nhận
 * file kiểm tra trước, chép bảng điểm đã kiểm vào `BATCH`, commit rồi mới chạy.
 * Đợt mới thì thay cả `BATCH`; đợt cũ còn trong lịch sử git.
 *
 * Ghi vào `BATCH.month`, không phải tháng hiện tại như form ở P-52: điểm trừ
 * thuộc tháng lương chưa chốt, và phải ghi trước khi chốt lương tháng đó.
 *
 * Chạy khô để xem trước, không ghi gì:
 *   bun run db:kpi-deduction
 *
 * Ghi thật thì BẮT BUỘC khai người chịu trách nhiệm:
 *   bun run db:kpi-deduction -- --apply --as=admin
 *
 * ⚠️ Chỉ `--apply` trên máy chủ. Database local là bản dump production kèm khoá
 * push thật, ghi ở local là đẩy tin tới điện thoại thật của nhân viên.
 *
 * Chạy lại được: người đã có dòng cùng tháng, cùng lý do thì bỏ qua, không trừ
 * và không báo lần hai.
 */

type Deduction = {
  /** Tên đăng nhập trên app, không phân biệt hoa thường. */
  code: string;
  /** Số điểm trừ, ghi số dương. */
  points: number;
  /** Số tài khoản lỗi, ghi vào câu thông báo; `null` thì câu không nhắc. */
  accounts: number | null;
};

/**
 * Sheet "ĐIỂM TRỪ T08" của file Bao_Cao_VPBa_08_Diem_Tru_App_Loi.xlsx, bảng chi
 * tiết dòng 23-249: 0,3 điểm cho mỗi tài khoản VPBa không ghi nhận. Mã
 * 342NHUHB đứng ở hai phòng nên đã cộng thành một dòng; 2 mã điểm 0 đã bỏ.
 */
const BATCH: { month: string; reason: string; rows: Deduction[] } = {
  month: "2026-09",
  reason: "điểm trừ lỗi VPBa tháng 08 không ghi nhận đủ giao dịch khác ngày",
  rows: [
    { code: "019LYBTC", points: 31.8, accounts: 106 },
    { code: "243PHUNGVN", points: 25.5, accounts: 85 },
    { code: "332PHIPN", points: 17.4, accounts: 58 },
    { code: "377DUNGLTM", points: 15.9, accounts: 53 },
    { code: "025HUYLH", points: 36.6, accounts: 122 },
    { code: "023TRUONGBD", points: 23.7, accounts: 79 },
    { code: "027TRANLNH", points: 24.3, accounts: 81 },
    { code: "330AIHTT", points: 18.6, accounts: 62 },
    { code: "331LOCDCT", points: 14.4, accounts: 48 },
    { code: "208THAOBN", points: 13.2, accounts: 44 },
    { code: "333PHUONGPN", points: 15, accounts: 50 },
    { code: "030CHAUNTT", points: 34.8, accounts: 116 },
    { code: "029TRUONGNH", points: 33.6, accounts: 112 },
    { code: "158NGUYENTH", points: 32.7, accounts: 109 },
    { code: "024HANHN", points: 25.5, accounts: 85 },
    { code: "039LUONGH", points: 37.2, accounts: 124 },
    { code: "183NGHIANT", points: 29.7, accounts: 99 },
    { code: "246DUPV", points: 18.3, accounts: 61 },
    { code: "040THANGHT", points: 34.2, accounts: 114 },
    { code: "035NGOCCTB", points: 14.7, accounts: 49 },
    { code: "202DANGLQ", points: 24.6, accounts: 82 },
    { code: "047ANNN", points: 43.8, accounts: 146 },
    { code: "050NHANNTT", points: 6.3, accounts: 21 },
    { code: "367PHONGLK", points: 27.9, accounts: 93 },
    { code: "239VYNTT", points: 2.1, accounts: 7 },
    { code: "118KHOALHV", points: 5.4, accounts: 18 },
    { code: "100NAMDVQ", points: 4.2, accounts: 14 },
    { code: "224DANGTV", points: 0.3, accounts: 1 },
    { code: "247KIEUTT", points: 8.7, accounts: 29 },
    { code: "108QUYENDTM", points: 9.3, accounts: 31 },
    { code: "302DUDTB", points: 10.8, accounts: 36 },
    { code: "253PHONGLT", points: 8.1, accounts: 27 },
    { code: "177ANHDQ", points: 3.9, accounts: 13 },
    { code: "385LOCLH", points: 10.8, accounts: 36 },
    { code: "402QUINDP", points: 10.5, accounts: 35 },
    { code: "407DANGHM", points: 15.3, accounts: 51 },
    { code: "397HAUDC", points: 11.7, accounts: 39 },
    { code: "405NHINN", points: 7.5, accounts: 25 },
    { code: "394THIENLN", points: 9.6, accounts: 32 },
    { code: "417MAITTH", points: 7.2, accounts: 24 },
    { code: "393KHANHBD", points: 3.6, accounts: 12 },
    { code: "354KHANGLP", points: 11.4, accounts: 38 },
    { code: "386NGUOV", points: 9.6, accounts: 32 },
    { code: "392HAUPV", points: 11.1, accounts: 37 },
    { code: "297MINHNVA", points: 20.4, accounts: 68 },
    { code: "431PHUONGLTY", points: 11.1, accounts: 37 },
    { code: "391NGUYETTHA", points: 13.8, accounts: 46 },
    { code: "403LOANVTK", points: 13.2, accounts: 44 },
    { code: "410KHOILC", points: 14.4, accounts: 48 },
    { code: "399LUCNV", points: 6.6, accounts: 22 },
    { code: "396DATNP", points: 8.7, accounts: 29 },
    { code: "398HIENDC", points: 19.8, accounts: 66 },
    { code: "074BINHHVQ", points: 54.9, accounts: 183 },
    { code: "072DACHH", points: 55.5, accounts: 185 },
    { code: "267HUYENVTK", points: 34.2, accounts: 114 },
    { code: "286YNN", points: 32.7, accounts: 109 },
    { code: "419TRUNGLA", points: 54.6, accounts: 182 },
    { code: "210TRUNGLM", points: 61.8, accounts: 206 },
    { code: "195DUYENVTM", points: 71.7, accounts: 239 },
    { code: "435VINTT", points: 48.9, accounts: 163 },
    { code: "071NAMBQ", points: 42.6, accounts: 142 },
    { code: "081YENVTM", points: 46.2, accounts: 154 },
    { code: "356QUOCVT", points: 43.8, accounts: 146 },
    { code: "335GIANGMT", points: 43.8, accounts: 146 },
    { code: "334DIT", points: 42, accounts: 140 },
    { code: "018NHIENNTT", points: 66.9, accounts: 223 },
    { code: "357TRUNGTH", points: 13.5, accounts: 45 },
    { code: "190NGUYENTC", points: 24.6, accounts: 82 },
    { code: "191CHAULK", points: 24, accounts: 80 },
    { code: "199LUANHK", points: 13.2, accounts: 44 },
    { code: "322NHATHL", points: 26.4, accounts: 88 },
    { code: "319TUANTH", points: 14.7, accounts: 49 },
    { code: "194LUCNT", points: 25.2, accounts: 84 },
    { code: "412HANNHN", points: 5.1, accounts: 17 },
    { code: "430NHULT", points: 7.2, accounts: 24 },
    { code: "092HIEUTK", points: 18.9, accounts: 63 },
    { code: "254TAMTMT", points: 15, accounts: 50 },
    { code: "093THANHTM", points: 22.8, accounts: 76 },
    { code: "085QUANGLD", points: 19.5, accounts: 65 },
    { code: "323ANLQ", points: 16.2, accounts: 54 },
    { code: "086HOAIMV", points: 23.1, accounts: 77 },
    { code: "264YTN", points: 7.8, accounts: 26 },
    { code: "149DAMDV", points: 10.5, accounts: 35 },
    { code: "231HAONV", points: 41.7, accounts: 139 },
    { code: "152THAOPTT", points: 14.1, accounts: 47 },
    { code: "432NGUYENNTT", points: 8.1, accounts: 27 },
    { code: "105KHANHDD", points: 21.9, accounts: 73 },
    { code: "088THANHNV", points: 21.6, accounts: 72 },
    { code: "346PHUNGDTT", points: 12.3, accounts: 41 },
    { code: "345TRONGDT", points: 6.9, accounts: 23 },
    { code: "122SUONGNTT", points: 25.2, accounts: 84 },
    { code: "103TIENLTK", points: 27.3, accounts: 91 },
    { code: "308PHUTQ", points: 19.8, accounts: 66 },
    { code: "337LAMDQ", points: 30.3, accounts: 101 },
    { code: "132NHUNV", points: 29.1, accounts: 97 },
    { code: "102DANGHH", points: 16.8, accounts: 56 },
    { code: "353NHANTM", points: 8.1, accounts: 27 },
    { code: "311VYNTT", points: 9, accounts: 30 },
    { code: "157LONGTD", points: 6.3, accounts: 21 },
    { code: "255BAOPC", points: 9.6, accounts: 32 },
    { code: "114CHAULN", points: 6.9, accounts: 23 },
    { code: "155CAOPT", points: 12.9, accounts: 43 },
    { code: "141QUYNHTT", points: 5.1, accounts: 17 },
    { code: "280THINHNT", points: 15.3, accounts: 51 },
    { code: "414MAIVN", points: 5.4, accounts: 18 },
    { code: "249NGANNTK", points: 15.6, accounts: 52 },
    { code: "256THANHTV", points: 10.2, accounts: 34 },
    { code: "154CUONGPPK", points: 20.7, accounts: 69 },
    { code: "262HUONGTT", points: 18.9, accounts: 63 },
    { code: "313DUCLH", points: 9.6, accounts: 32 },
    { code: "165TRITL", points: 12.9, accounts: 43 },
    { code: "324KYNTD", points: 19.5, accounts: 65 },
    { code: "421NHANHNH", points: 9.6, accounts: 32 },
    { code: "075TULH", points: 5.7, accounts: 19 },
    { code: "434NGHIANV", points: 10.8, accounts: 36 },
    { code: "321LOCTH", points: 28.8, accounts: 96 },
    { code: "426MYDH", points: 18.3, accounts: 61 },
    { code: "134DUNGSTT", points: 12.6, accounts: 42 },
    { code: "299PHUONGNQ", points: 17.1, accounts: 57 },
    { code: "320THUANTT", points: 33.9, accounts: 113 },
    { code: "261DANGHM", points: 29.1, accounts: 97 },
    { code: "422KHANHNT", points: 11.7, accounts: 39 },
    { code: "079TRUYENNV", points: 5.4, accounts: 18 },
    { code: "310DUTV", points: 17.4, accounts: 58 },
    { code: "109GIAUDV", points: 3.9, accounts: 13 },
    { code: "245MYNTN", points: 6.3, accounts: 21 },
    { code: "350NGUYENVC", points: 10.5, accounts: 35 },
    { code: "236TRUNGPN", points: 15.6, accounts: 52 },
    { code: "349TRIHM", points: 13.8, accounts: 46 },
    { code: "179NHUNGPTT", points: 11.4, accounts: 38 },
    { code: "032TUANPT", points: 24, accounts: 80 },
    { code: "124BINHNN", points: 6.9, accounts: 23 },
    { code: "015VIHK", points: 18.3, accounts: 61 },
    { code: "135HUNGTT", points: 0.9, accounts: 3 },
    { code: "111MIHT", points: 10.8, accounts: 36 },
    { code: "099HUYENDTN", points: 13.5, accounts: 45 },
    { code: "010LINHHP", points: 3.3, accounts: 11 },
    { code: "336THANHNH", points: 32.7, accounts: 109 },
    { code: "184THAOPTP", points: 18.3, accounts: 61 },
    { code: "119TIENLTN", points: 1.5, accounts: 5 },
    { code: "126NGOCNQK", points: 3, accounts: 10 },
    { code: "034THUVV", points: 4.2, accounts: 14 },
    { code: "315LUONGLM", points: 7.2, accounts: 24 },
    { code: "293TRUYENNT", points: 12.3, accounts: 41 },
    { code: "117DANGLH", points: 40.8, accounts: 136 },
    { code: "437NGUYENTDT", points: 6, accounts: 20 },
    { code: "418PHATDN", points: 4.8, accounts: 16 },
    { code: "428YNN", points: 9.3, accounts: 31 },
    { code: "429MANLH", points: 12.6, accounts: 42 },
    { code: "012TAINV", points: 4.2, accounts: 14 },
    { code: "425DATLT", points: 7.5, accounts: 25 },
    { code: "203HANLTN", points: 9, accounts: 30 },
    { code: "257QUYNHLV", points: 4.5, accounts: 15 },
    { code: "098HUYNHDM", points: 5.4, accounts: 18 },
    { code: "160DUYNC", points: 3.9, accounts: 13 },
    { code: "381HOAINT", points: 3.3, accounts: 11 },
    { code: "294THAIPQ", points: 12.9, accounts: 43 },
    { code: "163TRANGPTT", points: 7.2, accounts: 24 },
    { code: "296TAMNT", points: 2.7, accounts: 9 },
    { code: "342NHUHB", points: 6.3, accounts: 21 },
    { code: "175THUNPM", points: 8.1, accounts: 27 },
    { code: "343TRANGVTK", points: 12.3, accounts: 41 },
    { code: "384DANGTT", points: 7.5, accounts: 25 },
    { code: "147MYVK", points: 21, accounts: 70 },
    { code: "240HATTT", points: 5.7, accounts: 19 },
    { code: "140TUYENTN", points: 8.7, accounts: 29 },
    { code: "341THAOHD", points: 23.1, accounts: 77 },
    { code: "235DUYENNTN", points: 5.7, accounts: 19 },
    { code: "438LENNTK", points: 3.9, accounts: 13 },
    { code: "395NAMPV", points: 11.7, accounts: 39 },
    { code: "404ANHDTN", points: 9.6, accounts: 32 },
    { code: "406ANNT", points: 15.3, accounts: 51 },
    { code: "325TINKT", points: 9.9, accounts: 33 },
    { code: "436BANGTK", points: 0.6, accounts: 2 },
    { code: "420NHUVK", points: 0.9, accounts: 3 },
    { code: "433TRANLTB", points: 3.3, accounts: 11 },
    { code: "139THOTH", points: 5.4, accounts: 18 },
    { code: "372TIEPMT", points: 6, accounts: 20 },
    { code: "389PHUNT", points: 6.6, accounts: 22 },
    { code: "138GIAOTP", points: 8.4, accounts: 28 },
    { code: "143KHOITH", points: 0.3, accounts: 1 },
    { code: "305NGANPTK", points: 3, accounts: 10 },
    { code: "361NGOCLB", points: 7.8, accounts: 26 },
    { code: "121TUYENNN", points: 11.7, accounts: 39 },
    { code: "327HOAILC", points: 9.3, accounts: 31 },
    { code: "413THIETSH", points: 11.7, accounts: 39 },
    { code: "344DUNGNQ", points: 12.3, accounts: 41 },
    { code: "309KHENTQ", points: 16.2, accounts: 54 },
    { code: "442KHAITQ", points: 11.4, accounts: 38 },
    { code: "115PHONGLQ", points: 11.4, accounts: 38 },
    { code: "328HIEUPM", points: 16.5, accounts: 55 },
    { code: "443NHANNH", points: 9.6, accounts: 32 },
    { code: "181TRANGPT", points: 2.4, accounts: 8 },
    { code: "441ANBTT", points: 13.8, accounts: 46 },
    { code: "440THAMTTH", points: 3.3, accounts: 11 },
    { code: "242KHANGTM", points: 2.7, accounts: 9 },
    { code: "355LINHPM", points: 4.2, accounts: 14 },
    { code: "451DUONGNT", points: 15, accounts: 50 },
    { code: "447KHANGNH", points: 0.6, accounts: 2 },
    { code: "347ANVH", points: 4.5, accounts: 15 },
    { code: "444LEPTN", points: 9.3, accounts: 31 },
    { code: "298NGUYENTT", points: 9, accounts: 30 },
    { code: "449DELH", points: 0.9, accounts: 3 },
    { code: "452UYENNTM", points: 8.7, accounts: 29 },
    { code: "445NHINTY", points: 0.6, accounts: 2 },
    { code: "454VYNTT", points: 9.3, accounts: 31 },
    { code: "450LOCBT", points: 0.9, accounts: 3 },
    { code: "446KHANHNQ", points: 0.3, accounts: 1 },
    { code: "370LYHT", points: 10.2, accounts: 34 },
    { code: "360TRANNN", points: 3.3, accounts: 11 },
    { code: "127MINHNT", points: 0.3, accounts: 1 },
    { code: "374NHUTTH", points: 3.6, accounts: 12 },
    { code: "455TRANGLTT", points: 3.3, accounts: 11 },
    { code: "448SAHAVM", points: 1.8, accounts: 6 },
    { code: "439DANNTY", points: 1.5, accounts: 5 },
    { code: "458FINECA", points: 13.5, accounts: 45 },
    { code: "457HUNGPD", points: 8.1, accounts: 27 },
    { code: "456DATLM", points: 20.7, accounts: 69 },
    { code: "145NHUTTY", points: 5.4, accounts: 18 },
    { code: "453KHANHLV", points: 5.1, accounts: 17 },
    { code: "460LICHNV", points: 2.1, accounts: 7 },
    { code: "338THUYENVP", points: 0.3, accounts: 1 },
    { code: "142QUYNHTX", points: 3, accounts: 10 },
    { code: "464XUYENNTB", points: 2.4, accounts: 8 },
  ],
};

type Person = { id: string; username: string; full_name: string; active: boolean };

async function main() {
  const apply = process.argv.includes("--apply");
  const asArg = process.argv.find((a) => a.startsWith("--as="))?.slice(5) ?? "";
  const { month, reason, rows } = BATCH;
  const monthText = `${month.slice(5)}/${month.slice(0, 4)}`;

  const codes = rows.map((d) => d.code.toLowerCase());
  if (new Set(codes).size !== codes.length) throw new Error("BATCH có mã nhân viên lặp, cộng thành một dòng rồi chạy lại.");
  if (rows.some((d) => !(d.points > 0))) throw new Error("BATCH có dòng điểm trừ không dương.");

  const people = await db.execute<Person>(sql`
    select id, username, full_name, active from users
    where lower(username) in (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})
  `);
  const personOf = new Map(people.rows.map((p) => [p.username.toLowerCase(), p]));

  const applied = await db.execute<{ user_id: string }>(sql`
    select user_id from kpi_adjustments where year_month = ${month} and reason = ${reason}
  `);
  const done = new Set(applied.rows.map((r) => r.user_id));

  const missing = rows.filter((d) => !personOf.has(d.code.toLowerCase()));
  const already = rows.filter((d) => done.has(personOf.get(d.code.toLowerCase())?.id ?? ""));
  const todo = rows
    .map((d) => ({ ...d, person: personOf.get(d.code.toLowerCase()) }))
    .filter((d): d is Deduction & { person: Person } => !!d.person && !done.has(d.person.id));

  const total = (list: { points: number }[]) => formatPoints(roundPoints(list.reduce((s, d) => s + d.points, 0)));
  console.log(`Tháng ghi: ${month}. Lý do: "${reason}".`);
  console.log(`Đợt này có ${rows.length} mã bị trừ điểm, tổng ${total(rows)} điểm.`);
  if (missing.length > 0)
    console.log(
      `Không có tài khoản trên app, bỏ qua ${missing.length} mã, ${total(missing)} điểm:\n` +
        missing.map((d) => `  ${d.code}: ${formatPoints(d.points)}`).join("\n"),
    );
  if (already.length > 0) console.log(`Đã trừ ở lần chạy trước, bỏ qua ${already.length} người.`);
  if (todo.length === 0) {
    console.log("Không còn ai cần trừ điểm.");
    process.exit(0);
  }

  const inactive = todo.filter((d) => !d.person.active);
  console.log(
    `${todo.length} người sắp bị trừ, tổng ${total(todo)} điểm${apply ? "" : " (CHẠY KHÔ, không ghi gì)"}:\n` +
      todo
        .map((d) => `  ${d.person.full_name} (${d.code}): -${formatPoints(d.points)}${d.person.active ? "" : ", đã nghỉ"}`)
        .join("\n"),
  );
  if (inactive.length > 0)
    console.log(`Trong đó ${inactive.length} người đã nghỉ: vẫn trừ điểm, không gửi thông báo.`);
  if (!apply) process.exit(0);

  if (!asArg) throw new Error("Thiếu --as=<tên đăng nhập>. Trừ điểm KPI đổi lương, phải có người chịu trách nhiệm.");
  const actor = await db.execute<{ id: string }>(sql`select id from users where username = ${asArg} and active limit 1`);
  const actorId = actor.rows[0]?.id;
  if (!actorId) throw new Error(`Không tìm thấy tài khoản đang hoạt động nào có tên đăng nhập "${asArg}".`);

  await db.transaction(async (tx) => {
    for (const d of todo) {
      const [row] = await tx
        .insert(kpiAdjustments)
        .values({
          userId: d.person.id,
          yearMonth: month,
          points: (-d.points).toFixed(2),
          reason,
          createdBy: actorId,
        })
        .returning({ id: kpiAdjustments.id });
      // Cùng nhãn với route cộng điểm ở P-52, để màn nhật ký đọc như một lần trừ tay.
      await tx.execute(sql`
        insert into audit_log (actor_id, module, action, target_label, target_table, target_id)
        values (
          ${actorId}, 'system'::module_key, 'adjust-kpi'::action_key,
          ${`Trừ ${formatPoints(d.points)} điểm KPI tháng ${month} cho ${d.person.full_name}`},
          'kpi_adjustments', ${row.id}
        )
      `);
    }
  });
  console.log(`Đã ghi ${todo.length} dòng điểm trừ và nhật ký truy vết.`);

  // Gửi sau khi transaction xong: thông báo không được đi trước điểm đã ghi.
  let sent = 0;
  for (const d of todo.filter((t) => t.person.active)) {
    const accounts = d.accounts === null ? "" : ` cho ${d.accounts} tài khoản`;
    const ok = await notify(d.person.id, "announcement", {
      title: `Đã tính lại điểm KPI tháng ${monthText}`,
      body: `Điểm KPI tháng ${monthText} của bạn bị trừ ${formatPoints(d.points)} điểm${accounts}. Lý do: ${reason}.`,
    });
    if (ok) sent++;
  }
  console.log(`Đã gửi thông báo cho ${sent} người.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
