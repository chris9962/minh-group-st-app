---
name: ocr-verify
description: Quy trình sửa và đo bộ kiểm ảnh chứng minh tài khoản ngân hàng trong mgst-app (PaddleOCR + VietOCR đọc chữ, chấm bằng tìm giá trị hệ thống trong chữ). Dùng khi có ca kiểm ảnh sai, khi thêm ngân hàng mới, khi đổi model hay luật chấm, hoặc bất cứ việc gì đụng tới src/server/ocr, scripts/ocr-server.py, worker photo-check.
---

# Kiểm ảnh chứng minh tài khoản: sửa và đo

Chốt với chủ dự án 2026-09-19, thay bản cũ "mỗi màn một cấu hình Tesseract".

## Cách bộ kiểm hoạt động

Ba tầng, mỗi tầng một file:

| Tầng | File | Việc |
|---|---|---|
| Đọc chữ | `scripts/ocr-server.py`, `src/server/ocr/reader.ts` | PaddleOCR dò vùng chữ, VietOCR đọc từng vùng. Một lượt, không tiền xử lý, không nhận màn. Ảnh ngang đọc ba hướng, giữ hướng nhiều từ nhất. Tiến trình Python mở một lần, giữ suốt. |
| Chấm | `src/server/ocr/facts.ts`, `src/server/ocr/banks/<bank>.ts` | Tìm giá trị HỆ THỐNG trong chữ của cả bộ ảnh: tên khách, số tài khoản, mã giới thiệu, dòng "chuyển thành công". Không biết ảnh là màn nào, không đoán giá trị trên ảnh. Mỗi ngân hàng một hàm `facts(text, ctx)`; đọc-tới-khi-đủ và ba mục kết quả dùng chung ở `facts.ts`. |
| Hàng chờ | `src/server/photoCheck.ts`, `scripts/photo-check-worker.ts` | Ghi lượt chờ khi nhân viên hoàn thành, worker riêng đọc và ghi kết quả. |

Luật chấm, không dung sai (`ocr/text.ts`: `lineHasName`, `hasDigits`, `codeKey`, `linesHaveCode`):

- Tên: bỏ dấu, viết hoa, chuỗi chữ cái của tên nằm trong chuỗi chữ cái của một dòng, dư mỗi đầu tối đa 2 chữ; hoặc tên nối liền `CHUYENTIEN` (lời nhắn app tự điền).
- Số tài khoản: đúng từng chữ số, trọn dãy, cho khoảng trắng giữa các số. Không so chuỗi con: nhập thiếu hai số vẫn là chuỗi con. Ngân hàng `phone-match` (MSBb, MB, LPB, VPBank) lưu số điện thoại làm số tài khoản, tìm đúng số đó.
- Mã giới thiệu: gộp O/0, I/1, S/5, B/8, Z/2 rồi so đúng. Token liền nhau ghép lại vì OCR tách `ATI 07`. Mã toàn số (LPB, VPBank) tìm bằng `hasDigits`.
- Thành công: mỗi ngân hàng một `hasSuccess` riêng theo màn thật, xem đầu file `banks/<bank>.ts`.

Giá trị riêng từng ngân hàng (`Facts` có thêm khoá tuỳ chọn, `itemsFromFacts` gộp vào ba mục):

| Ngân hàng | Mục `open` | Mục `home` | Mục `transfer` |
|---|---|---|---|
| TPB | mã GT | tên + STK | "Chuyển thành công" / "Giao dịch thành công" / Lịch sử giao dịch + VND |
| MSBa, MSBb | mã GT (token đầu `display_name`) | tên + STK | "Chuyển tiền thành công"; tiêu đề bị popup che; tab Biến động số dư / Lịch sử giao dịch kèm "-Ref" |
| MB | mã RM + Tỉnh/Thành phố + Chi nhánh hỗ trợ | tên + User ID | "TIỀN RA" + VND, chứng từ, Thông báo biến động số dư |
| LPB | SĐT người giới thiệu | tên + SĐT + ngày mở `dd/mm/yyyy` | "Chuyển tiền thành công", Biến động số dư / Lịch sử giao dịch + VND |
| VPa, VPb `none` | mã DAO + mã giới thiệu cố định (`programOf`: VPa `MINHAP`, VPb SĐT của QR) | tên + SĐT | "Thành công" + tiền, thân chứng từ, Lịch sử giao dịch, Biến động số dư; kèm nạp chứng khoán (VNDIRECT / VPS / VPBankS / TKCK) |
| VPa, VPb `CNKD` | mã DAO + mã giới thiệu (VPa `MINHCA`, VPb SĐT QR riêng) + mục đích "Cá nhân kinh doanh" | tên + SĐT + màn liên kết eTax có SĐT | như trên, không đòi chứng khoán |
| VPa `HKD` | mã DAO + `MINHHKD` | tên + màn liên kết eTax (không so STK: eTax liên kết số doanh nghiệp) | màn "QR nhận tiền" / bảng QR ĐA NĂNG / "Yêu cầu mở tài khoản đã khởi tạo" |

