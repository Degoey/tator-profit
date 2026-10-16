package com.tatorprofit.wrapper;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Insets;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;


/**
 * The shared body of every Tatorprofit Android surface: one Activity that renders
 * one deployed Tatorprofit web surface inside a hardened WebView.
 *
 * One project ships three surfaces — anggota, admin and pemilik — which differ
 * only in package id, launcher name, icon, entry URL and (for the owner console)
 * passkey support. Everything below is common to all three, so a hardening fix
 * lands in every APK at once instead of drifting between copies.
 *
 * Why a WebView and not a native rewrite: each surface already ships its own
 * authentication, RBAC, audit trail and money rules on the server. Wrapping the
 * same origin keeps a single source of truth, so the APK can never show numbers
 * the web app would not show, and it never stores a balance locally.
 *
 * What is hardened here:
 *   - cleartext HTTP is refused by the release network policy;
 *   - TLS errors abort the load instead of being ignored;
 *   - only the configured origin stays inside the WebView, every other host and
 *     scheme (WhatsApp, mail, tel, …) is handed to the system;
 *   - the page cannot navigate to `file:`, `content:` or `intent:` URLs;
 *   - camera, microphone and geolocation prompts are denied;
 *   - the session cookie stays in the WebView cookie jar; this class never reads
 *     it except to authenticate a download it explicitly starts.
 */
public abstract class WrapperActivity extends Activity {

    private static final String TAG = "TatorprofitWrapper";

    private static final int REQUEST_FILE_CHOOSER = 0x10;

    /** Asset shown when a top-level navigation fails (device offline). */
    private static final String OFFLINE_ASSET = "offline.html";

    /** Placeholder inside `offline.html`, replaced with the URL to retry. */
    private static final String OFFLINE_URL_TOKEN = "__TATORPROFIT_APP_URL__";

    /** Schemes handed to another app; every other scheme is blocked. */
    private static final List<String> EXTERNAL_SCHEMES =
            List.of("mailto", "tel", "sms", "smsto", "whatsapp", "market");

    private FrameLayout rootLayout;
    private ProgressBar progressBar;
    private WebView webView;

    /** Pending `<input type="file">` callback, cleared once answered. */
    private ValueCallback<Uri[]> pendingFileCallback;

    /** Last http(s) URL the user asked for; retried from the offline page. */
    private String lastRequestedUrl = BuildConfig.APP_URL;

    /** Host of the wrapped origin; anything else counts as external. */
    private final String appHost = Uri.parse(BuildConfig.APP_URL).getHost();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        rootLayout = findViewById(R.id.root);
        progressBar = findViewById(R.id.progress);

        applyEdgeToEdge();
        registerBackHandler();

