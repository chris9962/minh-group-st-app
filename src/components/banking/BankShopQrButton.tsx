"use client";

import { useEffect, useState } from "react";
import { ExternalLink, QrCode } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { writeQrImage } from "@/lib/writeQrImage";

/** Nút hiện mã QR của link shop mua quà tặng, link cài ở hộp Sửa ngân hàng. */
export function BankShopQrButton({ link, className }: { link: string; className?: string }) {
  const [open, setOpen] = useState(false);
  /** Ảnh QR kèm link đã vẽ, để link đổi thì vẽ lại. */
  const [qr, setQr] = useState({ link: "", src: "" });

  // Vẽ khi người dùng mở, không vẽ sẵn: file wasm 647 KB, đa số lượt vào màn không mở QR.
  useEffect(() => {
    if (!open || !link) return;

    let live = true;
    let src = "";
    writeQrImage(link).then((image) => {
      if (!live || !image) return;
      src = URL.createObjectURL(image);
      setQr({ link, src });
    });
    return () => {
      live = false;
      if (src) URL.revokeObjectURL(src);
    };
  }, [open, link]);

  const src = qr.link === link ? qr.src : "";

  return (
    <>
      <Button variant="secondary" type="button" className={className} onClick={() => setOpen(true)}>
        <QrCode size={16} aria-hidden />
        Hiện QR shop mua quà tặng
      </Button>

      {open && src && (
        <ImageLightbox
          src={src}
          alt="Mã QR shop mua quà tặng"
          onClose={() => setOpen(false)}
          caption={
            <a href={link} target="_blank" rel="noreferrer">
              <ExternalLink size={16} aria-hidden />
              Quét QR code
            </a>
          }
        />
      )}
    </>
  );
}
