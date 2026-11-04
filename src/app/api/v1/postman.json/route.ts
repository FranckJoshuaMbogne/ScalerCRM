import { siteOrigin } from "@/lib/origin";
import { postmanCollection } from "@/modules/api/postman";

/** A Postman (v2.1) collection of /api/v1, generated from the OpenAPI operations. */
export async function GET() {
  return Response.json(postmanCollection(await siteOrigin()), {
    headers: {
      "cache-control": "public, max-age=300",
      "content-disposition": 'attachment; filename="scaler-api.postman_collection.json"',
    },
  });
}
