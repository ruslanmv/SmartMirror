import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from "react";

import { Icon, MirrorMark, type IconName } from "./icons";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export type ButtonVariant = "default" | "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconOnly?: boolean;
  busy?: boolean;
}

export function buttonClass({ variant = "default", size = "md", iconOnly = false } = {} as Pick<ButtonProps, "variant" | "size" | "iconOnly">) {
  return cx(
    "sm-btn",
    variant !== "default" && `sm-btn--${variant}`,
    size !== "md" && `sm-btn--${size}`,
    iconOnly && "sm-btn--icon",
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, icon, iconOnly, busy, className, children, type = "button", disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(buttonClass({ variant, size, iconOnly }), className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy ? <span className="sm-spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
});

export interface TileContentProps {
  icon: IconName;
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
}

export function TileContent({ icon, title, subtitle, badge }: TileContentProps) {
  return (
    <>
      <span className="sm-tile__icon">
        <Icon name={icon} />
      </span>
      <span className="sm-tile__title">{title}</span>
      {subtitle && <span className="sm-tile__subtitle">{subtitle}</span>}
      {badge && <span className="sm-tile__badge">{badge}</span>}
    </>
  );
}

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: IconName;
  pressed?: boolean;
}

export function Chip({ icon, pressed, className, children, type = "button", ...props }: ChipProps) {
  return (
    <button type={type} className={cx("sm-chip", className)} aria-pressed={pressed} {...props}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

export type StatusTone = "ok" | "warn" | "off" | "idle";

export function StatusPill({ tone, children, title }: { tone: StatusTone; children: ReactNode; title?: string }) {
  return (
    <span className={cx("sm-status", `sm-status--${tone}`)} title={title}>
      <span className="sm-status__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export function Badge({ tone, children }: { tone?: "accent" | "warn"; children: ReactNode }) {
  return <span className={cx("sm-badge", tone && `sm-badge--${tone}`)}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="sm-kbd">{children}</kbd>;
}

export function Progress({ value, label }: { value: number; label?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="sm-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <div className="sm-progress__bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

export interface WordmarkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  as?: "a" | "span";
}

export function Wordmark({ as = "span", className, ...props }: WordmarkProps) {
  const content = (
    <>
      <MirrorMark className="sm-wordmark__mark" />
      <span>Smart Mirror</span>
    </>
  );
  if (as === "a") {
    return (
      <a className={cx("sm-wordmark", className)} {...props}>
        {content}
      </a>
    );
  }
  return <span className={cx("sm-wordmark", className)}>{content}</span>;
}

export { cx };
