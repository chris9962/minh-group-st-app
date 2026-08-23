# Hai luồng: tạo đơn và duyệt đơn

Chốt 2026-08-23. Đọc file này trước khi code bước duyệt.

Bot chạy **hai luồng rời nhau**, không phải một luồng liền mạch. Lý do: bấm
"Chấp nhận" xong, PVI **không** trả `pr_key` của đơn vừa tạo. Khoá đó chỉ xuất
hiện ở màn `https://qlcd.pvi.com.vn/Service/Manager`, trong đường dẫn của nút
"Duyệt" trên từng dòng.

Vì vậy luồng tạo đơn kết thúc ngay sau khi bấm "Chấp nhận". Luồng duyệt là một
tiến trình khác, chạy độc lập, tự đi tìm đơn cần duyệt.

## Luồng 1 — tạo đơn

| Bước | Việc | Trạng thái đơn trong database |
|---|---|---|
| 1 | Worker quét đơn chờ chạy tự động | `queued` |
| 2 | Pool Playwright còn chỗ thì lấy đơn **cũ nhất trước** | |
| 3 | Đánh dấu đang chạy, để worker khác không lấy trùng | `creating` |
| 4 | Mở form, điền 26 ô, bấm "Chấp nhận" | |
| 5 | Đóng Playwright | |
| 6 | Ghi lại trạng thái mới | `pending-approval` |

Nhánh bot đi trọn: `queued` → `creating` → `pending-approval` →
`awaiting-certificate` → `done`.

Luồng 1 dừng ở đây. Nó **không** biết đơn vừa tạo mang `pr_key` nào.

Lấy đơn phải khoá dòng bằng `for update skip locked`. Không khoá thì hai worker
lấy trùng một đơn và PVI nhận hai đơn giống hệt nhau.

## Luồng 2 — duyệt đơn

Code ở `lib/duyet.js`, chạy bằng `bun run pvi:duyet`.

| Bước | Việc | Selector |
|---|---|---|
| 1 | Mở `https://qlcd.pvi.com.vn/Service/Manager` | |
| 2 | Đặt bộ lọc nghiệp vụ | `#nghiepvu` — `TNDT` Hộ SD Điện · `MOTO` Xe máy |
| 3 | Đặt bộ lọc trạng thái "Chờ" | `#tthai_don` = `01` |
| 4 | Gọi `clickSearchDataProcess()` của trang | |
| 5 | Đọc bảng, lấy dòng **cuối** | `#qlpdtable tbody tr` |
| 6 | Mở màn duyệt bằng `href` đọc được | |
| 7 | Đọc thông tin, tra ngược về đơn trong database | |
| 8 | Điền captcha, bấm Chấp nhận | `#cpatchaTextBox` · `#btnConfirm` |
| 9 | Ghi trạng thái đơn thành `done` | |

**Bảng sắp MỚI NHẤT TRƯỚC.** Đơn cũ nhất nằm ở dòng cuối, không phải dòng đầu.

**Không phải bấm dấu ba chấm.** Mục "Duyệt" nằm sẵn trong DOM của mỗi dòng:
`<a href="../Service/Assign/?pr_key=...&tthai=DUYET">`. Bot đọc thẳng `href`,
khỏi mở popover.

Bộ lọc không tải lại trang. `clickSearchDataProcess()` gọi
`GET /Service/ItemManager?dichvu=&ngay_ctu=&can_bo=&nghiepvu=&loai_ruiro=&tthai_don=`
bằng XHR đồng bộ rồi ghi HTML vào `#displayContent`.

Năm mã trạng thái của `#tthai_don`: `01` Chờ · `02` Chuyển · `00` Duyệt đơn ·
`-01` Hủy · `03` Đã tạo đơn.

Địa chỉ màn duyệt mang `pr_key` trong tham số:

```
https://qlcd.pvi.com.vn/Service/Assign/?pr_key=W6fXX4Fd7%2bI%3d&tthai=DUYET
```

`href` trên bảng mang bản đã url-encode; database lưu bản **thô**
(`W6fXX4Fd7+I=`). Màn duyệt cũng có `#pr_key_dv` chứa bản thô, dùng để đối chiếu.