Thông báo không đạt chỉ nói "Không tìm thấy X trong ảnh". `found` luôn rỗng. Bản cũ đoán giá trị trên ảnh bằng luật bố cục và hiện nhầm nhãn "Số tài khoản thanh toán" làm tên khách (2026-09-18); người duyệt phải mở ảnh, máy không thay được.

## Luật cứng

1. **Không đụng máy chủ.** Mọi việc đo làm ở máy local. `AGENTS.md` §0.2.
2. **Đo trước khi commit.** Sửa `ocr-server.py`, `reader.ts`, hay luật chấm thì chạy bộ benchmark và so với lượt trước. Không tài khoản nào tụt mà chưa soi bằng mắt.
3. **Claude là người gán nhãn.** Ca đổi kết quả phải mở ảnh xem bằng `Read`, xếp vào đúng một loại: OCR đọc sai / dữ liệu hệ thống sai / ảnh thiếu hoặc bị che. Chỉ loại đầu cần sửa code. Đếm riêng ba loại khi báo cáo.
4. **Một cấu hình đọc cho mọi ảnh.** Không thêm nhánh "màn này đọc kiểu này". Ảnh nào đọc sai thì sửa ở tầng đọc cho mọi ảnh, hoặc chấp nhận không đạt. Ngoại lệ duy nhất theo NGÂN HÀNG, không theo màn: MSBb đọc bằng `vgg_seq2seq` (chủ dự án chốt 2026-09-25), xem `ocrModelOf` ở `src/server/ocr/facts.ts`.
5. Máy user: `nice -n 19`, `OCR_THREADS=2`, việc dài chạy nền và ghi log ra file, không chặn chat.

## Môi trường local

Python của bộ đọc không nằm trong repo. Dựng một lần:

```bash
uv venv --python 3.11 ~/.mgst-ocr && source ~/.mgst-ocr/bin/activate
uv pip install "setuptools<70" torch torchvision paddlepaddle paddleocr vietocr
export OCR_PYTHON=~/.mgst-ocr/bin/python PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True
```

Lần chạy đầu tự tải model về `~/.paddlex` và `/tmp`. Thử nhanh một bộ ảnh:

```bash
OCR_CTX='{"referralCode":"AT107","customerName":"Dương Thị Mỹ Linh","accountNumber":"10005574904"}' \
  bun scripts/ocr-try.ts tpbank --raw anh0.webp anh1.webp     # msb: thêm "referralName"
```

## Quy trình sửa một ca

1. Lấy dữ liệu ca đó: `context` từ DB, ảnh từ S3. Trên production chỉ đọc, và chỉ khi chủ dự án cho phép trong lượt đó.
2. Xem ảnh bằng mắt trước. Ghi ra giá trị thật trên ảnh.
3. Chạy `ocr-try.ts --raw`, đọc chữ trả về. Xếp loại: chữ có giá trị mà luật không nhận, hay chữ không có giá trị.
4. Sửa đúng tầng: luật chấm ở `tpbank.ts`, cách đọc ở `ocr-server.py`.
5. Đo bộ benchmark, so với lượt trước. Soi từng ca đổi kết quả.
6. Commit chỉ file của mình. Working tree hay có việc dở của chủ dự án.

## Benchmark

Script `scripts/bench.ts` trong skill này, chạy từ `mgst-app`, `.env.local` đã `source` (DB local là dump production, S3 là bucket thật):

