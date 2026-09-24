"use client";

import { Icon, type IconName } from "@smartmirror/ui";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type Tone = "info" | "warn";
interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
  icon: IconName;
}

const ToastContext = createContext<(message: string, opts?: { tone?: Tone; icon?: IconName }) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((message: string, opts?: { tone?: Tone; icon?: IconName }) => {
    const id = nextId.current++;
    const tone = opts?.tone ?? "info";
    setItems((list) => [...list.filter((t) => t.message !== message).slice(-2), { id, message, tone, icon: opts?.icon ?? (tone === "warn" ? "shield" : "check") }]);
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 3200);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`}>
            <Icon name={t.icon} />
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
