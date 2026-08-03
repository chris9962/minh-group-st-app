# Báo cáo be-setup — 03/08/2026

## ĐỢT 2 (cùng ngày) — Bỏ toàn bộ mock, DB chuẩn uuid từ đầu

Quyết định của người dùng: gỡ hẳn MSW, xoá sạch DB, làm chuẩn từ giờ. **Phạm vi triển khai
GIỮ NGUYÊN** (đăng nhập · Phòng ban · Nhân sự & phân quyền) — trang thuộc module chưa xây
(khách hàng, ngân hàng, bảo hiểm, dịch vụ, cấu hình…) fetch lỗi và hiện lỗi, đó là chủ đích.

- **Gỡ mock tận gốc**: xoá `src/mocks/` + dep `msw` + `public/mockServiceWorker.js`;
  `providers.tsx` không còn nhánh USE_MOCK. `vnAddress.json` dời về `scripts/data/` (nguồn seed).
- **DB đập xây lại**: migration mới `drizzle/0000_init.sql` — **đủ 32 bảng · 16 enum đúng
  mgst-db-design.md, id uuid chuẩn** (hết ràng buộc id mock); kèm extension `unaccent`/`pg_trgm`
  + hàm `mgst_normalize` (đ/Đ → d/D) + cột sinh `customers.search_name` + index trigram cho C-06.
- **Seed chuẩn — không còn MỘT dòng dữ liệu giả**: 15 phòng thật · 12 tài khoản thật (demo pass
  `12345678`) · danh mục theo spec (13 ngân hàng, 5 kênh, 14 BV, 5 loại DV, 5 quà, 6 gói BH,
  7 quy tắc quà §5.2, chỉ tiêu 100 điểm) · 34 tỉnh + 3.321 xã tham chiếu · kho mã sạch (6 mã,
  0 lượt dùng). Bảng nghiệp vụ (khách, tài khoản, đơn, dịch vụ, quà) **trống** — như ngày đầu dùng thật.
- **Cột mới `users.staff_code`** (yêu cầu 03/08): mã nhân viên định danh ở app khác — partial
  unique, bắt buộc trên form P-53, lỗi `staff-code-taken` riêng; API staff giờ **zod-parse phía server**.
- **`/api/people` + `/api/people/:id` làm THẬT** (kéo vào phạm vi vì trang /people khoá bảng
  nhân sự sau query KPI): điểm tính sống từ bảng nghiệp vụ × hệ số danh mục — bảng trống thì
  0 điểm THẬT, dữ liệu vào tới đâu số đúng tới đó, không phải stub.

**Kiểm chứng đợt 2**: curl 7/7 (login uuid, 15 phòng, 12 nhân sự, tạo NV kèm mã, trùng mã →
`staff-code-taken`, thiếu mã → 400) · Playwright UI 5/5 (login không MSW, /departments,
/people hiện nhân sự thật + dialog có ô Mã nhân viên, /customers lỗi sạch) · tsc sạch ·
lint 14 vấn đề pre-existing (giảm 1 do xoá mock) · seed idempotent.

**Đăng nhập demo**: `giamdoc / tpkd2 / quantri / ntbtram + 12345678` (nv01… không còn — đó là dữ liệu giả).

---

# Báo cáo phiên tự động be-setup ĐỢT 1 — 03/08/2026 *(một phần đã bị đợt 2 thay thế: id text → uuid, seed 23 người → 12, MSW cắt từng phần → gỡ hẳn)*

> Thực hiện theo `docs/be-setup-brief.md`. Toàn bộ nằm trên branch **`be-setup`**, master không đụng.
> Kết quả: **hoàn thành đủ phạm vi, mọi kiểm chứng pass** (curl 23/23 · Playwright 8/8 · tsc sạch · lint không lỗi mới · seed idempotent).

## Cách chạy

```bash
bun install            # deps mới: drizzle-orm, pg, bcryptjs (+ drizzle-kit, @types dev)
bun run db:up          # Docker Postgres 16, port 5433, chờ healthy
bun run db:migrate     # chạy drizzle/0000_init.sql (đánh version, idempotent)
bun run db:seed        # 15 phòng + 23 nhân sự — mật khẩu demo 12345678
bun run dev            # như cũ — login/phòng ban/nhân sự giờ chạy DB thật
```

Tài khoản demo y hệt mock: `giamdoc / tpkd2 / quantri / ntbtram … + 12345678`.
**Lưu ý một lần**: ai đang có phiên cũ trong localStorage phải đăng nhập lại một lần để có cookie thật.

## Đã làm

