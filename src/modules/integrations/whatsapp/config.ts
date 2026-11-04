import "server-only";

/** Meta app settings (owned by Springs 360, see ADR 0002). All optional until WhatsApp is set up. */
export function metaConfig() {
  return {
    appId: process.env.META_APP_ID ?? "",
    appSecret: process.env.META_APP_SECRET ?? "",
    // Embedded Signup configuration id (Meta app dashboard → WhatsApp → Embedded Signup).
    configId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID ?? "",
    verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "",
    graphVersion: process.env.META_GRAPH_VERSION || "v23.0",
  };
}

export function embeddedSignupAvailable() {
  const c = metaConfig();
  return Boolean(c.appId && c.appSecret && c.configId);
}
