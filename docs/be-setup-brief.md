# Nhiệm vụ phiên tự động — Dựng nền backend (be-setup)

> Phiên này chạy TỰ ĐỘNG, không có người giám sát. MỌI quyết định đã chốt trong file này —
> không hỏi lại, không mở rộng phạm vi. Bế tắc thì ghi lại rồi dừng sạch sẽ (xem §7).

## 0. Quyết định đã chốt (03/08, cùng người dùng)

| Quyết định | Giá trị |
|---|---|
| Kiến trúc BE | **Next.js route handlers ngay trong mgst-app** (`app/api/**/route.ts`) — FE đã gọi `/api/...`, gỡ handler khỏi MSW là request đi thẳng API thật, KHÔNG sửa component |
| DB layer | **Drizzle ORM + drizzle-kit** — schema TypeScript ở `src/server/db/schema.ts`, migration SQL đánh version trong thư mục `drizzle/` |
| DB engine | Postgres 16 (alpine) qua **docker compose**, port **5433** (tránh đụng 5432), db/user `mgst` |
| Giao kết quả | Branch **`be-setup`** tách từ master. Commit theo bước. **KHÔNG push, KHÔNG đụng master** |
| Băm mật khẩu | **bcryptjs** (pure JS — không rắc rối native build với bun) |
| Nguồn sự thật schema | `../mgst-db-design.md` (thư mục cha) — đọc TRƯỚC khi viết schema. Enum `access-id-number` đã chốt 03/08 |

## 1. Đọc trước khi làm (đúng các file này, đủ rồi thì thôi)

`../mgst-db-design.md` (toàn bộ) · `AGENTS.md` · `src/lib/types.ts` · `src/lib/permissions.ts` ·
`src/lib/roles.ts` · `src/lib/api/auth.ts` · `src/lib/api/staff.ts` · `src/lib/api/org.ts` ·
`src/lib/api/departments.ts` · `src/mocks/handlers.ts` (phần login/staff/org) · `src/mocks/data.ts` ·
`src/store/session.ts`

## 2. Phạm vi ĐỢT NÀY — không hơn không kém

### 2a. Hạ tầng
- `docker-compose.yml`: `postgres:16-alpine`, port `5433:5432`, volume named, healthcheck `pg_isready`.
- `.env.local` (gitignored — kiểm tra `.gitignore` có cover): `DATABASE_URL=postgres://mgst:mgst@localhost:5433/mgst`, `SESSION_SECRET` chuỗi ngẫu nhiên. Kèm `.env.example` commit được.
- Scripts trong `package.json`: `db:up` (docker compose up -d + chờ healthy), `db:migrate`, `db:seed`.
- Docker daemon đang tắt thì `open -a Docker` rồi poll `docker info` tối đa ~90s.

### 2b. Schema + migration (chỉ nhóm phục vụ đợt này)
Tạo **toàn bộ 16 enum** theo design doc (rẻ, làm một lần), nhưng **bảng thì chỉ 6**:
`departments` · `users` · `user_managed_departments` · `user_permissions` · `sessions` · `audit_log`.
Các bảng khác (customers, bank_accounts…) **KHÔNG tạo đợt này**.

⚠️ **Sai lệch CÓ CHỦ ĐÍCH so với design doc**: `users.id` và `departments.id` dùng **`text`**
(không phải uuid), seed giữ NGUYÊN id chuỗi từ `src/mocks/data.ts` (`u-director`, `kd-2`…).
Lý do: các module còn chạy mock (banking, insurance, people…) tra actor bằng
`actorBy(actorId)` trên đúng các id đó — đổi id là vỡ mọi trang chưa migrate.
Ghi TODO trong schema: "chuyển uuid khi module cuối rời mock". Các cột còn lại bám đúng design doc
(kể cả `failed_attempts`, `locked_until`, partial index, append-only audit_log).

### 2c. Seed (idempotent — chạy lại không nhân đôi)
- 15 phòng + 12 tài khoản từ `src/mocks/data.ts`, giữ nguyên id/username/role/manageScope/managedDepartmentIds.
- Mật khẩu tất cả `12345678` băm bcryptjs (cost 10).
- `user_permissions` bung từ mảng `permissions` của từng account (nguồn `src/lib/roles.ts` + các bộ riêng trong data.ts).

