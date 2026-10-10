/**
 * Public deposit wallet published on the deposit page (QR image + address).
 *
 * The value is an EVM address used here on BNB Smart Chain, i.e. the transfer
 * must arrive as a BEP-20 token transfer: other EVM chains (Ethereum/Polygon)
 * and TRON are separate networks and would strand the funds. It is deliberately
 * a plain constant. Nothing in the application derives it, signs with it or
 * moves funds by itself: the member transfers manually and then uploads the
 * proof that an administrator reviews.
 *
 * Treat the string as a checksummed value (EIP-55): the mixed case is part of
 * the address, so it must never be lower-cased or re-typed by hand.
 */

/** Wallet address rendered under the QR code. */
export const DEPOSIT_WALLET_ADDRESS = "0xd442e9B62244B8347E1C95ED7098C71AD05a36C7";

/** `0x` followed by exactly 40 hexadecimal characters. */
export const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** Short label for the wallet that receives the manual transfer. */
export const DEPOSIT_WALLET_LABEL = "Dompet Indodax";

/**
 * Network the transfer must use: BNB Smart Chain, token standard BEP-20.
 *
 * The wallet lives on BNB Smart Chain. TRON/TRC20 uses a different, `T…` based
 * address format and other EVM chains are separate networks, so the copy must
 * never present this address as TRC20 and must not invite ERC-20 transfers.
 */
export const DEPOSIT_WALLET_NETWORK = "jaringan BEP-20 (BNB Smart Chain)";

/**
 * Candidate URLs for the "Barcode Indodax" image, tried in that order.
 *
 * Every file inside `public/` is served from the site root, so
 * `public/barcode-indodax.png` is reachable as `/barcode-indodax.png`. The
 * sub-folder entries exist so the QR keeps working when the image is filed
 * under `public/images/` or `public/assets/` instead.
 */
export const DEPOSIT_WALLET_QR_SOURCES = [
  "/barcode-indodax.png",
  "/images/barcode-indodax.png",
  "/assets/barcode-indodax.png",
] as const;

/**
 * Preferred location of the image on disk, relative to the repository root.
 * It matches `DEPOSIT_WALLET_QR_SOURCES[0]` and is only used in the hint shown
 * while no file can be loaded.
 */
export const DEPOSIT_WALLET_QR_DISK_PATH = "public/barcode-indodax.png";
