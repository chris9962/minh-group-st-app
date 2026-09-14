# Màn hình chính TPBank, làm ngày 2026-09-14

Trường cần kiểm: tên khách và số tài khoản. Chữ trắng trên nền tím, tên viết
hoa không dấu, số tài khoản dạng `1000 5514 153`.

## Bộ ảnh

63 ảnh có nhãn ở `~/Desktop/TPB/man hinh chinh/` và `man hinh chinh 2/`:
28 screenshot, 35 ảnh chụp lại bằng máy khác, gồm ảnh trong tối, ảnh loá,
ảnh nằm ngang. Kiểm nhãn bằng mắt sửa 7 file: 4 tên gõ sai, 1 STK sai, 1 STK
thiếu số, 3 file chưa có nhãn.

## Cấu hình đã thử, mỗi lần một lượt Tesseract

| Cấu hình | STK đúng / 32 | Tên đúng / 32 | Giây một ảnh |
|---|---|---|---|
| `plain`, vie best, psm 6 | 17 | 15 | 0,81 |
| xám đảo màu | 28 | 28 | 1,01 |
| kênh xanh lá đảo màu | 28 | 30 | 0,95 |
| kênh xanh đảo, phóng 2600 mọi ảnh | 30 | 28 | 1,44 |
| kênh xanh đảo, psm 4 | 29 | 30 | 0,69 |
| kênh xanh đảo, psm 11 | 29 | 31 | 0,88 |
| kênh xanh đảo, model vie gọn | 23 | 26 | 0,39 |
| kênh xanh đảo, Sauvola | 29 | 25 | 1,02 |
| kênh xanh đảo, chỉ ảnh chụp phóng 2600, psm 11 | 31 | 31 | 1,19 |
| như trên, `-l eng` bản gọn | 31 | 31 | 0,55 |
| như trên, `-l eng` bản best | 31 | 31 | 1,15 |

Chốt: kênh xanh lá đảo màu, screenshot giữ 1600px, ảnh chụp lại phóng
2600px, ảnh ngang xoay theo `--psm 0`, `-l eng` bản gọn của hệ điều hành,
`--psm 11`. Trên 112 ảnh qua parser thật: psm 11 đủ tên và STK 96 ảnh, psm 6
được 82. Một screenshot psm 11 tách `1000 5476 377` thành `10!` và `476377`,
psm 6 đọc liền, nên thêm lượt đọc lại psm 6 chỉ khi lượt đầu thiếu trường.

Vì sao kênh xanh lá: nền tím có xanh lá thấp, chữ trắng có xanh lá cao. Đảo
xong chữ đen trên nền sáng, tương phản cao hơn chuyển xám rồi đảo.

## Nhận màn bằng màu

Tím TPBank: hue 240 đến 268, bão hoà ≥ 0,35, sáng ≥ 0,2. Tím của nút và
banner ở màn khác có hue 270 đến 280 nên bị loại từ bước màu. Khối tím liền
lớn nhất sau khi giãn 2 điểm trên ảnh thu 240px, là màn hình chính khi:
diện tích ≥ 8% ảnh, cao ≥ 20%, rộng ≥ 30%.

Số đo: màn hình chính thấp nhất là 9,0% diện tích, cao 27%, rộng 33%. Màn
khác cao nhất 7,8% diện tích nhưng rộng 17%; còn lại cao dưới 15%. Kết quả
63/63 và 49/49 màn hình chính, 0/212 màn khác bị nhận nhầm, 28 ms một ảnh.

Screenshot của máy hiển thị tối có sáng 0,3; ngưỡng sáng 0,45 làm mất ảnh
đó, hạ xuống 0,2 vẫn không thêm ca nhận nhầm vì hue đã lọc.

## Kết quả cuối, 112 ảnh

| Loại | Số ảnh | Kết luận của code |
|---|---|---|
| Tên và STK trùng hệ thống | 97 | đạt, đúng |
| Tên bị thông báo đẩy che, hoặc cả tên lẫn STK bị che | 9 | không đạt, đúng |
| Ảnh khác hệ thống | 4 | không đạt kèm hai giá trị, đúng |
| OCR đọc sai một chữ số STK | 2 | không đạt, sai; ảnh loá và ảnh chụp đọc 1 thành 7 |

52 tài khoản benchmark so với bản 4 lượt: 50 giữ nguyên, 1 tốt lên, 1 đổi do
bỏ dung sai.

## Lỗi parser cũ đã thấy, tránh lặp ở màn khác

- Chỉ tìm tên trong 3 dòng sau "Xin chào": psm 11 chen 3 đến 5 dòng rác
  giữa hai dòng đó, mất 7/63 tên.
- Bỏ từ dưới 2 ký tự khi nhặt tên: `PHAM THI NHU Y` mất chữ Y.
- Đòi STK và số điện thoại cùng dòng để nhận màn: psm 11 tách hai số.
- Lấy dãy số đầu tiên khớp mẫu trong chữ nối 4 lượt: dãy sai ở lượt trước
  thắng dãy đúng ở lượt sau.
- Cho lệch 1 chữ số STK và 1 ký tự mỗi 8 ký tự tên: bỏ qua nhân viên nhập sai.
