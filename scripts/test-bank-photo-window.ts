import assert from "node:assert/strict";
import { canEditOpeningPhotos, errorPhotoDeadline } from "../src/lib/api/bankAccounts";
import { User } from "../src/lib/types";

const staff = User.parse({
  id: "test", username: "test", fullName: "Kiểm thử", role: "staff",
  departmentId: null, managedDepartmentIds: [], managedBankIds: [],
  manageScope: "none", title: "", permissions: [], active: true,
});
const marked = {
  status: "error" as const,
  finishedAt: "2026-09-01T02:00:00Z",
  lastErrorAt: "2026-09-09T08:30:00Z",
};

// Đúng 24 giờ, kể cả qua nửa đêm giờ Việt Nam.
assert.equal(errorPhotoDeadline(marked), "2026-09-10T08:30:00.000Z");
assert.equal(canEditOpeningPhotos(staff, marked, new Date("2026-09-10T08:29:59.999Z")), true);
assert.equal(canEditOpeningPhotos(staff, marked, new Date("2026-09-10T08:30:00Z")), false);
assert.equal(canEditOpeningPhotos(staff, marked, new Date("2026-09-09T18:00:00Z")), true);

// Gửi duyệt giữ nguyên hạn; duyệt xong đóng cửa sổ sửa lỗi.
assert.equal(errorPhotoDeadline({ ...marked, status: "fixed" }), errorPhotoDeadline(marked));
assert.equal(canEditOpeningPhotos(staff, { ...marked, status: "fixed" }, new Date("2026-09-10T08:30:00Z")), false);
assert.equal(canEditOpeningPhotos(staff, { ...marked, status: "done" }, new Date("2026-09-09T09:00:00Z")), false);

// Bị đánh lỗi lần nữa mới mở thêm hạn.
assert.equal(canEditOpeningPhotos(staff, { ...marked, lastErrorAt: "2026-09-10T08:00:00Z" }, new Date("2026-09-10T09:00:00Z")), true);

// Dữ liệu cũ/không hợp lệ không được tự mở hạn mới.
for (const lastErrorAt of [undefined, "", "sai ngày"])
  assert.equal(canEditOpeningPhotos(staff, { ...marked, lastErrorAt }, new Date("2026-09-09T09:00:00Z")), false);

// Luật ngày hoàn thành cũ và ngoại lệ trưởng phòng vẫn giữ.
const done = { status: "done" as const, finishedAt: "2026-09-09T16:59:00Z" };
assert.equal(canEditOpeningPhotos(staff, done, new Date("2026-09-09T16:59:59Z")), true);
assert.equal(canEditOpeningPhotos(staff, done, new Date("2026-09-09T17:00:00Z")), false);
assert.equal(canEditOpeningPhotos({ ...staff, role: "head" }, marked, new Date("2026-09-12T08:30:00Z")), true);
assert.equal(canEditOpeningPhotos(null, marked), false);
console.log("Đạt các ca hạn sửa ảnh: biên 24h, qua ngày, gửi duyệt, duyệt lại, đánh lỗi lại và dữ liệu cũ.");
