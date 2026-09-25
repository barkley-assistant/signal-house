/**
 * Attention Queue — open issues/PRs that need the operator's eyes.
 * Server-side privacy-filtered; this component only renders what the API sent.
 *
 * Brand intent (2026-08-24): stale items get a YELLOW indicator — both
 * the leading dot and a yellow-tinted left-border accent on the row.
 * Fresh items get the neutral blue dot. The yellow-on-stale mapping is
 * pinned by the unit test "stale row uses the warning dot class" below
 * so a future CSS or JSX refactor can't silently flip it back to blue.
 */
import { useEffect, useRef, useState } from "react";
import type { StatePayload } from "../state/store";
import { formatRelative } from "../../shared/format";

export function AttentionQueue({ attention }: { attention: StatePayload["attention"] }) {
  // The tail fade should only hint at MORE content below — once scrolled to
  // the bottom (or when the list fits), the last row must read at full
  // opacity. Track it off the scroll container so the fade follows the
  // actual overflow state, not the list's static position.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hasMoreBelow, setHasMoreBelow] = useState(false);
  // Cap the visible list at exactly 8 COMPLETE rows: a fixed max-height
  // (e.g. min(480px, 62vh)) clips the 8th row mid-line because row height
  // varies (stale captions, font metrics). Measure the first 8 rows and
  // size the container to their exact summed height instead — the 9th row
  // and beyond sit below the fold, revealed by scrolling.
  const LIST_CAP = 8;
  const [capHeight, setCapHeight] = useState<number | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const rows = Array.from(el.querySelectorAll("li"));
    const shown = rows.slice(0, LIST_CAP);
    if (shown.length === 0) {
      setCapHeight(null);
      return;
    }
    const sum = shown.reduce((acc, r) => acc + r.getBoundingClientRect().height, 0);
    // +1px guards subpixel rounding from clipping the last shown row.
    setCapHeight(sum + 1);
  }, [attention]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setHasMoreBelow(el.scrollTop + el.clientHeight < el.scrollHeight - 8);
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [attention.length]);

  if (attention.length === 0) {
    return (
      <section className="card" aria-label="Attention queue">
        <h2>Attention Queue</h2>
        <p className="state-label">
          <span className="dot dot--success" style={{ marginRight: 8 }} />
          All clear — no open issues or PRs need attention right now
        </p>
      </section>
    );
  }

  return (
    <section className="card" aria-label="Attention queue">
      <h2>Attention Queue</h2>
      <div
        ref={scrollRef}
        className="att-scroll"
        style={capHeight !== null ? { maxHeight: capHeight } : undefined}
        tabIndex={0}
        aria-label={`Attention queue items, ${attention.length} total`}
      >
        <ul
          className={`att-scroll__list${hasMoreBelow ? " att-scroll__list--fade" : ""}`}
          style={{ listStyle: "none", margin: 0, padding: 0 }}
        >
          {attention.map((item) => (
          <li
            key={item.id}
            className={`att-row${item.stale ? " att-row--stale" : ""}`}
          >
            <div className="att-row__meta">
              <span
                className={`dot ${item.stale ? "dot--warning" : "dot--info"}`}
                aria-label={item.stale ? "Stale item" : "Active item"}
              />
              <span className="mono">{item.type === "pr" ? "PR" : "issue"}</span>
              <span>{item.repo}</span>
              {item.ciStatus && <span className={`mono ${item.ciStatus === "success" ? "state-ok" : item.ciStatus === "failure" ? "state-bad" : ""}`}>CI {item.ciStatus}</span>}
              <span>· {formatRelative(Date.parse(item.updatedAt))}</span>
            </div>
            <div className="att-row__title">
              <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
            </div>
            {item.stale && <div className="kpi-caption">Stale · {item.ageDays}d old</div>}
          </li>
        ))}
        </ul>
      </div>
    </section>
  );
}
