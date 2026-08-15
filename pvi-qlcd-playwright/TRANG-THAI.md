# Trạng thái bot PVI

Cập nhật 2026-08-15. Đọc file này trước khi làm tiếp.

`README.md` nói cách CHẠY. File này nói đang làm tới đâu, chỗ nào chưa chắc, và
việc tiếp theo là gì.

## Chạy được tới đâu

| Bước | Trạng thái |
|---|---|
| Điền 23 ô của form tai nạn điện | Xong, đo trên máy chủ giả lập: 24/24 trường tới nơi |
| Bấm nút "Chấp nhận" | Xong trên máy chủ giả lập. CHƯA bấm lần nào trên PVI thật |
| Đọc `pr_key` của đơn vừa tạo | Có công cụ ghi vết, chưa đo trên PVI thật |
| Màn duyệt: điền captcha, bấm Chấp nhận | Đo được trên máy chủ giả lập, chưa nối vào bot |
| Nối vòng đời đơn trong database | Chưa làm |
| Flow BH xe máy | Chưa làm — chưa khảo sát form của PVI |

## Việc tiếp theo, theo thứ tự

**1. Đo PVI trả gì sau khi bấm "Chấp nhận".** Đây là chỗ đứt duy nhất của luồng.
Không biết PVI trả `pr_key` ở đâu thì bot không mở được màn duyệt.

Lần tới bạn cần tạo một đơn thật, chạy lệnh này thay vì làm tay từ đầu:

```bash
cat pvi-qlcd-playwright/payload.example.json | \
  bun run pvi:order -- --ghi-vet --cho-nguoi-bam=120
```

Bot điền xong rồi giữ trình duyệt mở 120 giây. Bạn kiểm rồi tự bấm "Chấp nhận".
Bot ghi lại mọi request, response, header và HTML trang cuối vào
`vet/<orderId>-vet.json`, và tự dò `pr_key` trong đó.

Đơn đó dù sao cũng phải tạo nên không sinh đơn rác, mà lấy được trọn thông tin.

Đọc `prKeyTimThay` trong kết quả. Rỗng thì mở thẳng file vết đọc tay — mẫu quét
hiện dựa trên đúng một ví dụ (`?pr_key=s8K%2bJbKREuM%3d&tthai=DUYET`), PVI đặt
tên khác là không thấy.

**2. Nối bước duyệt vào bot.** Có `pr_key` rồi thì mở
`/Service/AssignDuyet?pr_key=...&tthai=DUYET`, đọc `window.code`, điền vào
`#cpatchaTextBox`, bấm `#btnConfirm`.

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

**14 ô có `id` khác `name`.** Bot thao tác theo `id`, form gửi theo `name`.
Ví dụ `kenh_bh` gửi lên là `select_kenhbh`, `DanhSach_DaiLy` là `select_DaiLy`,
`trangthai-dv` là `trang_thai`. Bảng ánh xạ ở `mock/kiem-don.js`.

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

**Bốn việc spec ghi là chưa chốt** vẫn chưa chốt: ô `MaKhach`, khối hoá đơn điện
tử (`ho_ten_kh_vat`, `so_cccd`, `ma_sovat`), `StartTime`/`EndTime`, và trang
kiểm tra hợp lệ những gì lúc bấm "Chấp nhận".

## Điều kiện an toàn đang có

Bot **từ chối bấm "Chấp nhận" khi trỏ vào PVI thật**. Chỉ mở khi `PVI_BASE_URL`
trỏ sang máy chủ khác. Đo cả ba ca: không đặt biến, trỏ localhost, trỏ thẳng tên
miền PVI.

Muốn bấm trên PVI thật thì phải sửa `duocBamLuu` trong `lib/order.js`, và đó
đúng là mức cân nhắc nó xứng đáng. Cách an toàn hơn là `--cho-nguoi-bam` ở mục 1.

File vết lọc `cookie`, `set-cookie`, `authorization` trước khi ghi — chúng thay
cho mật khẩu phiên PVI.

## Không lên git

`storageState.json` (cookie đăng nhập thật), `anh/`, `captcha/`, `mock/don/`,
`vet/`. Khai ở `.gitignore` của mgst-app.

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
