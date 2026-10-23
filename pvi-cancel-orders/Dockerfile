# Image của job huỷ đơn trên PVI Connect. Dựng từ riêng thư mục này, không cần phần còn lại của repo:
#
#   docker build -t mgst-pvi-cancel:new pvi-cancel-orders
FROM oven/bun:1-alpine

# `tzdata` để `TZ` có tác dụng: giờ trong log phải khớp giờ đội vận hành đọc.
# tesseract cùng 3 gói python cho `solve-captcha.py`.
RUN apk add --no-cache tzdata tesseract-ocr tesseract-ocr-data-eng python3 py3-pillow py3-numpy py3-pip \
  && pip3 install --break-system-packages --no-cache-dir pytesseract
ENV TZ=Asia/Ho_Chi_Minh

WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY pvi-connect.ts cancel-orders.ts solve-captcha.py ./

ENTRYPOINT ["bun", "cancel-orders.ts"]
