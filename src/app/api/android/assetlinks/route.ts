import { NextResponse } from "next/server";

import { ANDROID_ASSET_LINKS } from "@/lib/config/android-app-links";

/**
 * Digital Asset Links statement, served to credential providers.
 *
 * Reached through the `/.well-known/assetlinks.json` rewrite in `next.config.ts`
 * rather than through a dot-directory inside `app/`: the path is what Android
 * fetches, the route lives where the app router is guaranteed to scan it.
 *
 * It must answer `200` with a JSON content type and must not redirect — a 301/302
 * fails verification, which would silently disable passkeys inside the owner app.
 */
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(ANDROID_ASSET_LINKS, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
