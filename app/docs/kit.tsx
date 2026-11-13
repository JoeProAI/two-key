import type { ReactNode } from "react";
import { CopyCmd } from "./copy-cmd";

export const REPO = "https://github.com/JoeProAI/two-key";
export const blob = (path: string) => `${REPO}/blob/main/${path}`;
export const tree = (path: string) => `${REPO}/tree/main/${path}`;

export function DocHead({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <header className="doc-head">
      <p className="eyebrow">{kicker}</p>
      <h1>{title}</h1>
      {children ? <div className="doc-lede">{children}</div> : null}
    </header>
  );
}

/** A command a judge can paste. Shown as text, copied as text. */
export function Cmd({ children, note }: { children: string; note?: string }) {
  return (
    <figure className="cmd">
      <pre><code>{children}</code></pre>
      <CopyCmd text={children} />
      {note ? <figcaption>{note}</figcaption> : null}
    </figure>
  );
}

export function Source({ paths }: { paths: string[] }) {
  return (
    <p className="doc-source">
      Source in the repo:{" "}
      {paths.map((path, index) => (
        <span key={path}>
          {index ? ", " : ""}
          <a href={path.endsWith("/") ? tree(path) : blob(path)}>{path}</a>
        </span>
      ))}
    </p>
  );
}

export function Table({ head, rows, caption }: { head: string[]; rows: ReactNode[][]; caption?: string }) {
  return (
    <div className="doc-table">
      <table>
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>{head.map((cell) => <th key={cell} scope="col">{cell}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (c === 0 ? <th key={c} scope="row">{cell}</th> : <td key={c}>{cell}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Limit({ children }: { children: ReactNode }) {
  return <li className="limit">{children}</li>;
}

export function Next({ href, label }: { href: string; label: string }) {
  return (
    <p className="doc-next">
      <a href={href}>{label}</a>
    </p>
  );
}
