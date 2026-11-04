"use client";

import Link from "next/link";
import { startTransition, useActionState, useOptimistic, useState } from "react";
import { StatusBadge, type Stage } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { initialState } from "@/lib/forms";
import { cn } from "@/lib/utils";
import { changeLeadStatus } from "@/modules/leads/actions";
import { type BoardStatus, buildBoard, checkMove, type Transitions } from "@/modules/pipeline/board";

export type BoardCard = {
  id: string;
  statusId: string;
  leadNumber: string;
  customerName: string;
  title: string | null;
  expectedValue: string | null;
  ownerId: string | null;
  ownerName: string | null;
  followUp: { label: string; overdue: boolean } | null;
};

type Move = { leadId: string; statusId: string };

/**
 * Drag cards between stages on a desktop; on phones, each card has a
 * "Move to" picker instead. Moves show at once and roll back if the server refuses.
 */
export function Board({
  statuses,
  cards,
  transitions,
  lostReasons,
  currency,
  canEdit,
}: {
  statuses: BoardStatus[];
  cards: BoardCard[];
  transitions: Transitions;
  lostReasons: { value: string; label: string }[];
  currency: string;
  canEdit: boolean;
}) {
  const [optimistic, applyMove] = useOptimistic(cards, (state, move: Move) =>
    state.map((c) => (c.id === move.leadId ? { ...c, statusId: move.statusId } : c)),
  );
  const [state, dispatch] = useActionState(changeLeadStatus, initialState);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pendingLost, setPendingLost] = useState<{ card: BoardCard; status: BoardStatus } | null>(null);

  const name = (id: string) => statuses.find((s) => s.id === id)?.name ?? "this stage";
  const columns = buildBoard(statuses, optimistic);

  function send(move: Move, extra?: { lostReasonId: string; lostNote: string }) {
    const form = new FormData();
    form.set("leadId", move.leadId);
    form.set("statusId", move.statusId);
    if (extra) {
      form.set("lostReasonId", extra.lostReasonId);
      form.set("lostNote", extra.lostNote);
    }
    startTransition(() => {
      applyMove(move);
      dispatch(form);
    });
  }

  function tryMove(card: BoardCard, statusId: string) {
    const to = statuses.find((s) => s.id === statusId);
    if (!to) return;
    const check = checkMove(card, to, transitions, name);
    if (!check.ok) {
      if (card.statusId !== statusId) setNotice(check.reason);
      return;
    }
    setNotice(null);
    if (check.needsLostReason) setPendingLost({ card, status: to });
    else send({ leadId: card.id, statusId });
  }

  const error = !state.ok && state.message ? state.message : null;

  return (
    <>
      {(notice || error) && (
        <p role="alert" className="mb-3 rounded-[var(--radius-control)] bg-danger/10 px-3 py-2 text-[13.5px] text-danger">
          {notice ?? error}
        </p>
      )}

      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:snap-none lg:px-0">
        {columns.map(({ status, leads, total }) => (
          <section
            key={status.id}
            aria-label={`${status.name}: ${leads.length} leads`}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              setOver(status.id);
            }}
            onDragLeave={() => setOver((o) => (o === status.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              const card = optimistic.find((c) => c.id === e.dataTransfer.getData("text/plain"));
              setOver(null);
              setDragging(null);
              if (card) tryMove(card, status.id);
            }}
            className={cn(
              "flex w-[82vw] max-w-[300px] shrink-0 snap-start flex-col rounded-[var(--radius-panel)] border border-line bg-paper/60 sm:w-[280px]",
              over === status.id && "border-signal bg-signal-soft/40",
              !status.isActive && "opacity-70",
            )}
          >
            <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
              <StatusBadge stage={status.stage as Stage} name={status.name} />
              <span className="text-[12px] text-muted tabular-nums">
                {leads.length}
                {total !== "0.00" && ` · ${formatMoney(total, currency)}`}
              </span>
            </header>
            <ol className="flex min-h-24 flex-col gap-2 p-2">
              {leads.map((card) => (
                <li
                  key={card.id}
                  draggable={canEdit}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", card.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(card.id);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  className={cn(
                    "rounded-[var(--radius-control)] border border-line bg-surface p-3 text-[13px] shadow-sm",
                    canEdit && "cursor-grab active:cursor-grabbing",
                    dragging === card.id && "opacity-50",
                  )}
                >
                  <Link href={`/leads/${card.id}`} className="block font-medium hover:text-signal">
                    {card.customerName}
                  </Link>
                  <p className="truncate text-[12px] text-muted">
                    {card.leadNumber}
                    {card.title ? ` · ${card.title}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                    <span className={card.ownerName ? "text-muted" : "font-medium text-stage-negotiation"}>
                      {card.ownerName ?? "Unassigned"}
                    </span>
                    {card.followUp && (
                      <span className={card.followUp.overdue ? "font-medium text-danger" : "text-muted"}>
                        · {card.followUp.label}
                      </span>
                    )}
                  </div>
                  {canEdit && (
                    <label className="mt-2 block lg:hidden">
                      <span className="sr-only">Move {card.leadNumber} to</span>
                      <select
                        value=""
                        onChange={(e) => e.target.value && tryMove(card, e.target.value)}
                        className="h-8 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[12.5px]"
                      >
                        <option value="">Move to…</option>
                        {statuses
                          .filter((s) => s.isActive && s.id !== card.statusId)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      {pendingLost && (
        <LostDialog
          card={pendingLost.card}
          status={pendingLost.status}
          reasons={lostReasons}
          onCancel={() => setPendingLost(null)}
          onConfirm={(lostReasonId, lostNote) => {
            send({ leadId: pendingLost.card.id, statusId: pendingLost.status.id }, { lostReasonId, lostNote });
            setPendingLost(null);
          }}
        />
      )}
    </>
  );
}

function LostDialog({
  card,
  status,
  reasons,
  onCancel,
  onConfirm,
}: {
  card: BoardCard;
  status: BoardStatus;
  reasons: { value: string; label: string }[];
  onCancel: () => void;
  onConfirm: (reasonId: string, note: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-ink/40 p-4 sm:place-items-center" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lost-title"
        className="w-full max-w-md rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      >
        <h2 id="lost-title" className="text-[15px] font-semibold">
          Move {card.leadNumber} to {status.name}
        </h2>
        <p className="mt-1 text-[13px] text-muted">Why was {card.customerName} lost? This feeds your lost-reason reports.</p>
        <label className="mt-4 block text-[13px] font-medium" htmlFor="board-lost-reason">Reason</label>
        <select
          id="board-lost-reason"
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1.5 h-10 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[14px]"
        >
          <option value="">Choose a reason</option>
          {reasons.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <label className="mt-3 block text-[13px] font-medium" htmlFor="board-lost-note">Note</label>
        <textarea
          id="board-lost-note"
          rows={2}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional"
          className="mt-1.5 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-[14px]"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-10 rounded-[var(--radius-control)] px-4 text-[14px] text-muted hover:bg-paper">
            Keep it open
          </button>
          <button
            type="button"
            disabled={!reason}
            onClick={() => onConfirm(reason, note)}
            className="h-10 rounded-[var(--radius-control)] bg-danger px-4 text-[14px] font-medium text-white disabled:opacity-50"
          >
            Mark as lost
          </button>
        </div>
      </div>
    </div>
  );
}

