"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { type ActionState, initialState } from "@/lib/forms";
import { completeEmbeddedSignup, connectManually } from "@/modules/integrations/actions";

type FB = {
  init(opts: Record<string, unknown>): void;
  login(cb: (r: { authResponse?: { code?: string } | null }) => void, opts: Record<string, unknown>): void;
};
declare global {
  interface Window {
    FB?: FB;
    fbAsyncInit?: () => void;
  }
}

/**
 * Meta Embedded Signup: the owner logs in with Facebook, picks or creates
 * their WhatsApp Business Account and number, and Meta returns a one-time code.
 */
export function EmbeddedSignup({ appId, configId, graphVersion }: { appId: string; configId: string; graphVersion: string }) {
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<ActionState>(initialState);
  const [pending, start] = useTransition();
  const session = useRef<{ wabaId?: string; phoneNumberId?: string }>({});

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!/^https:\/\/(www\.|web\.)?facebook\.com$/.test(event.origin)) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type === "WA_EMBEDDED_SIGNUP" && data.event === "FINISH") {
          session.current = { wabaId: data.data?.waba_id, phoneNumberId: data.data?.phone_number_id };
        } else if (data?.type === "WA_EMBEDDED_SIGNUP" && data.event === "CANCEL") {
          setResult({ ok: false, message: "Sign-up was cancelled before it finished." });
        }
      } catch {
        // Other Facebook messages are not JSON; ignore them.
      }
    };
    window.addEventListener("message", onMessage);
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, autoLogAppEvents: true, xfbml: false, version: graphVersion });
      setReady(true);
    };
    if (window.FB) window.fbAsyncInit();
    else if (!document.getElementById("facebook-jssdk")) {
      const s = document.createElement("script");
      s.id = "facebook-jssdk";
      s.src = "https://connect.facebook.net/en_US/sdk.js";
      s.async = true;
      s.crossOrigin = "anonymous";
      document.body.appendChild(s);
    }
    return () => window.removeEventListener("message", onMessage);
  }, [appId, graphVersion]);

  function launch() {
    setResult(initialState);
    window.FB?.login(
      (response) => {
        const code = response.authResponse?.code;
        const { wabaId, phoneNumberId } = session.current;
        if (!code || !wabaId || !phoneNumberId) {
          setResult({ ok: false, message: "Meta didn't finish the sign-up. Try again, and pick a phone number at the end." });
          return;
        }
        start(async () => setResult(await completeEmbeddedSignup({ code, wabaId, phoneNumberId })));
      },
      { config_id: configId, response_type: "code", override_default_response_type: true, extras: { sessionInfoVersion: "3" } },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <button
          type="button"
          onClick={launch}
          disabled={!ready || pending}
          className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] bg-[#1877F2] px-4 text-[14px] font-medium text-white disabled:opacity-60"
        >
          {pending ? "Connecting…" : "Connect with Facebook"}
        </button>
      </div>
      <FormMessage state={result} />
    </div>
  );
}

export function ManualConnect() {
  const [state, action] = useActionState(connectManually, initialState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="WhatsApp Business Account ID" name="wabaId" inputMode="numeric" autoComplete="off" required state={state} />
        <Field label="Phone number ID" name="phoneNumberId" inputMode="numeric" autoComplete="off" required state={state} />
      </div>
      <Field label="Access token" name="token" type="password" autoComplete="off" required
        hint="A system-user token with whatsapp_business_messaging and whatsapp_business_management. It's stored encrypted and never shown again." />
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Checking with Meta…">Connect number</SubmitButton>
      </div>
    </form>
  );
}
