"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use } from "react";
import { ChevronLeft, UserCog, Users } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import { fetchDepartmentDetail } from "@/lib/api/org";
import { fetchStaff, type StaffAccount } from "@/lib/api/staff";
import { ROLE_LABEL, type RoleKey } from "@/lib/types";
import styles from "./page.module.css";

/** Trưởng/Phó phòng sắp lên đầu bảng nhân viên — số càng cao càng lên trước. */
const ROLE_RANK: Record<RoleKey, number> = {
  head: 2,
  "deputy-head": 1,
  staff: 0,
  "deputy-director": 0,
  director: 0,
};

const EMPLOYEE_COLUMNS: RankColumn<StaffAccount>[] = [
  {
    key: "fullName",
    label: "Tên",
    render: (s) => (
      <Link href={`/people/${s.id}`} className={styles.nameLink}>
        {s.fullName}
      </Link>
    ),
  },
  {
    key: "role",
    label: "Chức vụ",
    sortBy: (s) => ROLE_RANK[s.role],
    render: (s) => ROLE_LABEL[s.role],
  },
  {
    key: "active",
    label: "Trạng thái",
    render: (s) => (
      <StatusTag ok={s.active}>{s.active ? "Đang hoạt động" : "Đã khoá"}</StatusTag>
    ),
  },
];

/** Chi tiết một phòng ban — mở rộng P-91: bấm tên phòng ở bảng đi tới đây. */
export default function DepartmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const { data, isPending, isError } = useQuery({
    queryKey: ["org-department", id],
    queryFn: () => fetchDepartmentDetail(id),
  });

  const { data: staffData } = useQuery({
    queryKey: ["staff-by-department", id],
    queryFn: () =>
      fetchStaff({
        departmentId: id,
        status: "all",
        roles: [],
        search: "",
        scope: "company",
      }),
    enabled: Boolean(data),
  });

  const employees = staffData?.staff ?? [];

  return (
    <>
      <TopBar title={data?.department.name ?? "Phòng ban"} />

      <main className={styles.body}>
        <Link href="/departments" className={styles.back}>
          <ChevronLeft size={15} aria-hidden />
          Phòng ban
        </Link>

        {isPending && <p className="text-muted">Đang tải phòng ban…</p>}
        {isError && <p className="text-muted">Không tìm thấy phòng ban này.</p>}

        {data && (
          <>
            <SectionCard title="Người quản lý" icon={<UserCog size={17} />}>
              <ul className={styles.managers}>
                {data.managers.map((m) => (
                  <li key={m.id}>
                    <Link href={`/people/${m.id}`} className={styles.nameLink}>
                      {m.fullName}
                    </Link>
                    <span className={styles.managerTitle}>{m.title}</span>
                  </li>
                ))}
              </ul>
              {data.managedByDefault && (
                <p className={styles.footnote}>
                  Phòng này chưa có Phó Giám Đốc phụ trách — Giám đốc quản trực tiếp.
                </p>
              )}
            </SectionCard>

            <SectionCard
              title="Nhân viên"
              icon={<Users size={17} />}
              meta={`${employees.length} người`}
            >
              {employees.length === 0 ? (
                <p className="text-muted">Phòng này chưa có nhân viên nào.</p>
              ) : (
                <>
                  <RankTable
                    rows={employees}
                    columns={EMPLOYEE_COLUMNS}
                    rowKey={(s) => s.id}
                    defaultSort="role"
                    pageSize={10}
                    caption="Nhân viên của phòng, Trưởng và Phó phòng nằm đầu bảng"
                  />
                  <p className={styles.footnote}>
                    Gồm cả người <strong>đã khoá</strong> — họ vẫn thuộc phòng này cho
                    tới khi chuyển sang phòng khác.
                  </p>
                </>
              )}
            </SectionCard>
          </>
        )}
      </main>
    </>
  );
}
