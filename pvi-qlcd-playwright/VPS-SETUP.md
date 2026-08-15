# Triển khai lên VPS

Tài liệu này viết cho Ubuntu 22.04 hoặc 24.04. Người đọc là người vận hành, không cần biết Playwright.

Bạn đăng nhập trên máy cá nhân, chép `storageState.json` lên VPS. VPS không cần màn hình.

⚠️ Đường dẫn trong tài liệu này viết theo bản cũ, khi thư mục còn đứng riêng ở
`/opt/pvi-qlcd`. Thư mục nay nằm trong repo `mgst-app`, nên `/opt/pvi-qlcd` đổi
thành `<thư mục mgst-app trên VPS>/pvi-qlcd-playwright`, và `npm install` bỏ đi
vì `playwright` đã nằm trong `dependencies` của mgst-app. Phần Xvfb, VNC và
systemd vẫn đúng nguyên.

## 1. `storageState.json` là gì

Đây là file JSON do Playwright xuất ra. Nó chứa toàn bộ cookie và `localStorage` của một phiên trình duyệt đã đăng nhập.

Cấu trúc:

```json
{
  "cookies": [
    {
      "name": "ASP.NET_SessionId",
      "value": "chuỗi bí mật",
      "domain": "qlcd.pvi.com.vn",
      "path": "/",
      "expires": -1,
      "httpOnly": true,
      "secure": true,
      "sameSite": "Lax"
    }
  ],
  "origins": [
    { "origin": "https://qlcd.pvi.com.vn", "localStorage": [] }
  ]
}
```

Vai trò của nó trong hệ thống:

| Câu hỏi | Trả lời |
|---|---|
| Ai tạo ra | `login.js` hoặc `import-cookies.js`, chạy trên máy cá nhân |
| Ai đọc | `create-order.js` và `check-session.js` trên VPS |
| Thay cho việc gì | Thay cho đăng nhập. Trình duyệt mở lên đã ở trạng thái đăng nhập sẵn |
| Có chứa mật khẩu không | Không. Chỉ chứa cookie phiên |
| Sống bao lâu | Theo hạn phiên của PVI. Chưa đo được, phải theo dõi thực tế |
| Mất file thì sao | Tạo lại theo mục 3 |

Cảnh báo bảo mật: ai cầm file này thì đăng nhập được vào tài khoản PVI của bạn mà không cần mật khẩu. Đặt quyền `600`, không commit, không gửi qua chat hay email.

## 2. Cài đặt trên VPS

