import type { ReactNode } from "react";

/**
 * The NorthStar page banner: the same orbit-and-star header as "Welcome, Michael" on Home,
 * so every page opens with one recognizable look. The highlighted word gets the aurora
 * gradient, the star, and the underline.
 */
export function PageBanner({ icon, kicker, lead, highlight, fact, aside }: {
  icon: ReactNode;
  kicker: string;
  /** Words before the highlighted one, e.g. "Your". */
  lead?: string;
  highlight: string;
  /** One line of real numbers under the title. */
  fact?: ReactNode;
  /** Right side: a page action, or Home's sync status. */
  aside?: ReactNode;
}) {
  return (
    <header className="home-welcome">
      <span className="home-welcome-orbit home-welcome-orbit-one" aria-hidden="true" />
      <span className="home-welcome-orbit home-welcome-orbit-two" aria-hidden="true" />
      <div className="home-welcome-copy">
        <p className="home-welcome-kicker">{icon} {kicker}</p>
        <h1>{lead && <>{lead} </>}<span className="home-welcome-name">{highlight}<i aria-hidden="true" /></span></h1>
        {fact && <p className="page-banner-fact"><i aria-hidden="true" />{fact}</p>}
      </div>
      {aside && <div className="page-banner-aside">{aside}</div>}
    </header>
  );
}
