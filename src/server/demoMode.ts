/**
 * Bản demo chạy trên máy riêng, database riêng, không có worker nào (chốt
 * 2026-09-29). Bật bằng `DEMO_MODE=1`: mọi ảnh tải lên nằm dưới tiền tố `demo/`
 * của bucket, và đơn bảo hiểm tạo xong là Hoàn thành, trỏ vào 2 ảnh GCN mẫu
 * tải sẵn lên bucket (`DEMO_GCN_ELECTRIC_KEY`, `DEMO_GCN_MOTORBIKE_KEY`, file
 * gốc ở `deploy/demo/`).
 */
export const demoMode = (): boolean => process.env.DEMO_MODE === "1";
