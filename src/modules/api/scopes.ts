/** API key scopes. The database list is private.api_scopes(). */
export const API_SCOPES = [
  { key: "leads:write", label: "Create and update leads", hint: "Website forms need only this one." },
  { key: "leads:read", label: "Read leads", hint: "" },
  { key: "customers:read", label: "Read customers", hint: "" },
  { key: "orders:read", label: "Read orders and payments", hint: "" },
  { key: "orders:write", label: "Create and update orders", hint: "" },
  { key: "tasks:write", label: "Create tasks", hint: "" },
  { key: "webhooks:manage", label: "Manage webhook endpoints", hint: "" },
] as const;

export type ApiScope = (typeof API_SCOPES)[number]["key"];

export const API_SCOPE_KEYS = API_SCOPES.map((s) => s.key) as [ApiScope, ...ApiScope[]];