| Hạng mục | Nội dung |
|---|---|
| Hạ tầng | `docker-compose.yml` (postgres:16-alpine, port 5433, healthcheck) · `.env.local`/`.env.example` · scripts `db:up · db:migrate · db:seed` |
| Schema | `src/server/db/schema.ts` — đủ **16 enum** + **6 bảng** (departments, users, user_managed_departments, user_permissions, sessions, audit_log) theo `mgst-db-design.md`; migration version `drizzle/0000_init.sql` |
| Seed | Đọc **thẳng từ src/mocks** (không chép tay): 12 người P-51 + 11 tài khoản còn lại = 23 users, 329 dòng quyền, 14 dòng phòng-quản; idempotent (chạy 2 lần không nhân đôi) |
| Đăng nhập | bcrypt · sai 5 lần khoá 15 phút (đếm trong DB, khoá cả khi gõ đúng lúc đang khoá) · session cookie httpOnly, DB giữ sha256 token · không lộ tên đăng nhập nào có thật |
| Phòng ban | list+summary (headcount MỘT câu GROUP BY) · tạo/đổi tên (so trùng bỏ dấu) · ngừng/mở (chặn ngừng phòng còn người) · chi tiết kèm người quản · gate `system:manage-org` · stats trả rỗng chờ bảng nghiệp vụ |
| Nhân sự | list lọc **phạm vi thật** (clampScope + visibleDepartmentIds — tpkd2 xin `company` vẫn bị hạ về kd-2) · tạo/sửa kiểm **bậc vai** + **từng ô quyền** phía server, ghi trong transaction · khoá/mở (mở khoá kèm xoá khoá-15-phút) · reset mật khẩu trả đúng một lần |
| Audit | `audit_log` ghi mọi thao tác ghi + lượt xem chi tiết nhân viên; append-only |
| Cắt MSW | Gỡ login/staff/org/departments khỏi handlers — MSW bypass sang API thật; **mọi module khác giữ nguyên mock** |
| Đồng bộ id | `u-staff` → `p2` trong mocks/data.ts (một người một id giữa DB ↔ mock ↔ P-51) |
| types.ts | Thêm `customer:access-id-number` (quyết định 03/08) — enum DB và zod khớp nhau |

## Kết quả kiểm chứng

**Curl suite — 23/23 PASS**: khoá 5 lần/15 phút (cả ca "đúng mật khẩu lúc đang khoá") · cookie phiên ·
response không lộ password · 401 không cookie · 15 phòng + headcount đúng · trùng tên bỏ dấu 422 ·
ngừng phòng còn người 422 · vòng đời phòng đủ · tpkd2 tạo phòng 403 · scope thật (23 vs 5 người) ·
role-too-high · permission-too-high · tạo nhân viên + reset mật khẩu + **đăng nhập được bằng mật khẩu vừa cấp** · khoá nhân viên · stats rỗng.

**Playwright smoke — 8/8 PASS**: login UI giamdoc → /departments 15 phòng → tạo phòng qua UI →
/people staff thật sống chung KPI mock → tpkd2 thấy kd-2, không thấy kd-7.

**Khác**: `tsc --noEmit` sạch · lint 15 vấn đề pre-existing (không lỗi mới, lỗi ProgressRing có từ trước) ·
seed chạy lại không nhân đôi · audit_log xác nhận có dòng khi mutation.

## Findings từ be-audit (tự rà theo .claude/skills/be-audit)

| Mức | Finding | Ghi chú |
|---|---|---|
| 🟡 | `GET /api/staff/:id` chỉ cần đăng nhập — chưa kiểm phạm vi/quyền xem, ai đăng nhập cũng gọi thẳng URL xem được hồ sơ + bảng quyền người khác | GIỮ NGUYÊN hành vi mock (mock cũng không kiểm); gate lại khi migrate trọn P-52 |
| 🟡 | Chưa có `/api/logout` — FE đăng xuất chỉ xoá store cục bộ, dòng session trong DB sống tới hết hạn | FE hiện không gọi endpoint nào khi logout; thêm khi làm đợt sau |
| 🟢 | Race tạo trùng: check JS trước insert; username có unique constraint đỡ lưng (race → 500 thay vì 422), tên phòng KHÔNG có unique theo bản-bỏ-dấu trong DB | Hiếm ở quy mô này; sửa đẹp khi có `mgst_normalize` (design doc §8) |
| 🟢 | `sessions` hết hạn chưa có dọn định kỳ | Thêm cron dọn khi deploy thật |
| 🟢 | Cookie chưa `Secure` | Cố ý — dev chạy http://localhost; bật khi https |

**Đã rà KHÔNG thấy vấn đề**: N+1 (quyền/phòng-quản nạp một lượt `relationsFor`, headcount GROUP BY) ·
lộ password/hash trong response · tin scope client (clamp mọi chỗ) · counter tự chế · đường UPDATE/DELETE
vào audit_log · đè `active` khi sửa hồ sơ · thiếu transaction ở ghi nhiều bảng.

## Hạn chế đã biết (chấp nhận trong đợt này)

1. **Stats phòng ban trả rỗng** — chưa có bảng nghiệp vụ; FE hiện "—" đúng thiết kế.
2. **Sửa quyền nhân viên chưa dội ngược vào mockUsers** — các module còn mock (banking, insurance…) dùng quyền cũ của phiên tới khi đăng nhập lại. Hết hẳn khi các module đó rời mock.
3. **`users.id`/`departments.id` là text** giữ id mock (`u-*`, `kd-*`, `p*`) — sai lệch có chủ đích với design doc; chuyển uuid khi module cuối rời mock.
4. Tài khoản `ktth` từng bị khoá 15 phút do test — **đã mở lại**; dữ liệu test curl/smoke **đã dọn khỏi DB**.

## Commit trên branch be-setup

1. `Dựng nền DB: Docker Postgres, schema Drizzle 16 enum + 6 bảng, migration, seed`
2. `API thật: đăng nhập + Phòng ban + Nhân sự & phân quyền, cắt MSW tương ứng`
3. Commit này: brief + báo cáo + skill be-audit.
