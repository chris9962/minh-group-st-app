# Trạng thái bot PVI

Cập nhật 2026-08-15. Đọc file này trước khi làm tiếp.

`README.md` nói cách CHẠY. File này nói đang làm tới đâu, chỗ nào chưa chắc, và
việc tiếp theo là gì. `LUONG-TAO-VA-DUYET.md` nói vì sao bot tách hai luồng và
luồng duyệt phải làm những bước nào.

## Chạy được tới đâu

| Bước | Trạng thái |
|---|---|
| Điền 26 ô của form tai nạn điện | Xong. Chạy trên PVI thật 2026-08-23: mọi ô đạt, không ô nào bị trang ghi đè |
| Bấm nút "Chấp nhận" lúc tạo đơn | Người bấm tay được, bot chưa bấm lần nào |
| Đọc `pr_key` của đơn vừa tạo | PVI không trả lúc bấm — lấy ở màn Manager |
| Lọc bảng Manager, lấy `pr_key`, mở màn duyệt | Xong, đo trên PVI thật 2026-08-23 |
| Màn duyệt: điền captcha, bấm Chấp nhận | Code xong, CHƯA bấm lần nào trên PVI thật |
| Nối vòng đời đơn trong database | Chưa làm — hai cột `pvi_*` đã có |
| Flow BH xe máy | Chưa làm — chưa khảo sát form của PVI |

## Việc tiếp theo, theo thứ tự

**1. Bấm "Chấp nhận" một lần ở màn duyệt trên PVI thật.**

Đây là chỗ đứt duy nhất còn lại. Mọi bước trước đó đã đo được 2026-08-23: lọc
bảng, lấy `pr_key`, mở màn duyệt, đọc bốn ô thông tin.

```bash
PVI_CHO_PHEP_DUYET=1 bun run pvi:duyet -- --san-pham=electric-accident --duyet
```

Không đặt biến đó thì script mở trang rồi dừng.

**1b. Công cụ khảo sát DOM.**

Chạy lệnh này rồi tự thao tác trên trang trong lúc trình duyệt còn mở:

```bash
cat pvi-qlcd-playwright/payload.example.json | \
  bun run pvi:chay -- --ghi-vet --cho-nguoi-bam=600
```

Bot ghi mọi request, response, header và HTML trang cuối vào
`vet/<orderId>-vet.json`. Mở file đó ra đọc là thấy DOM thật, khỏi chép tay.

Đơn đó dù sao cũng phải tạo nên không sinh đơn rác, mà lấy được trọn thông tin.

**2. Nối luồng duyệt vào database.** Tra đơn theo tên người thụ hưởng cộng sản
phẩm, ghi `pvi_electronic_order_no` và `pvi_pr_key`, chuyển trạng thái sang
`done`. Hai cột có từ migration `0035_insurance_pvi_keys`.

Đường dẫn màn duyệt là `/Service/Assign/?pr_key=...&tthai=DUYET`, xác định
2026-08-23 bằng DOM thật. Ghi chép 2026-08-15 nói `/Service/AssignDuyet` — sai.

**3. Nối vòng đời đơn.** `insurance_orders.status` đã có sẵn sáu trạng thái.
Worker đọc `queued`, gọi `taoDon`, ghi `creating` → `pending-approval`. Lấy đơn
phải khoá dòng bằng `for update skip locked`, không thì hai worker lấy trùng và
PVI nhận hai đơn giống nhau.

**4. Flow BH xe máy.** Cần DOM thật của form đó, làm như đã làm với tai nạn điện.

## Những điều đã đo, tin được

**Bot điền đúng.** Máy chủ giả lập kiểm ở phía NHẬN — không đọc DOM mà đọc dữ
liệu form gửi lên. Kết quả 24/24 trường đạt, tổng phí `100000` khớp số đo trên
PVI thật ghi ở spec.

**Captcha màn duyệt không cần OCR.** Nó sinh client-side bằng canvas, đáp án nằm
ở biến toàn cục `code`, trang tự so sánh trong trình duyệt. Đo cả hai chiều:
điền đúng thì đi tiếp, điền `SAI123` thì hiện `Invalid Captcha. try Again`.

**Có ô `id` khác `name`.** Bot thao tác theo `id`, form gửi theo `name`. Bảy ô
đã đo được, chép lại đây vì file chứa bảng này đã xoá cùng máy chủ giả lập:

| `id` trên DOM | `name` gửi lên |
|---|---|
| `kenh_bh` | `select_kenhbh` |
| `DanhSach_DaiLy` | `select_DaiLy` |
| `keycode_dv` | `KeyCode` |
| `dtbh_tanphe` | `dtbh_sinhhoat_nhole` |
| `dtbh_tamthan_ungthu` | `dtbh_tantat_thuongtat` |
| `idcapmoi` | `loai_dcap` |
| `idtaituc` | `loai_dcap_taituc` |

