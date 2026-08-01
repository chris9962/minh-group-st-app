"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { SearchField } from "@/components/ui/SearchField";
import { InsuranceOrderFormDialog } from "@/components/insurance/InsuranceOrderFormDialog";
import { fetchCustomerDetail, fetchCustomers } from "@/lib/api/customers";
import { useDebouncedValue } from "@/lib/hooks";
import { useSession } from "@/store/session";
import styles from "./CreateInsuranceOrderDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * P-13 · Tạo đơn bảo hiểm tự nguyện — bấm từ danh sách đơn, không có sẵn
 * khách trong ngữ cảnh (khác luồng Tặng quà P-43, luôn mở từ hồ sơ khách).
 * Nên có thêm bước chọn khách ở đây rồi mới sang đúng `InsuranceOrderFormDialog`
 * đã dùng cho P-43, với `source="self"` để tự chọn gói.
 */
export function CreateInsuranceOrderDialog({ open, onClose }: Props) {
  const actor = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search);

  const { data: list, isPending: listPending, isError: listError } = useQuery({
    queryKey: ["customers-picker", searchQuery],
    queryFn: () => fetchCustomers({ search: searchQuery, channel: "", from: "", to: "" }),
    enabled: open && !customerId,
    placeholderData: (previous) => previous,
  });

  const { data: detail, isPending: detailPending } = useQuery({
    queryKey: ["customer", customerId],
    queryFn: () => fetchCustomerDetail(customerId, actor?.id ?? ""),
    enabled: !!customerId,
  });

  if (customerId && detail) {
    return (
      <InsuranceOrderFormDialog
        open
        customer={detail.customer}
        source="self"
        onClose={onClose}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ["insurance-list"] })}
      />
    );
  }

  const customers = list?.customers ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Tạo đơn bảo hiểm — chọn khách hàng"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Huỷ
        </Button>
      }
    >
      <div className={styles.body}>
        <SearchField
          block
          label="Tìm khách hàng"
          placeholder="Tìm tên hoặc số điện thoại…"
          value={search}
          onChange={setSearch}
        />

        {customerId && detailPending && (
          <p className="text-muted">Đang tải hồ sơ khách hàng…</p>
        )}

        {!customerId && (
          <>
            {listPending && <p className="text-muted">Đang tải danh sách khách hàng…</p>}
            {listError && <p className="text-muted">Không tải được danh sách khách hàng.</p>}
            {!listPending && customers.length === 0 && (
              <p className="text-muted">
                Không tìm thấy khách hàng nào khớp “{searchQuery}”. Chưa có hồ sơ thì{" "}
                <Link href="/customers">tạo khách hàng mới</Link> trước.
              </p>
            )}
            {customers.length > 0 && (
              <ul className={styles.list}>
                {customers.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={styles.row}
                      onClick={() => setCustomerId(c.id)}
                    >
                      <span className={styles.rowName}>{c.fullName}</span>
                      <span className={styles.rowPhone}>{c.primaryPhone}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
