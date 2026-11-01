import Link from "next/link";
import { Suspense } from "react";
import { Wordmark } from "@/components/shell/wordmark";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/modules/tenancy/session";
import { AcceptForm } from "./accept-form";

export const metadata = { title: "Invitation" };

type Invitation = { business_name: string; role_name: string; email: string; status: string };

async function InvitationCard({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_invitation", { p_token: token });
  const invite = (data as Invitation[] | null)?.[0];
  const user = await getUser();
  const here = `/invite/${token}`;

  if (!invite || invite.status !== "pending") {
    const reason =
      invite?.status === "expired"
        ? "This invitation has expired."
        : invite?.status === "accepted"
          ? "This invitation has already been used."
          : "This invitation link isn't valid any more.";
    return (
      <>
        <h1 className="text-[22px] font-semibold">{reason}</h1>
        <p className="mt-2 text-[14px] text-muted">Ask the person who invited you to send a new link.</p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-[22px] font-semibold tracking-tight">Join {invite.business_name}</h1>
      <p className="mt-2 text-[14px] text-muted">
        You&apos;ve been invited as <span className="font-medium text-text">{invite.role_name}</span>. This
        invitation is for <span className="font-medium text-text">{invite.email}</span>.
      </p>

      {user ? (
        user.email?.toLowerCase() === invite.email.toLowerCase() ? (
          <AcceptForm token={token} />
        ) : (
          <div className="mt-6 rounded-[var(--radius-control)] bg-danger/10 px-3 py-2 text-[13.5px] text-danger">
            You&apos;re signed in as {user.email}. Sign out and sign in with {invite.email} to accept.
            <form action="/auth/signout" method="post" className="mt-2">
              <button className="font-medium underline">Sign out</button>
            </form>
          </div>
        )
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          <Link
            href={`/signup?next=${encodeURIComponent(here)}`}
            className="inline-flex h-10 items-center justify-center rounded-[var(--radius-control)] bg-signal px-4 text-[14px] font-medium text-white hover:bg-signal-strong"
          >
            Create an account to join
          </Link>
          <Link
            href={`/login?next=${encodeURIComponent(here)}`}
            className="inline-flex h-10 items-center justify-center rounded-[var(--radius-control)] border border-line px-4 text-[14px] font-medium hover:bg-paper"
          >
            I already have an account
          </Link>
        </div>
      )}
    </>
  );
}

export default function InvitePage(props: PageProps<"/invite/[token]">) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-12">
      <Wordmark tone="dark" className="mb-10" />
      <Suspense fallback={<p className="text-[14px] text-muted">Checking your invitation…</p>}>
        <InvitationCard params={props.params} />
      </Suspense>
    </main>
  );
}
