# Hai luồng: tạo-duyệt và lấy giấy chứng nhận

Chốt 2026-08-23. Đọc file này trước khi sửa bot.

Bot chạy **hai luồng**. Luồng 1 tạo đơn rồi duyệt luôn trong cùng một lượt.
Luồng 2 tách hẳn, vì PVI không sinh file giấy chứng nhận ngay lúc duyệt.

## Vòng đời một đơn

```
queued → creating → awaiting-certificate → done
              ↓
       pending-approval   tạo xong nhưng bot không khớp được dòng để duyệt
       manual-queued      lỗi ngay khi điền form
```

## Luồng 1 — tạo đơn và duyệt

| Bước | Việc | Trạng thái |
|---|---|---|
| 1 | Lấy đơn cũ nhất đang chờ, khoá dòng | `queued` → `creating` |
| 2 | Mở form, điền 26 ô | |
| 3 | Bấm "Chấp nhận" | |
| 4 | PVI chuyển sang `/Service/Manager`, đọc bảng tìm dòng vừa tạo | |
| 5 | Khớp được → ghi số đơn và `pr_key`, bấm Duyệt | → `awaiting-certificate` |
| 5b | Không khớp dòng nào → dừng, để người duyệt tay | → `pending-approval` |

Lấy đơn phải khoá dòng bằng `for update skip locked`. Không khoá thì hai worker
lấy trùng một đơn và PVI nhận hai đơn giống hệt nhau.

### Bước 4 — tìm đúng dòng vừa tạo

Sau khi bấm "Chấp nhận", PVI trả `302` tới `/Service/Manager`. Đo 2026-08-23:
đơn vừa tạo nằm ở **dòng đầu** bảng, vì bảng sắp mới nhất trước.

Dòng đầu không phải lúc nào cũng đúng — người khác có thể tạo đơn cùng lúc. Bot
duyệt từ dòng đầu xuống, lấy dòng đầu tiên khớp **cả năm điều kiện**:

| Điều kiện | So với |
|---|---|
| Trạng thái | `Chờ` |
| Tên khách | tên script vừa điền, bỏ dấu và chuẩn hoá khoảng trắng |
| Nghiệp vụ | `Hộ SD điện` cho `electric-accident`, `TNDS xe máy` cho `motorbike` |
| Ngày chứng từ | ngày chạy |
| Phí | tổng phí script đọc lại từ form |

Không dòng nào khớp thì bot **không duyệt gì cả**. Đơn về `pending-approval`,
người vận hành duyệt tay. Duyệt nhầm đơn của người khác là thao tác không đảo
ngược được trên dữ liệu không thuộc phạm vi.

### Bước 5 — màn duyệt

Đường dẫn nằm sẵn trong `href` của mục "Duyệt" trên dòng đó, không phải bấm dấu
ba chấm mới hiện:

```
https://qlcd.pvi.com.vn/Service/Assign/?pr_key=W6fXX4Fd7%2bI%3d&tthai=DUYET
```

Captcha sinh ở trình duyệt bằng canvas, đáp án nằm ở biến toàn cục `code`. Bot
đọc biến đó, điền `#cpatchaTextBox`, bấm `#btnConfirm`. Đo 2026-08-23: PVI không
kiểm lại ở máy chủ.

Duyệt xong đơn chuyển sang trạng thái **"Tạo đơn"** bên PVI, không phải "Duyệt
đơn". Bộ lọc `#tthai_don` = `00` trả về rỗng; `03` mới là "Đã tạo đơn".

## Luồng 2 — lấy giấy chứng nhận

Code ở `lib/certificate.ts`, chạy trong vòng lặp của `worker.ts`.

| Bước | Việc | Trạng thái |
|---|---|---|
| 1 | Lấy đơn đang đợi file, cũ nhất trước, tối đa 20 đơn một vòng | `awaiting-certificate` |
| 2 | Gọi `GET /Service/DownloadFile?id=<pr_key>&type=3` | |
| 3a | Trả PDF → đổi WebP, đẩy kho, ghi khoá ảnh | → `done` |
| 3b | Trả HTML → tăng số lần thử, bỏ qua tới vòng sau | giữ nguyên |
| 3c | Đủ 60 lần thử → ngừng hỏi đơn đó | giữ nguyên |

**PVI không sinh file ngay lúc duyệt.** Đo 2026-08-23: đơn duyệt xong 11 phút mà
`/Service/DownloadFile` vẫn trả trang HTML "File trên hệ thống đã bị xóa". Vì
vậy luồng 2 là vòng lặp, không phải một lượt tải.

Đơn vừa hỏi hụt phải đợi 90 giây mới hỏi lại.

**Chạm ngưỡng thì KHÔNG đổi trạng thái đơn.** Đơn đã duyệt xong bên PVI; đẩy nó
về `manual-queued` là bắt người ta tạo lại từ đầu một đơn đã tạo xong. Luồng chỉ
thôi hỏi, và màn hình đọc `certificate_attempts` rồi hiện lời nhắc đi hỏi người
có thẩm quyền. Ngưỡng ở `CERTIFICATE_MAX_ATTEMPTS` trong
`src/lib/api/insuranceOrders.ts` — một chỗ, vì cả worker lẫn màn hình đều đọc.