### 2.1. Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
```

### 2.2. Thư mục và mã nguồn

```bash
sudo mkdir -p /opt/pvi-qlcd && sudo chown $USER:$USER /opt/pvi-qlcd
```

Chép `config.js`, `browser-fill.js`, `create-order.js`, `check-session.js`, `package.json` vào `/opt/pvi-qlcd`.

```bash
cd /opt/pvi-qlcd && npm install
```

### 2.3. Chromium và thư viện hệ thống

```bash
cd /opt/pvi-qlcd && npx playwright install --with-deps chromium
```

`--with-deps` cài luôn các thư viện hệ thống mà Chromium cần. Thiếu chúng thì trình duyệt không khởi động được.

### 2.4. Màn hình ảo

```bash
sudo apt install -y xvfb
```

Trang PVI có lớp chống bot. Chạy Chromium headless dễ bị chặn, nên script chạy có giao diện trên màn hình ảo của `xvfb-run`.

## 3. Tạo `storageState.json` trên máy cá nhân

Captcha cần người nhìn, nên bước này không tự động hóa được. Chọn một trong hai cách.

### Cách 1 — chạy `login.js`

Cần Node và Playwright trên máy cá nhân.

```bash
cd "/Users/nguyentruong/Minh group/pvi-qlcd-playwright" && npm install && npx playwright install chromium
```

```bash
node login.js
```

Script mở một cửa sổ Chromium. Bạn nhập tài khoản, mật khẩu, captcha. Vào được form thì script lưu file rồi tự đóng trình duyệt:

```
Đã lưu phiên vào .../storageState.json
```

Quá 10 phút chưa đăng nhập xong thì script thoát mã 1 và không lưu gì.

### Cách 2 — copy cookie từ Chrome đang đăng nhập

Không cần cài Playwright. Bạn giữ nguyên tab PVI đang mở.

1. Mở tab `qlcd.pvi.com.vn` đã đăng nhập.
2. Bấm F12, chọn tab **Network**.
3. Tải lại trang.
4. Click request đầu tiên trong danh sách.
5. Kéo xuống mục **Request Headers**, copy toàn bộ giá trị của dòng `cookie:`.
6. Dán vào file `cookie.txt`.

```bash
node import-cookies.js cookie.txt && rm cookie.txt
```

Script in ra tên các cookie đọc được và đặt quyền `600` cho file.

### Chép lên VPS

```bash
scp storageState.json user@vps:/opt/pvi-qlcd/ && ssh user@vps 'chmod 600 /opt/pvi-qlcd/storageState.json'
```

## 4. Kiểm tra phiên trên VPS

Làm ngay sau khi chép file lên. Bước này trả lời câu hỏi phiên có dùng được từ IP của VPS không.

```bash
cd /opt/pvi-qlcd && xvfb-run -a node check-session.js
```

Kết quả khi phiên dùng được:

```json
{ "ok": true, "thongDiep": "Phiên dùng được", "soCookie": 6, "cookieHetHanSomNhat": "..." }
```

| Mã thoát | Nghĩa | Xử lý |
|---|---|---|
| 0 | Phiên dùng được | Sang mục 5 |
| 2 | Phiên hết hạn, file hỏng, hoặc phiên gắn với IP máy cá nhân | Thử lại cách còn lại ở mục 3. Vẫn mã 2 thì làm mục 7 |

## 5. Tạo đơn

```bash
cd /opt/pvi-qlcd && cat payload.json | xvfb-run -a node create-order.js
```

Chạy thử, không ghi vào form:

```bash
cd /opt/pvi-qlcd && cat payload.json | xvfb-run -a node create-order.js --dry-run
```

Script in JSON ra stdout, chụp ảnh form vào `/opt/pvi-qlcd/anh/`.

BE gọi bằng cách chạy tiến trình con, ghi payload vào stdin, đọc stdout và mã thoát.

## 6. Xử lý khi phiên hết hạn

Phiên hết hạn thì `create-order.js` thoát mã 2 với thông điệp `Phiên đăng nhập hết hạn`.

BE phải bắt mã 2 và báo người vận hành. Người vận hành làm lại mục 3.

Nên hẹn giờ chạy `check-session.js` mỗi giờ để biết trước, thay vì biết lúc có đơn cần tạo:

```bash
(crontab -l 2>/dev/null; echo '0 * * * * cd /opt/pvi-qlcd && xvfb-run -a node check-session.js >> /var/log/pvi-check.log 2>&1') | crontab -
```

## 7. Dự phòng — đăng nhập ngay trên VPS qua VNC

Chỉ dùng khi mục 4 luôn báo mã 2. Nguyên nhân khi đó là lớp chống bot gắn phiên với IP hoặc dấu vết trình duyệt. Cách này tạo cookie từ chính IP của VPS.

### 7.1. Bật màn hình ảo và VNC trên VPS

```bash
sudo apt install -y x11vnc
```

```bash
Xvfb :99 -screen 0 1280x900x24 > /tmp/xvfb.log 2>&1 &
```

```bash
x11vnc -display :99 -localhost -rfbport 5900 -nopw -forever > /tmp/x11vnc.log 2>&1 &
```

`-localhost` bắt x11vnc chỉ nhận kết nối từ chính VPS. Người ngoài không nối thẳng vào được, phải qua đường hầm SSH.

### 7.2. Mở đường hầm SSH từ máy bạn

```bash
ssh -L 5900:localhost:5900 user@vps
```

Giữ cửa sổ này mở suốt quá trình đăng nhập.

### 7.3. Mở trình xem VNC trên máy Mac

Mở một cửa sổ Terminal khác:

```bash
open vnc://localhost:5900
```

macOS có sẵn ứng dụng Screen Sharing. Màn hình đen là đúng, vì chưa có gì chạy trên màn hình ảo.

### 7.4. Chạy login trên VPS

Chép thêm `login.js` lên `/opt/pvi-qlcd`. Quay lại cửa sổ SSH ở mục 7.2:

```bash
cd /opt/pvi-qlcd && DISPLAY=:99 node login.js
```

Cửa sổ Chromium hiện trong trình xem VNC. Bạn nhập tài khoản, mật khẩu, captcha.

### 7.5. Khóa quyền file và tắt VNC

```bash
chmod 600 /opt/pvi-qlcd/storageState.json && pkill x11vnc && pkill Xvfb
```

## 8. Lỗi hay gặp

| Hiện tượng | Nguyên nhân | Cách sửa |
|---|---|---|
| `browserType.launch: Host system is missing dependencies` | Thiếu thư viện hệ thống | Chạy lại `npx playwright install --with-deps chromium` |
| `import-cookies.js` báo `Không đọc ra cookie nào` | Copy nhầm dòng khác trong Request Headers | Copy lại đúng giá trị dòng `cookie:` |
| `check-session.js` luôn thoát mã 2 dù mới đăng nhập | Phiên gắn với IP máy cá nhân | Làm mục 7 |
| Trình xem VNC báo không nối được | Chưa mở đường hầm SSH, hoặc x11vnc chưa chạy | Kiểm tra `/tmp/x11vnc.log`, chạy lại mục 7.1 và 7.2 |
| VNC hiện màn hình đen sau khi chạy `login.js` | Quên `DISPLAY=:99` | Chạy lại với `DISPLAY=:99` đứng trước `node` |
| `create-order.js` thoát mã 3, báo `AJAX KHÔNG TRẢ OPTION` | Mạng chậm hoặc PVI đổi API kênh bán hàng | Chạy lại. Vẫn lỗi thì kiểm tra `POST /Electrical/GetKenhKT` |