        if (BuildConfig.DEBUG) {
            // Debug builds only: allows chrome://inspect against the dev server.
            WebView.setWebContentsDebuggingEnabled(true);
        }

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);

        installWebView();
        if (webView != null) {
            // Third-party cookies are pointless here (single origin) and would
            // only widen what the page can do.
            cookieManager.setAcceptThirdPartyCookies(webView, false);
            webView.loadUrl(BuildConfig.APP_URL);
        }
    }

    /** Creates the WebView and wires every policy hook into it. */
    private void installWebView() {
        WebView created;
        try {
            created = new WebView(this);
        } catch (Exception error) {
            // Rare: Android System WebView disabled, missing or too old.
            Log.e(TAG, "WebView unavailable", error);
            toast(getString(R.string.webview_unavailable));
            finish();
            return;
        }

        created.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        created.setBackgroundColor(getColor(R.color.brand_ink));
        created.setOverScrollMode(View.OVER_SCROLL_NEVER);

        configureSettings(created.getSettings());
        // Surface-specific policy hook (the owner console enables passkey support
        // here). The default implementation adds nothing.
        onWebViewReady(created, created.getSettings());

        created.setWebViewClient(new AppWebViewClient());
        created.setWebChromeClient(new AppWebChromeClient());
        created.setDownloadListener(this::handleDownloadRequest);

        webView = created;
        // Index 0 keeps the progress bar drawn above the page.
        rootLayout.addView(created, 0);
    }

    @SuppressWarnings("deprecation") // setAllowFileAccess / setForceDark
    private void configureSettings(WebSettings settings) {
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUserAgentString(
                settings.getUserAgentString() + " TatorprofitAndroid/" + BuildConfig.VERSION_NAME);

        // The page is remote content: it must not read the device file system.
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSaveFormData(false);
        settings.setGeolocationEnabled(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);

        // The web app is already responsive; zooming only breaks its layout.
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Keep the brand colours exactly as authored, even in system dark mode.
            settings.setForceDark(WebSettings.FORCE_DARK_OFF);
        }
    }

    /*
     * Navigation policy
     * -----------------
     * Everything the page tries to open goes through `handleNavigation`. Only the
     * configured origin may replace the current document; anything else leaves the
     * app, so the WebView can never be pointed at an attacker-controlled page that
     * would inherit the admin session.
     */

    private boolean isAppHost(String host) {
        if (host == null || appHost == null) {
            return false;
        }
        return host.equalsIgnoreCase(appHost) || host.equalsIgnoreCase("www." + appHost);
    }

    /** @return true when the WebView must not handle the URL itself. */
    private boolean handleNavigation(Uri uri) {
        String scheme = uri.getScheme();
        if (scheme == null) {
            return true;
        }

        String normalized = scheme.toLowerCase(Locale.US);
        if ("http".equals(normalized) || "https".equals(normalized)) {
            if (isAppHost(uri.getHost())) {
                return false;
            }
            openExternally(uri);
            return true;
        }

        if (EXTERNAL_SCHEMES.contains(normalized)) {
            openExternally(uri);
            return true;
        }

        // file:, content:, intent:, data:, javascript: … are never navigated to.
        Log.w(TAG, "Blocked navigation to scheme: " + normalized);
        return true;
    }

    /**
     * Hook called once the WebView exists and its settings are configured, before
     * any page loads. Surfaces that need extra WebView policy override it; the
     * default is deliberately empty so the member and admin APKs add nothing.
     */
    protected void onWebViewReady(WebView webView, WebSettings settings) {
    }

    /**
     * Hands a URL to another app. Kept protected so a surface-specific subclass can
     * use it as a fallback (e.g. when the device cannot do passkeys inside a
     * WebView, the owner console opens in the system browser instead).
     */
    protected void openExternally(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException error) {
            toast(getString(R.string.external_link_no_app));
        }
    }

    /*
     * Edge-to-edge layout
     * -------------------
     * The shell owns the system bar padding on every API level, so the web page is
     * never drawn under the status bar (Android 15 forces edge-to-edge for apps
     * targeting SDK 35) and never double-padded on older releases.
     */

    private void applyEdgeToEdge() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }

        rootLayout.setOnApplyWindowInsetsListener((view, windowInsets) -> {
            int top;
            int bottom;
            int left;
            int right;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets bars = windowInsets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                top = bars.top;
                bottom = bars.bottom;
                left = bars.left;
                right = bars.right;
            } else {
                top = windowInsets.getSystemWindowInsetTop();
                bottom = windowInsets.getSystemWindowInsetBottom();
                left = windowInsets.getSystemWindowInsetLeft();
                right = windowInsets.getSystemWindowInsetRight();
            }

            view.setPadding(left, top, right, bottom);
            return windowInsets;
        });
    }

    /*
     * Back navigation
     * ---------------
     * Back walks the WebView history first and only leaves the app at the entry
     * point, which is what a wrapped site is expected to do.
     */

    private void registerBackHandler() {
        BackDispatcher.register(this, this::handleBackPressed);
    }

    private void handleBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        finish();
    }

    @SuppressWarnings("deprecation") // legacy back callback, API < 33
    @Override
    public void onBackPressed() {
        handleBackPressed();
    }

    /**
     * Keeps the API 33 `OnBackInvokedDispatcher` reference out of this class so
     * older devices never have to resolve it.
     */
    private static final class BackDispatcher {
        static void register(Activity activity, Runnable callback) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                activity.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                        android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                        callback::run);
            }
        }
    }

    /*
     * Page hooks
     * ----------
     */

    private final class AppWebViewClient extends WebViewClient {

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleNavigation(request.getUrl());
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                lastRequestedUrl = url;
            }
            showProgress(0);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            hideProgress();
        }

        @Override
        public void onReceivedError(
                WebView view, WebResourceRequest request, WebResourceError error) {
            // Sub-resource failures (a favicon, a background fetch) must not replace
            // the page: the web app already handles those in place.
            if (!request.isForMainFrame()) {
                return;
            }
            Log.w(TAG, "Main frame failed with code " + error.getErrorCode());
            showOfflinePage();
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            // Never continue past a broken certificate chain: this app carries an
            // authenticated administrator session.
            handler.cancel();
            toast(getString(R.string.ssl_error));
        }
    }

    private final class AppWebChromeClient extends WebChromeClient {

        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            if (newProgress >= 100) {
                hideProgress();
            } else {
                showProgress(newProgress);
            }
        }

        @Override
        public boolean onShowFileChooser(
                WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            // The deposit form and the admin panel both use <input type="file">.
            if (pendingFileCallback != null) {
                pendingFileCallback.onReceiveValue(null);
            }
            pendingFileCallback = callback;

            try {
                startActivityForResult(params.createIntent(), REQUEST_FILE_CHOOSER);
                return true;
            } catch (ActivityNotFoundException error) {
                pendingFileCallback = null;
                toast(getString(R.string.file_chooser_unavailable));
                return false;
            }
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            // Camera, microphone and geolocation are denied here as well as by the
            // server's Permissions-Policy header.
            request.deny();
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(
                String origin, GeolocationPermissions.Callback callback) {
            callback.invoke(origin, false, false);
        }
    }

    /*
     * Offline handling
     * ----------------
     */

    private void showProgress(int percent) {
        progressBar.setProgress(percent);
        progressBar.setVisibility(View.VISIBLE);
    }

    private void hideProgress() {
        progressBar.setVisibility(View.GONE);
    }

    /**
     * Replaces the document with a local, self-contained "no connection" screen.
     *
     * It is shipped inside the APK, so it renders with no network at all, and it
     * deliberately shows no numbers: a cached balance must never be mistaken for
     * live money data. The retry button targets the last URL the user asked for.
     */
    private void showOfflinePage() {
        if (webView == null) {
            return;
        }

        String html = readAsset(OFFLINE_ASSET);
        if (html == null) {
            return;
        }

        hideProgress();
        webView.loadDataWithBaseURL(
                null,
                html.replace(OFFLINE_URL_TOKEN, lastRequestedUrl),
                "text/html",
                "utf-8",
                null);
    }

    private String readAsset(String name) {
        try (InputStream input = getAssets().open(name)) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = input.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
            }
            return buffer.toString("UTF-8");
        } catch (IOException error) {
            Log.e(TAG, "Cannot read asset " + name, error);
            return null;
        }
    }

    /*
     * Downloads and file input
     * ------------------------
     */

    /**
     * Payment proofs are PDFs or images served by an authenticated endpoint. The
     * WebView cannot render a PDF, so those clicks become a real download. The
     * session cookie is forwarded explicitly because DownloadManager runs outside
     * this process and would otherwise receive a 401.
     */
    private void handleDownloadRequest(
            String url,
            String userAgent,
            String contentDisposition,
            String mimeType,
            long contentLength) {
        Uri uri = Uri.parse(url);
        if (!isAppHost(uri.getHost())) {
            openExternally(uri);
            return;
        }

        DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        if (manager == null) {
            openExternally(uri);
            return;
        }

        String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
        if (fileName == null || fileName.isEmpty()) {
            fileName = "tatorprofit-berkas";
        }

        DownloadManager.Request request = new DownloadManager.Request(uri);
        request.addRequestHeader("User-Agent", userAgent);
        String cookie = CookieManager.getInstance().getCookie(url);
        if (cookie != null) {
            request.addRequestHeader("Cookie", cookie);
        }
        if (mimeType != null) {
            request.setMimeType(mimeType);
        }
        request.setTitle(fileName);
        request.setNotificationVisibility(
                DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
        } else {
            // Below API 29 the public directory would need a storage permission.
            // The app asks for none, so the file goes to its own directory.
            request.setDestinationInExternalFilesDir(
                    this, Environment.DIRECTORY_DOWNLOADS, fileName);
        }

        try {
            manager.enqueue(request);
            toast(getString(R.string.download_started));
        } catch (IllegalArgumentException | SecurityException error) {
            Log.e(TAG, "Download could not be queued", error);
            toast(getString(R.string.download_failed));
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQUEST_FILE_CHOOSER) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }

        ValueCallback<Uri[]> callback = pendingFileCallback;
        pendingFileCallback = null;
        if (callback == null) {
            return;
        }

        Uri[] result = resultCode == RESULT_OK && data != null ? collectUris(data) : null;
        callback.onReceiveValue(result);
    }

    /** Turns a single or a multiple selection into the array the page expects. */
    private Uri[] collectUris(Intent data) {
        if (data.getClipData() != null) {
            int count = data.getClipData().getItemCount();
            List<Uri> uris = new ArrayList<>(count);
            for (int index = 0; index < count; index++) {
                Uri item = data.getClipData().getItemAt(index).getUri();
                if (item != null) {
                    uris.add(item);
                }
            }
            return uris.isEmpty() ? null : uris.toArray(new Uri[0]);
        }

        if (data.getDataString() != null) {
            return new Uri[] {Uri.parse(data.getDataString())};
        }

        return null;
    }

    /*
     * Lifecycle
     * ---------
     */

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
        }
        // Persist the session cookie so restarting the app does not log the
        // administrator out.
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = null;
        }

        if (webView != null) {
            rootLayout.removeView(webView);
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }

        super.onDestroy();
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }
}
