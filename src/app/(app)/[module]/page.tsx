import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModulePlaceholder } from "@/components/module-placeholder";
import { allNav, findNav } from "@/components/shell/nav-config";

/*
 * Catch-all for modules not built yet. When a sprint delivers a module it
 * gets its own folder (e.g. app/(app)/leads), which takes precedence over
 * this dynamic segment — no change needed here.
 */
export function generateStaticParams() {
  return allNav
    .filter((item) => item.href !== "/dashboard")
    .map((item) => ({ module: item.href.slice(1) }));
}

export async function generateMetadata({
  params,
}: PageProps<"/[module]">): Promise<Metadata> {
  const { module } = await params;
  return { title: findNav(`/${module}`)?.label };
}

export default async function ModulePage({ params }: PageProps<"/[module]">) {
  const { module } = await params;
  if (!findNav(`/${module}`)) notFound();
  return <ModulePlaceholder href={`/${module}`} />;
}
