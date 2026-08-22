"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CustomerFormDialog } from "@/components/customers/CustomerFormDialog";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { SearchField } from "@/components/ui/SearchField";
import { SkeletonTable, SkeletonText } from "@/components/ui/Skeleton";
import { fetchCustomerDetail, fetchCustomers, type Customer } from "@/lib/api/customers";
import { useDebouncedValue } from "@/lib/hooks";
import styles from "./CustomerPickerDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Tiêu đề của bước chọn khách. */
  title: string;
  /**
   * Bước tiếp theo, dựng khi đã có khách — hộp thoại mở tài khoản, tạo đơn, ghi
   * dịch vụ. `back` đưa người dùng về bước chọn khách; hộp thoại bước sau gắn
   * nó vào nút "Chọn khách khác" của mình.
   */
  children: (customer: Customer, back: () => void) => React.ReactNode;
};

/**
 * Bước CHỌN KHÁCH đứng trước ba luồng tạo bản ghi: mở tài khoản ngân hàng
 * (P-21), tạo đơn bảo hiểm, ghi dịch vụ (P-30).
 *
 * Ba luồng đó vốn là ba bản chép nguyên của cùng một đoạn ~120 dòng, và đã bắt
 * đầu lệch nhau: một comment mô tả sai luồng bên cạnh, một class CSS chết. Gom
 * về đây để sửa một chỗ là cả ba nhận (AGENTS.md §2).
 *
 * Khác ba nút "Mở ngân hàng" / "Ghi dịch vụ" ở P-40 và P-42 — chúng luôn có sẵn
 * khách nên gọi thẳng hộp thoại bước sau, không qua đây.
 *
 * Không tìm thấy khách thì tạo mới NGAY tại đây, tạo xong đi THẲNG vào bước
 * tiếp theo, không chặn lại ở một bước xác nhận trung gian.
 */
export function CustomerPickerDialog({ open, onClose, title, children }: Props) {
  const [pickedId, setPickedId] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  // Khách vừa tạo đã có sẵn đủ dữ liệu — khỏi tải lại qua `fetchCustomerDetail`
  // như đường "chọn khách có sẵn" bên dưới.
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
    queryFn: () =>
      fetchCustomers({
        search: searchQuery,
        channelId: "",
        staffId: "",
        from: "",
        to: "",
        page: 0,
        sort: "name",
        dir: "asc",
      }),
    enabled: open && !pickedId && !readyCustomer,
    placeholderData: (previous) => previous,
  });

  const { data: detail, isPending: detailPending } = useQuery({
    queryKey: ["customer", pickedId],
    queryFn: () => fetchCustomerDetail(pickedId),
    enabled: !!pickedId,
  });

  /**
   * Quay về bước chọn khách. Phải xoá CẢ HAI nguồn — chọn khách có sẵn ghi vào
   * `pickedId`, còn tạo khách mới ghi vào `readyCustomer`, và chỉ xoá một cái
   * thì `resolvedCustomer` vẫn có giá trị nên hộp thoại bước sau không đóng.
   *
   * Ô tìm giữ nguyên: người dùng bấm nút này vì chọn nhầm người trong CÙNG một
   * danh sách, xoá đi là bắt họ gõ lại từ đầu.
   */
  const back = () => {
    setPickedId("");
    setReadyCustomer(null);
  };

  const resolvedCustomer = readyCustomer ?? detail?.customer ?? null;
  if (resolvedCustomer) return <>{children(resolvedCustomer, back)}</>;

  const customers = list?.rows ?? [];

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={title}
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

          {pickedId && detailPending && (
            <SkeletonText lines={3} label="Đang tải hồ sơ khách hàng" />
          )}

          {!pickedId && (
            <>
              {listPending && (
                <SkeletonTable rows={4} columns={2} label="Đang tải danh sách khách hàng" />
              )}
              {listError && (
                <ErrorState
                  what="danh sách khách hàng"
                  onRetry={refetchList}
                  retrying={listFetching}
                />
              )}
              {/* `!listError` bắt buộc: tải hỏng thì `customers` cũng rỗng, và khối
                  này mời người dùng tạo hồ sơ cho một người có thể đã có — ra hồ sơ trùng. */}
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
                        onClick={() => setPickedId(c.id)}
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
