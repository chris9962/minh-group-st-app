---
name: ocr-screen-parser
description: Quy trình dựng bộ đọc OCR cho MỘT màn hình app ngân hàng trong mgst-app (gán nhãn, tìm cấu hình Tesseract một lượt, nhận màn bằng màu, parser kiểm chứng, đo trước khi commit). Dùng khi cần thêm màn mới hoặc ngân hàng mới cho kiểm ảnh chứng minh tài khoản, khi có bộ ảnh cần gán nhãn hoặc đo OCR, khi user nói "màn X của bank Y", "tìm config tesseract", "parser đọc sai", "ảnh chụp lại không đọc được", hoặc bất cứ việc gì đụng tới src/server/ocr.
---

# Dựng bộ đọc OCR cho một màn hình app ngân hàng

Mỗi màn có màu chữ, màu nền và bố cục riêng. Không có một cấu hình Tesseract
đọc tốt mọi màn. Vì vậy đơn vị làm việc là **một màn của một ngân hàng**, và
đầu ra là ba thứ: cách nhận ra màn đó, một cấu hình đọc, một hàm kiểm chứng.

Cách làm dưới đây đã dùng cho màn hình chính TPBank ngày 2026-09-14: từ 4 lượt
Tesseract 40 giây một tài khoản xuống 1 lượt 0,6 giây một ảnh, 110/112 kết
luận đúng, 0 ca đạt nhầm. Số đo và cấu hình cụ thể ở
`references/tpb-home-worked-example.md`. Đọc file đó trước khi làm màn kế
tiếp: phần lớn biến đã thử rồi, đừng thử lại từ đầu.

## Luật cứng, chốt với chủ dự án 2026-09-14

1. **Kiểm nhãn bằng mắt trước khi đo.** Claude là người gán nhãn. Xem mọi ảnh,
   đối chiếu với tên file, sửa nhãn sai, rồi mới chạy đo. Lần đầu tôi chỉ kiểm
   ảnh nào OCR lệch nhãn, kết quả báo nhầm lỗi OCR trong khi 7/63 nhãn sai.
2. **So đúng từng ký tự, không dung sai.** Nhân viên gõ sai một chữ số cũng
   phải bị bắt. Bản trước cho lệch 1 chữ số nên bỏ qua ca `QUYNH`/`HUYNH`.
   OCR đọc sai thì báo "không khớp" kèm cả hai giá trị, người duyệt xem ảnh.
3. **Một lượt Tesseract cho ảnh bình thường.** Lượt thứ hai chỉ khi lượt đầu
   thiếu trường, và phải đo được nó thêm bao nhiêu ảnh.
4. **Chạy so sánh toàn bộ benchmark phải hỏi user trước.** Bước này chạy
   5 đến 10 phút, chiếm CPU máy user.
5. **Không đụng máy chủ.** Mọi việc đo làm ở máy local. `AGENTS.md` §0.2.
6. Máy user: `OMP_THREAD_LIMIT=1`, tối đa 2 tiến trình Tesseract song song,
   `nice -n 19`. Việc dài chạy `nohup` và ghi log ra file.

## Quy trình

### Bước 1. Bộ ảnh có nhãn

Một thư mục một màn, ví dụ `~/Desktop/TPB/man hinh chinh/`. Nhãn nằm ở một
trong hai chỗ:

- Tên file: `<ten-khach>-<so-tai-khoan>.webp`. Đủ cho màn chỉ có tên và STK.
- `labels.json` trong thư mục: `{ "file.webp": { "customerName": "...",
  "accountNumber": "...", "referralCode": "..." } }`. Dùng khi màn có nhiều
  trường.

Ảnh chưa có nhãn thì Claude tự đọc bằng vision và đặt nhãn. Cần đủ ba nguồn:
screenshot iPhone, screenshot Android, ảnh chụp lại màn hình bằng máy khác.
Ảnh chụp lại là nơi mọi lỗi xuất hiện; bộ chỉ có screenshot cho số đo ảo.

Kiểm nhãn:

```bash
cd mgst-app
bun .claude/skills/ocr-screen-parser/scripts/verify-sheet.ts "<thư mục ảnh>" /tmp/vs
```

Script ghép 4 ảnh một tấm, mỗi ảnh kèm tên file, cắt phần trên màn hình.
Đọc từng tấm bằng `Read`, đối chiếu, đổi tên file sai. Bộ benchmark cũ ở
`/private/tmp/mgst-ocr-bench-<mã>/` có `manifest.json` chứa dữ liệu hệ thống
của từng tài khoản, lấy nhãn từ đó được nhưng vẫn phải xem ảnh.

### Bước 2. Tìm cấu hình đọc, một biến một lần

