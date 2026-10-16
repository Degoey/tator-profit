/**
 * Digital Asset Links for the Android surfaces.
 *
 * WebView refuses to hand a passkey ceremony to the app unless the app and the
 * site are associated: the site must publish `/.well-known/assetlinks.json`
 * naming the app's package id and the SHA-256 fingerprint of the certificate it
 * was signed with. Without this file the owner console opens inside the app but
 * the fingerprint prompt can never appear — the console would be locked.
 *
 * Only the owner surface needs it: it is the one surface with a mandatory second
 * factor. The member and admin apps carry no credential libraries, so they are
 * not listed and cannot be impersonated by a page on this origin.
 *
 * The fingerprint is a public value — it is published here on purpose — but the
 * matching private key is not: it lives in the release keystore outside the
 * repository (`android/keystore.properties`, git-ignored). Rotating the signing
 * key means updating this file and redeploying, otherwise every passkey prompt
 * silently stops appearing inside the app.
 */

/** Package id of the Konsol Pemilik app; mirrors `Surfaces.owner` in build.gradle.kts. */
export const OWNER_ANDROID_PACKAGE = "com.tatorprofit.owner";

/** Release signing certificate, colon-separated uppercase SHA-256. */
export const OWNER_ANDROID_CERT_SHA256 =
  "83:6D:B9:2B:9F:5A:8B:9E:AB:D8:4F:DC:DE:28:D7:5C:59:DE:3A:AA:6E:45:59:9C:7C:34:83:88:74:06:D0:DE";

/** The statement a credential provider reads to associate the app with this site. */
export const ANDROID_ASSET_LINKS = [
  {
    relation: ["delegate_permission/common.get_login_creds"],
    target: {
      namespace: "android_app",
      package_name: OWNER_ANDROID_PACKAGE,
      sha256_cert_fingerprints: [OWNER_ANDROID_CERT_SHA256],
    },
  },
];
