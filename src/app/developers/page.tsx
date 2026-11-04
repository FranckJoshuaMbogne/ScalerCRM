import Link from "next/link";
import { OPERATIONS } from "@/modules/api/openapi";
import { API_SCOPES } from "@/modules/api/scopes";
import { WEBHOOK_EVENTS } from "@/modules/webhooks/events";
import { VERIFY_SAMPLE_NODE, VERIFY_SAMPLE_PYTHON } from "@/modules/webhooks/samples";

export const metadata = {
  title: "API reference",
  description: "SCALER's REST API and webhooks for partners and developers.",
};

const TAGS = ["Customers", "Leads", "Orders", "Payments", "Tasks", "Webhooks"];

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-[var(--radius-control)] border border-line bg-paper p-3 text-[12.5px] leading-relaxed">
      {children}
    </pre>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-10 scroll-mt-6">
      <h2 className="mb-3 text-[18px] font-semibold">{title}</h2>
      <div className="space-y-3 text-[14px] leading-relaxed">{children}</div>
    </section>
  );
}

/** Public reference for /api/v1. The tables come from the same operation list as the OpenAPI document. */
export default function DevelopersPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <p className="text-[12px] font-semibold tracking-[0.08em]">SCALER</p>
      <h1 className="mt-1 text-[26px] font-semibold">API reference</h1>
      <p className="mt-2 text-[15px] text-muted">
        Read and write a business&apos;s customers, leads, orders, payments and tasks, and get signed webhooks when things change.
      </p>
      <p className="mt-4 flex flex-wrap gap-4 text-[14px]">
        <a href="/api/v1/openapi.json" className="text-signal hover:underline">OpenAPI 3.1 document</a>
        <a href="/api/v1/postman.json" className="text-signal hover:underline">Postman collection</a>
        <Link href="/settings/api-keys" className="text-signal hover:underline">Make an API key</Link>
      </p>

      <Section id="auth" title="Keys and scopes">
        <p>
          A business admin makes keys in Settings → API keys and chooses what each key may do. Send the key from your server as{" "}
          <code>Authorization: Bearer sk_live_…</code>. A key only ever sees its own business.
        </p>
        <table className="w-full text-left text-[13.5px]">
          <tbody className="divide-y divide-line">
            {API_SCOPES.map((s) => (
              <tr key={s.key}>
                <td className="py-1.5 pr-4"><code>{s.key}</code></td>
                <td className="py-1.5">{s.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section id="conventions" title="Conventions">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Base URL <code>/api/v1</code>. /v1 is stable: breaking changes only come in /v2, announced 6 months ahead.</li>
          <li>Times are ISO 8601 with an offset. Money is a decimal string, e.g. <code>&quot;1250.00&quot;</code>, never a float.</li>
          <li>
            Lists return <code>{"{ data, has_more, next_cursor }"}</code>, oldest change first. Pass <code>?cursor=</code> for the next
            page (<code>limit</code> up to 100) and <code>?updated_since=</code> to sync only what changed.
          </li>
          <li>
            Every write takes an <code>Idempotency-Key</code> header. A retry with the same key returns the first answer and never
            writes twice; the same key with a different request gets <code>409</code>.
          </li>
          <li>
            Each answer has <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code> and <code>X-RateLimit-Reset</code>{" "}
            (seconds). Over the plan&apos;s limit you get <code>429</code> with <code>Retry-After</code>.
          </li>
          <li>
            Errors are <code>{"{ error, message, details }"}</code>: <code>401 invalid_api_key</code>,{" "}
            <code>403 insufficient_scope</code>, <code>403 business_read_only</code>, <code>404 not_found</code>,{" "}
            <code>422 invalid_request</code>.
          </li>
        </ul>
      </Section>

      <Section id="endpoints" title="Endpoints">
        {TAGS.map((tag) => (
          <div key={tag} className="mt-4">
            <h3 className="mb-1 text-[15px] font-semibold">{tag}</h3>
            <table className="w-full text-left text-[13.5px]">
              <tbody className="divide-y divide-line">
                {OPERATIONS.filter((o) => o.tag === tag).map((o) => (
                  <tr key={o.operationId} className="align-top">
                    <td className="w-[70px] py-1.5 font-mono text-[12.5px] font-semibold">{o.method.toUpperCase()}</td>
                    <td className="py-1.5 pr-4 font-mono text-[12.5px]">{o.path}</td>
                    <td className="py-1.5 pr-4">
                      {o.summary}
                      {o.description && <span className="block text-[12.5px] text-muted">{o.description}</span>}
                    </td>
                    <td className="py-1.5 text-[12.5px] whitespace-nowrap text-muted">{o.scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <p className="text-muted">Field-by-field schemas are in the OpenAPI document.</p>
        <Code>{`curl ${"$"}SCALER/api/v1/orders?stage=ready&limit=20 \\
  -H "Authorization: Bearer $SCALER_KEY"

curl -X PATCH ${"$"}SCALER/api/v1/orders/<id> \\
  -H "Authorization: Bearer $SCALER_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: 9f6c2f8e-…" \\
  -d '{"stage": "delivered"}'`}</Code>
      </Section>

      <Section id="webhooks" title="Webhooks">
        <p>
          Add endpoints in Settings → Webhooks or through <code>/api/v1/webhooks</code>. Each event is a JSON POST:
        </p>
        <Code>{`POST /your-endpoint
Content-Type: application/json
Scaler-Event: order.stage_changed
Scaler-Delivery: whd_1042
Scaler-Signature: t=1779000000,v1=5f0c…

{ "id": "evt_981", "object": "event", "type": "order.stage_changed", "api_version": "v1",
  "created_at": "2027-05-20T11:02:07.51+05:30", "business_id": "…",
  "data": { "order": { … }, "from_stage": "in_production", "to_stage": "ready" } }`}</Code>
        <table className="w-full text-left text-[13.5px]">
          <tbody className="divide-y divide-line">
            {WEBHOOK_EVENTS.map((e) => (
              <tr key={e.type}>
                <td className="py-1.5 pr-4"><code>{e.type}</code></td>
                <td className="py-1.5">{e.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Answer 2xx within 10 seconds. Anything else is retried after 1, 5 and 30 minutes, then 2, 5 and 10 hours, for up to 24 hours.</li>
          <li>Redirects are not followed. The same event can arrive twice: use the event <code>id</code> to ignore repeats.</li>
          <li>After 20 failed deliveries in a row the endpoint is switched off and the business&apos;s admins are emailed.</li>
          <li>Every delivery is in the delivery log for 30 days and can be replayed from there.</li>
        </ul>
        <h3 className="pt-2 text-[15px] font-semibold">Checking the signature</h3>
        <p>
          The signature is an HMAC-SHA256 of <code>&lt;t&gt;.&lt;raw body&gt;</code> with the endpoint&apos;s signing secret. Use the body
          exactly as received, before parsing it, and refuse timestamps more than 5 minutes old.
        </p>
        <p className="font-medium">Node.js</p>
        <Code>{VERIFY_SAMPLE_NODE}</Code>
        <p className="font-medium">Python</p>
        <Code>{VERIFY_SAMPLE_PYTHON}</Code>
      </Section>
    </main>
  );
}
