"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Gift } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { SearchField } from "@/components/ui/SearchField";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { GIFT_CATEGORY_LABEL, GiftCategory, fetchGiftChoices, type GiftChoice } from "@/lib/api/giftShops";
import { matchesSearch } from "@/lib/format";
import { writeQrImage } from "@/lib/writeQrImage";
import styles from "./GiftPickerButton.module.scss";

const ALL = "all";

type Props = {
  /** Shop dòng đã ghi: chỉ hiện quà của shop này, để khách không mua ở shop khác shop đã tính đơn. */
  shop?: { id: string; name: string };
  className?: string;
};

/**
 * Nút "Chọn quà tặng từ Shopee" của dòng ShopeePay.
 *
 * Chọn một món thì hiện QR của trang sản phẩm: khách quét bằng điện thoại để mua
 * bằng ví ShopeePay vừa mở, nên link phải mở được trên máy khách.
 */
export function GiftPickerButton({ shop, className }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL);
  const [picked, setPicked] = useState<GiftChoice | null>(null);
  const [qr, setQr] = useState({ link: "", src: "" });

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["gift-choices", shop?.id ?? ""],
    queryFn: () => fetchGiftChoices(shop?.id),
    enabled: open,
  });

  const qrLink = picked?.link ?? "";

  // Vẽ khi nhân viên chọn món, không vẽ sẵn: file wasm 647 KB, cùng lý do với `BankShopQrButton`.
  useEffect(() => {
    if (!qrLink) return;

    let live = true;
    let src = "";
    writeQrImage(qrLink).then((image) => {
      if (!live || !image) return;
      src = URL.createObjectURL(image);
      setQr({ link: qrLink, src });
    });
    return () => {
      live = false;
      if (src) URL.revokeObjectURL(src);
    };
  }, [qrLink]);

  const qrSrc = qr.link === qrLink ? qr.src : "";

  const items = data?.items ?? [];
  const matched = search.trim() ? items.filter((g) => matchesSearch(`${g.name} ${g.shopName}`, search)) : items;
  const visible = category === ALL ? matched : matched.filter((g) => g.category === category);
  const tabs = [
    { value: ALL, label: "Tất cả", count: matched.length },
    ...GiftCategory.options.map((c) => ({
      value: c,
      label: GIFT_CATEGORY_LABEL[c],
      count: matched.filter((g) => g.category === c).length,
    })),
  ];

  const close = () => {
    setOpen(false);
    setPicked(null);
  };

  // Modal nằm trong form Hoàn thành mà `Dialog` không portal ra ngoài: Enter ở ô tìm sẽ gửi form đó.
  const keepEnterInside = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault();
  };

  return (
    <>
      <Button variant="secondary" className={className} onClick={() => setOpen(true)}>
        <Gift size={16} aria-hidden />
        Chọn quà tặng từ Shopee
      </Button>

      {open && (
        <Dialog
          open
          fullScreen
          title={picked ? "Quà đã chọn" : "Chọn quà tặng từ Shopee"}
          onClose={close}
          footerStart={
            picked ? (
              <Button variant="secondary" onClick={() => setPicked(null)}>
                <ArrowLeft size={16} aria-hidden />
                Chọn món khác
              </Button>
            ) : undefined
          }
          footer={<Button onClick={close}>{picked ? "Xong" : "Đóng"}</Button>}
        >
          {picked ? (
            <div className={styles.picked}>
              {qrSrc ? (
                // eslint-disable-next-line @next/next/no-img-element -- ảnh QR vẽ tại máy thành blob URL
                <img src={qrSrc} alt={`Mã QR trang sản phẩm ${picked.name}`} width={240} height={240} className={styles.qr} />
              ) : (
                <span className={styles.qr} aria-hidden />
              )}
              <p className={styles.pickedName}>{picked.name}</p>
              <p className="text-muted">
                {picked.price || "—"} · {picked.shopName}
              </p>
              <a href={picked.link} target="_blank" rel="noreferrer" className={styles.openLink}>
                <ExternalLink size={16} aria-hidden />
                Mở trên Shopee
              </a>
              <p className="text-muted">Khách quét mã bằng điện thoại để mở quà trong app Shopee.</p>
            </div>
          ) : (
            <div className={styles.body} onKeyDown={keepEnterInside}>
              <SearchField
                block
                label="Tìm quà"
                placeholder="Tìm theo tên quà hoặc tên shop"
                value={search}
                onChange={setSearch}
              />
              <SegmentedTabs compact label="Loại quà" options={tabs} value={category} onChange={setCategory} />

              {shop && <p className="text-muted">Dòng này đã ghi shop {shop.name}, nên chỉ hiện quà của shop này.</p>}
              {data && data.hiddenShops.length > 0 && (
                <p className="text-muted">
                  Đang ẩn quà của {data.hiddenShops.join(", ")}: shop có nhiều đơn nhất trong ngày.
                </p>
              )}

              {isPending && <SkeletonCard lines={4} label="Đang tải danh sách quà" />}
              {isError && <ErrorState what="danh sách quà" onRetry={refetch} retrying={isFetching} />}

              {data && visible.length === 0 && <p className="text-muted">Không có quà nào khớp.</p>}
              {data && visible.length > 0 && (
                <ul className={styles.grid}>
                  {visible.map((g) => (
                    <li key={g.id}>
                      <button type="button" className={styles.card} onClick={() => setPicked(g)} disabled={!g.link}>
                        {g.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- ảnh đi qua /api/images có kiểm phiên, next/image không đọc được
                          <img src={g.imageUrl} alt="" loading="lazy" className={styles.photo} />
                        ) : (
                          <span className={styles.photo} aria-hidden />
                        )}
                        <span className={styles.name}>{g.name}</span>
                        <span className={styles.price}>{g.price || "—"}</span>
                        <span className={styles.shop}>
                          {g.shopName} · {g.shopTodayCount} đơn trong ngày
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
