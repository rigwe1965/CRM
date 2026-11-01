import type { ReactNode } from "react";
import { LEGAL_VERSION } from "@/lib/legal";

/** A legal document: title, the date it took effect, then numbered sections in plain words. */
export function LegalDoc({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <article className="space-y-6 text-[15px] leading-relaxed">
      <header className="space-y-2 pt-2">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">In force from {LEGAL_VERSION}.</p>
        {intro && <p>{intro}</p>}
      </header>
      {children}
    </article>
  );
}

export function LegalSection({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">
        {n}. {title}
      </h2>
      {children}
    </section>
  );
}

export const P = ({ children }: { children: ReactNode }) => <p>{children}</p>;
export const List = ({ children }: { children: ReactNode }) => <ul className="list-disc space-y-1 pl-6">{children}</ul>;
