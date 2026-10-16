package com.tatorprofit.wrapper;

/**
 * The member and admin surfaces.
 *
 * Both render a plain authenticated web surface, so they add nothing to the shared
 * wrapper: no extra WebView policy, no extra dependency. The owner console is the
 * one surface that needs more (passkeys), and it lives in its own flavor as
 * {@code OwnerActivity} — see `app/src/owner/`.
 */
public class SurfaceActivity extends WrapperActivity {
}