## Cách chạy: worker trong container

```
┌─ container pvi-worker ────────────────────┐
│  worker.ts                                │
│  vòng lặp 10 giây:                        │
│    1. đơn queued  → tạo, duyệt            │
│    2. đơn awaiting-certificate → tải file │
│    3. ghi heartbeat                       │
│  Chromium riêng, phiên đăng nhập riêng    │
└───────────────────────────────────────────┘
             │ for update skip locked
             ▼
      insurance_orders (Postgres)
```

Chạy **một container**, một tài khoản PVI. Tài khoản đọc từ `PVI_USER` và
`PVI_PASS` trong `.env.local`, không có bảng khai tài khoản nào.

Mở rộng bằng cách thêm container, mỗi cái một tài khoản. Mỗi tài khoản chỉ thấy
đơn của chính nó trên bảng Manager (xác nhận 2026-08-23), nên nhiều container
chạy song song không cần khoá và không cần điều phối viên: bảng của mỗi worker
chỉ chứa đơn của nó.

Lúc scale mới cần hai thứ: bảng khai tài khoản, và cột ghi đơn nào do tài khoản
nào tạo — luồng 2 phải dùng đúng phiên đó mới tải được giấy chứng nhận.

Hai việc trước khi dựng container: đo RAM còn trống trên VPS, và cài
`docker-compose-plugin` (VM hiện thiếu).

## Dữ liệu lấy từ PVI

### Mười hai cột của bảng Manager

| # | Tiêu đề | Giá trị mẫu |
|---|---|---|
| 1 | Dịch vụ | Nguyễn Văn B |
| 2 | Số đơn ĐT | 26/21/14/MOTO/0107042 |
| 3 | Số đơn BH | (trống) |
| 4 | Nghiệp vụ | TNDS xe máy |
| 5 | Loại rủi ro | Thấp |
| 6 | Phí | 76 000 |
| 7 | Ngày chứng từ | 23/08/2026 |
| 8 | Trạng thái | Chờ |
| 9 | Đơn vị | PVI Tây Nam |
| 10 | Cán bộ tạo | Hà Khang Vĩ |
| 11 | Đại lý | CÔNG TY TNHH MINH GROUP ST |
| 12 | Tác vụ | dấu ba chấm |

Cột 1 ghi "Dịch vụ" nhưng giá trị là TÊN KHÁCH.

Bộ lọc: `#nghiepvu` (`TNDT` Hộ SD Điện, `MOTO` Xe máy) và `#tthai_don` (`01` Chờ,
`02` Chuyển, `00` Duyệt đơn, `-01` Hủy, `03` Đã tạo đơn). Đặt xong gọi
`clickSearchDataProcess()` — hàm đó gọi `/Service/ItemManager` bằng XHR đồng bộ,
không tải lại trang.

### Bảy trường của màn duyệt

| Nhãn | Selector | Giá trị mẫu |
|---|---|---|
| Tên dịch vụ | `#ten_dvu` | Nguyễn Văn B |
| Loại rủi ro | `#loại_ruiro` | Thấp |
| Ngày tạo dịch vụ | `#ngay_ctu` | 23/08/2026 |
| Người tạo dịch vụ | `#canbo_gui` | Hà Khang Vĩ |
| Trạng thái | `#trangthai-dv` | `00` — 00 ___ Duyệt DV |
| Ghi chú | `#ghichu` | (trống) |
| `pr_key` bản thô | `#pr_key_dv` | zPb8i3fvkmQ= |

`id` của ô loại rủi ro có dấu tiếng Việt, đúng như PVI đặt.

### Hai cột trong database

`pvi_electronic_order_no` giữ "Số đơn ĐT" — chỉ hiện ở BẢNG, màn duyệt không có.
`pvi_pr_key` giữ khoá dạng THÔ (`zPb8i3fvkmQ=`), không lưu bản đã url-encode.

## Chỗ sai được, đã chấp nhận

Một khách mua hai đơn bảo hiểm điện một năm liền kề — `2026-2027` và
`2027-2028` — thì hai đơn giống nhau mọi thông tin hiện trên bảng Manager, kể cả
phí và ngày chứng từ. Chỉ khác năm hiệu lực, mà cột đó không có.

Với luồng 1 gộp, ca này ít hại hơn hẳn: bot tạo đơn nào thì duyệt ngay đơn đó
trong cùng lượt, và ghi số đơn vào đúng row nó đang cầm. Hai row luôn nhận hai
số khác nhau.

Ca còn sai: hai worker chạy song song cùng tạo hai đơn của cùng một khách trong
vài giây. Lúc đó cả hai thấy hai dòng khớp năm điều kiện như nhau. Row nào nhận
số nào thì không chắc — nhưng khách vẫn nhận đủ hai giấy chứng nhận, nên sai sót
chỉ nằm ở việc đối soát nội bộ.

## Điều kiện an toàn

