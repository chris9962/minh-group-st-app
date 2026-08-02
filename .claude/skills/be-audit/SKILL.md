---
name: be-audit
description: Audit code backend/tầng dữ liệu của MGST theo bộ rule đã chốt — SQL & hiệu năng (mgst-db-design.md §11), phân quyền, snapshot lịch sử, transaction, bảo mật. Dùng khi cần rà lại backend trước khi merge/deploy, hoặc định kỳ sau một đợt agent code nhiều.
---

# Audit backend MGST

Bạn là auditor rà code backend của nền tảng MGST theo các rule dự án đã chốt.
Mục tiêu: bắt đúng các lỗi **không lộ lúc dev** (dữ liệu bé, gì cũng nhanh, một mình một phiên)
nhưng phát nổ khi chạy thật — N+1, quên kiểm quyền phía server, viết lại lịch sử, race condition.

## Nguồn sự thật — đọc TRƯỚC khi rà

| Tài liệu | Lấy gì từ đó |
|---|---|
| `../mgst-db-design.md` §9 | Danh sách giá trị CẤM lưu (used/holding, giftStatus, điểm KPI…) |
| `../mgst-db-design.md` §10 | Bất biến app phải giữ (transition, for update, canGrant, clampScope…) |
| `../mgst-db-design.md` §11 | 10 rule SQL bắt buộc |
| `../mgst-platform-spec.md` §1.1, §10 | Mô hình phân quyền 3 trục, chặn tự nâng quyền |
| `AGENTS.md` | Quy ước code chung của repo |

## Phạm vi rà

- **Khi backend thật đã tồn tại**: rà repo/thư mục backend đó (tầng queries, handlers, migrations).
- **Hiện tại (chưa có backend thật)**: backend = MSW handlers — rà `src/mocks/handlers.ts` + các module `src/mocks/*.ts` chứa logic nghiệp vụ, và `src/lib/permissions.ts`. Mock là bản nháp của backend thật nên logic sai ở đây sẽ được chép nguyên sang backend.

Không rà component React, CSS, hay chuyện style code — skill này chỉ lo ĐÚNG ĐẮN và HIỆU NĂNG của tầng dữ liệu.

## Hạng mục kiểm — theo thứ tự ưu tiên

### A · Phân quyền (nghiêm trọng nhất — lỗi ở đây là lỗ hổng, không phải bug)

1. Mọi endpoint danh sách / chi tiết / xuất dữ liệu đi qua **đúng một hàm kiểm quyền**
   (`can` / `scopeFor` / `clampScope` trong `src/lib/permissions.ts`) — tìm endpoint nào
   tự viết điều kiện phạm vi riêng hoặc quên hẳn.
2. **Không tin tham số scope từ client** — mọi chỗ đọc `scope` từ query/body phải đi qua
   `clampScope` trước khi dùng. Grep `params.get("scope")` và soi từng chỗ.
3. Mutation (POST/PATCH/DELETE) kiểm quyền **ở server**, không dựa vào việc UI đã ẩn nút.
4. Tạo/sửa nhân viên: có kiểm **bậc vai** (không tạo vai cao hơn mình) và **canGrant từng ô quyền**
   (không cấp rộng hơn chính mình) — spec §10.1.
5. Ghi `audit_log` cho: xem chi tiết khách hàng, mọi thao tác ghi/sửa, mọi lượt xuất Excel.

### B · SQL & hiệu năng (mgst-db-design.md §11 — 10 rule)

Với mock hiện tại, dấu hiệu tương đương của từng rule:

1. **N+1**: `await` hoặc gọi hàm truy dữ liệu bên trong `for`/`.map()` khi dựng một danh sách —
   đúng ra phải gom một lượt (JOIN/GROUP BY khi có SQL thật).
2. **Kéo hết rồi lọc bằng JS**: chấp nhận được trong mock, nhưng ĐÁNH DẤU các chỗ backend thật
   phải chuyển thành WHERE/aggregate — đặc biệt chỗ nào lọc sau khi đã map/enrich nặng.
3. **Index**: query mới trên bảng lớn (`bank_accounts`, `insurance_orders`, `services`, `audit_log`)
   phải khớp index đã khai ở §8 — pattern WHERE mới mà không có index đi kèm là finding.
4. **Danh sách không phân trang**: endpoint trả mảng không `limit` — `audit_log` là bắt buộc tuyệt đối.
5. **Read-modify-write không có khoá**: giữ chỗ mã giới thiệu, sinh mã đơn (`order_code_counters`),
   chốt quà — phải là transaction + `select … for update` (backend thật) / phải ghi chú rõ (mock).
6. **Counter tự chế**: biến đếm lưu sẵn cho giá trị §9 cấm lưu (used/holding, giftStatus, điểm KPI,
   tổng app) — mọi chỗ phải đếm/tính từ bản ghi thật.

### C · Snapshot & bất biến lịch sử