### 2d. Route handlers thật (app/api/**/route.ts + tầng SQL tập trung src/server/)
- **`POST /api/login`** — đúng shape `LoginResult`/`LoginError` ở `src/lib/types.ts`: sai → `bad-credentials` + `attemptsLeft`; sai lần 5 → khoá 15 phút (`locked` + `lockedUntil`); đúng → reset đếm, tạo session (token 32 byte random, lưu **sha256 hash** vào `sessions`, cookie `mgst_session` httpOnly sameSite=lax, maxAge 30 ngày / 365 ngày theo `remember`), trả user KHÔNG kèm password_hash.
- **Auth helper** `src/server/auth.ts` — `getActor(request)`: đọc cookie → tra sessions (chưa hết hạn) → trả User đầy đủ permissions. Không có → 401. **actorId client gửi lên: BỎ QUA hoàn toàn** — actor chỉ lấy từ session.
- **`GET /api/departments`** — danh sách phòng active (cho ô lọc).
- **`/api/org/departments`** — GET (search + summary), POST tạo; **`/api/org/departments/stats`** — GET trả `{ departments: [] }` (DB chưa có dữ liệu nghiệp vụ — FE tự hiện "—"); **`/api/org/departments/[id]`** — GET detail (managers suy từ users), POST đổi tên; **`/[id]/active`** — POST. Gate `system:manage-org` (trừ GET list/detail: theo đúng hành vi mock hiện tại). Mã lỗi đúng FE chờ: `name-taken`, `department-not-empty` (so tên bỏ dấu như `sameName` trong mock). Chặn ngừng phòng còn người.
- **`/api/staff`** — GET (lọc scope qua `clampScope` với actor từ session, search/status/roles như mock), POST tạo (kiểm **bậc vai** + **canGrant từng ô quyền** — spec §10.1, lỗi `role-too-high`/`permission-too-high`/`username-taken`); **`/api/staff/[id]`** — GET, PATCH; **`/[id]/active`** POST; **`/[id]/reset-password`** POST (sinh mật khẩu mới, trả về đúng một lần, lưu hash).
- **`audit_log`**: ghi cho mọi thao tác GHI (tạo/sửa/khoá phòng & nhân viên, reset mật khẩu) + xem chi tiết nhân viên. Append-only.
- Tuân **§11 mgst-db-design.md**: SQL tập trung `src/server/`, không N+1 (headcount phòng = 1 câu GROUP BY), mọi danh sách có limit hợp lý, transaction cho create-staff (users + permissions + managed_departments trong một transaction).

### 2e. Cắt MSW cho đúng các route đã thật
Xoá khỏi `src/mocks/handlers.ts` CHỈ các handler: login, staff*, org/departments*, departments list.
MSW mặc định bypass request không có handler → tự đi vào API thật. **Mọi handler khác GIỮ NGUYÊN.**
Không sửa component FE. Nếu một fetcher FE gửi `actorId` thừa — kệ nó, server bỏ qua, không sửa FE.

## 3. Kiểm chứng — tự chạy, tự ghi kết quả

1. `bunx tsc --noEmit` sạch; `bun run lint` không lỗi MỚI (pre-existing ProgressRing bỏ qua).
2. `db:up` → `db:migrate` → `db:seed` chạy ngọt; seed chạy 2 lần không nhân đôi.
3. **Curl suite** (chạy `bun dev` nền ở port 3100, xong kill): login đúng → 200 + cookie; sai mật khẩu 5 lần → `locked` + `lockedUntil`; GET `/api/org/departments` không cookie → 401; có cookie giamdoc → đủ 15 phòng; POST phòng trùng tên → 422 `name-taken`; ngừng phòng còn người → 422 `department-not-empty`; tpkd2 tạo nhân viên vai `director` → 422 `role-too-high`; reset-password trả mật khẩu mới.
4. **Playwright smoke** (headless — được phép trong phiên này): login UI bằng `giamdoc/12345678` → `/departments` hiện 15 phòng → tạo phòng mới + đổi tên + ngừng phòng rỗng qua UI → `/people` hiện danh sách nhân viên (staff đã thật; KPI vẫn mock — chấp nhận) → login `tpkd2` xác nhận danh sách staff bị giới hạn phạm vi.
5. Chạy **`/be-audit`** trên code mới viết, đính tóm tắt findings vào báo cáo.

## 4. Báo cáo cuối — `docs/be-setup-report.md`

Ghi: việc đã làm · bảng kết quả test (pass/fail từng mục §3) · hạn chế đã biết
(stats trả rỗng; sửa quyền nhân viên chưa đồng bộ ngược vào mockUsers nên module mock dùng quyền cũ
tới khi reload; id text chờ chuyển uuid) · cách chạy (db:up → db:migrate → db:seed → bun dev) ·
findings be-audit. Commit tất cả lên `be-setup`.

## 5. Quy ước commit

Commit theo bước hợp lý (hạ tầng → schema+seed → auth → org → staff → cắt MSW → test+report),
message tiếng Việt như lịch sử repo, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## 6. Cấm

- Đụng master. Push. Sửa component FE. Đụng module nghiệp vụ khác (customers/banking/insurance/services/settings — cả mock lẫn API). Tạo bảng ngoài danh sách §2b. Thêm thư viện ngoài: drizzle-orm, drizzle-kit, pg (hoặc postgres.js), bcryptjs. Hỏi người dùng (không có ai trả lời).

## 7. Khi bế tắc

Docker không dậy / migration hỏng không gỡ được / quota cạn giữa chừng → commit WIP lên `be-setup`,
ghi `docs/be-setup-report.md` phần "DỪNG Ở ĐÂU + LỖI GÌ + LÀM TIẾP THẾ NÀO", dừng. Không cố phá.
