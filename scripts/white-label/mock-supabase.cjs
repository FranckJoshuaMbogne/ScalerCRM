/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run by scripts/white-label-check.sh */
// Stand-in for Supabase's REST API: two tenants with active custom domains.
const http = require("http");
const brands = {
  "crm.alpha.test": { business_id: "aaaaaaaa-0000-0000-0000-000000000001", app_name: "Alpha CRM", short_name: "Alpha", primary_color: "#7a1f5c", sidebar_color: "#1d1230",
    support_email: "help@alpha.test", support_phone: null, signin_headline: "Welcome to Alpha", signin_tagline: null, powered_by: false,
    logo: "aaaa1111bbbb2222", icon: "aaaa1111bbbb2222", branded: true },
  "desk.beta.test": { business_id: "bbbbbbbb-0000-0000-0000-000000000002", app_name: "Beta Desk", short_name: "Beta", primary_color: "#0b6e4f", sidebar_color: "#0e1b33",
    support_email: null, support_phone: null, signin_headline: null, signin_tagline: null, powered_by: true, logo: null, icon: null, branded: true },
};
const png = "\\x89504e470d0a1a0a" + "00".repeat(64);
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const args = body ? JSON.parse(body) : {};
    res.setHeader("content-type", "application/json");
    if (req.url.startsWith("/rest/v1/rpc/brand_for_host")) return res.end(JSON.stringify(brands[args.p_host] ?? null));
    if (req.url.startsWith("/rest/v1/rpc/brand_asset_for_host")) {
      const b = brands[args.p_host];
      return res.end(JSON.stringify(b && b.icon ? [{ content_type: "image/png", data: png, sha256: b.icon }] : []));
    }
    if (req.url.startsWith("/auth/v1/user")) { res.statusCode = 401; return res.end(JSON.stringify({ message: "no session" })); }
    res.end("null");
  });
}).listen(54321, "127.0.0.1", () => console.log("mock up"));
