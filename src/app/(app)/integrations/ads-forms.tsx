"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Field, FormMessage, SelectField, SubmitButton } from "@/components/ui/form";
import { type ActionState, initialState } from "@/lib/forms";
import { connectAdAccount, connectPageManually, connectPagesFromLogin, createGoogleWebhook, listPages } from "@/modules/integrations/ads-actions";

export function PageManualForm() {
  const [state, action] = useActionState(connectPageManually, initialState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Facebook page ID" name="pageId" inputMode="numeric" required state={state} />
        <Field label="Page access token" name="token" type="password" autoComplete="off" required
          hint="Needs leads_retrieval and pages_manage_metadata. Stored encrypted." state={state} />
      </div>
      <FormMessage state={state} />
      <div><SubmitButton variant="secondary" pendingLabel="Checking with Meta…">Connect page</SubmitButton></div>
    </form>
  );
}

type FBLogin = { login(cb: (r: { authResponse?: { accessToken?: string } | null }) => void, o: Record<string, unknown>): void; init(o: Record<string, unknown>): void };

/** Facebook Login → pick pages → the server fetches page tokens and subscribes them. */
export function PageLogin({ appId, graphVersion }: { appId: string; graphVersion: string }) {
  const [userToken, setUserToken] = useState<string | null>(null);
  const [pages, setPages] = useState<{ id: string; name: string }[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [result, setResult] = useState<ActionState>(initialState);
  const [pending, start] = useTransition();

  useEffect(() => {
    const w = window as unknown as { FB?: FBLogin; fbAsyncInit?: () => void };
    const init = () => w.FB?.init({ appId, xfbml: false, version: graphVersion });
    if (w.FB) init();
    else {
      w.fbAsyncInit = init;
      if (!document.getElementById("facebook-jssdk")) {
        const s = document.createElement("script");
        s.id = "facebook-jssdk";
        s.src = "https://connect.facebook.net/en_US/sdk.js";
        s.async = true;
        document.body.appendChild(s);
      }
    }
  }, [appId, graphVersion]);

  function login() {
    const FB = (window as unknown as { FB?: FBLogin }).FB;
    FB?.login(
      (r) => {
        const token = r.authResponse?.accessToken;
        if (!token) return setResult({ ok: false, message: "Facebook login was cancelled." });
        setUserToken(token);
        start(async () => {
          const list = await listPages(token);
          if (list.ok) setPages(list.pages);
          else setResult({ ok: false, message: list.error });
        });
      },
      { scope: "pages_show_list,pages_read_engagement,pages_manage_metadata,leads_retrieval,ads_read" },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!pages ? (
        <div>
          <button type="button" onClick={login} disabled={pending}
            className="inline-flex h-10 items-center rounded-[var(--radius-control)] bg-[#1877F2] px-4 text-[14px] font-medium text-white disabled:opacity-60">
            {pending ? "Loading pages…" : "Choose pages with Facebook"}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 text-[13.5px]">
          {pages.length === 0 && <p className="text-muted">This Facebook account doesn&apos;t manage any pages.</p>}
          {pages.map((p) => (
            <label key={p.id} className="flex items-center gap-2">
              <input type="checkbox" checked={picked.includes(p.id)}
                onChange={(e) => setPicked((x) => (e.target.checked ? [...x, p.id] : x.filter((i) => i !== p.id)))} />
              {p.name}
            </label>
          ))}
          <div>
            <button type="button" disabled={!picked.length || pending}
              onClick={() => start(async () => setResult(await connectPagesFromLogin(userToken ?? "", picked)))}
              className="h-9 rounded-[var(--radius-control)] bg-signal px-3.5 text-[13.5px] font-medium text-white disabled:opacity-50">
              {pending ? "Connecting…" : "Connect selected pages"}
            </button>
          </div>
        </div>
      )}
      <FormMessage state={result} />
    </div>
  );
}

export function AdAccountForm() {
  const [state, action] = useActionState(connectAdAccount, initialState);
  const [platform, setPlatform] = useState("meta");
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Platform" name="platform" value={platform} onChange={(e) => setPlatform(e.target.value)}
          options={[{ value: "meta", label: "Meta (Facebook, Instagram)" }, { value: "google", label: "Google Ads" }]} />
        <Field label={platform === "meta" ? "Ad account ID (act_…)" : "Customer ID (123-456-7890)"} name="externalId" required state={state} />
        <Field label="Name" name="name" placeholder="Optional" state={state} />
        {platform === "google" && <Field label="Manager account ID" name="loginCustomerId" placeholder="Only if accessed through an MCC" state={state} />}
        <Field label={platform === "meta" ? "Access token (ads_read)" : "OAuth refresh token"} name="token" type="password" autoComplete="off" required
          className="sm:col-span-2" state={state} />
      </div>
      <FormMessage state={state} />
      <div><SubmitButton variant="secondary" pendingLabel="Saving…">Connect ad account</SubmitButton></div>
    </form>
  );
}

export function GoogleWebhookForm() {
  const [state, action] = useActionState(createGoogleWebhook, initialState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Name" name="name" placeholder="Search campaign lead form" className="min-w-56 flex-1" state={state} />
        <SubmitButton variant="secondary" pendingLabel="Creating…">Create webhook</SubmitButton>
      </div>
      <FormMessage state={state} />
      {state.ok && state.data && (
        <dl className="grid gap-1 rounded-[var(--radius-control)] bg-paper p-3 text-[12.5px]">
          <dt className="font-medium">Webhook URL</dt>
          <dd className="break-all select-all"><code>{state.data.link}</code></dd>
          <dt className="mt-1 font-medium">Key</dt>
          <dd className="select-all"><code>{state.data.key}</code></dd>
        </dl>
      )}
    </form>
  );
}
