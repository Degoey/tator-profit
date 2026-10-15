import { NextResponse } from "next/server";

import { ADMIN_MANIFEST } from "@/lib/config/admin-manifest";

/**
 * Manifest Panel Admin, dilayani di `/admin/manifest.webmanifest`.
 *
 * Ditulis sebagai route handler biasa, bukan `manifest.ts`, karena konvensi
 * berkas `manifest.ts` hanya berlaku di akar `app/`: berkas itu diabaikan begitu
 * diletakkan di dalam segmen rute. Route handler juga tidak melewati layout
 * `/admin`, jadi browser dapat mengambil manifest ini justru saat petugas belum
 * masuk — memang harus, karena manifest inilah yang memasang aplikasinya.
 */
export function GET() {
  return NextResponse.json(ADMIN_MANIFEST, {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
