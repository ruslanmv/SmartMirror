"use client";

import { Button, Wordmark } from "@smartmirror/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import "../smartmirror/mirror.css";
import "./companion.css";

export default function CompanionCodeEntry() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = code.replace(/[^0-9a-z]/gi, "").toUpperCase();
    if (clean.length >= 4) router.push(`/companion/${clean}`);
  };
  return (
    <main className="companion-page">
      <Wordmark />
      <form className="sm-panel companion-card" onSubmit={submit}>
        <h1 className="sm-display" style={{ fontSize: "2.2rem" }}>
          Use your phone as the camera
        </h1>
        <p className="sm-muted">Enter the code shown on your Smart Mirror screen.</p>
        <input
          className="sm-input"
          style={{ fontSize: "1.6rem", letterSpacing: "0.3em", textAlign: "center", textTransform: "uppercase" }}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={12}
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          aria-label="Screen code"
        />
        <Button type="submit" variant="primary" size="lg">
          Continue
        </Button>
      </form>
    </main>
  );
}
