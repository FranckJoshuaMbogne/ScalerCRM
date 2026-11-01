import { Suspense } from "react";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
