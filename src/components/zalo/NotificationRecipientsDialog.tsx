"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { SearchField } from "@/components/ui/SearchField";
import { SegmentedTabs, type TabOption } from "@/components/ui/SegmentedTabs";
import { TextField } from "@/components/ui/TextField";
import {
  fetchZaloGroupOptions,
  fetchZaloPeopleOptions,
  notificationPeople,
  notificationTakesGroups,
  notificationTakesPhones,
  saveZaloNotificationPgds,
  saveZaloNotificationRoutes,
  ZALO_NOTIFICATION_PHONES_MAX,
  ZALO_NOTIFICATION_TITLE,
  type ZaloNotificationRoute,
  type ZaloPersonOption,
} from "@/lib/api/zaloBot";
import { digitsOnly, formatPhone, isValidPhone, matchesSearch } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import { RecipientChip } from "./RecipientChip";
import styles from "./NotificationRecipientsDialog.module.scss";

type Props = {
  accountId: string;
  route: ZaloNotificationRoute;
  onClose: () => void;
};

type Tab = "groups" | "people" | "phones";

/**
 * Nơi nhận của một loại thông báo: nhóm Zalo, nhân viên, số điện thoại nhập tay.
 * Loại nào nhận gì do `notificationTakesGroups`, `notificationPeople`,
 * `notificationTakesPhones` quyết định; máy chủ kiểm lại khi lưu.
 *
 * Tìm ở trình duyệt được vì nhóm và nhân viên đang làm là danh sách đóng, không
 * lớn thêm theo ngày làm việc (AGENTS.md §5.1, điều 4).
 */
