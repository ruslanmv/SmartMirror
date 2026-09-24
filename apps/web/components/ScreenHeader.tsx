"use client";

import { Icon, buttonClass } from "@smartmirror/ui";
import Link from "next/link";
import type { ReactNode } from "react";

export function ScreenHeader({
  title,
  subtitle,
  actions,
  backHref = "/smartmirror",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
}) {
  return (
    <div className="screen-header">
      <Link href={backHref} className={buttonClass({ iconOnly: true })} aria-label="Back">
        <Icon name="back" />
      </Link>
      <div className="screen-header__titles">
        <h1 className="screen-header__title">{title}</h1>
        {subtitle && <p className="screen-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="screen-header__actions">{actions}</div>}
    </div>
  );
}
