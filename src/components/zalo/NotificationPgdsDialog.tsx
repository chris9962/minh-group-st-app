"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { SearchField } from "@/components/ui/SearchField";
import {
  fetchZaloPeopleOptions,
  notificationPeople,
  notificationTakesPhones,
  saveZaloNotificationPgds,
  ZALO_NOTIFICATION_LABEL,
  type ZaloNotificationKind,
  type ZaloNotificationPhone,
} from "@/lib/api/zaloBot";
import { digitsOnly, formatPhone, isValidPhone, matchesSearch } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./NotificationGroupsDialog.module.css";

type Props = {
  kind: ZaloNotificationKind;
  initialUserIds: string[];
  initialPhones: ZaloNotificationPhone[];
  onClose: () => void;
};

const phoneLabel = (p: ZaloNotificationPhone) =>
  p.name ? `${p.name} - ${formatPhone(p.phone)}` : formatPhone(p.phone);

/**
 * Chọn người nhận riêng của một loại thông báo: mỗi người được chọn nhận một tin
 * riêng tới SĐT trên hồ sơ. Báo cáo ngày chỉ chọn Phó giám đốc đang làm, loại
 * khác chọn mọi người đang làm, và nhận thêm số nhập tay: gõ đủ 10 số vào ô tìm
 * thì số đó hiện thành một dòng để tick. Máy chủ kiểm lại khi lưu.
 *
 * Tìm ở trình duyệt được vì đây là hộp chọn trên danh sách đóng: người đang làm,
 * không lớn thêm theo ngày làm việc (AGENTS.md §5.1, điều 4).
 */
export function NotificationPgdsDialog({ kind, initialUserIds, initialPhones, onClose }: Props) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<string[]>(initialUserIds);
  // Số đã bỏ tick vẫn nằm trong danh sách tới khi đóng dialog, để tick lại được.
  const [phoneOptions, setPhoneOptions] = useState<ZaloNotificationPhone[]>(initialPhones);
  const [pickedPhones, setPickedPhones] = useState<string[]>(initialPhones.map((p) => p.phone));
  const [search, setSearch] = useState("");
  const who = notificationPeople(kind) === "pgd" ? "Phó giám đốc" : "người nhận";
  const takesPhones = notificationTakesPhones(kind);

  const options = useQuery({
    queryKey: ["zalo-bot", "people-options", kind],
    queryFn: () => fetchZaloPeopleOptions(kind),
  });

  const save = useMutation({
    mutationFn: () => saveZaloNotificationPgds(kind, { userIds: picked, phones: pickedPhones }),
    onSuccess: () => {
      toast.ok(`Đã lưu ${who}.`);
      void queryClient.invalidateQueries({ queryKey: ["zalo-bot", "notifications"] });
      onClose();
    },
    onError: (e) => toast.fail(errorMessage(e, `Không lưu được danh sách ${who}.`)),
  });

  const shown = (options.data ?? []).filter((p) => matchesSearch(`${p.name} ${p.phone}`, search));
  const shownPhones = phoneOptions.filter((p) => matchesSearch(`${p.name} ${p.phone}`, search));

  const typedPhone = /^[\d\s.]+$/.test(search.trim()) ? digitsOnly(search) : "";
  const newPhone =
    takesPhones &&
    options.isSuccess &&
    isValidPhone(typedPhone) &&
    !phoneOptions.some((p) => p.phone === typedPhone) &&
    !options.data.some((p) => digitsOnly(p.phone) === typedPhone)
      ? typedPhone
      : "";

  const toggle = (id: string, checked: boolean) =>
    setPicked((prev) => (checked ? [...prev, id] : prev.filter((p) => p !== id)));

  const togglePhone = (phone: string, checked: boolean) =>
    setPickedPhones((prev) => (checked ? [...prev, phone] : prev.filter((p) => p !== phone)));

  const addPhone = (phone: string) => {
    setPhoneOptions((prev) => [...prev, { phone, name: "" }]);
    togglePhone(phone, true);
  };

  const nothingShown = !newPhone && shownPhones.length === 0 && shown.length === 0;

  return (
    <Dialog
      open
      title={ZALO_NOTIFICATION_LABEL[kind]}
      onClose={onClose}
      footerStart={
        <span className={styles.count}>Đã chọn {picked.length + pickedPhones.length} người</span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Thôi
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || options.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <SearchField
          label={`Tìm ${who}`}
          placeholder="Họ tên hoặc số điện thoại"
          value={search}
          onChange={setSearch}
          block
        />
        {options.isError ? (
          <ErrorState what={`danh sách ${who}`} onRetry={options.refetch} retrying={options.isFetching} />
        ) : options.isPending ? (
          <p className="text-muted">Đang tải danh sách {who}…</p>
        ) : nothingShown ? (
          <p className="text-muted">{search ? "Không ai khớp." : `Chưa có ${who} nào.`}</p>
        ) : (
          <ul className={styles.list}>
            {newPhone && (
              <li>
                <Checkbox
                  checked={false}
                  onCheckedChange={(checked) => checked && addPhone(newPhone)}
                  label={formatPhone(newPhone)}
                  block
                />
              </li>
            )}
            {shownPhones.map((p) => (
              <li key={p.phone}>
                <Checkbox
                  checked={pickedPhones.includes(p.phone)}
                  onCheckedChange={(checked) => togglePhone(p.phone, checked)}
                  label={phoneLabel(p)}
                  block
                />
              </li>
            ))}
            {shown.map((p) => {
              const hasPhone = isValidPhone(p.phone);
              return (
                <li key={p.id}>
                  <Checkbox
                    checked={picked.includes(p.id)}
                    onCheckedChange={(checked) => toggle(p.id, checked)}
                    label={`${p.name} - ${hasPhone ? formatPhone(p.phone) : "Chưa có số điện thoại"}`}
                    // Vẫn bỏ chọn được người đã chọn trước khi số trên hồ sơ bị xoá.
                    disabled={!hasPhone && !picked.includes(p.id)}
                    block
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