export function NotificationRecipientsDialog({ accountId, route, onClose }: Props) {
  const queryClient = useQueryClient();
  const kind = route.kind;
  const people = notificationPeople(kind);
  const takesGroups = notificationTakesGroups(kind);
  const takesPhones = notificationTakesPhones(kind);
  const peopleWord = people === "pgd" ? "Phó giám đốc" : "nhân viên";

  const [groupIds, setGroupIds] = useState(route.groups.map((g) => g.id));
  const [userIds, setUserIds] = useState(route.pgds.map((p) => p.id));
  const [phones, setPhones] = useState(route.phones.map((p) => p.phone));
  const [tab, setTab] = useState<Tab>(takesGroups ? "groups" : "people");
  const [search, setSearch] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const phoneErrorId = useId();

  const groupOptions = useQuery({
    queryKey: ["zalo-bot", "group-options", accountId],
    queryFn: fetchZaloGroupOptions,
    enabled: takesGroups,
  });
  const peopleOptions = useQuery({
    queryKey: ["zalo-bot", "people-options", kind],
    queryFn: () => fetchZaloPeopleOptions(kind),
    enabled: !!people,
  });

  const save = useMutation({
    mutationFn: () =>
      Promise.all([
        takesGroups ? saveZaloNotificationRoutes(kind, { groupIds }) : null,
        people ? saveZaloNotificationPgds(kind, { userIds, phones }) : null,
      ]),
    onSuccess: () => {
      toast.ok("Đã lưu nơi nhận.");
      void queryClient.invalidateQueries({ queryKey: ["zalo-bot", "notifications"] });
      onClose();
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được nơi nhận.")),
  });

  const groupName = new Map(
    [...route.groups, ...(groupOptions.data ?? [])].map((g) => [g.id, g.name]),
  );
  const personById = new Map<string, ZaloPersonOption>(
    [...route.pgds, ...(peopleOptions.data ?? [])].map((p) => [p.id, p]),
  );
  const phoneName = new Map(route.phones.map((p) => [p.phone, p.name]));
  const pickedCount = groupIds.length + userIds.length + phones.length;

  const toggleIn =
    (set: React.Dispatch<React.SetStateAction<string[]>>) => (id: string, checked: boolean) =>
      set((prev) => (checked ? [...prev, id] : prev.filter((p) => p !== id)));
  const toggleGroup = toggleIn(setGroupIds);
  const togglePerson = toggleIn(setUserIds);

  const tabs: TabOption[] = [];
  if (takesGroups) tabs.push({ value: "groups", label: "Nhóm", count: groupIds.length });
  if (people)
    tabs.push({ value: "people", label: people === "pgd" ? "Phó giám đốc" : "Nhân viên", count: userIds.length });
  if (takesPhones) tabs.push({ value: "phones", label: "Số điện thoại", count: phones.length });

  const changeTab = (value: string) => {
    setTab(value as Tab);
    setSearch("");
  };

  const addPhone = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidPhone(phoneInput)) return setPhoneError("Số điện thoại phải có 10 chữ số");
    if (phones.includes(phoneInput)) return setPhoneError("Số này đã có trong danh sách");
    if (phones.length >= ZALO_NOTIFICATION_PHONES_MAX)
      return setPhoneError(`Tối đa ${ZALO_NOTIFICATION_PHONES_MAX} số điện thoại`);
    setPhones((prev) => [...prev, phoneInput]);
    setPhoneInput("");
  };

  const shownGroups = (groupOptions.data ?? []).filter((g) => matchesSearch(g.name, search));
  const shownPeople = (peopleOptions.data ?? []).filter((p) =>
    matchesSearch(`${p.name} ${p.phone}`, search),
  );

  return (
    <Dialog
      open
      title={ZALO_NOTIFICATION_TITLE[kind]}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Thôi
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <section className={styles.picked} aria-label="Nơi nhận đã chọn">
          <p className={styles.pickedTitle}>
            Đã chọn <span className="so">{pickedCount}</span>
          </p>
          {pickedCount === 0 ? (
            <p className={styles.empty}>Chưa chọn nơi nhận.</p>
          ) : (
            <ul className={styles.chips}>
              {groupIds.map((id) => (
                <li key={`g:${id}`}>
                  <RecipientChip
                    type="group"
                    name={groupName.get(id) ?? id}
                    onRemove={() => toggleGroup(id, false)}
                  />
                </li>
              ))}
              {userIds.map((id) => {
                const p = personById.get(id);
                return (
                  <li key={`u:${id}`}>
                    <RecipientChip
                      type="person"
                      name={p?.name ?? ""}
                      phone={p?.phone}
                      onRemove={() => togglePerson(id, false)}
                    />
                  </li>
                );
              })}
              {phones.map((phone) => (
                <li key={`p:${phone}`}>
                  <RecipientChip
                    type="phone"
                    name={phoneName.get(phone) ?? ""}
                    phone={phone}
                    onRemove={() => setPhones((prev) => prev.filter((p) => p !== phone))}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {tabs.length > 1 && (
          <SegmentedTabs label="Loại nơi nhận" options={tabs} value={tab} onChange={changeTab} compact />
        )}

        {tab === "groups" && (
          <div className={styles.panel}>
            <SearchField label="Tìm nhóm" placeholder="Tên nhóm" value={search} onChange={setSearch} block />
            {groupOptions.isError ? (
              <ErrorState
                what="danh sách nhóm"
                onRetry={groupOptions.refetch}
                retrying={groupOptions.isFetching}
              />
            ) : groupOptions.isPending ? (
              <p className={styles.empty}>Đang tải danh sách nhóm…</p>
            ) : shownGroups.length === 0 ? (
              <p className={styles.empty}>{search ? "Không nhóm nào khớp." : "Chưa có nhóm nào."}</p>
            ) : (
              <ul className={styles.options}>
                {shownGroups.map((g) => (
                  <li key={g.id}>
                    <Checkbox
                      checked={groupIds.includes(g.id)}
                      onCheckedChange={(checked) => toggleGroup(g.id, checked)}
                      label={g.name}
                      block
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === "people" && people && (
          <div className={styles.panel}>
            <SearchField
              label={`Tìm ${peopleWord}`}
              placeholder="Họ tên hoặc số điện thoại"
              value={search}
              onChange={setSearch}
              block
            />
            {peopleOptions.isError ? (
              <ErrorState
                what={`danh sách ${peopleWord}`}
                onRetry={peopleOptions.refetch}
                retrying={peopleOptions.isFetching}
              />
            ) : peopleOptions.isPending ? (
              <p className={styles.empty}>Đang tải danh sách {peopleWord}…</p>
            ) : shownPeople.length === 0 ? (
              <p className={styles.empty}>{search ? "Không ai khớp." : `Chưa có ${peopleWord} nào.`}</p>
            ) : (
              <ul className={styles.options}>
                {shownPeople.map((p) => {
                  const hasPhone = isValidPhone(p.phone);
                  const picked = userIds.includes(p.id);
                  return (
                    <li key={p.id}>
                      <Checkbox
                        checked={picked}
                        onCheckedChange={(checked) => togglePerson(p.id, checked)}
                        label={`${p.name} - ${hasPhone ? formatPhone(p.phone) : "Chưa có số điện thoại"}`}
                        // Vẫn bỏ chọn được người đã chọn trước khi số trên hồ sơ bị xoá.
                        disabled={!hasPhone && !picked}
                        block
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {tab === "phones" && (
          <form className={styles.panel} onSubmit={addPhone} noValidate>
            <div className={styles.phoneRow}>
              <TextField
                label="Số điện thoại"
                placeholder="0901234567"
                inputMode="numeric"
                autoComplete="off"
                maxLength={10}
                value={phoneInput}
                onChange={(e) => {
                  setPhoneInput(digitsOnly(e.target.value));
                  setPhoneError("");
                }}
                // Lỗi đặt dưới cả hàng, không trong ô: lỗi trong ô đẩy ô cao lên và nút Thêm lệch hàng.
                aria-invalid={!!phoneError}
                aria-describedby={phoneError ? phoneErrorId : undefined}
                className={styles.phoneField}
              />
              <Button type="submit" variant="secondary">
                <Plus size={16} aria-hidden />
                Thêm
              </Button>
            </div>
            {phoneError && (
              <p id={phoneErrorId} className={styles.error} role="alert">
                {phoneError}
              </p>
            )}
            {phones.length === 0 ? (
              <p className={styles.empty}>Chưa nhập số nào.</p>
            ) : (
              <ul className={styles.options}>
                {[...phones].reverse().map((phone) => {
                  const name = phoneName.get(phone);
                  return (
                    <li key={phone} className={styles.phoneItem}>
                      <Phone size={16} aria-hidden className={styles.phoneIcon} />
                      <span className={styles.phoneText}>
                        <span className="so">{formatPhone(phone)}</span>
                        {name && <span className={styles.phoneName}>{name}</span>}
                      </span>
                      <Button
                        variant="ghost"
                        icon
                        tooltip="Bỏ số này"
                        aria-label={`Bỏ số ${formatPhone(phone)}`}
                        onClick={() => setPhones((prev) => prev.filter((p) => p !== phone))}
                      >
                        <Trash2 size={16} aria-hidden />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </form>
        )}
      </div>
    </Dialog>
  );
}
