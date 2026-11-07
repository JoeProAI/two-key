"use client";

import type { FormEvent, ReactNode } from "react";
import { useOffline } from "./desk-frame";

export function GuardedForm({
  action,
  blocked,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  blocked?: boolean;
  children: ReactNode;
}) {
  const offline = useOffline();
  const stop = Boolean(blocked || offline);
  return (
    <form
      action={action}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        if (stop) event.preventDefault();
      }}
    >
      {children}
    </form>
  );
}

export function ApproverField({ blocked }: { blocked: boolean }) {
  const offline = useOffline();
  const off = blocked || offline;
  const describedBy = ["approver-note", "key-reason", offline ? "offline-note" : ""].filter(Boolean).join(" ");
  return (
    <>
      <label htmlFor="approver">Demo approver label</label>
      <input
        id="approver"
        name="approver"
        type="text"
        defaultValue="joe"
        maxLength={40}
        autoComplete="off"
        required
        aria-describedby={describedBy}
        {...(off ? { readOnly: true } : {})}
      />
      <p id="approver-note">This is a demo label. It is not authentication.</p>
    </>
  );
}

export function DeskKeyField() {
  const offline = useOffline();
  return (
    <>
      <label htmlFor="desk-key">Desk key</label>
      <input
        id="desk-key"
        name="deskKey"
        type="password"
        autoComplete="current-password"
        maxLength={200}
        required
        aria-describedby={offline ? "key-reason offline-note" : "key-reason"}
        {...(offline ? { readOnly: true } : {})}
      />
    </>
  );
}
