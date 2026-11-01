import { Lock } from "lucide-react";
import { Panel } from "./primitives";

export function NoAccess({ what }: { what: string }) {
  return (
    <Panel className="flex flex-col items-start gap-2 p-8">
      <Lock className="size-5 text-muted" />
      <p className="text-[15px] font-medium">You don&apos;t have access to {what}</p>
      <p className="text-[14px] text-muted">Ask a business admin to change your role if you need it.</p>
    </Panel>
  );
}
