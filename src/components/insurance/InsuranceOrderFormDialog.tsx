"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { UserCheck } from "lucide-react";
import {
  BankAccountPhotos,
  uploadPendingPhotos,
  type PhotoItem,
} from "@/components/banking/BankAccountPhotos";
import { DepartmentPicker } from "@/components/layout/DepartmentPicker";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { DateField } from "@/components/ui/DateField";
import { TextField } from "@/components/ui/TextField";
import { AddressField } from "@/components/ui/AddressField";
import { useAddressSuggestions } from "@/lib/useAddressSuggestions";
import type { Customer } from "@/lib/api/customers";
import { createInsuranceOrders, fetchStartDateConfirm } from "@/lib/api/insurance";
import {
  INTAKE_PHOTO_LABEL,
  latestStartDate,
  yearsLater,
  InsuranceOrderForm,
  type InsuranceOrderLegForm,
  type InsuranceOrderSource,
} from "@/lib/api/insuranceOrders";
import { isRealIsoDate } from "@/lib/types";
import { PRODUCT_LABEL } from "@/lib/types";
import { fetchInsurancePackages, type InsurancePackage } from "@/lib/api/settings";
import { businessDay, formatDate, formatVnd } from "@/lib/format";
import { invalidateKpi } from "@/lib/invalidateKpi";
import {
  SUM_INSURED_OPTIONS,
  VEHICLE_TYPE_DEFAULT,
  VEHICLE_TYPES,
  sumInsuredForFee,
} from "@/lib/pvi";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./InsuranceOrderFormDialog.module.scss";
import { digitsOnly, numberValue, numericField } from "@/lib/numberField";
import { reportInvalid } from "@/lib/formErrors";
import { spellingPartsForName } from "@/lib/vietnameseNameSpellcheck";

type Props = {
  open: boolean;
  onClose: () => void;
  customer: Customer;
  source: InsuranceOrderSource;
  /** Cố định gói — dùng khi mở từ luồng Tặng quà (P-43). */
  prefill?: { packageName: string };
  onCreated?: (orders: Awaited<ReturnType<typeof createInsuranceOrders>>) => void;
  /**
   * Có khi hộp thoại này là bước 2 của `CustomerPickerDialog`. Không có khi mở
   * thẳng từ hồ sơ khách (P-42) hoặc luồng Tặng quà — ở đó khách đã cố định,
   * không có bước nào để quay về.
   */
  onBack?: () => void;
};

/**
 * Dựng form theo đúng danh sách leg đã khai ở gói (chốt 04/08) — MỘT LEG = MỘT
 * ĐƠN. Không suy gì từ tên gói.
 *
 * Người thụ hưởng để trống: có thể là người khác hẳn khách hàng (spec §5.4),
 * mặc định sẵn tên khách thì hay gặp ca gõ nhầm rồi phải xoá lại.
 *
 * Ngày mặc định theo `chainsToPrevious` (chốt 2026-09-03, thu hẹp 2026-09-06):
 * CHỈ đơn tai nạn điện nối tiếp nhau, vì hãng chỉ phát hành hợp đồng 1 năm nên
 * gói 2 năm là hai đơn liền mạch cho cùng một người. Đơn xe máy KHÔNG nối
 * tiếp: gói nhiều năm một xe là MỘT đơn dài, còn gói hai xe là hai đơn cho hai
 * xe khác nhau, cùng bắt đầu hôm nay. Gói ghép hai sản phẩm khác nhau cũng
 * cùng bắt đầu hôm nay.
 *
 * `blankStart` bỏ mặc định ngày bắt đầu (chốt 2026-09-19) cho người huỷ nhiều
 * đơn trong tháng: 260 trên 623 lượt huỷ tháng 9/2026 là để nguyên ngày mặc
 * định trong khi khách còn bảo hiểm cũ. Ô trống thì phải nhập, không bấm qua
 * được. Đơn nối tiếp vẫn tính từ đơn trước, trống theo nếu đơn trước trống.
 */