```bash
B=/private/tmp/mgst-ocr-bench-TPB
bun .claude/skills/ocr-verify/scripts/bench.ts xuat $B --n 60 --them <id đang soi>
bun .claude/skills/ocr-verify/scripts/bench.ts tai  $B
OCR_PYTHON=... nice -n 19 bun .claude/skills/ocr-verify/scripts/bench.ts doc $B mobile-v1 > $B/doc.log 2>&1 &
bun .claude/skills/ocr-verify/scripts/bench.ts so   $B db mobile-v1
```

- `xuat`: 60 tài khoản ngẫu nhiên từ 2026-09-01, cộng tài khoản chỉ định. Lưu `manifest.json` kèm kết quả lượt kiểm cũ trong DB (`oldItems`).
- `tai`: 4 luồng, timeout 30 giây mỗi ảnh. 310 ảnh mất khoảng 5 phút.
- `doc`: khoảng 3 giây một ảnh trên máy user, 310 ảnh khoảng 15 phút. Chạy nền. Ảnh đã đọc thì bỏ qua, nên đổi `ocr-server.py` phải đặt tên lượt mới.
- `so`: chấm hai lượt bằng `checkTpbank` hiện tại, in bảng đạt từng mục và danh sách tài khoản đổi kết quả kèm ghi chú. `db` làm lượt A là so với kết quả đang lưu trong DB.

Thư mục `/private/tmp` mất khi máy khởi động lại; `xuat` và `tai` dựng lại được trong 10 phút.

Kiểm nhãn bằng mắt nhiều ảnh một lúc: `scripts/verify-sheet.ts` ghép 4 ảnh một tấm kèm tên file, đọc từng tấm bằng `Read`.

## Số đo đang có

Bộ 62 tài khoản TPBank, 310 ảnh, đo 2026-09-19 trên máy user, so VietOCR (model dò `PP-OCRv5_mobile_det`) với flow Tesseract cũ (commit c4364b4). Số cuối ghi ở `docs/plan-ocr-vietocr-2026-09-19.md` mục "Kết quả đo". Số đo các ngân hàng còn lại (MSB, MB, LPB, VPBank ba loại, TPB hồi quy) đo 2026-09-22 ở `docs/plan-ocr-cac-ngan-hang-2026-09-22.md`.

Đã biết:

- Ảnh chụp lại màn hình, chữ nhỏ: VietOCR đọc được `AT107` mà Tesseract 36 cấu hình không cấu hình nào đọc được.
- Ảnh ngang: VietOCR đọc vùng xoay ra ký tự rời. `ocr-server.py` đọc bốn hướng cho ảnh ngang, giữ hướng nhiều từ có nghĩa nhất (`VOCAB`), hoà thì nhiều chữ nhất. Bộ phân loại hướng `PP-LCNet_x1_0_doc_ori` của Paddle đoán sai 1/2 ảnh thử nên không dùng.
- Ảnh dọc chụp lại điện thoại khách cầm ngược (VPBank 5/85 bộ 2026-09-22): đọc ra dưới 3 từ có nghĩa thì đọc lại lộn 180°.
- Tiêu đề "Chuyển thành công!" có khi bị dò thành hai vùng "Chuyển" và "thành công": luật thành công phải ghép được hai dòng liền nhau.
- Ảnh chụp cả CCCD trên bàn: số CCCD đọc ra dạng 4-4-3. Luật STK so đúng dãy hệ thống nên không đạt nhầm; đừng thêm luật "lấy số 4-4-3 đầu tiên".

## Thêm ngân hàng mới

Theo đúng cách của `tpbank.ts`: một hàm `facts(text, ctx)` trả các giá trị hệ thống có trong chữ không (`Facts`, thêm khoá tuỳ chọn nếu ngân hàng đòi thêm giá trị), `check(texts, ctx)` gọi `itemsFromFacts`, `checkImages(images, ctx)` gọi `readUntilFound`. Đăng ký ở `CHECKERS` của `photoCheck.ts`, `bench.ts` và `ocr-try.ts`; viết `scripts/test-<bank>-photo-parser.ts` với chữ VietOCR thật và nối vào `test:ocr`. Đo trên benchmark của ngân hàng đó (`bench.ts xuat --bank X [--loai CNKD]`) rồi mới thêm vào `ENABLED_BANKS`. BIDV, MBV, SHB, TCB, VIB chưa có bộ nhãn (2026-09-22).
