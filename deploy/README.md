# Cấu hình máy chủ đi theo git

Thư mục này chứa phần cấu hình máy chủ THUỘC VỀ app: khối Nginx của app và
trang bảo trì. Để trong repo nên nó được review như code, và VM dựng lại không
mất.

Thông số máy chủ, chứng chỉ, tài khoản nằm ở `docs/deploy-fpt-cloud.md` — file
đó trong `.gitignore` vì chứa mật khẩu.

## Nội dung

| Đường dẫn | Nội dung |
|---|---|
| `nginx/app.conf` | khối `location` của app, chế độ bảo trì, trần dung lượng ảnh |
| `nginx/proxy.conf` | header chuyển tiếp dùng chung, `nginx/app.conf` include vào |
| `maintenance/index.html` | trang bảo trì, tự đếm ngược và tự tải lại |
| `bat-bao-tri.sh` | bật bảo trì, tham số là số phút dự kiến |
| `tat-bao-tri.sh` | tắt bảo trì |

`maintenance/on` và `maintenance/until.txt` là trạng thái lúc chạy, hai script
sinh ra, `.gitignore` chặn.

## Gắn vào Nginx trên máy chủ

Máy chủ giữ `/etc/nginx/sites-available/mgst.conf` như cũ, thêm đúng một dòng
vào trong khối `server` của HTTPS:

```nginx
include /opt/mgst-app/deploy/nginx/app.conf;
```

Rồi xoá những khối `location` cũ trong file đó — chúng đã chuyển vào
`app.conf`. Đặc biệt phải xoá khối `location /uploads/`: nó phục vụ ảnh thẳng
từ đĩa, không qua chốt kiểm phiên đăng nhập nào. Từ khi ảnh chuyển sang FPT
Object Storage, mọi lượt xem đi qua `GET /api/images/<key>` và route đó đòi phiên.

⚠️ Kiểm cú pháp TRƯỚC khi nạp lại. Nạp lại với cấu hình lỗi thì Nginx giữ bản
cũ, nhưng lần khởi động lại kế tiếp sẽ dừng.

```bash
nginx -t
systemctl reload nginx
```

**Không đưa cả file `mgst.conf` vào repo.** Certbot ghi thẳng vào file đó mỗi
lần cấp hay gia hạn chứng chỉ. Deploy chạy `git reset --hard` là xoá phần
certbot vừa ghi và HTTPS dừng.

## Bảo trì lúc deploy

```bash
cd /opt/mgst-app
./deploy/bat-bao-tri.sh 15      # dự kiến 15 phút

git fetch origin main && git reset --hard origin/main
bun install --frozen-lockfile
bun run db:migrate
bun run build
systemctl restart mgst-app

./deploy/tat-bao-tri.sh
```

Bật và tắt KHÔNG cần `nginx -t` lẫn `systemctl reload nginx`. Nginx kiểm sự tồn
tại của file `maintenance/on` ở từng request.

Trang bảo trì hỏi máy chủ 15 giây một lần rồi tự tải lại khi mã trả về khác 503.
Người dùng không phải bấm gì.

## Cách hoạt động

| Đường dẫn | Lúc bình thường | Lúc bảo trì |
|---|---|---|
| `/` và mọi trang | app trả về | 503 + `index.html` |
| `/api/...` | app trả về | 503 + JSON `{"message":"..."}` |
| `/__maintenance/until.txt` | mốc giờ | mốc giờ, không bị chặn |

API trả JSON chứ không trả HTML. FE gọi bằng `fetch` rồi đọc `res.ok`; nhận
nguyên trang HTML thì nó ném lỗi cú pháp thay vì hiện thông báo bảo trì.

Mã phải là 503, không phải 200. Trả 200 thì trang bảo trì nằm lại trong cache
của trình duyệt và proxy cả sau khi bạn đã tắt.

## Đã kiểm 2026-08-21

Chạy nginx:alpine dùng chung mạng với container app, nạp đúng `app.conf` của
repo. Kết quả:

| Ca | Kết quả |
|---|---|
| Bình thường: `/`, `/login` | 200 |
| Bình thường: `/api/bank-account-list` không phiên | 401 JSON |
| Bảo trì: `/` và `/banking/abc` | 503, `text/html`, `Retry-After: 900`, đúng trang |
| Bảo trì: `/api/bank-account-list` | 503, `application/json`, parse được |
| Bảo trì: `/__maintenance/until.txt` | 200, `text/plain` |
| Tắt bảo trì | quay lại 200 và 401 như cũ |

Bản đầu dùng `error_page 503 = @bao_tri_html` và trả về 200: dấu `=` bảo Nginx
lấy mã từ khối được gọi, mà `try_files` phục vụ file tĩnh với mã 200. Bỏ dấu `=`
thì giữ đúng 503.
