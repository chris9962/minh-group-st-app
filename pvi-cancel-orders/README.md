# pvi-cancel-orders

Job huỷ trên PVI Connect (baohiem.pvi.com.vn) các đơn bảo hiểm đã huỷ trong mgst-app. Job chỉ lấy đơn huỷ của ngày hiện tại.

Đơn huỷ trong mgst-app vẫn còn hiệu lực trên PVI. Nhân viên huỷ trên PVI bằng tay mỗi tối, theo 3 bước:

1. Gom các đơn lẻ đã huỷ thành đơn gom, ở trang "Gom đơn".
2. Lập SĐBS "0401 - Hủy đơn" cho đơn gom.
3. Ký SĐBS.

Việc này phải xong trước lượt gom tự động của PVI, khoảng 21:00. Sau lượt đó, PVI gom đơn huỷ chung với đơn còn hiệu lực.

Thư mục này đứng riêng: không import gì từ phần còn lại của repo. Code chép từ skill `pvi-connect` ngày 2026-10-23. Ghi chép về API và body của từng lệnh nằm ở `~/.claude/skills/pvi-connect/references/huy-don.md`.

## Các file

| File | Việc |
|---|---|
| `cancel-orders.ts` | Job chính: đọc đơn huỷ từ DB, đăng nhập, gom, lập SĐBS, ký, ghi kết quả |
| `pvi-connect.ts` | Gọi API PVI Connect và dựng body |
| `solve-captcha.py` | Đọc captcha đăng nhập |
| `Dockerfile` | Image có bun, tesseract, python |
| `../deploy/systemd/mgst-pvi-cancel.service` | Chạy job một lần bằng `docker run` |
| `../deploy/systemd/mgst-pvi-cancel.timer` | Gọi service lúc 19:30 mỗi ngày |

## Job làm gì

1. Đọc DB: đơn `motorbike` và `electric-accident`, trạng thái `cancelled`, `order_date` bằng ngày hiện tại, có số seri.
2. Đăng nhập PVI Connect. Job dùng lại phiên đã lưu, làm mới bằng refresh token, hoặc đăng nhập lại bằng captcha.
3. Tìm từng đơn trong danh sách chờ gom của ngày hiện tại:
   - Xe máy: lọc theo số seri, thử lần lượt 3 giá trị "Thời hạn bảo hiểm".
   - Đơn điện: tải cả danh sách, khớp số đơn lẻ với `pvi_policy_number`.
4. Ghi kế hoạch: đơn nào gom được, đơn nào vào chung một đơn gom, đơn nào bỏ qua và lý do.
5. Khi `PVI_CANCEL_ENABLED=1`, job gom cả xe máy lẫn đơn điện, rồi huỷ từng đơn gom:
   - Xe máy: lập SĐBS huỷ, ký SĐBS.
   - Đơn điện: ký đơn gom, lập SĐBS huỷ, ký SĐBS. Đơn gom điện tạo ra ở trạng thái Chờ duyệt, chưa ký thì không lập được SĐBS.

Form SĐBS đơn điện bắt nhập 2 ô mà đơn gom để trống: "Phạm vi BH" và mã điều khoản ở bảng "Quy tắc bảo hiểm". Job điền theo SĐBS nhân viên đã lập: nội dung phạm vi chuẩn của sản phẩm và mã 030224.

Đơn không còn chờ gom thì job tra đơn gom đang chứa nó, và xem đơn gom đó đã có SĐBS huỷ chưa.

Cuối mỗi lượt chạy, kể cả lượt dừng vì lỗi, job ghi một dòng vào bảng `pvi_cancel_runs` (migration 0148). Worker Zalo đọc dòng mới và gửi thông báo "Kết quả gom và huỷ đơn trên PVI Connect" tới người nhận và nhóm chọn ở màn Bot Zalo, tab "Thông báo tự động". Nội dung tin dựng ở `src/server/zalo/pviCancelReport.ts`.

Kết quả ghi ở `/data/results-<ngày>.json`, ghi lại ngay sau mỗi lệnh ghi lên PVI. Chạy lại trong ngày thì job làm tiếp từ chỗ dừng: đơn đã gom không gom lại, đơn gom chưa ký thì lập SĐBS và ký tiếp. Cuối lượt, log in danh sách đơn gom và đơn bị bỏ qua.

## Biến môi trường

| Biến | Giá trị |
|---|---|
| `DATABASE_URL` | Đường tới DB mgst. Service truyền sẵn. |
| `PVI_CONNECT_USERNAME` | Tài khoản PVI Connect có mã vai trò `ma_tthai = "02"`. Tài khoản khác không ký được SĐBS do chính nó tạo. |
| `PVI_CONNECT_PASSWORD` | Mật khẩu của tài khoản đó |
| `PVI_CANCEL_ENABLED` | `1` thì ghi thật lên PVI. Không đặt thì chỉ kiểm tra. |
| `PVI_CANCEL_DATA_DIR` | Thư mục lưu phiên và kết quả. Mặc định `/data`. |

## Cài trên máy chủ

Làm theo luật ở `AGENTS.md` mục 0.2: chỉ làm khi chủ dự án cho phép trong lượt đó.

1. Tạo file biến môi trường, quyền 600:

   ```bash
   cat > /opt/mgst-app/.env.pvi-cancel <<'EOF'
   PVI_CONNECT_USERNAME=...
   PVI_CONNECT_PASSWORD=...
   EOF
   chmod 600 /opt/mgst-app/.env.pvi-cancel
   ```

   Chưa đặt `PVI_CANCEL_ENABLED`: vài ngày đầu job chỉ kiểm tra.

2. Tạo thư mục kết quả:

   ```bash
   mkdir -p /var/lib/mgst-pvi-cancel && chmod 700 /var/lib/mgst-pvi-cancel
   ```

3. Dựng image:

   ```bash
   cd /opt/mgst-app && docker build -t mgst-pvi-cancel:latest pvi-cancel-orders
   ```

4. Chạy thử một lượt bằng tay, rồi đọc log:

   ```bash
   cp deploy/systemd/mgst-pvi-cancel.service deploy/systemd/mgst-pvi-cancel.timer /etc/systemd/system/
   systemctl daemon-reload
   systemctl start mgst-pvi-cancel.service
   journalctl -u mgst-pvi-cancel -n 100 --no-pager
   ```

5. Bật timer:

   ```bash
   systemctl enable --now mgst-pvi-cancel.timer
   systemctl list-timers mgst-pvi-cancel.timer
   ```

6. Khi kết quả kiểm tra đúng vài ngày liền, thêm `PVI_CANCEL_ENABLED=1` vào `/opt/mgst-app/.env.pvi-cancel`.

Job hỏng thì `mgst-alert@` ghi lỗi vào journal, cùng cách với các timer khác.

## Việc còn thiếu

- Captcha: `solve-captcha.py` đọc đúng 3 trên 6 ảnh mẫu trên máy Mac, 2 trên 6 trong image. Job thử tối đa 8 captcha mỗi lần đăng nhập, và chỉ thử lại khi PVI báo sai captcha. Chưa biết PVI có khoá tài khoản sau nhiều lần sai hay không.
- Đơn điện: body của 3 bước sau gom chép từ lượt huỷ C061144 ngày 2026-10-24 trên giao diện, đơn gom có 1 đơn lẻ. Job chưa chạy thật cho đơn điện, và chưa thử đơn gom điện có nhiều đơn lẻ.