```bash
bun .claude/skills/ocr-screen-parser/scripts/ocr-grid.ts "<thư mục ảnh>" \
  --name gneg-psm11 --pre green-neg --psm 11 --lang eng --model os
```

Mỗi lần gọi là một cấu hình, một lượt Tesseract mỗi ảnh. Script chấm theo
nhãn với đúng luật kiểm chứng ở bước 5, in số đạt từng trường và danh sách
ảnh lỗi, lưu chữ vào `<thư mục ảnh>/../ocr-out/<name>/` để xem lại.

Thứ tự thử, giữ các biến khác cố định khi đổi một biến:

| Biến | Giá trị | Ghi chú |
|---|---|---|
| Tiền xử lý | `plain`, `gray-neg`, `green-neg`, `red`, `sharp` | Tesseract chỉ đọc tốt chữ tối nền sáng. Chữ trắng nền màu thì đảo; chọn kênh làm nền tối nhất |
| Cỡ ảnh | `--size 1600`, `--photo-size 2600` | phóng ảnh chụp lại giúp, phóng screenshot làm hỏng tên |
| `--psm` | 11, 6, 4 | 11 cho chữ rời rạc và ảnh chụp; 6 cho bảng nhãn-giá trị xếp hàng |
| Model | `--lang eng --model os`, `--lang vie --model best` | màn chỉ có chữ hoa không dấu và số thì `eng` đúng hơn và nhanh gấp đôi |
| Xoay | tự bật cho ảnh ngang | `--psm 0` dò hướng, 0,3 giây |

Đừng thử: ngưỡng nhị phân Sauvola, `blur`, `threshold`, `clahe`, phóng 3600px.
Đã đo, không tốt hơn `plain`. Tô trắng dải đen dưới màn hình làm Tesseract
đổi cách đọc dấu thanh ở đầu ảnh; ngưỡng Otsu tính trên toàn ảnh.

Ảnh chụp sát màn hình có vân lưới điểm ảnh: MỌI cỡ phóng ra hàng nghìn dòng
rác, kể cả `blur` hay `median` trước khi phóng; chỉ cỡ gốc đọc đúng. Ảnh
chụp bình thường thì ngược lại, phóng mới đọc được. Không có tiền xử lý nào
hợp cả hai, nên cỡ gốc là lượt hai khi lượt phóng thiếu trường.

### Bước 3. Soi từng ảnh lỗi bằng mắt

Với mỗi ảnh chưa đạt, cắt vùng chứa trường đó, phóng to, `Read`, rồi xếp vào
đúng một loại:

| Loại | Dấu hiệu | Việc phải làm |
|---|---|---|
| OCR đọc sai thật | mắt đọc được, Tesseract ra chữ khác | đổi cấu hình, quay lại bước 2 |
| Nhãn sai | ảnh ghi khác tên file | sửa nhãn, chạy lại |
| Ảnh bị che hoặc lệch dữ liệu | thông báo đẩy che tên, khách chọn chi nhánh khác, ảnh của khách khác | không sửa gì; kết luận "không đạt" là đúng |

Chỉ loại đầu cần sửa cấu hình. Đếm riêng ba loại khi báo cáo; trộn lẫn là
báo sai độ chính xác.

### Bước 4. Nhận ra màn trước khi OCR, nếu màn có đặc điểm riêng

Bước này không bắt buộc. Nó có khi màn có một đặc điểm hình ảnh không cần
OCR mới thấy: khối màu lớn, logo, bố cục. Không có thì bỏ qua: chạy cấu hình
của màn lên mọi ảnh chưa nhận ra, để bước 5 quyết định; ảnh khác màn sẽ không
chứa giá trị hệ thống nên không đạt nhầm.

Khi có đặc điểm màu:

```bash
bun .claude/skills/ocr-screen-parser/scripts/color-blob.ts "<thư mục home>" "<thư mục màn khác>" \
  --hue 240-268 --sat 0.35 --val 0.2
```

Script in ba số cho mỗi ảnh: diện tích khối liền lớn nhất, chiều cao và
chiều rộng khung bao của khối, theo tỉ lệ ảnh. Chọn ngưỡng có khoảng cách
giữa nhóm đúng và nhóm sai, rồi viết vào `src/server/ocr/screen.ts`.

Ba cách đã đo và không tách được màn hình chính TPBank, đừng thử lại: tổng
tỉ lệ điểm màu, dải hàng màu liền dài nhất, siết màu theo độ sáng. Khối liền
lớn nhất sau khi giãn 2 điểm mới tách được, vì thanh trạng thái và banner của
màn khác là dải mỏng còn header là khối.

