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
  return (
    <>
      <label htmlFor="approver">Approver</label>
      <input
        id="approver"
        name="approver"
        type="text"
        defaultValue="joe"
        maxLength={40}
        autoComplete="name"
        required
        readOnly={off}
        aria-describedby={offline ? "key-reason offline-note" : "key-reason"}
      />
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
        readOnly={offline}
        aria-describedby={offline ? "key-reason offline-note" : "key-reason"}
      />
    </>
  );
}
