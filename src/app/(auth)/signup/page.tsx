import { redirect } from "next/navigation";
import { Suspense } from "react";
import { hostBrand } from "@/modules/branding/host";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Create account" };

/** Self-serve sign-up is SCALER's: a business's own domain only lets its invited team in. */
async function Form() {
  if (await hostBrand()) redirect("/login");
  return <SignupForm />;
}

export default function SignupPage() {
  return (
    <Suspense>
      <Form />
    </Suspense>
  );
}
