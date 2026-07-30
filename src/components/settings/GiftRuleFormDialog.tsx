"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import { fetchBanks } from "@/lib/api/bankCatalog";
import { fetchChannels } from "@/lib/api/channelCatalog";
import {
  APP_COMPARATOR_LABEL,
  createGiftRule,
  GIFT_GROUP_LABEL,
  GIFT_MODE_LABEL,
  GiftRuleForm,
  MODES_FOR_GROUP,
  updateGiftRule,
  type GiftItem,
  type GiftRule,
  type InsurancePackage,
} from "@/lib/api/settings";
import styles from "./GiftRuleFormDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Có thì là sửa, không có thì là lập quy tắc mới. */
  rule?: GiftRule | null;
  giftItems: GiftItem[];
  packages: InsurancePackage[];
};

const emptyForm: GiftRuleForm = {
  group: "cash",
  mode: "accumulate",
  requiredBank: "",
  requiresCnkd: false,
  appCountComparator: "none",
  appCountValue: 0,
  channel: "",
  cashAmount: 0,
  giftItemIds: [],
  effectiveFrom: "",
  effectiveTo: "",
};

const toForm = (r: GiftRule): GiftRuleForm => ({
  group: r.group,
  mode: r.mode,
  requiredBank: r.requiredBank ?? "",
  requiresCnkd: r.requiresCnkd,
  appCountComparator: r.appCountComparator,
  appCountValue: r.appCountValue ?? 0,
  channel: r.channel ?? "",
  cashAmount: r.cashAmount ?? 0,
  giftItemIds: r.giftItemIds,
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo ?? "",
});

/** P-81 · Lập / sửa một dòng quy tắc quà. */
export function GiftRuleFormDialog({ open, onClose, rule, giftItems, packages }: Props) {
  const queryClient = useQueryClient();
  const editing = Boolean(rule);

  const { data: banks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });
  const activeBanks = banks.filter((b) => b.active);
  const { data: channels = [] } = useQuery({ queryKey: ["channels"], queryFn: fetchChannels });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<GiftRuleForm>({
    resolver: zodResolver(GiftRuleForm),
    defaultValues: rule ? toForm(rule) : emptyForm,
  });

  const group = watch("group");
  const giftItemIds = watch("giftItemIds");
  const appCountComparator = watch("appCountComparator");

  const save = useMutation({
    mutationFn: (form: GiftRuleForm) =>
      rule ? updateGiftRule(rule.id, form) : createGiftRule(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gift-rules"] });
      onClose();
    },
  });

  const toggleGiftItem = (id: string) =>
    setValue(
      "giftItemIds",
      giftItemIds.includes(id) ? giftItemIds.filter((x) => x !== id) : [...giftItemIds, id],
      { shouldDirty: true },
    );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Sửa quy tắc quà" : "Thêm quy tắc quà"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="gift-rule-form" disabled={isSubmitting || save.isPending}>
            {editing ? "Lưu" : "Tạo quy tắc"}
          </Button>
        </>
      }
    >
      <form
        id="gift-rule-form"
        className={styles.form}
        onSubmit={handleSubmit((form) => save.mutate(form))}
        noValidate
      >
        {save.isError && <Alert tone="error">Không lưu được quy tắc này.</Alert>}

        <div className={styles.pair}>
          <Select
            block
            label="Nhóm"
            value={group}
            onChange={(v) => {
              const nextGroup = v as GiftRuleForm["group"];
              setValue("group", nextGroup, { shouldDirty: true });
              setValue("mode", MODES_FOR_GROUP[nextGroup][0], { shouldDirty: true });
            }}
            options={Object.entries(GIFT_GROUP_LABEL).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Select
            block
            label="Cách chạy"
            value={watch("mode")}
            onChange={(v) =>
              setValue("mode", v as GiftRuleForm["mode"], { shouldDirty: true })
            }
            options={MODES_FOR_GROUP[group].map((m) => ({ value: m, label: GIFT_MODE_LABEL[m] }))}
          />
        </div>

        <div className={styles.pair}>
          <Select
            block
            label="Ngân hàng bắt buộc"
            value={watch("requiredBank")}
            onChange={(v) => setValue("requiredBank", v, { shouldDirty: true })}
            options={[
              { value: "", label: "— Không yêu cầu —" },
              ...activeBanks.map((b) => ({ value: b.code, label: b.code })),
            ]}
          />
          <Select
            block
            label="Kênh"
            value={watch("channel")}
            onChange={(v) => setValue("channel", v, { shouldDirty: true })}
            options={[
              { value: "", label: "— Không yêu cầu —" },
              ...channels.map((c) => ({ value: c.name, label: c.name })),
            ]}
          />
        </div>

        <Checkbox
          label="Yêu cầu mở CNKD/HKD"
          checked={watch("requiresCnkd")}
          onCheckedChange={(v) => setValue("requiresCnkd", v, { shouldDirty: true })}
        />

        <div className={styles.pair}>
          <Select
            block
            label="Tổng app"
            value={appCountComparator}
            onChange={(v) =>
              setValue("appCountComparator", v as GiftRuleForm["appCountComparator"], {
                shouldDirty: true,
              })
            }
            options={Object.entries(APP_COMPARATOR_LABEL).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          {appCountComparator !== "none" && (
            <TextField
              label="Số app"
              type="number"
              inputMode="numeric"
              error={errors.appCountValue?.message}
              {...register("appCountValue", { valueAsNumber: true })}
            />
          )}
        </div>

        {group === "cash" ? (
          <TextField
            label="Số tiền (đồng)"
            type="number"
            inputMode="numeric"
            error={errors.cashAmount?.message}
            {...register("cashAmount", { valueAsNumber: true })}
          />
        ) : (
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Món bỏ vào rổ</legend>
            <div className={styles.checks}>
              {giftItems.map((g) => (
                <label key={g.id} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={giftItemIds.includes(g.id)}
                    onChange={() => toggleGiftItem(g.id)}
                  />
                  {g.name}
                </label>
              ))}
              {packages.map((p) => (
                <label key={p.id} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={giftItemIds.includes(p.id)}
                    onChange={() => toggleGiftItem(p.id)}
                  />
                  {p.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className={styles.pair}>
          <TextField
            label="Hiệu lực từ"
            type="date"
            error={errors.effectiveFrom?.message}
            {...register("effectiveFrom")}
          />
          <TextField
            label="Hiệu lực đến"
            type="date"
            hint="Bỏ trống = chưa có ngày kết thúc"
            {...register("effectiveTo")}
          />
        </div>
      </form>
    </Dialog>
  );
}