function defaultLegsFor(pkg: InsurancePackage | null, blankStart: boolean): InsuranceOrderLegForm[] {
  if (!pkg) return [];
  // `toISOString()` cắt theo UTC, mà máy chủ chạy UTC: đơn lập lúc 0-7h sáng
  // giờ Việt Nam mặc định lùi về HÔM QUA (xem lib/format.ts).
  const today = businessDay();
  const legs: InsuranceOrderLegForm[] = [];
  pkg.legs.forEach((leg, i) => {
    const startDate = chainsToPrevious(pkg, i) ? legs[i - 1].endDate : blankStart ? "" : today;
    const values: InsuranceOrderLegForm = {
      product: leg.product,
      packageName: pkg.name,
      // Ngày TẠO đơn, mặc định hôm nay. Khác `startDate` (ngày hiệu lực).
      orderDate: today,
      /** Phí khai riêng cho leg này — trọn thời hạn, không phải chia đều giá gói. */
      fee: leg.fee,
      startDate,
      // `yearsLater("")` ném lỗi: `new Date("")` là Invalid Date.
      endDate: startDate ? yearsLater(startDate, leg.years) : "",
      beneficiaryName: "",
      beneficiaryDob: "",
      beneficiaryAddress: "",
      householdSize: 0,
      // Đơn xe máy không có ô này nên để 0; tai nạn điện chọn sẵn mức đi kèm phí.
      sumInsured: leg.product === "electric-accident" ? sumInsuredForFee(leg.fee) : 0,
      licensePlate: "",
      vehicleType: VEHICLE_TYPE_DEFAULT,
      chassisNumber: "",
      engineNumber: "",
      // Điền lúc gửi, sau khi ảnh lên kho — xem `save` bên dưới.
      intakePhotoUrl: "",
      intakePhotoBackUrl: "",
    };
    legs.push(values);
  });
  return legs;
}

/** Đơn thứ `i` nối tiếp đơn liền trước: chỉ khi CẢ HAI là tai nạn điện. */
const chainsToPrevious = (pkg: InsurancePackage | null, i: number): boolean =>
  i > 0 &&
  !!pkg &&
  pkg.legs[i - 1]?.product === "electric-accident" &&
  pkg.legs[i]?.product === "electric-accident";

/** Nhãn từng form. Nhiều đơn thì đánh số để KD biết đang điền đơn nào. */
const legLabel = (pkg: InsurancePackage | null, i: number): string => {
  const leg = pkg?.legs[i];
  if (!leg) return "";
  const label = `${PRODUCT_LABEL[leg.product]} · ${leg.years} năm`;
  return pkg.legs.length > 1 ? `Đơn ${i + 1}/${pkg.legs.length} · ${label}` : label;
};

