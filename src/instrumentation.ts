import type { Instrumentation } from "next";

/** Server errors go to Sentry when SENTRY_DSN is set (src/lib/monitoring.ts). */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("@/lib/monitoring");
  await reportError(err, {
    route: context.routePath,
    route_type: context.routeType,
    method: request.method,
    path: request.path.split("?")[0],
  });
};