### Bước 5. Parser là kiểm chứng, không phải trích xuất

Hệ thống đã biết giá trị đúng. Parser nhận `ctx` và trả lời "giá trị này có
trong chữ OCR không":

- Số: phải có TRỌN dãy trong chữ OCR, trước và sau không còn chữ số; cho
  khoảng trắng và xuống dòng giữa các chữ số vì `--psm 11` hay tách số ra
  nhiều dòng. Không kiểm `includes` trên chuỗi chữ số của cả ảnh: nhân viên
  nhập `1000 5476 1` thiếu hai số vẫn là chuỗi con của số trên ảnh và đạt
  nhầm (benchmark TPB, tài khoản 10f75c6d, đo 2026-09-15). `hasDigits` trong
  `tpbank.ts`.
- Chữ: bỏ dấu, viết hoa, bỏ mọi ký tự không phải chữ cái, so trên từng dòng.
  Giá trị hệ thống phải nằm trong dòng, phần dư mỗi đầu tối đa 2 chữ cái.
  Logo và biểu tượng 👋 đọc thành `V`, `W`, `VW` đứng trước tên; OCR hay dính
  từ `TO THICAM HON`. `NGUYEN THI NHIEU HOA` không khớp `NGUYEN THI NHIEU`.
- Mã có ký tự dễ nhầm: gộp `O/0`, `I/1`, `S/5`, `B/8`, `Z/2` rồi so đúng, như
  `codeKey` trong `tpbank.ts`. Không cho sai ký tự.

Trích xuất chỉ để hiện cho người duyệt khi không khớp: dãy số giống STK nhất,
dòng chữ hoa gần nhất. Bỏ dòng thông báo đẩy (`TPBank Mobile`, `TK: xxxx`,
`bây giờ`) và dòng "Xin chào".

Bảng thông báo đã duyệt cho trường tên và STK; màn khác dùng cùng dạng:

| Ảnh đọc được | Nhãn ngắn | Ghi chú |
|---|---|---|
| tên khớp, STK khác | Số tài khoản không khớp | Số tài khoản trên ảnh X, đã nhập Y. |
| tên khớp, không thấy STK | Không đọc được số tài khoản | Ảnh màn hình chính không đọc được số tài khoản. |
| tên khác, STK khớp | Tên khách hàng không khớp | Tên trên ảnh X, tên khách Y. |
| không thấy tên, STK khớp | Không đọc được tên khách hàng | Ảnh màn hình chính không có tên khách, có thể bị thông báo che. |
| tên khác, STK khác | Ảnh của khách khác | Ảnh ghi X; hệ thống ghi Y. |
| không có ảnh màn này | Thiếu ảnh màn hình chính | Không ảnh nào là màn hình chính app TPBank. |

Ghi chú luôn có cả hai giá trị. Người duyệt tự quyết OCR sai hay nhân viên
nhập sai.

### Bước 6. Đưa vào code

| Việc | Chỗ |
|---|---|
| Cấu hình đọc | `src/server/ocr/image.ts`: thêm một `VARIANTS` nếu cần tiền xử lý mới, thêm một `OcrProfile` |
| Nhận màn | `src/server/ocr/screen.ts`: một hàm `is<Bank><Screen>Screen(image)` |
| Kiểm chứng và thông báo | `src/server/ocr/banks/<mã>.ts`: `verify<Bank><Screen>(text, ctx)`, gọi từ `check<Bank>` |
| Chọn cấu hình theo ảnh | `check<Bank>Images(images, ctx)` trong cùng file, đăng ký ở `CHECKERS` của `src/server/photoCheck.ts` |
| Gói Tesseract mới | `Dockerfile`, dòng `apk add tesseract-ocr-data-*`; máy chủ phải dựng lại image |

Giữ `checkBank(texts, ctx, ...)` là hàm thuần để benchmark chạy trên chữ cache.
Ngân hàng chưa làm lại vẫn đi qua `withDefaultOcr` bốn lượt, không đổi kết
quả của họ.

### Bước 7. Đo trước khi commit, hỏi user trước khi chạy

Hai bộ đo, chạy `checkBankImages` thật:

1. Bộ ảnh nhãn ở bước 1, mỗi ảnh một tài khoản:

   ```bash
   OMP_THREAD_LIMIT=1 bun .claude/skills/ocr-screen-parser/scripts/flow-check.ts "<thư mục ảnh>" --bank TPB --item open
   ```

   Script đổ nhãn vào `ctx`, so kết luận của mục với nhãn: `pass` khi nhãn
   có đủ trường của mục, `fail` khi nhãn cố ý bỏ trường vì ảnh không có giá
   trị đó. Ngân hàng khác thì thêm checker vào `CHECKERS` của script.
