"use client";

import { useEffect, useRef } from "react";

type Api = { render(el: HTMLElement, o: { sitekey: string; callback(t: string): void; "expired-callback"(): void; "error-callback"(): void }): string; reset(id?: string): void; remove(id?: string): void };
declare global {
  interface Window {
    turnstile?: Api;
  }
}

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Cloudflare's CAPTCHA box. `onToken` gets a one-time token, or null when it expires or fails. Change `resetKey` to get a fresh one. */
export function Turnstile({ siteKey, onToken, resetKey }: { siteKey: string; onToken(token: string | null): void; resetKey: number }) {
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    let id: string | undefined;
    let cancelled = false;
    const mount = () => {
      if (cancelled || !box.current || !window.turnstile) return;
      id = window.turnstile.render(box.current, { sitekey: siteKey, callback: (t) => cb.current(t), "expired-callback": () => cb.current(null), "error-callback": () => cb.current(null) });
    };
    if (window.turnstile) mount();
    else {
      let script = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
      if (!script) {
        script = document.createElement("script");
        script.src = SRC;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", mount);
    }
    return () => {
      cancelled = true;
      if (id) window.turnstile?.remove(id);
    };
    // A new resetKey remounts the box, which gives a fresh token (they work once).
  }, [siteKey, resetKey]);

  return <div ref={box} />;
}
