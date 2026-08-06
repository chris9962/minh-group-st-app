"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { SkeletonTable, SkeletonText } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { SearchField } from "@/components/ui/SearchField";
import { CustomerFormDialog } from "@/components/customers/CustomerFormDialog";
import { ServiceFormDialog } from "@/components/services/ServiceFormDialog";
import { fetchCustomerDetail, fetchCustomers, type Customer } from "@/lib/api/customers";
import { useDebouncedValue } from "@/lib/hooks";
import styles from "./CreateServiceDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * P-30 · Ghi dịch vụ cho khách chưa có sẵn trong ngữ cảnh (khác nút "Ghi dịch
 * vụ" ở P-40/P-42, luôn có sẵn khách) — chọn khách trước rồi mới sang đúng
 * `ServiceFormDialog` đã dùng ở đó.
 *
 * Không tìm thấy khách thì tạo mới NGAY tại đây, tạo xong đi THẲNG vào bước
 * ghi dịch vụ, không chặn lại ở một bước xác nhận trung gian — giống hệt
 * `CreateBankAccountDialog`.
 */
export function CreateServiceDialog({ open, onClose }: Props) {
  const [pickedId, setPickedId] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  // Khách vừa tạo đã có sẵn đủ dữ liệu (Customer đầy đủ) — khỏi cần tải lại
  // qua fetchCustomerDetail như đường "chọn khách có sẵn" bên dưới.
  const [readyCustomer, setReadyCustomer] = useState<Customer | null>(null);
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search);

  const {
    data: list,
    isPending: listPending,
    isError: listError,
    refetch: refetchList,
    isFetching: listFetching,
  } = useQuery({
    queryKey: ["customers-picker", searchQuery],
    queryFn: () => fetchCustomers({ search: searchQuery, channelId: "", from: "", to: "", page: 0, sort: "name", dir: "asc" }),
    enabled: open && !pickedId && !readyCustomer,
    placeholderData: (previous) => previous,
  });

  const { data: detail, isPending: detailPending } = useQuery({
    queryKey: ["customer", pickedId],
    queryFn: () => fetchCustomerDetail(pickedId),
    enabled: !!pickedId,
  });

  const resolvedCustomer = readyCustomer ?? detail?.customer ?? null;

  if (resolvedCustomer) {
    return (
      <ServiceFormDialog
        open
        customerId={resolvedCustomer.id}
        customerName={resolvedCustomer.fullName}
        onClose={onClose}
      />
    );
  }

  const customers = list?.rows ?? [];

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title="Ghi dịch vụ — chọn khách hàng"
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

          {pickedId && detailPending && <SkeletonText lines={3} label="Đang tải hồ sơ khách hàng" />}

          {!pickedId && (
            <>
              {listPending && <SkeletonTable rows={4} columns={2} label="Đang tải danh sách khách hàng" />}
              {listError && (
                <ErrorState
                  what="danh sách khách hàng"
                  onRetry={refetchList}
                  retrying={listFetching}
                />
              )}
              {/* `!listError` bắt buộc: tải hỏng thì `customers` cũng rỗng, và khối này mời
                  người dùng "tạo khách hàng mới" cho một người có thể đã có hồ sơ — ra hồ sơ trùng. */}
              {!listPending && !listError && customers.length === 0 && (
                <div className={styles.empty}>
                  <p className="text-muted">
                    Không tìm thấy khách hàng nào khớp “{searchQuery}”.
                  </p>
                  <Button variant="secondary" onClick={() => setCreatingCustomer(true)}>
                    <Plus size={16} />
                    Tạo khách hàng
                  </Button>
                </div>
              )}
              {customers.length > 0 && (
                <ul className={styles.list}>
                  {customers.map((c) => (
                    <li key={c.id}>
                      <button type="button" className={styles.row} onClick={() => setPickedId(c.id)}>
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

      {creatingCustomer && (
        <CustomerFormDialog
          open
          onClose={() => setCreatingCustomer(false)}
          onCreated={(customer) => {
            setCreatingCustomer(false);
            setReadyCustomer(customer);
          }}
        />
      )}
    </>
  );
}
