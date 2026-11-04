import { siteOrigin } from "@/lib/origin";
import { openApiDocument } from "@/modules/api/openapi";

/** The OpenAPI 3.1 description of /api/v1, generated from the zod schemas. */
export async function GET() {
  return Response.json(openApiDocument(await siteOrigin()), {
    headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" },
  });
}
