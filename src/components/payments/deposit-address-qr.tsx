"use client";

import * as React from "react";

import {
  DEPOSIT_WALLET_ADDRESS,
  DEPOSIT_WALLET_LABEL,
  DEPOSIT_WALLET_NETWORK,
  DEPOSIT_WALLET_QR_DISK_PATH,
  DEPOSIT_WALLET_QR_SOURCES,
} from "@/lib/config/deposit-wallet";

/**
 * "Barcode Indodax" QR code plus the wallet address of the manual deposit.
 *
 * Styling is intentionally isolated: one unique class
 * (`.barcode-indodax-container`) and inline styles only, so this block can
 * neither restyle nor be restyled by the surrounding design system. The image
 * is capped at 200px and shrinks with the container on narrow viewports.
 *
 * `DEPOSIT_WALLET_QR_SOURCES` is tried in order. When none of the files can be
 * loaded the block explains where to place the image instead of showing a
 * broken icon.
 */
export function DepositAddressQr() {
  const [sourceIndex, setSourceIndex] = React.useState(0);
  const source = DEPOSIT_WALLET_QR_SOURCES[sourceIndex];
  const missing = source === undefined;

  return (
    <div className="barcode-indodax-container" style={CONTAINER_STYLE}>
      <p style={HEADING_STYLE}>
        {DEPOSIT_WALLET_LABEL} · {DEPOSIT_WALLET_NETWORK}
      </p>

      <div style={FRAME_STYLE}>
        {missing ? (
          <p style={PLACEHOLDER_STYLE}>
            Gambar QR belum tersedia. Simpan berkas barcode-indodax.png di{" "}
            {DEPOSIT_WALLET_QR_DISK_PATH} lalu muat ulang halaman ini.
          </p>
        ) : (
          // Disengaja memakai <img>, bukan next/image: berkas disajikan apa adanya
          // (optimizer dapat mereduksi ketajaman modul QR) dan rantai kandidat URL
          // di atas bergantung pada onError.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={source}
            alt={`QR code ${DEPOSIT_WALLET_LABEL} untuk alamat dompet ${DEPOSIT_WALLET_ADDRESS}`}
            width={200}
            height={200}
            decoding="async"
            onError={() => setSourceIndex((current) => current + 1)}
            style={IMAGE_STYLE}
          />
        )}
      </div>

      <p style={CAPTION_STYLE}>Alamat dompet — verifikasi sebelum mengirim:</p>
      <code style={ADDRESS_STYLE}>{DEPOSIT_WALLET_ADDRESS}</code>

      <p style={WARNING_STYLE}>
        Kirim USDT hanya melalui jaringan BEP-20 (BNB Smart Chain). Jangan gunakan TRC20/TRON,
        ERC-20, atau jaringan lain: aset yang dikirim lewat jaringan yang salah akan hilang dan
        tidak dapat dikembalikan.
      </p>
    </div>
  );
}

const CONTAINER_STYLE: React.CSSProperties = {
  border: "1px solid rgba(246, 196, 83, 0.28)",
  borderRadius: "16px",
  background: "rgba(255, 255, 255, 0.02)",
  padding: "16px",
  display: "grid",
  gap: "10px",
  justifyItems: "center",
  textAlign: "center",
  maxWidth: "100%",
};

const HEADING_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: "11px",
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "#f6c453",
};

/** White plate behind the QR: scanners need the light quiet zone. */
const FRAME_STYLE: React.CSSProperties = {
  width: "100%",
  maxWidth: "200px",
  boxSizing: "border-box",
  padding: "8px",
  borderRadius: "12px",
  background: "#ffffff",
  display: "grid",
  placeItems: "center",
};

const IMAGE_STYLE: React.CSSProperties = {
  display: "block",
  width: "100%",
  maxWidth: "200px",
  height: "auto",
};

const PLACEHOLDER_STYLE: React.CSSProperties = {
  margin: 0,
  padding: "12px 4px",
  fontSize: "11px",
  lineHeight: 1.5,
  color: "#0a1016",
  wordBreak: "break-word",
};

const CAPTION_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: "11px",
  color: "rgba(255, 255, 255, 0.55)",
};

const ADDRESS_STYLE: React.CSSProperties = {
  margin: 0,
  maxWidth: "100%",
  padding: "8px 10px",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: "8px",
  background: "rgba(0, 0, 0, 0.35)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: "12px",
  lineHeight: 1.5,
  color: "#ffffff",
  wordBreak: "break-all",
  userSelect: "all",
};

const WARNING_STYLE: React.CSSProperties = {
  margin: 0,
  maxWidth: "360px",
  fontSize: "11px",
  lineHeight: 1.6,
  color: "rgba(255, 255, 255, 0.55)",
};
