"use client";

import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export type EvidenceTab = { id: string; label: string; note: string };

export function EvidenceSwitch({
  tabs,
  focus,
  children,
}: {
  tabs: EvidenceTab[];
  focus: string;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState(focus);
  const [seen, setSeen] = useState(focus);
  if (seen !== focus) {
    setSeen(focus);
    setSelected(focus);
  }
  const ids = tabs.map((tab) => tab.id);
  const current = ids.includes(selected) ? selected : focus;

  function onTabsKey(event: KeyboardEvent<HTMLDivElement>) {
    const index = Math.max(0, ids.indexOf(current));
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % ids.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + ids.length) % ids.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ids.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const id = ids[next];
    setSelected(id);
    requestAnimationFrame(() => document.getElementById(`tab-${id}`)?.focus());
  }

  return (
    <div className="evidence">
      <div className="steps" role="tablist" aria-label="Evidence" onKeyDown={onTabsKey}>
        {tabs.map((tab) => {
          const on = tab.id === current;
          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls="evidence-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => setSelected(tab.id)}
            >
              <span className="tab-label">{tab.label}</span>
              <span className="tab-note">{tab.note}</span>
            </button>
          );
        })}
      </div>
      <div
        className="stage"
        id="evidence-panel"
        role="tabpanel"
        aria-labelledby={`tab-${current}`}
        data-selected={current}
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  );
}
