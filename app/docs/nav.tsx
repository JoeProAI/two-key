"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export type DocPage = { href: string; label: string; note: string };

export function DocsNav({ pages }: { pages: DocPage[] }) {
  const path = usePathname();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    // On a phone the page list scrolls sideways. Keep the current page in view.
    const current = ref.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const list = current?.closest("ol");
    if (current && list && list.scrollWidth > list.clientWidth) list.scrollLeft = current.offsetLeft - 16;
  }, [path]);
  return (
    <nav className="docs-nav" aria-label="Docs" ref={ref}>
      <ol>
        {pages.map((page) => (
          <li key={page.href}>
            <a href={page.href} aria-current={path === page.href ? "page" : undefined}>
              <span>{page.label}</span>
              <small>{page.note}</small>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
