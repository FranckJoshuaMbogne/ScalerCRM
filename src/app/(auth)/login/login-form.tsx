"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { sendMagicLink, signIn } from "@/modules/auth/actions";

export function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "";
  const linkError = params.get("error") === "link";
  const [mode, setMode] = useState<"password" | "link">("password");
  const [pwState, pwAction] = useActionState(signIn, initialState);
  const [linkState, linkAction] = useActionState(sendMagicLink, initialState);

  return (
    <>
      <h1 className="text-[24px] font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 mb-6 text-[14px] text-muted">
        New to SCALER?{" "}
        <Link href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-signal hover:underline">
          Create an account
        </Link>
      </p>

      {linkError && (
        <p role="alert" className="mb-4 rounded-[var(--radius-control)] bg-danger/10 px-3 py-2 text-[13.5px] text-danger">
          That link has expired or was already used. Sign in below or request a new link.
        </p>
      )}

      {mode === "password" ? (
        <form action={pwAction} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          <Field label="Email" name="email" type="email" autoComplete="email" required state={pwState} />
          <Field label="Password" name="password" type="password" autoComplete="current-password" required state={pwState} />
          <FormMessage state={pwState} />
          <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
        </form>
      ) : (
        <form action={linkAction} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          <Field label="Email" name="email" type="email" autoComplete="email" required state={linkState} />
          <FormMessage state={linkState} />
          <SubmitButton pendingLabel="Sending…">Email me a sign-in link</SubmitButton>
        </form>
      )}

      <button
        type="button"
        onClick={() => setMode(mode === "password" ? "link" : "password")}
        className="mt-4 text-[13.5px] font-medium text-signal hover:underline"
      >
        {mode === "password" ? "Sign in with an email link instead" : "Sign in with a password instead"}
      </button>
    </>
  );
}