/** Mỗi lần màn kiểm lại mở, nút xác nhận chờ đủ 5 giây rồi mới cho tạo đơn. */
function ConfirmCreateButton({
  pending,
  onConfirm,
}: {
  pending: boolean;
  onConfirm: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(5);
  const submitted = useRef(false);

  useEffect(() => {
    if (secondsLeft === 0) return;
    const timeout = window.setTimeout(() => setSecondsLeft((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timeout);
  }, [secondsLeft]);

  const confirm = () => {
    if (secondsLeft > 0 || pending || submitted.current) return;
    submitted.current = true;
    onConfirm();
  };

  return (
    <Button onClick={confirm} disabled={pending || secondsLeft > 0}>
      {pending
        ? "Đang tạo…"
        : secondsLeft > 0
          ? `Xác nhận, tạo đơn (${secondsLeft}s)`
          : "Xác nhận, tạo đơn"}
    </Button>
  );
}

/**
 * Tạo đơn bảo hiểm — người thụ hưởng có thể khác khách hàng (spec §5.4).
 * Dùng chung cho luồng Tặng quà (`source='gift'`, gói cố định) và mua tự
 * nguyện (`source='self'`, tự chọn gói).
 *
 * Lối vào của `source='self'` từng bị gỡ 2026-08-25 và mở lại 2026-08-28 —
 * nay là nút "Tạo đơn bảo hiểm" ở header màn P-13, qua `CreateInsuranceOrderDialog`.
 *
 * Số form = số leg khai ở gói (chốt 04/08). Mỗi form một bộ ô đầy đủ vì người
 * thụ hưởng của từng đơn có thể khác nhau. Nút "Lấy thông tin khách" ở từng
 * form là đủ — không cần cờ dùng chung người thụ hưởng.
 */
export function InsuranceOrderFormDialog({
  open,
  onClose,
  customer,
  source,
  prefill,
  onCreated,
  onBack,
}: Props) {
  const queryClient = useQueryClient();
  const [packageName, setPackageName] = useState(prefill?.packageName ?? "");
  // Luôn nạp danh mục gói (kể cả luồng Tặng quà gói cố định) — cần phí gói
  // để điền `fee` của từng đơn, ô này không hiện trên form.
  const { data: packages = [] } = useQuery({
    queryKey: ["insurance-packages"],
    queryFn: fetchInsurancePackages,
  });

  const selectedPackage = packages.find((p) => p.name === packageName) ?? null;

  /**
   * Người huỷ từ 4 đơn trong tháng phải xác nhận với khách trước khi nhập ngày
   * bắt đầu (chốt 2026-09-19). Máy chủ đếm, form chỉ hỏi "có phải tôi không".
   *
   * Hỏi lại mỗi lần mở form và KHÔNG dựng `legs` trước khi có câu trả lời:
   * ngày mặc định quyết định lúc dựng, dựng sớm với câu trả lời cũ là người
   * vừa chạm ngưỡng vẫn thấy ngày điền sẵn. `retry: false` để mất mạng không
   * giữ form trống mấy giây; hỏng thì coi như không bắt.
   */
  const startDateConfirm = useQuery({
    queryKey: ["insurance-start-date-confirm"],
    queryFn: fetchStartDateConfirm,
    retry: false,
  });
  const confirmRequired = startDateConfirm.data ?? false;
  const confirmKnown = startDateConfirm.isFetchedAfterMount;

  const {
    register,
    control,
    setValue,
    getValues,
    watch,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InsuranceOrderForm>({
    // Focus ô sai do `reportInvalid` lo — xem `lib/formErrors.ts`.
    shouldFocusError: false,
    resolver: zodResolver(InsuranceOrderForm),
    defaultValues: {
      customerId: customer.id,
      source,
      // Dựng ở `selectPackage` hoặc effect prefill bên dưới, sau khi biết
      // `confirmRequired`.
      legs: [],
      // Hồ sơ khách đã thuộc về một phòng, nên đơn mở cho khách đó mặc định
      // ghi vào chính phòng ấy (chốt 2026-09-03). Người không thuộc phòng nào
      // vẫn đổi được; máy chủ chốt lại cùng một luật.
      departmentId: customer.createdByDepartmentId ?? "",
    },
  });
  const legsField = useFieldArray({ control, name: "legs" });

  /**
   * Ảnh hồ sơ của TỪNG đơn, theo chỉ số leg (chốt 2026-09-07). Nằm ngoài
   * react-hook-form: ảnh là `File` trong máy người dùng tới lúc bấm Tạo đơn,
   * còn form chỉ giữ URL sau khi tải lên. Đổi gói là bỏ hết — số đơn đổi theo.
   */
  const [photos, setPhotos] = useState<PhotoItem[][]>([]);
  const photosOf = (i: number): PhotoItem[] => photos[i] ?? [];
  const setPhotosOf = (i: number, next: PhotoItem[]) =>
    setPhotos((prev) => {
      const copy = [...prev];
      copy[i] = next;
      return copy;
    });
  /** Ảnh đầu của mỗi đơn bắt buộc; ảnh CCCD thứ hai tùy tình trạng hồ sơ. */
  const missingPhoto = legsField.fields.some((_, i) => photosOf(i).length === 0);

  /**
   * Bấm "Tạo đơn" mở màn kiểm lại chứ chưa gửi (chốt 2026-09-13): đơn PVI
   * không sửa lại được sau khi gửi, một ô gõ nhầm biến thành đơn sai phải huỷ
   * làm lại. `reviewValues` giữ đúng bản đã qua validate; đóng màn kiểm lại
   * không đụng gì tới form phía dưới, người dùng sửa tiếp trên form cũ.
   */
  const [reviewValues, setReviewValues] = useState<InsuranceOrderForm | null>(null);
  /**
   * Luồng Tặng quà mở hộp thoại với gói CỐ ĐỊNH, nhưng danh mục gói về sau qua
   * query — lúc dựng form chưa biết gói có mấy leg nên `legs` rỗng. Dựng lại
   * một lần khi danh mục về, và chỉ khi người dùng chưa gõ gì.
   *
   * Đây là đồng bộ dữ liệu ngoài vào form, không phải giá trị suy ra được.
   */
  useEffect(() => {
    if (!prefill || !selectedPackage || !confirmKnown) return;
    if (getValues("legs").length > 0) return;
    legsField.replace(defaultLegsFor(selectedPackage, confirmRequired));
  }, [prefill, selectedPackage, confirmKnown, confirmRequired, getValues, legsField]);

  const selectPackage = (value: string) => {
    setPackageName(value);
    legsField.replace(
      defaultLegsFor(packages.find((p) => p.name === value) ?? null, confirmRequired),
    );
    setPhotos([]);
    setStartDateConfirmed([]);
  };

  /**
   * Hộp "Xác nhận với khách" trước ô Ngày bắt đầu (chốt 2026-09-19), chỉ với
   * người `confirmRequired`. `confirmAskFor` là chỉ số đơn đang hỏi;
   * `startDateConfirmed[i]` nhớ đơn đã bấm "Đã xác nhận" để hỏi MỘT lần mỗi
   * đơn trong một lượt mở form. Đơn nối tiếp không hỏi: ngày của nó tự tính.
   */
  const [confirmAskFor, setConfirmAskFor] = useState<number | null>(null);
  const [startDateConfirmed, setStartDateConfirmed] = useState<boolean[]>([]);
  const needsStartDateConfirm = (i: number) =>
    confirmRequired && !startDateConfirmed[i] && !chainsToPrevious(selectedPackage, i);
  const confirmAskProduct =
    (selectedPackage?.legs ?? [])[confirmAskFor ?? -1]?.product ?? "motorbike";
  const confirmStartDate = () => {
    if (confirmAskFor === null) return;
    setStartDateConfirmed((prev) => {
      const copy = [...prev];
      copy[confirmAskFor] = true;
      return copy;
    });
    setConfirmAskFor(null);
  };

  /**
   * Sửa ngày bắt đầu thì tính lại ngày kết thúc theo số năm của LEG ĐÓ (chốt
   * 2026-09-02) — KD đổi ngày hiệu lực rồi hay quên kéo ngày kết thúc theo.
   * Các đơn nối tiếp phía sau (`chainsToPrevious`) dời theo luôn, nếu không thì
   * KD sửa đơn 1 xong đơn 2 vẫn nằm ở khoảng thời gian cũ và chồng lên đơn 1.
   * Ngày kết thúc và số tiền bảo hiểm KHOÁ, mức phí không hiện (chốt
   * 2026-09-16): cả ba lấy từ gói, ngày bắt đầu là ô duy nhất KD nhập về thời
   * hạn. `fee` vẫn nằm trong form state từ `defaultLegsFor` và gửi lên bình thường.
   */
  const changeStartDate = (i: number, v: string) => {
    setValue(`legs.${i}.startDate`, v, { shouldDirty: true, shouldValidate: true });
    if (!isRealIsoDate(v)) return;
    let start = v;
    for (let j = i; j < (selectedPackage?.legs.length ?? 0); j++) {
      const years = selectedPackage?.legs[j]?.years;
      if (!years) break;
      const end = yearsLater(start, years);
      setValue(`legs.${j}.startDate`, start, { shouldDirty: true, shouldValidate: true });
      setValue(`legs.${j}.endDate`, end, { shouldDirty: true, shouldValidate: true });
      if (!chainsToPrevious(selectedPackage, j + 1)) break;
      start = end;
    }
  };

  /**
   * Chỉ số đơn đang chờ trả lời "mua cho chính khách hay cho người thân"
   * (chốt 2026-09-16). Người thụ hưởng hay là người thân của khách, mà nút
   * điền sẵn bấm theo quán tính thì tên khách nằm trên đơn của người khác.
   */
  const [fillAskFor, setFillAskFor] = useState<number | null>(null);

  const applyCustomerInfo = (i: number) => {
    setValue(`legs.${i}.beneficiaryName`, customer.fullName, { shouldDirty: true });
    setValue(`legs.${i}.beneficiaryAddress`, customer.address, { shouldDirty: true });
    // Đơn xe máy không hỏi ngày sinh (ô đã ẩn) — điền vào là gửi lên dữ liệu
    // người dùng không hề thấy để đối chiếu.
    if ((selectedPackage?.legs ?? [])[i]?.product !== "motorbike")
      setValue(`legs.${i}.beneficiaryDob`, customer.dob ?? "", { shouldDirty: true });
  };

  const save = useMutation({
    /**
     * Ảnh lên kho TRƯỚC, ghi đơn SAU, từng đơn một. Ảnh nào lên xong thì đổi
     * ô đó sang `saved` ngay: lượt ghi đơn hỏng (409, mất mạng) rồi bấm lại
     * thì không tải lại tấm đã lên. Đưa `blob:` vào bản ghi là ảnh vỡ sau khi
     * tải lại trang — xem chú thích ở `BankAccountPhotos`.
     */
    mutationFn: async (form: InsuranceOrderForm) => {
      const legs: InsuranceOrderLegForm[] = [];
      for (let i = 0; i < form.legs.length; i++) {
        const urls = await uploadPendingPhotos(photosOf(i), "insurance-orders");
        if (urls.length > 0) setPhotosOf(i, urls.map((url) => ({ kind: "saved", url })));
        legs.push({
          ...form.legs[i],
          intakePhotoUrl: urls[0] ?? "",
          intakePhotoBackUrl: urls[1] ?? "",
        });
      }
      return createInsuranceOrders({ ...form, legs });
    },
    onSuccess: (orders) => {
      queryClient.invalidateQueries({ queryKey: ["insurance-list"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", customer.id] });
      // Bảng nhân sự P-51 có cột "Đơn BH" đếm từ chính bảng này.
      invalidateKpi(queryClient);
      onCreated?.(orders);
      setReviewValues(null);
      onClose();
      // Một gói khai mấy leg thì tạo bấy nhiêu đơn — nói ra đủ mã, vì người dùng
      // điền một form và dễ tưởng mình vừa tạo đúng một đơn.
      toast.ok(
        orders.length === 1
          ? `Đã tạo đơn ${orders[0].orderCode}`
          : `Đã tạo ${orders.length} đơn: ${orders.map((o) => o.orderCode).join(", ")}`,
      );
    },
    onError: (e) => {
      // Đóng màn kiểm lại về form: lỗi máy chủ (CCCD trùng, đơn tồn tại…) chỉ
      // sửa được trên form, màn kiểm lại không có ô nào để bấm sửa.
      setReviewValues(null);
      toast.fail(errorMessage(e, "Không tạo được đơn bảo hiểm này."));
    },
  });

  // Mở màn kiểm lại — CHƯA gửi. `save.mutate` chỉ chạy khi người dùng bấm xác
  // nhận ở đó (`confirmCreate`).
  const openReview = handleSubmit((values) => setReviewValues(values), reportInvalid);
  const confirmCreate = () => {
    if (reviewValues) save.mutate(reviewValues);
  };

  const addressSuggestions = useAddressSuggestions();

  /**
   * Một nhóm ảnh cho MỖI đơn, đứng đầu khối. CCCD nhận tối đa hai mặt nhưng chỉ
   * bắt buộc một; cà vẹt xe vẫn một ảnh. Ảnh chỉ tải lên khi bấm Tạo đơn.
   */
  const renderIntakePhoto = (i: number) => {
    const product = (selectedPackage?.legs ?? [])[i]?.product ?? "electric-accident";
    return (
      <BankAccountPhotos
        title={INTAKE_PHOTO_LABEL[product]}
        requiredPhotos={1}
        max={product === "electric-accident" ? 2 : 1}
        small
        required
        photos={photosOf(i)}
        onChange={(next) => setPhotosOf(i, next)}
        busy={save.isPending}
      />
    );
  };

  const renderVehicleInfo = (i: number) => (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Thông tin xe</legend>

      <div className={styles.pair}>
        <TextField
          label="Biển số xe"
          required
          placeholder="67A1-123.45"
          error={errors.legs?.[i]?.licensePlate?.message}
          {...register(`legs.${i}.licensePlate`)}
        />
        <Select
          label="Loại xe"
          value={watch(`legs.${i}.vehicleType`)}
          block
          required
          error={errors.legs?.[i]?.vehicleType?.message}
          // `shouldValidate`: ô này không `register` nên không có onChange của
          // RHF để tự kiểm lại. Thiếu nó thì sau một lần submit hỏng, chọn
          // đúng loại xe rồi dòng chữ đỏ vẫn nằm đó tới lần submit sau.
          onChange={(v) =>
            setValue(`legs.${i}.vehicleType`, v, { shouldDirty: true, shouldValidate: true })
          }
          options={VEHICLE_TYPES.filter((v) => v.code === VEHICLE_TYPE_DEFAULT).map((v) => ({
            value: v.code,
            label: `${v.code} – ${v.label}`,
          }))}
        />
      </div>
      <div className={styles.pair}>
        <TextField
          label="Số khung"
          placeholder="Không bắt buộc"
          error={errors.legs?.[i]?.chassisNumber?.message}
          {...register(`legs.${i}.chassisNumber`)}
        />
        <TextField
          label="Số máy"
          placeholder="Không bắt buộc"
          error={errors.legs?.[i]?.engineNumber?.message}
          {...register(`legs.${i}.engineNumber`)}
        />
      </div>
    </fieldset>
  );

  /**
   * Hai ô form PVI hỏi ở đơn tai nạn điện. Đứng thành khối riêng chứ không lẫn
   * vào "Khách hàng": chúng tả cái HỘ, không tả người đứng tên.
   */
  const renderHouseholdInfo = (i: number) => (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Thông tin hộ</legend>

      <div className={styles.pair}>
        <TextField
          label="Số thành viên"
          type="text"
          inputMode="numeric"
          required
          error={errors.legs?.[i]?.householdSize?.message}
          {...numericField(register(`legs.${i}.householdSize`, { setValueAs: numberValue }), digitsOnly)}
        />
        <Select
          label="Số tiền bảo hiểm"
          block
          required
          // Đi cặp với mức phí (`sumInsuredForFee`), mà phí đã khoá theo gói.
          disabled
          value={String(watch(`legs.${i}.sumInsured`))}
          error={errors.legs?.[i]?.sumInsured?.message}
          // `shouldValidate`: ô này không `register` nên không có onChange của
          // RHF để tự kiểm lại sau một lần submit hỏng.
          onChange={(v) =>
            setValue(`legs.${i}.sumInsured`, Number(v), {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
          options={SUM_INSURED_OPTIONS.map((amount) => ({
            value: String(amount),
            label: formatVnd(amount),
          }))}
        />
      </div>
    </fieldset>
  );

  /**
   * Ô Ngày bắt đầu bọc trong một lớp chặn: chưa xác nhận thì chạm vào ô mở hộp
   * hỏi thay vì bàn phím hay lịch.
   *
   * Tiêu điểm đặt vào ô chữ NGAY trong lượt chạm, trước khi mở hộp: iOS chỉ
   * bật bàn phím khi `focus()` gọi trong sự kiện người dùng, và `<dialog>`
   * đóng thì trả tiêu điểm về đúng phần tử đang giữ nó lúc `showModal()`. Nhờ
   * vậy bấm "Đã xác nhận" xong là con trỏ nằm sẵn trong ô, không cần gọi
   * `focus()` lần hai sau khi hộp đóng — lượt gọi đó nằm ngoài sự kiện người
   * dùng nên iOS bỏ qua.
   *
   * `preventDefault` ở pointerdown chặn tiêu điểm và lịch của ô ngày ẩn; click
   * vẫn tới (không phải sự kiện tương thích chuột) nên chặn thêm ở click để
   * `showPicker()` không chạy. Tab vào ô hay `reportInvalid` gọi `focus()` đi
   * đường `onFocusCapture`.
   */
  const renderStartDate = (i: number) => (
    <div
      className={styles.startDateGuard}
      onPointerDownCapture={(e) => {
        if (!needsStartDateConfirm(i)) return;
        e.preventDefault();
        e.currentTarget.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
        setConfirmAskFor(i);
      }}
      onClickCapture={(e) => {
        if (!needsStartDateConfirm(i)) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onFocusCapture={(e) => {
        if (!needsStartDateConfirm(i)) return;
        if (e.target instanceof HTMLInputElement && e.target.type === "text") setConfirmAskFor(i);
      }}
    >
      <DateField
        label="Ngày bắt đầu"
        required
        error={errors.legs?.[i]?.startDate?.message}
        value={watch(`legs.${i}.startDate`)}
        onChange={(v) => changeStartDate(i, v)}
        min={businessDay()}
        max={latestStartDate(businessDay())}
      />
    </div>
  );

  const renderBeneficiary = (i: number) => (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Khách hàng</legend>

      <Button variant="secondary" onClick={() => setFillAskFor(i)}>
        <UserCheck size={14} aria-hidden />
        Điền theo hồ sơ khách
      </Button>

      <TextField
        label="Họ tên"
        required
        placeholder="Nguyễn Văn A"
        error={errors.legs?.[i]?.beneficiaryName?.message}
        {...register(`legs.${i}.beneficiaryName`)}
      />
      {/* Đơn BH xe máy không hỏi ngày sinh; đơn tai nạn điện vẫn cần. */}
      {(selectedPackage?.legs ?? [])[i]?.product !== "motorbike" && (
        <DateField
          label="Ngày sinh"
          required
          max={businessDay()}
          value={watch(`legs.${i}.beneficiaryDob`)}
          onChange={(v) =>
            setValue(`legs.${i}.beneficiaryDob`, v, { shouldDirty: true, shouldValidate: true })
          }
          error={errors.legs?.[i]?.beneficiaryDob?.message}
        />
      )}
      <AddressField
        label="Địa chỉ"
        required
        placeholder="Gõ để tìm Ấp, Xã, Tỉnh"
        suggestions={addressSuggestions}
        value={watch(`legs.${i}.beneficiaryAddress`)}
        onChange={(v) =>
          setValue(`legs.${i}.beneficiaryAddress`, v, { shouldDirty: true, shouldValidate: true })
        }
        error={errors.legs?.[i]?.beneficiaryAddress?.message}
      />
    </fieldset>
  );

  /**
   * Một khối cho mỗi đơn ở màn kiểm lại — CHỈ những ô người dùng tự gõ hay tự
   * chọn mỗi lần, nơi có thể gõ nhầm. Bỏ mức phí, loại xe, số tiền bảo hiểm:
   * ba ô đó lấy sẵn từ gói (`defaultLegsFor`), không phải chỗ hay sai. Cũng bỏ
   * tên gói và ảnh, đã hiện ngay trên form phía dưới.
   */
  const renderReviewLeg = (leg: InsuranceOrderLegForm, i: number) => {
    const nameParts = spellingPartsForName(leg.beneficiaryName);
    const nameNeedsReview = nameParts.some((part) => part.suspicious);

    return (
      <fieldset key={i} className={styles.reviewLeg}>
        {legsField.fields.length > 1 && (
          <legend className={styles.legTitle}>{legLabel(selectedPackage, i)}</legend>
        )}
        <dl className={styles.reviewGrid}>
          <div>
            <dt>Ngày bắt đầu</dt>
            <dd>{formatDate(leg.startDate)}</dd>
          </div>
          <div>
            <dt>Ngày kết thúc</dt>
            <dd>{formatDate(leg.endDate)}</dd>
          </div>
          {leg.product === "motorbike" ? (
            <div>
              <dt>Biển số xe</dt>
              <dd>{leg.licensePlate}</dd>
            </div>
          ) : (
            <div>
              <dt>Số thành viên hộ</dt>
              <dd>{leg.householdSize}</dd>
            </div>
          )}
          <div>
            <dt>Người thụ hưởng</dt>
            <dd>
              {nameParts.map((part, index) =>
                part.suspicious ? (
                  <mark key={index} className={styles.reviewNameMark}>{part.text}</mark>
                ) : (
                  part.text
                ),
              )}
              {nameNeedsReview && (
                <small className={styles.reviewNameWarning} role="status">
                  Tên có thể sai chính tả. Kiểm tra lại giấy tờ.
                </small>
              )}
            </dd>
          </div>
          {leg.product !== "motorbike" && (
            <div>
              <dt>Ngày sinh</dt>
              <dd>{formatDate(leg.beneficiaryDob)}</dd>
            </div>
          )}
          <div>
            <dt>Địa chỉ</dt>
            <dd>{leg.beneficiaryAddress}</dd>
          </div>
        </dl>
      </fieldset>
    );
  };

  return (
    <>
    <Dialog
      open={open}
      onClose={onClose}
      title="Tạo đơn bảo hiểm"
      footerStart={onBack && <BackButton onClick={onBack}>Chọn khách khác</BackButton>}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            type="submit"
            form="insurance-order-form"
            disabled={
              isSubmitting ||
              save.isPending ||
              (selectedPackage?.legs ?? []).length === 0 ||
              missingPhoto
            }
          >
            {save.isPending ? "Đang lưu…" : "Tạo đơn"}
          </Button>
        </>
      }
    >
      <form id="insurance-order-form" className={styles.form} onSubmit={openReview} noValidate>
        <DepartmentPicker
          module="insurance"
          value={watch("departmentId")}
          onChange={(v) => setValue("departmentId", v, { shouldDirty: true })}
        />

        {!prefill && (
          <Select
            block
            label="Gói bảo hiểm"
            required
            // Chọn gói là dựng `legs`, mà ngày mặc định phụ thuộc câu trả lời
            // của máy chủ — chưa có thì chưa cho chọn.
            disabled={!confirmKnown}
            value={packageName}
            onChange={selectPackage}
            options={[
              { value: "", label: "— Chọn gói —" },
              // Gói đã ngừng không tặng cho khách mới được nữa. Chỉ lọc ở đây,
              // không lọc `packages`: luồng Tặng quà vẫn cần tra phí gói cũ để
              // prefill đơn đang mở dở.
              ...packages.filter((p) => p.active).map((p) => ({ value: p.name, label: p.name })),
            ]}
          />
        )}


        {legsField.fields.length > 1 &&
          legsField.fields.map((field, i) => (
            <fieldset key={field.id} className={styles.legCard}>
              <legend className={styles.legTitle}>{legLabel(selectedPackage, i)}</legend>

              {renderIntakePhoto(i)}

              {/* Không có ô Ngày tạo đơn (chốt 2026-09-08): sổ chốt theo ngày,
                  không nhập bù. `orderDate` vẫn gửi lên, luôn là ngày lập. */}
              <div className={styles.pair}>
                {renderStartDate(i)}
                <DateField
                  label="Ngày kết thúc"
                  required
                  disabled
                  error={errors.legs?.[i]?.endDate?.message}
                  value={watch(`legs.${i}.endDate`)}
                  onChange={(v) =>
                    setValue(`legs.${i}.endDate`, v, { shouldDirty: true, shouldValidate: true })
                  }
                />
              </div>

              {(selectedPackage?.legs ?? [])[i].product === "motorbike"
                ? renderVehicleInfo(i)
                : renderHouseholdInfo(i)}
              {renderBeneficiary(i)}
            </fieldset>
          ))}

        {legsField.fields.length === 1 && (
          <>
            {renderIntakePhoto(0)}

            <div className={styles.pair}>
              {renderStartDate(0)}
              <DateField
                label="Ngày kết thúc"
                required
                disabled
                error={errors.legs?.[0]?.endDate?.message}
                value={watch("legs.0.endDate")}
                onChange={(v) =>
                  setValue("legs.0.endDate", v, { shouldDirty: true, shouldValidate: true })
                }
              />
            </div>
            {(selectedPackage?.legs ?? [])[0].product === "motorbike"
              ? renderVehicleInfo(0)
              : renderHouseholdInfo(0)}
            {renderBeneficiary(0)}
          </>
        )}
      </form>
    </Dialog>

    {/* Kiểm lại trước khi gửi (chốt 2026-09-13). Đứng NGOÀI form phía trên nên
        Esc/bấm nền chỉ đóng màn này, form và ảnh đã chọn còn nguyên. */}
    <Dialog
      open={Boolean(reviewValues)}
      onClose={() => setReviewValues(null)}
      title="Kiểm tra lại trước khi tạo đơn"
      footer={
        <>
          <Button variant="secondary" onClick={() => setReviewValues(null)} disabled={save.isPending}>
            Quay lại sửa
          </Button>
          <ConfirmCreateButton pending={save.isPending} onConfirm={confirmCreate} />
        </>
      }
    >
      <div className={styles.reviewList}>
        <p className={styles.reviewPackage}>
          Gói <strong>{packageName}</strong> cho khách <strong>{customer.fullName}</strong>
        </p>
        {reviewValues?.legs.map(renderReviewLeg)}
      </div>
    </Dialog>

    <ConfirmDialog
      open={fillAskFor !== null}
      title="Điền theo hồ sơ khách"
      confirmLabel="Bản thân khách"
      cancelLabel="Người thân"
      onConfirm={() => {
        if (fillAskFor !== null) applyCustomerInfo(fillAskFor);
        setFillAskFor(null);
      }}
      onClose={() => setFillAskFor(null)}
    >
      Bảo hiểm này mua cho <strong className={styles.fillAskEmphasis}>chính khách</strong> hay
      cho <strong className={styles.fillAskEmphasis}>người thân</strong> của khách?
    </ConfirmDialog>

    {/* Không có nút đóng, Esc, bấm nền: đường duy nhất là "Đã xác nhận". Ô
        ngày vẫn trống, không xác nhận thì không nhập được. */}
    <Dialog
      open={confirmAskFor !== null}
      onClose={confirmStartDate}
      title="Xác nhận với khách"
      dismissible={false}
      footer={<Button onClick={confirmStartDate}>Đã xác nhận</Button>}
    >
      <p className={styles.confirmAsk}>
        Hỏi khách:{" "}
        <strong className={styles.fillAskEmphasis}>
          khách có {PRODUCT_LABEL[confirmAskProduct]} còn hạn không?
        </strong>{" "}
        Còn thì ngày bắt đầu là ngày hết hạn của bảo hiểm cũ.
      </p>
    </Dialog>
    </>
  );
}
