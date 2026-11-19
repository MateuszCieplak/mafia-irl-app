'use client';

/**
 * Przejście między trasami (login → lobby → pokój → gra).
 * template.js jest montowany od nowa przy każdej nawigacji, więc animacja
 * wejścia odpala się za każdym razem. Wrapper wypełnia wysokość body
 * (flex-1 flex flex-col min-h-0), żeby strony z flex-1 / h-dvh działały bez zmian.
 * `animate-page-in` używa fill-mode `backwards` — po animacji nie zostaje transform,
 * więc elementy position: fixed w stronach nie zmieniają containing block.
 */
export default function Template({ children }) {
  return <div className="flex-1 flex flex-col min-h-0 animate-page-in">{children}</div>;
}