2. Bộ benchmark cũ đủ 5 ảnh mỗi tài khoản, so từng tài khoản với bản cũ:
   `git show HEAD:src/server/ocr/banks/<mã>.ts` ra file tạm cạnh đó, chạy
   parser cũ trên chữ cache, in `cũ → mới` cho từng mục, xoá file tạm sau.

Điều kiện commit: không tài khoản nào tụt trừ ca tụt do bỏ dung sai, và mỗi
ca đổi kết quả đã soi bằng mắt. Báo cáo tách ba số: đạt đúng, không đạt đúng
lý do, kết luận sai. Chỉ commit file của mình; working tree hay có việc dở
của user.

## Bộ ảnh và số đo đang có

| Màn | Bộ nhãn | Benchmark cũ |
|---|---|---|
| TPBank màn hình chính | `~/Desktop/TPB/man hinh chinh/` 35 ảnh, `man hinh chinh 2/` 28 ảnh, đã kiểm | `/private/tmp/mgst-ocr-bench-TPB/` 52 tài khoản, 49 ảnh home |
| TPBank màn "Nhập thông tin" (mã giới thiệu) | `~/Desktop/TPB/ma gt/` 94 ảnh, `labels.json` chỉ có `referralCode`, đã kiểm 2026-09-14; luồng mới 94/94, chưa so benchmark | cùng bộ trên, 99 ảnh màn này |
| TPBank màn "Mở tài khoản thành công" | `~/Desktop/TPB/mở tk thanh công/` 74 ảnh, `labels.json` có `referralCode` và `accountNumber`, đã kiểm 2026-09-14; luồng mới 74/74; số đo ở `references/tpb-open-worked-example.md` | cùng bộ trên, 45 ảnh màn này; so 2026-09-15: 46 giữ nguyên, 3 tốt lên, 3 xấu đi đều đúng luật |
| TPBank màn "Chuyển thành công" biến thể 1 | `~/Desktop/TPB/ck-case-1/` 55 ảnh, `labels.json` có `amount`, `sender` (dạng `*TEN CHUYEN TIEN`), `title`, `bank`, đã kiểm 2026-09-14; luồng mới 52/55 đạt, 3 không đạt đúng lý do, chưa so benchmark | cùng bộ trên, khoảng 50 ảnh màn này; biến thể 2 và 3 chưa có bộ nhãn |

Màn "Nhập thông tin" TPBank, đo 2026-09-14: `plain` + `eng` + `--psm 11`
85/94 ở 0,36 s; phóng ảnh chụp 2600px 89/94; `sharp` 91/94 nhưng trượt 2 ảnh
khác `plain`, nên `sharp` chỉ là lượt hai khi thấy màn mà thiếu mã. `vie`
`--psm 6` mặc định chỉ 80/94. Ảnh nằm ngang 1400px: `--psm 0` báo "Too few
characters" trên ảnh gốc, phải phóng 2600px rồi mới hỏi hướng. Ảnh chụp bằng
máy cân bằng trắng lệch làm nền lavender thành tím bão hoà 0,35-0,45 và bị
nhận nhầm màn hình chính; `isTpbPurple` siết bão hoà lên 0,5.

Màn "Chuyển thành công" TPBank biến thể 1, đo 2026-09-14: số tiền in đậm
trên nền hoa văn và tiêu đề xanh lá làm `eng` `--psm 11` chỉ đọc số tiền
16/55, phải dùng `vie` `--psm 6` bản `best`. Kênh đỏ 1600px một lượt 0,63 s
đủ bốn trường 50/55 theo luật parser; thêm `sharp` khi thiếu thì 55/55; phóng
ảnh chụp 2600px làm số tiền tụt 54 → 50. Trường so được với hệ thống là TÊN
KHÁCH trong lời nhắn `<tên> chuyen tien [QR]` do app tự điền; 3/55 ảnh tên
ngân hàng khác tên hệ thống (đảo thứ tự, Phan/Pham, Nhuyen/Nguyen) và phải
báo không khớp. Grid chấm `title` và `bank` chặt hơn parser (`hasLabel` có
dung sai, `hasPhrase` mọi dòng), nên tính độ phủ ghép lượt theo luật parser.
| MB | chưa có bộ riêng | `/private/tmp/mgst-ocr-bench.QB38nP/` 50 tài khoản |
| MSBb | chưa có bộ riêng | `/private/tmp/mgst-ocr-bench-MSBb/` 104 tài khoản |

Thư mục `/private/tmp` mất khi máy khởi động lại; `scripts/benchmark-bank-ocr.ts`
ghi cách xuất lại từ database local.
