# Màn "Mở tài khoản thành công" TPBank, làm ngày 2026-09-14

Trường cần kiểm: mã giới thiệu phải đúng mã đã chọn (luật của chủ dự án).
Số tài khoản có trên màn thì so thêm; không đọc được thì không kết luận, vì
màn hình chính đã so số đó. Chữ tối trên nền lavender, nhãn trái giá trị
phải, tiêu đề xanh lá.

## Bộ ảnh

74 ảnh ở `~/Desktop/TPB/mở tk thanh công/`: 46 screenshot, 28 ảnh chụp lại,
gồm ảnh nghiêng, ảnh loá, ảnh nằm ngang, ảnh máy cân bằng trắng lệch thành
tím, ảnh màn hình nứt, ảnh chụp sát có vân lưới. Tên file chỉ có tên và số
tài khoản; mã giới thiệu đọc bằng mắt từng ảnh rồi ghi `labels.json`. Kiểm
nhãn sửa 1 file: số tài khoản gõ sai một chữ số. Một ảnh chưa bấm "Xem thêm"
nên không có mã, nhãn bỏ trường `referralCode` để kết luận đúng là "không đọc
được mã".

## Cấu hình đã thử, mỗi lần một lượt Tesseract, 74 ảnh

| Cấu hình | Đủ mã và STK | Giây một ảnh |
|---|---|---|
| `plain`, vie best, psm 6, 1600 (lượt đầu của profile mặc định) | 66 | 0,77 |
| `plain`, eng, psm 11, ảnh chụp phóng 2600 | 72 | 0,72 |
| như trên, psm 6 | 71 | 0,60 |
| `sharp`, eng, psm 11, phóng 2600 | 69 | 0,83 |
| `plain`, eng, psm 11, không phóng | 71 | 0,32 |
| `plain`, eng, psm 11, phóng 1400 | 73 | 0,36 |
| `plain`, eng, psm 11, phóng 2000 | 72 | 0,45 |
| `plain`, eng, psm 6, không phóng | 71 | 0,34 |

Chốt lượt đầu: `plain` + `eng` + `--psm 11` + phóng 2600, dùng chung với màn
"Nhập thông tin" vì trước khi OCR không biết ảnh là màn nào; trên bộ 94 ảnh
của màn đó, 1400 chỉ 88/94, 2000 và 2600 cùng 89/94.

Hai ảnh lỗi ở lượt đầu cần hai cách ngược nhau:

- `phung-thi-kim-tuyen`: chụp sát màn hình, vân lưới điểm ảnh. Mọi cỡ phóng
  từ 1200 tới 3000 ra 200 đến 1500 dòng rác, kể cả `blur`, `median`,
  `grayscale` trước hay sau khi phóng. Cỡ gốc 900px đọc đúng cả mã lẫn STK.
  Nên lượt hai là cỡ gốc (`TPB_LIGHT_UNSCALED_PROFILE`).
- `cao-thi-lac`: nghiêng, loá, vân chéo. psm 11 đọc STK đúng ở 1200, 1400,
  2000 nhưng sai ở 1800, 2200, 2600: không ổn định theo cỡ. Tiêu đề xanh lá
  mất ở mọi kênh (đỏ, xanh lá, xám, normalise). Lượt đầu vẫn đọc được mã
  và hai nhãn "Tên đăng nhập", "Số tài khoản thanh toán", nên nhận màn bằng
  hai nhãn đó khi mất tiêu đề. STK đọc thiếu một chữ số không khớp mẫu
  4-4-3 nên không bị báo "không khớp"; màn hình chính so số đó.

## Luồng đã viết vào code

`ocrTpbOther`: lượt đầu `TPB_LIGHT_PROFILE`; thấy màn mở tài khoản mà thiếu
mã hay STK thì đọc thêm lượt cỡ gốc, lấy lượt thấy nhiều trường hơn. Không
nhận ra màn sáng nào thì đi tiếp nhánh chuyển khoản như trước.

`verifyTpbOpen`: mã so bằng `codeKey` trên từng token và cặp token liền nhau;
STK so trên chuỗi chữ số của cả ảnh. Giá trị hiện cho người duyệt lấy token
dạng mã sau dòng nhãn "Mã giới thiệu", và dãy 4-4-3 đầu tiên.

## Kết quả, `checkTpbankImages` thật

74/74 kết luận đúng ở 0,98 giây một ảnh: 73 đạt, 1 "không đọc được mã" đúng
vì ảnh chưa bấm "Xem thêm". Màn "Nhập thông tin" chạy lại sau khi đổi thứ tự
nhánh: 94/94 ở 0,67 giây.

Benchmark 52 tài khoản so với bản `fb2088b`, đo 2026-09-15, 7,9 giây một tài
khoản thay cho 40 đến 50 giây của bản bốn lượt: 46 giữ nguyên, 3 tốt lên, 3
xấu đi, mỗi ca đã soi ảnh:

- Tốt lên: khách có màn mở tài khoản chưa bấm "Xem thêm" cộng màn "Nhập
  thông tin" có mã, kèm một ảnh của người khác; bản cũ chọn ảnh người khác vì
  đọc đủ trường nhất. Một ca màn hình chính đọc được STK nhờ lượt `--psm 6`.
- Xấu đi: nhân viên nhập STK `1000 5476 1` thiếu hai số, bản cũ cho đạt vì
  so `includes` trên chuỗi chữ số cả ảnh, bản mới báo không khớp kèm hai giá
  trị. Hai ca còn lại là mục chuyển khoản so tên trong lời nhắn, cùng lệch
  với mục màn hình chính đã báo.

## Lỗi parser cũ đã thấy

- `pickField` đòi giá trị cùng dòng với nhãn: `--psm 11` tách nhãn và giá
  trị ra hai dòng, mất hết.
- `referralCodeIn` lấy cụm sau chữ "thiệu" trên cùng dòng: cùng lý do.
- Bốn trường `username`, `effectiveFrom`, ... tách ra nhưng không dùng để
  kiểm; bỏ, chỉ giữ hai trường của luật.
