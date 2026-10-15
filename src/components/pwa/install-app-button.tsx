"use client";

import { Download, Smartphone } from "lucide-react";
import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Non-standard event, only fired by Chromium browsers. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * The installed state is an external system (the browser's display mode), so it
 * is read through `useSyncExternalStore` instead of being mirrored into state
 * from an effect. That keeps the first paint identical on the server, where the
 * app is never installed, and avoids cascading renders on hydration.
 */
function isStandalone(): boolean {
  const displayMode = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return displayMode || iosStandalone;
}

function subscribeToInstallState(onStoreChange: () => void): () => void {
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", onStoreChange);
  window.addEventListener("appinstalled", onStoreChange);

  return () => {
    media.removeEventListener("change", onStoreChange);
    window.removeEventListener("appinstalled", onStoreChange);
  };
}

const readInstallState = () => isStandalone();
const readServerInstallState = () => false;

/** iOS Safari never fires `beforeinstallprompt`, so it needs written steps. */
function isIosDevice(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/**
 * "Install app" affordance for the administrator panel.
 *
 * Chromium fires `beforeinstallprompt` once the manifest requirements are met;
 * the event is captured and replayed from a real user gesture, which is the only
 * way a browser accepts `prompt()`. Browsers that never fire it get written
 * instructions instead of a button that does nothing.
 *
 * Nothing here grants access: the installed window still authenticates with the
 * same session cookie and the same server-side permission checks.
 */
export interface InstallAppButtonProps {
  /**
   * Teks tombol. Konsol pemilik memakai labelnya sendiri ("Pasang aplikasi
   * pemilik") supaya tidak tertukar dengan aplikasi anggota/admin.
   */
  label?: string;
}

export function InstallAppButton({ label = "Pasang aplikasi admin" }: InstallAppButtonProps) {
  const installed = React.useSyncExternalStore(
    subscribeToInstallState,
    readInstallState,
    readServerInstallState,
  );
  const [promptEvent, setPromptEvent] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [showHint, setShowHint] = React.useState(false);
  /**
   * Only read on the client, and only used after a tap, so the server rendered
   * markup is unaffected.
   */
  const [onIos] = React.useState(() => typeof window !== "undefined" && isIosDevice());

  React.useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setPromptEvent(null);
      setShowHint(false);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  async function install() {
    if (!promptEvent) {
      setShowHint(true);
      return;
    }

    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    setPromptEvent(null);
    if (choice.outcome === "accepted") setShowHint(false);
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={install}>
        {promptEvent ? <Download aria-hidden /> : <Smartphone aria-hidden />}
        {label}
      </Button>

      {showHint ? (
        <Alert variant="info" className="w-full">
          {onIos
            ? "Di Safari: ketuk tombol Bagikan, lalu pilih “Tambahkan ke Layar Utama”."
            : "Buka menu browser (⋮) lalu pilih “Instal aplikasi” atau “Tambahkan ke layar utama”."}
        </Alert>
      ) : null}
    </>
  );
}