### Mười hai cột của bảng Manager

| # | Tiêu đề | Giá trị mẫu |
|---|---|---|
| 1 | Dịch vụ | Nguyễn Văn A |
| 2 | Số đơn ĐT | 26/21/14/TNCN/0096592 |
| 3 | Số đơn BH | (trống) |
| 4 | Nghiệp vụ | Hộ SD điện |
| 5 | Loại rủi ro | Thấp |
| 6 | Phí | 100 000 |
| 7 | Ngày chứng từ | 23/08/2026 |
| 8 | Trạng thái | Chờ |
| 9 | Đơn vị | PVI Tây Nam |
| 10 | Cán bộ tạo | Hà Khang Vĩ |
| 11 | Đại lý | CÔNG TY TNHH MINH GROUP ST |
| 12 | Tác vụ | dấu ba chấm |

Cột 1 ghi "Dịch vụ" nhưng giá trị là TÊN KHÁCH.

**Số đơn ĐT là thứ định danh đơn bên PVI.** Màn duyệt không hiện số này, nên bot
phải đọc ở bảng và lưu vào `insurance_orders.pvi_electronic_order_no`. Bỏ qua ở
bảng là mất luôn.

### Dữ liệu trên màn duyệt

| Nhãn | Selector | Giá trị mẫu |
|---|---|---|
| Tên dịch vụ | `#ten_dvu` | Nguyễn Văn A |
| Loại rủi ro | `#loại_ruiro` | Thấp |
| Ngày tạo dịch vụ | `#ngay_ctu` | 23/08/2026 |
| Người tạo dịch vụ | `#canbo_gui` | Hà Khang Vĩ |
| Trạng thái | `#trangthai-dv` | `00` — 00 ___ Duyệt DV |
| Ghi chú | `#ghichu` | (trống) |
| `pr_key` bản thô | `#pr_key_dv` | W6fXX4Fd7+I= |

"Tên dịch vụ" chính là tên khách hàng, không phải tên sản phẩm.

`id` của ô loại rủi ro có dấu tiếng Việt — `loại_ruiro`, đúng như PVI đặt.

Bốn ô đầu đều `readonly`. Chỉ `#ghichu` và ô captcha nhập được.

Nút "Chấp nhận" là `#btnConfirm`. Nó không submit thẳng: handler so
`#cpatchaTextBox` với biến toàn cục `code`, khớp thì `$("#formauto").submit()`,
lệch thì `alert("Invalid Captcha. try Again")` rồi vẽ captcha mới. Ô captcha
không có `name` nên không đi theo form.

## Luồng 3 — tải giấy chứng nhận

Code ở `src/server/pvi-certificate.ts` và `scripts/pvi-fetch-certificates.ts`.

```bash
bun run pvi:chung-nhan              # quét một vòng rồi thoát
bun run pvi:chung-nhan -- --lap=120 # quét lại mỗi 120 giây
```

| Bước | Việc | Trạng thái đơn |
|---|---|---|
| 1 | Lấy đơn đang đợi file, cũ nhất trước, tối đa 20 đơn một vòng | `awaiting-certificate` |
| 2 | Gọi `GET /Service/DownloadFile?id=<pr_key>&type=3` | |
| 3a | Trả PDF → đổi sang PNG, đẩy lên kho, ghi khoá | `done` |
| 3b | Trả HTML → tăng số lần thử, bỏ qua tới vòng sau | giữ nguyên |
| 3c | Quá 60 lần thử → chuyển sang người xử lý tay | `manual-queued` |

**PVI không sinh file ngay lúc duyệt.** Đo 2026-08-23: đơn duyệt xong 11 phút mà
`/Service/DownloadFile` vẫn trả trang HTML "File trên hệ thống đã bị xóa". Vì
vậy luồng 3 là vòng lặp, không phải một lượt tải.

Đơn vừa hỏi hụt phải đợi 90 giây mới hỏi lại, kể cả khi vòng quét chạy dày hơn.

### Đo trên PVI thật 2026-08-23

