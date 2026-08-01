/**
 * Brand logo — the retained signal-house logo with the signature slow
 * pulse-ring + light-flash + light-sweep glow (V1 visual identity, §LogoGlow).
 * Timing carried over from V1: pulse 6.3s, glow sweep 8s. Respects reduced
 * motion. The mark renders at `size` px; rings/flash scale to match.
 */

import { motion, useReducedMotion } from "framer-motion";
import logoUrl from "../assets/signal-house-logo.png";

export function Logo({ size = 64 }: { size?: number }) {
  const reduce = useReducedMotion();

  // Pulse rings — slow radar ping. Slower cycle (8s) with a quick fade:
  // peak at ~1s, gone by ~2.2s, then a long quiet stretch (operator pref).
  const pulse = reduce ? { scale: 1.08, opacity: 0.32 } : { scale: [1, 2.08], opacity: [0, 0.52, 0] };
  const pulseT = reduce ? undefined : { duration: 8, repeat: Infinity, times: [0, 0.12, 0.28], ease: "easeOut" as const };

  // Light flash — radial glow that blooms then fades (V1 LogoGlow `a`).
  // x/y keep the element centered (framer overrides CSS transforms).
  const flash = reduce
    ? { opacity: 0.3, scale: 0.8, x: "-50%", y: "-50%" }
    : { opacity: [0, 0, 0.92, 0.86, 0, 0], scale: [0.45, 0.45, 1.1, 1, 0.45, 0.45], x: "-50%", y: "-50%" };
  // Light sweep — a soft horizontal bar that sweeps across (V1 LogoGlow `a2`).
  const sweep = reduce
    ? { opacity: 0.2, scaleX: 0.9, x: "-50%", y: "-50%" }
    : { opacity: [0, 0, 0.5, 0.38, 0, 0], scaleX: [0.35, 0.35, 1.08, 1, 0.35, 0.35], x: "-50%", y: "-50%" };
  const glowT = { duration: 8, repeat: Infinity, times: [0, 0.55, 0.65, 0.72, 0.85, 1], ease: "easeInOut" as const };

  const flashSize = size * 0.5;
  const sweepW = size * 0.875;
  const sweepH = size * 0.19;

  return (
    <div className="logo" style={{ width: size, height: size }} aria-hidden="true">
      <img src={logoUrl} alt="" width={size} height={size} className="logo__img" />
      {[0, 2.7, 5.4].map((delay, i) => (
        <motion.span
          key={delay}
          aria-hidden="true"
          className="logo__ring"
          style={{ borderColor: `rgba(56, 189, 248, ${i === 0 ? 0.56 : 0.42})` }}
          initial={{ scale: 1, opacity: 0 }}
          animate={pulse}
          transition={pulseT ? { ...pulseT, delay } : undefined}
        />
      ))}
      {/* Light flash — radial bloom over the mark, screen-blended. */}
      <motion.div
        aria-hidden="true"
        className="logo__flash"
        style={{
          width: flashSize,
          height: flashSize,
          background:
            "radial-gradient(circle, rgba(241, 250, 255, 0.92) 0%, rgba(125, 211, 252, 0.58) 24%, rgba(56, 189, 248, 0.22) 52%, rgba(56, 189, 248, 0) 76%)",
          mixBlendMode: "screen",
        }}
        // initial must differ from animate or framer never runs the timeline
        initial={{ opacity: 0, scale: 0.45, x: "-50%", y: "-50%" }}
        animate={flash}
        transition={glowT}
      />
      {/* Light sweep — soft horizontal bar sweeping across the mark. */}
      <motion.div
        aria-hidden="true"
        className="logo__sweep"
        style={{
          width: sweepW,
          height: sweepH,
          background:
            "linear-gradient(90deg, rgba(56, 189, 248, 0), rgba(186, 230, 253, 0.62), rgba(56, 189, 248, 0))",
          mixBlendMode: "screen",
        }}
        // initial must differ from animate or framer never runs the timeline
        initial={{ opacity: 0, scaleX: 0.35, x: "-50%", y: "-50%" }}
        animate={sweep}
        transition={glowT}
      />
    </div>
  );
}