1. `created_by_department_id` ghi lúc INSERT và **không bao giờ** bị UPDATE khi luân chuyển người.
2. Các snapshot khác đúng chỗ: `services.ward_name` (xã lúc tạo), `insurance_orders.package_name`
   (tên gói lúc tạo), kênh chép vào `bank_accounts` lúc mở.
3. `audit_log` chỉ ghi thêm — không có đường UPDATE/DELETE.
4. `gift_grants` bất biến sau khi chốt; `snapshot` đóng băng, không tính lại theo luật mới.
5. Không có code nào tra ĐỘNG hồ sơ nhân viên để suy ra dữ liệu lịch sử (phòng, xã) —
   đổi hồ sơ hôm nay không được làm đổi báo cáo tháng trước.

### D · Vòng đời & bất biến nghiệp vụ

1. Trạng thái đơn bảo hiểm chỉ chuyển theo đồ thị hợp lệ
   (`queued→creating→pending-approval→done`, lỗi rẽ `manual-queued→manual-progress→done`) —
   server từ chối trạng thái tuỳ ý từ client; mỗi lần chuyển ghi `insurance_order_status_history`.
2. `bank_accounts`: xoá thật CHỈ khi `creating`; `finish` chỉ từ `creating`; đủ ảnh theo
   `required_photos` mới cho hoàn thành (chặn cứng); bản ghi `done` không sửa được ngoài ảnh.
3. Quà: một khách đúng một `gift_grant` (unique) — kiểm cả ở code lẫn constraint;
   nhóm `cash` luôn mode `accumulate`.
4. `account_type` chỉ khác `none` khi ngân hàng là VPa.
5. Không xoá cứng ở mọi bảng có lịch sử trỏ vào (phòng, người, ngân hàng, danh mục) — chỉ `active=false`;
   không cho ngừng phòng còn người.

### E · Bảo mật dữ liệu

1. `password_hash` / `password` không bao giờ nằm trong response — kiểm mọi chỗ trả `user`/`staff`
   có strip đúng không (pattern mock: `const { password: _omit, ...user }`).
1b. **CCCD là trường bảo mật** (quyết định 03/08): response mặc định chỉ trả 4 số cuối
   (`**** 4871`) — grep mọi chỗ trả `idNumber`/`id_number` ra client. Một quyền duy nhất
   `customer:access-id-number` gate cả XEM đầy đủ (endpoint reveal — mỗi lượt ghi audit_log),
   SỬA ô CCCD, và luồng "điền theo khách hàng" (vì số hiện trong form). Luồng update thường
   phải BỎ QUA giá trị dạng `**** NNNN` client gửi lên (không cho đè mất số thật).
2. Mật khẩu PVI không bao giờ trả về client, kể cả màn quản trị.
3. Khoá đăng nhập: sai 5 lần liên tiếp → khoá 15 phút; đăng nhập đúng reset đếm; quản trị mở lại được.
4. Session hết hạn kiểm **phía server** ở mọi request, không chỉ client.

### F · Toàn vẹn dữ liệu & xuất Excel

1. CCCD trùng → chặn kèm trả về hồ sơ đã có (không phải lỗi ngõ cụt); unique chỉ áp khi không null.
2. Mỗi khách đúng một SĐT chính.
3. Xuất Excel đi qua hàm format dùng chung (`src/lib/format.ts`): SĐT/CCCD ép cột text,
   tên VIẾT HOA BỎ DẤU với `đ/Đ → d/D` — không tự viết lại normalize.

## Cách làm việc

1. Đọc các mục tài liệu ở bảng trên (chỉ đúng các mục đó, không đọc cả file).
2. Xác định phạm vi: backend thật hay mock (xem "Phạm vi rà").
3. Rà theo thứ tự A → F. Dùng grep tìm ứng viên, nhưng **mọi finding phải được xác nhận bằng cách
   đọc trọn hàm chứa nó** — không báo lỗi chỉ dựa trên một dòng grep khớp.
4. Điều gì mock làm "tạm được" nhưng backend thật bắt buộc làm khác (vd lọc bằng JS) →
   ghi loại riêng "nợ khi chuyển backend thật", không tính là bug hiện tại.

## Báo cáo

Chỉ báo lỗi CÓ KỊCH BẢN HỎNG CỤ THỂ — không báo nitpick style, không báo "nên cân nhắc".
Mỗi finding gồm: `file:dòng` · rule bị vi phạm (vd "A2", "B1") · kịch bản hỏng
(input/tình huống nào → sai gì) · đề xuất sửa một câu.

Xếp theo mức, nặng trước:

- 🔴 **Nghiêm trọng** — phân quyền hở, mất/sai dữ liệu, viết lại lịch sử, race condition có thật
- 🟡 **Cao** — hiệu năng sẽ nổ theo thời gian (N+1, không phân trang, thiếu index), thiếu audit log
- 🟢 **Ghi nhận** — nợ khi chuyển backend thật, lệch quy ước chưa gây hại

Cuối báo cáo: bảng tóm tắt số finding theo mức + theo hạng mục A–F, và danh sách các hạng mục
đã rà mà KHÔNG có finding (để biết cái gì đã được kiểm chứ không phải bị bỏ sót).
