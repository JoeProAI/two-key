"use client";

import { useState } from "react";

export function CopyCmd({ text }: { text: string }) {
  const [note, setNote] = useState("");
  return (
    <button
      type="button"
      className="cmd-copy"
      onClick={() => {
        if (!navigator.clipboard?.writeText) {
          setNote("Select and copy");
          return;
        }
        navigator.clipboard.writeText(text).then(
          () => setNote("Copied"),
          () => setNote("Select and copy"),
        );
      }}
    >
      {note || "Copy"}
    </button>
  );
}
