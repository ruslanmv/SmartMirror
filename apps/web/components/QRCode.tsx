"use client";

import QR from "qrcode";
import { useEffect, useState } from "react";

export function QRCode({ value, label }: { value: string; label: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QR.toString(value, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#14110d", light: "#00000000" } })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(null));
    return () => {
      alive = false;
    };
  }, [value]);
  return (
    <div className="qr" role="img" aria-label={label}>
      {svg && <div style={{ width: "100%", height: "100%" }} dangerouslySetInnerHTML={{ __html: svg }} />}
    </div>
  );
}
