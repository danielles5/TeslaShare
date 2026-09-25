"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import type { Possession } from "@/lib/types";
import { name } from "@/lib/format";
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const heading = useId();
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),textarea,select,[tabindex="0"]',
          ) || [],
        );
        const first = items[0],
          last = items.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = scroll;
      document.removeEventListener("keydown", handler);
      old?.focus();
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={heading}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="handle" />
        <header className="sheet-header">
          <h2 id={heading}>{title}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={21} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export function Field({
  label,
  value,
  onChange,
  suffix,
  type = "number",
  required = false,
  min = "0",
  step = "any",
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  suffix?: string;
  type?: string;
  required?: boolean;
  min?: string;
  step?: string;
}) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <div className="input-wrap">
        <input
          id={id}
          aria-label={label}
          type={type}
          inputMode={type === "number" ? "decimal" : undefined}
          value={value}
          min={type === "number" ? min : undefined}
          step={type === "number" ? step : undefined}
          required={required}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
        {suffix && <span>{suffix}</span>}
      </div>
    </label>
  );
}
export function People({
  value,
  onChange,
  guest,
  onGuest,
  payer = false,
}: {
  value: string;
  onChange: (s: Possession) => void;
  guest: string;
  onGuest: (s: string) => void;
  payer?: boolean;
}) {
  return (
    <div className="field">
      <span>{payer ? "Who paid?" : "Who has the car?"}</span>
      <div className={`people ${payer ? "three" : ""}`}>
        {(payer
          ? ["danielle", "maya", "guest"]
          : ["danielle", "maya", "shared", "guest"]
        ).map((p) => (
          <button
            type="button"
            className={value === p ? "selected" : ""}
            aria-pressed={value === p}
            key={p}
            onClick={() => onChange(p as Possession)}
          >
            {name(p)}
          </button>
        ))}
      </div>
      {value === "guest" && (
        <Field
          label={payer ? "Payer name" : "Guest name"}
          type="text"
          value={guest}
          onChange={onGuest}
          required
        />
      )}
    </div>
  );
}
export function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
export function DemoBadge() {
  return <span className="demo-badge">DEMO</span>;
}
