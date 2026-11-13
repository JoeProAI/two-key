"use client";

import { useFormStatus } from "react-dom";
import { useOffline } from "./desk-frame";

export function SubmitButton({
  idle,
  pending,
  blocked,
  quiet,
}: {
  idle: string;
  pending: string;
  blocked?: boolean;
  quiet?: boolean;
}) {
  const status = useFormStatus();
  const offline = useOffline();
  const off = Boolean(blocked || offline || status.pending);
  const describedBy = offline ? "key-reason offline-note" : "key-reason";
  return (
    <button
      type="submit"
      className={quiet ? "quiet" : undefined}
      aria-disabled={off || undefined}
      aria-busy={status.pending || undefined}
      aria-describedby={describedBy}
      onClick={(event) => {
        if (off) event.preventDefault();
      }}
    >
      {status.pending ? pending : idle}
    </button>
  );
}
