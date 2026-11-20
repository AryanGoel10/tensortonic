import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({ variant = "secondary", size = "md", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-black text-white hover:bg-neutral-800",
        variant === "secondary" && "border border-border bg-white text-black hover:bg-neutral-50",
        variant === "ghost" && "text-neutral-700 hover:bg-neutral-100",
        variant === "danger" && "border border-red-200 bg-white text-red-700 hover:bg-red-50",
        className,
      )}
    />
  );
}

const STATUS_STYLES: Record<string, string> = {
  Researching: "bg-blue-50 text-blue-700 border-blue-200",
  Drafted: "bg-neutral-100 text-neutral-800 border-neutral-200",
  "Needs review": "bg-amber-50 text-amber-800 border-amber-200",
  Approved: "bg-emerald-50 text-accent-ink border-emerald-200",
  Queued: "bg-violet-50 text-violet-700 border-violet-200",
  Emailed: "bg-accent text-white border-accent",
  Failed: "bg-red-50 text-red-700 border-red-200",
  Rejected: "bg-neutral-50 text-neutral-500 border-neutral-200 line-through",
  Skipped: "bg-neutral-50 text-neutral-500 border-neutral-200",
};

export function Badge({ children, tone, className }: { children: ReactNode; tone?: string; className?: string }) {
  const style = (tone && STATUS_STYLES[tone]) || "bg-neutral-50 text-neutral-700 border-neutral-200";
  return <span className={clsx("inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium", style, className)}>{children}</span>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("rounded-lg border border-border bg-white", className)}>{children}</div>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  return (
    <div
      className={clsx(
        "rounded-md border px-3 py-2 text-sm",
        tone === "info" && "border-neutral-200 bg-neutral-50 text-neutral-800",
        tone === "warn" && "border-amber-200 bg-amber-50 text-amber-900",
        tone === "error" && "border-red-200 bg-red-50 text-red-800",
        tone === "ok" && "border-emerald-200 bg-emerald-50 text-accent-ink",
      )}
    >
      {children}
    </div>
  );
}

export function Counter({ value, max }: { value: number; max: number }) {
  return <span className={clsx("font-mono text-[11px]", value > max ? "font-semibold text-red-600" : value > max * 0.9 ? "text-amber-600" : "text-muted")}>{value}/{max}</span>;
}
