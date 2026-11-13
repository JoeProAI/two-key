"use client";

import { useState } from "react";

export function CopyId({ id, label }: { id: string; label?: string }) {
  const [note, setNote] = useState("");
  return (
    <div className="id-row">
      <p className="id">
        {label ? <span className="id-label">{label}</span> : null}
        <span className="id-value">{id}</span>
      </p>
      <button
        type="button"
        className="quiet"
        onClick={() => {
          const text = id;
          if (!navigator.clipboard?.writeText) {
            setNote("Select the id and copy it.");
            return;
          }
          navigator.clipboard.writeText(text).then(
            () => setNote("Copied"),
            () => setNote("Select the id and copy it."),
          );
        }}
      >
        Copy
      </button>
      {note ? <span className="id-note" role="status">{note}</span> : null}
    </div>
  );
}