**Hai ô giờ dùng 24 giờ, không dùng AM/PM.** Thẻ HTML render sẵn `2:05 PM`,
nhưng bootstrap-timepicker của trang chạy với `showMeridian: false` và ghi đè
thành `14:05` ngay lúc khởi tạo. Đọc `$('#StartTime').data('timepicker')` trên
trang thật 2026-08-23 để đo. Plugin giữ giờ trong state riêng, nên script gọi
`timepicker('setTime', ...)` chứ không đặt bằng `.val()`.

**`defaultTime: "current"`.** Trang tự điền giờ nạp trang vào cả hai ô, nên hai
ô không bao giờ trống. Script vẫn ghi đè: giờ nạp trang lệch với giờ người vận
hành muốn khi đơn chạy trong hàng đợi.

**Checkbox gửi hai giá trị cùng tên.** ASP.NET MVC đặt một ô `hidden` cùng
`name` giá trị `false` bên cạnh checkbox, nên tick xong trình duyệt gửi
`gom_don=true&gom_don=false`. Lấy giá trị cuối là đọc ra `false` ở mọi ô đã tick.

**Năm hành vi của trang buộc bot theo thứ tự.** Bốn cái đầu ghi ở
`../pvi-qlcd-auto-order-spec.md`. Cái thứ năm phát hiện 2026-08-15:
`gettongphi_bh()` gọi `GET /API/GetTongPhi_HoSD_Dien` rồi tuỳ trạng thái trả về
mà khoá hoặc mở `pvbh_dkbs_01`, `tyle_phi_quytac_hienhanh`, `phi_giamphi`. Năm ô
gọi nó. Bot ghi đè được nhờ `removeAttribute('readonly')`.

## Những điều CHƯA chắc

**Công thức phí là suy đoán.** Máy chủ giả lập tính `STBH × tỷ lệ / 100`, dựng
từ đúng một điểm đo (40 000 000 với 0.25 ra 100 000). Công thức thật của PVI có
thể còn nhân theo số ngày hiệu lực hoặc số người thuê trọ.

**Captcha màn duyệt có thể được kiểm ở máy chủ.** Ô `cpatchaTextBox` không có
thuộc tính `name` nên không đi theo form. Toàn bộ việc kiểm nằm ở trình duyệt —
ít nhất là theo DOM đã chụp. Nếu PVI kiểm thêm ở phía họ thì cách đọc
`window.code` không qua được.

**Máy chủ giả lập trả `pr_key` trong HTML trang kết quả.** Đó là PHỎNG ĐOÁN để
thử được cách bot đọc lại khoá, không phải điều PVI làm.

**Hai việc spec ghi là chưa chốt** vẫn chưa chốt: khối hoá đơn điện tử
(`ho_ten_kh_vat`, `so_cccd`, `ma_sovat`), và trang kiểm tra hợp lệ những gì lúc
bấm "Chấp nhận".

## Điều kiện an toàn đang có

Bot **từ chối bấm "Chấp nhận" khi trỏ vào PVI thật**. Chỉ mở khi `PVI_BASE_URL`
trỏ sang máy chủ khác. Đo cả ba ca: không đặt biến, trỏ localhost, trỏ thẳng tên
miền PVI.

Muốn bấm trên PVI thật thì phải sửa `duocBamLuu` trong `lib/order.js`, và đó
đúng là mức cân nhắc nó xứng đáng. Cách an toàn hơn là `--cho-nguoi-bam` ở mục 1.

File vết lọc `cookie`, `set-cookie`, `authorization` trước khi ghi — chúng thay
cho mật khẩu phiên PVI.

## Không lên git

`storageState.json` (cookie đăng nhập thật), `anh/`, `captcha/`, `vet/`. Khai ở `.gitignore` của mgst-app.

Bộ 11 ảnh captcha ở `capcha-resolver/example/` thì GIỮ: tên file là đáp án đúng,
nên đó là bộ đo lại được mỗi lần sửa `solve.py`.

## Mã thoát

| `ma` | Nghĩa | BE làm gì |
|---|---|---|
| 0 | Điền xong | Xem `daLuu` để biết đã bấm Lưu hay chưa |
| 1 | Payload sai hoặc thiếu trường | Trả lỗi cho người gọi |
| 2 | Phiên đăng nhập hết hạn | Báo người vận hành chạy `bun run pvi:login` |
| 3 | Lỗi trang, hoặc có ô không điền được | Ghi log, xem `canXem` và ảnh chụp |
| 4 | Chưa có script cho sản phẩm | Đặt đơn về `manual-queued` kèm lý do |
