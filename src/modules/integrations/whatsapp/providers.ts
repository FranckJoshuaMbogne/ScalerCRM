import "server-only";
import { dialog360 } from "./dialog360";
import { metaCloud } from "./meta-cloud";
import type { MessagingProvider } from "./provider";

export function providerFor(name: string | null | undefined): MessagingProvider {
  return name === "dialog360" ? dialog360 : metaCloud;
}