Chỉ áp cho SCRIPT CHẠY TAY. Worker tự bật cả hai — xem mục trên.

| Thao tác | Cần |
|---|---|
| Bấm "Chấp nhận" tạo đơn | cờ `--bam-luu` **và** `PVI_CHO_PHEP_LUU=1` |
| Bấm "Chấp nhận" màn duyệt | cờ `--duyet` **và** `PVI_CHO_PHEP_DUYET=1` |

Thiếu một trong hai thì script làm xong phần điền rồi dừng, và nói ra lý do. Một
cờ dòng lệnh gõ nhầm không đủ để tạo hay duyệt đơn thật.

## Ba chỗ dễ sai khi lấy giấy chứng nhận

**Không dùng `request` của Playwright để tải file.** PVI trả
`200 application/pdf` kèm `set-cookie: BNI_persistence=...; Path=/`, và
`_parseSetCookieHeader` của playwright-core ném `TypeError ... cannot be parsed
as a URL` trên đúng header đó. Response không bao giờ đọc xong, lượt gọi treo
tới hết thời gian chờ. Dùng `fetch` với header `Cookie` dựng từ
`storageState.json`.

**Đổi ảnh hỏng thì KHÔNG tăng số lần thử.** Lỗi đó nằm ở máy mình, không ở PVI.

**Cần `pdftoppm` của poppler và `cwebp` của libwebp trên máy chạy.**
macOS: `brew install poppler webp`. Container: `apt install poppler-utils webp`.

Ảnh ra ở định dạng WebP, chất lượng 80, cạnh dài nhất 1600px — cùng thông số với
ảnh người dùng tải lên (`src/lib/toWebpImage.ts`). Đo trên một giấy chứng nhận
thật 2026-08-23: PDF 330KB → WebP 184KB, 1600×1127, mất 1,4 giây.

## Chạy worker

```bash
bun run pvi:worker                       # chạy mãi, quét mỗi 10 giây — CHẠY THẬT
bun run pvi:worker -- --mot-vong         # một vòng rồi thoát
bun run pvi:worker -- --chi-chung-nhan   # bỏ bước tạo đơn, chỉ tải file
bun run pvi:worker -- --thu              # điền form rồi dừng, không bấm gì
```

**Worker chạy là chạy thật.** Nó tự bật `PVI_CHO_PHEP_LUU` và
`PVI_CHO_PHEP_DUYET` lúc khởi động — hai biến ấy sinh ra để chặn script chạy tay
gõ nhầm, không phải để chặn worker.

`--thu` tắt cả hai: worker vẫn lấy đơn và điền 26 ô, nhưng dừng trước lúc bấm và
đưa đơn về `manual-queued`. Dùng để xem nó chọn đúng đơn và điền đúng dữ liệu
chưa.

Code ở `worker.ts`. Ba script cũ (`chay-don.js`, `duyet-don.js`,
`create-order.js`) vẫn chạy tay được, dùng khi cần soi một đơn — chúng giữ mặc
định KHÔNG bấm và đòi cả cờ lẫn biến môi trường.

## Container

Worker nằm chung repo và chung `Dockerfile` với app, nhưng là container RIÊNG:

```bash
docker compose --profile pvi up pvi-worker      # máy local
docker build --target worker -t mgst-pvi-worker .   # máy chủ, chưa có compose plugin
```

Tách container chứ không gộp vào app vì ba lý do. Image app là
`oven/bun:alpine` 155 MB; worker cần Chromium thật cộng Xvfb nên nền là
`mcr.microsoft.com/playwright`, khoảng 2 GB. Gộp thì mỗi lần deploy web tải thêm
gần 2 GB cho thứ web không dùng. Worker chết và khởi động lại cũng không được
kéo web sập theo. Và bật tắt bot phải làm được mà không đụng tới web.

Image worker cài thêm năm thứ ngoài nền Playwright: `poppler-utils` cho
`pdftoppm`, `webp` cho `cwebp`, `tesseract-ocr` cộng
`python3-pil`/`python3-numpy`/`pytesseract` cho `capcha-resolver/solve.py`, và
`bun` để chạy thẳng TypeScript.

Phiên đăng nhập PVI nằm ở volume `mgst-pvi-session` gắn vào `/app/session`. Mất
nó là mỗi lần dựng lại container phải giải captcha đăng nhập lần nữa.

Chromium chạy CÓ giao diện trên màn hình ảo của Xvfb — trang PVI có lớp chống
bot, headless dễ bị chặn.

## Việc còn lại

Chưa có lần nào worker chạy trọn vòng thật: lấy đơn → tạo đơn thật trên PVI →
duyệt → tải giấy chứng nhận → `done`. Mọi phép đo tới 2026-08-23 đều chạy với cờ
tắt, tức worker dừng trước lúc bấm.

Đơn nối tiếp bảo hiểm cũ (`select_ttxe` = `TTTG1.03`) **bỏ hẳn**, không làm:
người nhập tự chọn ngày bắt đầu, bot không đi tìm đơn cũ. Mọi đơn khai là xe mới
100%.
