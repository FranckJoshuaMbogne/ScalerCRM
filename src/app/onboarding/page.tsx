import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Wordmark } from "@/components/shell/wordmark";
import { getMemberships, getUser } from "@/modules/tenancy/session";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Set up your business" };

async function Gate({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  if (!(await getUser())) redirect("/login?next=/onboarding");
  const { new: addAnother } = await searchParams;
  const memberships = await getMemberships();
  if (memberships.length > 0 && !addAnother) redirect("/dashboard");
  return (
    <>
      {memberships.length > 0 && (
        <Link href="/dashboard" className="mb-6 inline-block text-[13.5px] text-signal hover:underline">
          Back to {memberships[0].businessName}
        </Link>
      )}
      <OnboardingForm />
    </>
  );
}

export default function OnboardingPage(props: PageProps<"/onboarding">) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-12">
      <Wordmark tone="dark" className="mb-10" />
      <h1 className="text-[24px] font-semibold tracking-tight">Set up your business</h1>
      <p className="mt-1 mb-8 text-[14px] text-muted">
        You&apos;ll be its admin. You can add more branches and invite your team next.
      </p>
      <Suspense>
        <Gate searchParams={props.searchParams as Promise<{ new?: string }>} />
      </Suspense>
    </main>
  );
}
