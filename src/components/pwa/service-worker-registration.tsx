"use client";

import * as React from "react";

/**
 * Registers the service worker that makes the app installable and gives it an
 * offline notice page.
 *
 * Only in production: during `next dev` a cached shell would hide the changes an
 * administrator is testing. Registration is best effort, so a browser without
 * service worker support simply keeps the normal web experience.
 */
export function ServiceWorkerRegistration() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        /* Installing is optional; the app keeps working as a normal website. */
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
