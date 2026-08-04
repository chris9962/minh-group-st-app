"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { SkeletonTable, SkeletonText } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { SearchField } from "@/components/ui/SearchField";
import { CustomerFormDialog } from "@/components/customers/CustomerFormDialog";
import { InsuranceOrderFormDialog } from "@/components/insurance/InsuranceOrderFormDialog";
import { fetchCustomerDetail, fetchCustomers, type Customer } from "@/lib/api/customers";
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
 *
 * Không tìm thấy khách thì tạo mới NGAY tại đây, tạo xong đi THẲNG vào bước
 * tạo đơn, không chặn lại ở một bước xác nhận trung gian — giống hệt
 * `CreateServiceDialog`/`CreateBankAccountDialog`.
 */
export function CreateInsuranceOrderDialog({ open, onClose }: Props) {
  const actor = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState("");
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
    queryFn: () => fetchCustomers({ search: searchQuery, channel: "", from: "", to: "" }),
    enabled: open && !customerId && !readyCustomer,
    placeholderData: (previous) => previous,
  });

  const { data: detail, isPending: detailPending } = useQuery({
    queryKey: ["customer", customerId],
    queryFn: () => fetchCustomerDetail(customerId, actor?.id ?? ""),
    enabled: !!customerId,
  });

  const resolvedCustomer = readyCustomer ?? detail?.customer ?? null;

  if (resolvedCustomer) {
    return (
      <InsuranceOrderFormDialog
        open
        customer={resolvedCustomer}
        source="self"
        onClose={onClose}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ["insurance-list"] })}
      />
    );
  }

  const customers = list?.customers ?? [];

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title="Chọn khách hàng"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Huỷ
            </Button>
            {/* Luôn hiện, không chỉ lúc tìm không ra — khách mới toanh thì
                nhân viên bấm thẳng, khỏi phải gõ tìm vu vơ trước. */}
            <Button onClick={() => setCreatingCustomer(true)}>
              <Plus size={16} aria-hidden />
              Tạo KH mới
            </Button>
          </>
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
            <SkeletonText lines={3} label="Đang tải hồ sơ khách hàng" />
          )}

          {!customerId && (
            <>
              {listPending && <SkeletonTable rows={4} columns={2} label="Đang tải danh sách khách hàng" />}
              {listError && (
                <ErrorState
                  what="danh sách khách hàng"
                  onRetry={refetchList}
                  retrying={listFetching}
                />
              )}
              {/* Nút tạo giờ nằm cố định ở footer — chỗ này chỉ còn lời nhắn. */}
              {/* `!listError` bắt buộc: tải hỏng thì `customers` cũng rỗng, và khối này mời
                  người dùng "tạo khách hàng mới" cho một người có thể đã có hồ sơ — ra hồ sơ trùng. */}
              {!listPending && !listError && customers.length === 0 && (
                <p className="text-muted">
                  Không tìm thấy khách hàng nào khớp “{searchQuery}”. Bấm{" "}
                  <strong>Tạo KH mới</strong> để lập hồ sơ.
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