| Mục | Giá trị |
|---|---|
| PDF | 330 KB, 1 trang, 595,5 × 419,25 pt |
| Tên file PVI đặt | `_260307461_26_21_14_TNCN_0096557.pdf` |
| PNG sau khi đổi, 150 DPI | 278 KB |
| Thời gian một đơn | 1,0 – 2,5 giây |

### Ba chỗ dễ sai

**Không dùng `request` của Playwright để tải file.** PVI trả
`200 application/pdf` kèm `set-cookie: BNI_persistence=...; Path=/`, và
`_parseSetCookieHeader` của playwright-core ném `TypeError ... cannot be parsed
as a URL` trên đúng header đó. Response không bao giờ đọc xong, lượt gọi treo
tới hết thời gian chờ. Dùng `fetch` với header `Cookie` dựng từ
`storageState.json`.

**Đổi ảnh hỏng thì KHÔNG tăng số lần thử.** Lỗi đó nằm ở máy mình, không ở PVI.
Tăng nữa là đơn bị đẩy sang làm tay vì lỗi của bot.

**Cần `pdftoppm` của poppler trên máy chạy.** `brew install poppler` trên macOS,
`apt install poppler-utils` trên VPS. Thiếu nó thì luồng 3 báo lỗi ở mọi đơn.

## Cách tra ngược về đơn trong database

Màn duyệt chỉ cho **tên khách** và **loại bảo hiểm**. Hai thứ đó đủ để thu hẹp
xuống một hoặc hai đơn.

### Chỗ sai được, đã chấp nhận

Một khách mua hai đơn bảo hiểm điện một năm — `2026-2027` và `2027-2028` — thì
hai đơn giống nhau mọi thông tin hiện trên màn duyệt, chỉ khác năm hiệu lực.
Năm hiệu lực không hiện ở đó, nên bot **không phân biệt được đang duyệt đơn nào**.

Cách xử lý: chọn một trong hai. Sai sót chấp nhận được, vì nhân viên vẫn giao cả
hai giấy chứng nhận cho cùng một khách. Cái sai chỉ nằm ở việc đơn nào trong
database mang `pr_key` nào, không ảnh hưởng tới khách.

Đọc thêm được số hợp đồng ở bảng Manager thì vẫn không gỡ được ca này: bảng cũng
không hiện năm hiệu lực.

## Điều kiện an toàn

Bot **không bấm "Chấp nhận" ở màn duyệt** khi trỏ vào PVI thật, trừ khi người
chạy đặt `PVI_CHO_PHEP_DUYET=1`. Duyệt là thao tác không đảo ngược được, cùng
mức với bấm "Chấp nhận" lúc tạo đơn.

```bash
bun run pvi:duyet -- --san-pham=electric-accident          # chỉ liệt kê
bun run pvi:duyet -- --san-pham=electric-accident --duyet  # mở màn duyệt, chưa bấm
PVI_CHO_PHEP_DUYET=1 bun run pvi:duyet -- --duyet          # bấm Duyệt thật
```

## Việc còn lại

1. **Chưa bấm "Chấp nhận" lần nào ở màn duyệt trên PVI thật.** Mọi bước trước đó
   đã đo được 2026-08-23: đọc bảng, lọc, lấy `pr_key`, mở màn duyệt, đọc bốn ô.
2. **Nối luồng 2 vào database.** Chưa viết: tra đơn theo tên người thụ hưởng
   cộng sản phẩm, ghi `pvi_electronic_order_no` và `pvi_pr_key`, chuyển trạng
   thái sang `awaiting-certificate`. Luồng 3 nhận tiếp từ đó và đã chạy được.
3. **Captcha màn duyệt có thể được kiểm ở máy chủ.** Bot đọc `window.code` và
   trang tự so ở trình duyệt. PVI kiểm thêm ở phía họ thì cách này không qua
   được — chưa đo.
4. **Phân trang bảng Manager.** Ảnh chụp 2026-08-23 có 464 dòng trong một trang,
   không thấy nút phân trang. Chưa biết PVI cắt trang khi bảng lớn hơn.
