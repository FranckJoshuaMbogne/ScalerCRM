import { createAnonClient } from "@/lib/supabase/anon";
import { createClient } from "@/lib/supabase/server";
import { isPlatformHost, requestHost } from "@/modules/branding/host";

type Asset = { content_type: string; data: string; sha256: string };

/** PostgREST returns bytea as "\x…" hex. */
function bytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex.replace(/^\\x/, ""), "hex"));
}

/**
 * A brand's logo or app icon. On a custom domain: that domain's business,
 * public (the sign-in page and the installed app need it). On SCALER's domain:
 * ?b=<business> for its members only. Falls back to SCALER's icon.
 */
export async function GET(request: Request, { params }: RouteContext<"/brand/[kind]">) {
  const { kind } = await params;
  if (kind !== "logo" && kind !== "icon") return new Response("not found", { status: 404 });
  const url = new URL(request.url);
  const host = await requestHost();
  let asset: Asset | null = null;

  if (!isPlatformHost(host)) {
    const { data } = await createAnonClient().rpc("brand_asset_for_host", { p_host: host, p_kind: kind });
    asset = ((data ?? []) as Asset[])[0] ?? null;
  } else {
    const business = url.searchParams.get("b");
    if (business && /^[0-9a-f-]{36}$/i.test(business)) {
      const supabase = await createClient();
      const { data } = await supabase.rpc("brand_asset", { p_business_id: business, p_kind: kind });
      asset = ((data ?? []) as Asset[])[0] ?? null;
    }
  }

  if (!asset) {
    return kind === "icon"
      ? Response.redirect(new URL("/icons/icon-512.png", url), 302)
      : new Response("not found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  const etag = `"${asset.sha256}"`;
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
  // Versioned URLs (?v=<hash>) never change; others are re-checked hourly.
  const immutable = url.searchParams.get("v") && asset.sha256.startsWith(url.searchParams.get("v")!);
  return new Response(Buffer.from(bytes(asset.data)), {
    headers: {
      "content-type": asset.content_type,
      etag,
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
      vary: "host",
    },
  });
}
