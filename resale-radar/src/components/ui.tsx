import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer select-none",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:opacity-90 shadow-sm",
        secondary: "bg-surface-2 text-fg border border-border hover:border-border-strong",
        ghost: "text-fg-muted hover:text-fg hover:bg-surface-2",
        danger: "bg-negative-soft text-negative border border-negative/30 hover:border-negative/60",
        positive: "bg-positive-soft text-positive border border-positive/30 hover:border-positive/60",
        link: "text-accent underline-offset-4 hover:underline px-0 h-auto",
      },
      size: { sm: "h-8 px-3 text-xs", md: "h-9 px-4", lg: "h-11 px-5 text-base", icon: "h-9 w-9" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export function Button({ className, variant, size, ...props }: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function LinkButton({ className, variant, size, ...props }: ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-xl border border-border bg-surface shadow-[0_1px_0_0_rgb(0_0_0/0.02)]", className)} {...props} />;
}

export function CardHeader({ title, description, action, icon, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5", className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg [&_svg]:size-4 [&_svg]:text-fg-muted">
          {icon}
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-xs text-fg-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-4 py-4 sm:px-5", className)} {...props} />;
}

const badgeVariants = cva("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3", {
  variants: {
    tone: {
      neutral: "bg-surface-2 text-fg-muted border border-border",
      accent: "bg-accent-soft text-accent",
      positive: "bg-positive-soft text-positive",
      caution: "bg-caution-soft text-caution",
      negative: "bg-negative-soft text-negative",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-xs font-medium text-fg-muted", className)} {...props} />;
}

const fieldBase =
  "w-full rounded-md border border-border bg-bg-subtle px-3 text-sm text-fg placeholder:text-fg-subtle transition-colors hover:border-border-strong focus:border-accent focus:outline-none disabled:opacity-60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldBase, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(fieldBase, "min-h-20 py-2", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(fieldBase, "h-9 pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children, className, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-[11px] leading-snug text-fg-subtle">{hint}</p> : null}
    </div>
  );
}

export function MoneyInput({ name, defaultValue, placeholder, required, id, className }: { name: string; defaultValue?: number | null; placeholder?: string; required?: boolean; id?: string; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-subtle">$</span>
      <Input
        id={id ?? name}
        name={name}
        inputMode="decimal"
        autoComplete="off"
        className="pl-6 tabular"
        defaultValue={defaultValue != null ? (defaultValue / 100).toFixed(2) : undefined}
        placeholder={placeholder ?? "0.00"}
        required={required}
        pattern="^\$?\s*[0-9,]*(\.[0-9]{0,2})?$"
      />
    </div>
  );
}

export function Stat({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "positive" | "negative" | "caution" | "neutral"; icon?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1.5 text-xs text-fg-muted [&_svg]:size-3.5">
        {icon}
        {label}
      </span>
      <span
        className={cn(
          "truncate text-xl font-semibold tabular tracking-tight",
          tone === "positive" && "text-positive",
          tone === "negative" && "text-negative",
          tone === "caution" && "text-caution",
        )}
      >
        {value}
      </span>
      {sub ? <span className="text-xs text-fg-subtle">{sub}</span> : null}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon ? <div className="mb-1 rounded-full border border-border bg-surface-2 p-3 text-fg-muted [&_svg]:size-5">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-md text-xs text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ title, description, actions, icon }: { title: string; description?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl [&_svg]:size-5 [&_svg]:text-fg-muted">
          {icon}
          {title}
        </h1>
        {description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto scrollbar-thin">
      <table className={cn("w-full text-sm", className)} {...props} />
    </div>
  );
}
export function Th({ className, ...props }: ComponentProps<"th">) {
  return <th className={cn("whitespace-nowrap border-b border-border px-3 py-2 text-left text-xs font-medium text-fg-muted first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5", className)} {...props} />;
}
export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("border-b border-border/60 px-3 py-2.5 align-middle first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5", className)} {...props} />;
}

export function Progress({ value, tone = "accent", className }: { value: number; tone?: "accent" | "positive" | "caution" | "negative"; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-2", className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", { accent: "bg-accent", positive: "bg-positive", caution: "bg-caution", negative: "bg-negative" }[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Notice({ tone = "neutral", title, children, icon }: { tone?: "neutral" | "caution" | "negative" | "positive" | "accent"; title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border px-3.5 py-3 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
        tone === "neutral" && "border-border bg-surface-2 text-fg-muted",
        tone === "caution" && "border-caution/30 bg-caution-soft text-caution",
        tone === "negative" && "border-negative/30 bg-negative-soft text-negative",
        tone === "positive" && "border-positive/30 bg-positive-soft text-positive",
        tone === "accent" && "border-accent/30 bg-accent-soft text-accent",
      )}
    >
      {icon}
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn("text-[13px] leading-relaxed", title && "mt-0.5 opacity-90")}>{children}</div> : null}
      </div>
    </div>
  );
}

export function KeyValue({ items, className }: { items: { k: ReactNode; v: ReactNode; strong?: boolean; tone?: "positive" | "negative" | "caution" }[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-border/60", className)}>
      {items.map((it, i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
          <dt className="text-fg-muted">{it.k}</dt>
          <dd
            className={cn(
              "text-right tabular",
              it.strong && "font-semibold",
              it.tone === "positive" && "text-positive",
              it.tone === "negative" && "text-negative",
              it.tone === "caution" && "text-caution",
            )}
          >
            {it.v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-md", className)} />;
}
