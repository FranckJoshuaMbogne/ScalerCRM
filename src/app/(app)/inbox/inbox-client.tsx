"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/forms";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  addNote,
  assignConversation,
  markConversationRead,
  sendReply,
  setConversationStatus,
  setLabels,
} from "@/modules/inbox/actions";

/** Refreshes the inbox when conversations or messages change (Supabase Realtime; RLS filters the stream). */
export function InboxLive({ businessId, openId, unread }: { businessId: string; openId: string | null; unread: number }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const bump = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 400);
    };
    const channel = supabase
      .channel(`inbox:${businessId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `business_id=eq.${businessId}` }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `business_id=eq.${businessId}` }, bump)
      .subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [businessId, router]);

  useEffect(() => {
    if (openId && unread > 0) void markConversationRead(openId);
  }, [openId, unread]);

  // Keep the newest message in view.
  useEffect(() => {
    document.getElementById("thread-end")?.scrollIntoView({ block: "end" });
  });
  return null;
}

export function Composer({ conversationId, canReply, windowOpen }: { conversationId: string; canReply: boolean; windowOpen: boolean }) {
  const [mode, setMode] = useState<"reply" | "note">(canReply && windowOpen ? "reply" : "note");
  const [replyState, reply] = useActionState(sendReply, initialState);
  const [noteState, note] = useActionState(addNote, initialState);
  const state = mode === "reply" ? replyState : noteState;
  const replyBlocked = mode === "reply" && (!canReply || !windowOpen);
  return (
    <form action={mode === "reply" ? reply : note} className="flex flex-col gap-2 border-t border-line bg-surface p-3">
      <input type="hidden" name="conversationId" value={conversationId} />
      <div className="flex gap-1 text-[12.5px]">
        {(["reply", "note"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className="rounded-full px-2.5 py-1 text-muted aria-pressed:bg-paper aria-pressed:font-medium aria-pressed:text-text"
          >
            {m === "reply" ? "WhatsApp reply" : "Internal note"}
          </button>
        ))}
      </div>
      {replyBlocked ? (
        <p className="rounded-[var(--radius-control)] bg-paper px-3 py-2 text-[13px] text-muted">
          {!canReply
            ? "Your role can read conversations but not reply."
            : "The 24-hour window has closed. WhatsApp only allows approved template messages until the customer writes again (templates arrive with campaigns)."}
        </p>
      ) : (
        <div className="flex items-end gap-2">
          <label className="sr-only" htmlFor="composer">{mode === "reply" ? "Reply" : "Note"}</label>
          <textarea
            id="composer"
            key={mode}
            name="body"
            rows={2}
            maxLength={mode === "reply" ? 4096 : 4000}
            defaultValue={state.ok ? "" : (state.values?.body ?? "")}
            placeholder={mode === "reply" ? "Type a reply…" : "Only your team sees notes"}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
            }}
            className={cn(
              "min-h-[44px] flex-1 resize-y rounded-[var(--radius-control)] border border-line px-3 py-2 text-[14px] focus:border-signal focus:outline-none",
              mode === "note" ? "bg-stage-negotiation/10" : "bg-surface",
            )}
          />
          <SubmitButton pendingLabel="…">{mode === "reply" ? "Send" : "Add note"}</SubmitButton>
        </div>
      )}
      {state.message && !state.ok && <FormMessage state={state} />}
    </form>
  );
}

export function ConversationControls({
  conversationId,
  assigneeId,
  status,
  labels,
  people,
  canAssignOthers,
  me,
}: {
  conversationId: string;
  assigneeId: string | null;
  status: "open" | "closed";
  labels: string[];
  people: { value: string; label: string }[];
  canAssignOthers: boolean;
  me: string;
}) {
  const [assignState, assign] = useActionState(assignConversation, initialState);
  const [statusState, setStatus] = useActionState(setConversationStatus, initialState);
  const [labelState, saveLabels] = useActionState(setLabels, initialState);
  const message = [assignState, statusState, labelState].find((s) => s.message && !s.ok);
  const options = canAssignOthers ? people : people.filter((p) => p.value === me || p.value === assigneeId);
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <form action={assign} className="flex items-center gap-1.5">
          <input type="hidden" name="conversationId" value={conversationId} />
          <label htmlFor="assignee" className="text-muted">Assigned to</label>
          <select
            id="assignee"
            name="assigneeId"
            defaultValue={assigneeId ?? ""}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="h-8 rounded-[var(--radius-control)] border border-line bg-surface px-2"
          >
            <option value="">Nobody</option>
            {options.map((p) => (
              <option key={p.value} value={p.value}>{p.value === me ? `${p.label} (me)` : p.label}</option>
            ))}
          </select>
        </form>
        <form action={setStatus}>
          <input type="hidden" name="conversationId" value={conversationId} />
          <input type="hidden" name="status" value={status === "open" ? "closed" : "open"} />
          <SubmitButton variant="ghost">{status === "open" ? "Close" : "Reopen"}</SubmitButton>
        </form>
      </div>
      <form action={saveLabels} className="flex items-center gap-1.5">
        <input type="hidden" name="conversationId" value={conversationId} />
        <label htmlFor="labels" className="text-muted">Labels</label>
        <input
          id="labels"
          name="labels"
          defaultValue={labels.join(", ")}
          placeholder="wedding, urgent"
          list="label-suggestions"
          className="h-8 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-2"
        />
        <SubmitButton variant="ghost">Save</SubmitButton>
      </form>
      {message && <FormMessage state={message} />}
    </div>
  );
}
