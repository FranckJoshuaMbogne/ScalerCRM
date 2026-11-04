import { OPERATIONS } from "./openapi";

/** Postman collection (format 2.1) with every operation, ready to import. */
export function postmanCollection(origin: string) {
  const tags = [...new Set(OPERATIONS.map((o) => o.tag))];
  return {
    info: {
      name: "SCALER API v1",
      description: "Set the apiKey variable to a key from Settings → API keys. Reference: /developers",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    auth: { type: "bearer", bearer: [{ key: "token", value: "{{apiKey}}", type: "string" }] },
    variable: [
      { key: "baseUrl", value: `${origin}/api/v1` },
      { key: "apiKey", value: "" },
      { key: "id", value: "" },
    ],
    item: tags.map((tag) => ({
      name: tag,
      item: OPERATIONS.filter((o) => o.tag === tag).map((op) => {
        const path = op.path.replace("{id}", "{{id}}");
        const headers = [{ key: "Accept", value: "application/json" }];
        if (op.body) headers.push({ key: "Content-Type", value: "application/json" });
        if (op.kind === "write") headers.push({ key: "Idempotency-Key", value: "{{$guid}}" });
        return {
          name: op.summary,
          request: {
            method: op.method.toUpperCase(),
            header: headers,
            url: {
              raw: `{{baseUrl}}${path}`,
              host: ["{{baseUrl}}"],
              path: path.split("/").filter(Boolean),
              ...(op.kind === "list" ? { query: [{ key: "limit", value: "50", disabled: true }, { key: "updated_since", value: "", disabled: true }] } : {}),
            },
            ...(op.body ? { body: { mode: "raw", raw: JSON.stringify(op.example ?? {}, null, 2), options: { raw: { language: "json" } } } } : {}),
            description: `Scope: ${op.scope}`,
          },
        };
      }),
    })),
  };
}
