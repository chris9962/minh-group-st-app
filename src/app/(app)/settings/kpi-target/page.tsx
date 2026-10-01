import { redirect } from "next/navigation";

/** P-83 đã gộp vào Chỉ tiêu tháng P-85 (chốt 2026-10-01). Giữ đường cũ cho link đã lưu. */
export default function KpiTargetPage() {
  redirect("/settings/quota");
}
