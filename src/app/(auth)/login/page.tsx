import { Suspense } from "react";
import { hostBrand } from "@/modules/branding/host";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

async function Form() {
  const brand = await hostBrand();
  return <LoginForm brandName={brand?.app_name ?? null} />;
}

export default function LoginPage() {
  return (
    <Suspense>
      <Form />
    </Suspense>
  );
}
