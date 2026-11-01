"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { signUp } from "@/modules/auth/actions";

export function SignupForm() {
  const next = useSearchParams().get("next") ?? "";
  const [state, action] = useActionState(signUp, initialState);

  if (state.ok) {
    return (
      <>
        <h1 className="text-[24px] font-semibold tracking-tight">Check your email</h1>
        <p className="mt-2 text-[14px] text-muted">{state.message}</p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-[24px] font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1 mb-6 text-[14px] text-muted">
        Already have one?{" "}
        <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-signal hover:underline">
          Sign in
        </Link>
      </p>
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <Field label="Full name" name="fullName" autoComplete="name" required state={state} />
        <Field label="Work email" name="email" type="email" autoComplete="email" required state={state} />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          hint="At least 8 characters."
          state={state}
        />
        <FormMessage state={state} />
        <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
      </form>
      <p className="mt-4 text-[12.5px] text-muted">
        Joining a team? Use the email address your invitation was sent to.
      </p>
    </>
  );
}
