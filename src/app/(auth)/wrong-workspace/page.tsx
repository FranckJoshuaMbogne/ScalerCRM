import { Suspense } from "react";
import { hostBrand } from "@/modules/branding/host";
import { getUser } from "@/modules/tenancy/session";

export const metadata = { title: "Wrong workspace" };

async function Message() {
  const [user, brand] = await Promise.all([getUser(), hostBrand()]);
  const name = brand?.app_name ?? "this workspace";
  return (
    <>
      <h1 className="text-[22px] font-semibold">This account isn&apos;t part of {name}</h1>
      <p className="mt-2 text-[14px] text-muted">
        {user ? <>You&apos;re signed in as <strong className="font-medium text-text">{user.email}</strong>. </> : null}
        Sign out, then sign in with the account your {name} admin invited.
        {brand?.support_email ? <> Questions: <a className="text-signal hover:underline" href={`mailto:${brand.support_email}`}>{brand.support_email}</a>.</> : null}
      </p>
      <form action="/auth/signout" method="post" className="mt-6">
        <button type="submit" className="inline-flex h-10 items-center rounded-[var(--radius-control)] bg-signal px-4 text-[14px] font-medium text-white hover:bg-signal-strong">
          Sign out
        </button>
      </form>
    </>
  );
}

/** Shown on a business's own domain to someone signed in who isn't a member there. */
export default function WrongWorkspacePage() {
  return (
    <Suspense fallback={null}>
      <Message />
    </Suspense>
  );
}
