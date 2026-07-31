/**
 * Brand logo — the retained signal-house logo with the signature slow
 * pulse-ring + light-sweep glow. The animation concept carries over from V1's
 * visual identity; implementation is fresh. Respects reduced motion.
 */

import { motion, useReducedMotion } from "framer-motion";
import logoUrl from "../assets/signal-house-logo.png";

export function Logo({ size = 56 }: { size?: number }) {
  const reduce = useReducedMotion();
  const pulse = reduce ? { scale: 1.08, opacity: 0.32 } : { scale: [1, 2.08], opacity: [0, 0.52, 0] };
  const t = reduce ? undefined : { duration: 6.3, repeat: Infinity, times: [0, 0.18, 1], ease: "easeOut" as const };

  return (
    <div className="logo" style={{ width: size, height: size }} aria-hidden="true">
      <img src={logoUrl} alt="" width={size} height={size} className="logo__img" />
      {[0, 2.1, 4.2].map((delay, i) => (
        <motion.span
          key={delay}
          aria-hidden="true"
          className="logo__ring"
          style={{ borderColor: `rgba(56, 189, 248, ${i === 0 ? 0.56 : 0.42})` }}
          initial={{ scale: 1, opacity: 0 }}
          animate={pulse}
          transition={t ? { ...t, delay } : undefined}
        />
      ))}
    </div>
  );
}
