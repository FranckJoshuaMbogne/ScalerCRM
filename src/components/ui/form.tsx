"use client";

import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/forms";

const control =
  "h-10 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[14px] text-text placeholder:text-muted/70 focus:border-signal focus:outline-none aria-[invalid=true]:border-danger";

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  hint?: string;
  state?: ActionState;
};

export function Field({ label, name, hint, state, className, id, ...props }: FieldProps) {
  const error = state?.fieldErrors?.[name];
  const echoed = props.value === undefined && props.defaultValue === undefined ? state?.values?.[name] : undefined;
  const inputId = id ?? `f-${name}`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={inputId} className="text-[13px] font-medium">
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${inputId}-note` : undefined}
        className={control}
        {...(echoed !== undefined ? { defaultValue: echoed } : {})}
        {...props}
      />
      {(error || hint) && (
        <p id={`${inputId}-note`} className={cn("text-[12.5px]", error ? "text-danger" : "text-muted")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  name: string;
  hint?: string;
  state?: ActionState;
};

export function TextAreaField({ label, name, hint, state, className, id, ...props }: TextAreaProps) {
  const error = state?.fieldErrors?.[name];
  const echoed = props.value === undefined && props.defaultValue === undefined ? state?.values?.[name] : undefined;
  const inputId = id ?? `f-${name}`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={inputId} className="text-[13px] font-medium">
        {label}
      </label>
      <textarea
        id={inputId}
        name={name}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${inputId}-note` : undefined}
        className={cn(control, "h-auto min-h-20 py-2 leading-snug")}
        {...(echoed !== undefined ? { defaultValue: echoed } : {})}
        {...props}
      />
      {(error || hint) && (
        <p id={`${inputId}-note`} className={cn("text-[12.5px]", error ? "text-danger" : "text-muted")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  name: string;
  state?: ActionState;
  options: { value: string; label: string }[];
};

export function SelectField({ label, name, state, options, className, id, ...props }: SelectProps) {
  const error = state?.fieldErrors?.[name];
  const echoed = props.value === undefined && props.defaultValue === undefined ? state?.values?.[name] : undefined;
  const inputId = id ?? `f-${name}`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={inputId} className="text-[13px] font-medium">
        {label}
      </label>
      <select
        id={inputId}
        name={name}
        aria-invalid={error ? true : undefined}
        className={control}
        {...(echoed !== undefined ? { defaultValue: echoed } : {})}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
    </div>
  );
}

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || props.disabled}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 text-[14px] font-medium transition-colors disabled:opacity-60",
        variant === "primary" && "bg-signal text-white hover:bg-signal-strong",
        variant === "secondary" && "border border-line bg-surface hover:bg-paper",
        variant === "danger" && "border border-line bg-surface text-danger hover:bg-paper",
        variant === "ghost" && "h-8 px-2 text-[13px] text-muted hover:bg-paper hover:text-text",
        className,
      )}
      {...props}
    >
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={cn(
        "rounded-[var(--radius-control)] px-3 py-2 text-[13.5px]",
        state.ok ? "bg-signal-soft text-text" : "bg-danger/10 text-danger",
      )}
    >
      {state.message}
    </p>
  );
}
