package com.tatorprofit.wrapper;

import android.net.Uri;
import android.util.Log;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

/**
 * The Konsol Pemilik (super admin) surface.
 *
 * The owner console is the only surface that requires a second factor: a passkey
 * (fingerprint / Face ID) registered by the owner. A plain WebView refuses
 * `navigator.credentials`, so without the WebView WebAuthn API the console would
 * be permanently locked inside the app even though it works in a browser.
 *
 * This class enables that API, which needs three things outside the code:
 *
 *   1. the credential libraries declared for this flavor only
 *      (`androidx.webkit`, `androidx.credentials`, `credentials-play-services-auth`)
 *      — the member and admin APKs stay dependency-free;
 *   2. Digital Asset Links: the web app must serve `/.well-known/assetlinks.json`
 *      with `delegate_permission/common.get_login_creds` for this package id and
 *      the release signing certificate. Without it WebView refuses to hand the
 *      ceremony to the app;
 *   3. an up-to-date Android System WebView on the device.
 *
 * When the device cannot do passkeys at all, the app says so and opens the console
 * in the system browser instead of showing a screen the owner can never unlock.
 */
public class OwnerActivity extends WrapperActivity {

    private static final String TAG = "TatorprofitOwner";

    @Override
    protected void onWebViewReady(WebView webView, WebSettings settings) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
            Log.w(TAG, "WebView does not support WebAuthn; opening the console externally");
            Toast.makeText(this, getString(R.string.passkey_unavailable), Toast.LENGTH_LONG).show();
            openExternally(Uri.parse(BuildConfig.APP_URL));
            finish();
            return;
        }

        WebSettingsCompat.setWebAuthenticationSupport(
                settings, WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP);

        // The WebView may refuse the request (missing Digital Asset Links, disabled
        // credential provider); read the answer back instead of assuming it worked.
        int support = WebSettingsCompat.getWebAuthenticationSupport(settings);
        if (support != WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP) {
            Log.w(TAG, "WebAuthn support not granted, state=" + support);
        } else {
            Log.i(TAG, "WebAuthn support enabled for the owner console");
        }
    }
}
