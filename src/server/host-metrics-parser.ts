/**
 * Parser for `pmlogsummary <archive> <metrics…>` stdout (issue #359).
 *
 * Verified line grammar (PCP, this host, 2026-08-23) — one invocation reads
 * exactly one archive:
 *
 *   mem.util.used   10698734.082 Kbyte
 *   swapdev.length ["/swap.img"] 16777212.000 Kbyte
 *   kernel.all.cpu.idle  3.781 none
 *
 * i.e. `name` + whitespace + optional `["instance"]` + whitespace + number +
 * space + unit. Units vary per metric family (Kbyte for memory, byte for
 * swap.used, Kbyte for swapdev.length, none for cpu counters); metrics
 * absent from a kernel's PMNS never appear on stdout at all (they only
 * produce a stderr note), so absence is the normal shape, not an error.
 *
 * Percentage derivation:
 *   memPct  = 100 × mem.util.available / mem.physmem
 *             (the kernel's "available" estimate ignores reclaimable page
 *              cache; raw `used` counts it as consumption and reads far
 *              scarier than reality. Deliberately no fallback formula — a
 *              silent semantic switch mid-series corrupts the trend; a gap
 *              is honest.)
 *   swapPct = 100 × swap.used / Σ swapdev.length
 *             (summed across ALL swap devices, unit-normalized to bytes)
 *   cpuPct  = 100 × (1 − idle / Σ(all cpu states))
 *             (pmlogsummary time-averages the cumulative counters, so each
 *              state is its fraction of one core over the window; their sum
 *              approaches ncpu when the machine is saturated)
 *
 * Any missing ingredient → that percentage is null. Unknown is never 0.
 */

export interface MetricValue {
  value: number;
  unit: string;
}

export interface ParsedSummary {
  /** Singular metrics: name → value. */
  scalars: Map<string, MetricValue>;
  /** Instanced metrics: name → (instance → value). */
  instances: Map<string, Map<string, MetricValue>>;
  /** Lines that didn't match the grammar, capped — surfaced for logs. */
  unparsedLines: string[];
}

/** Metric set requested from every archive. Requesting a metric a kernel
 *  doesn't have is harmless (stderr note, no stdout line), so the list is
 *  the union of what common kernels expose rather than a per-host config. */
export const HOST_METRIC_NAMES: readonly string[] = [
  "mem.util.available",
  "mem.physmem",
  "swap.used",
  "swapdev.length",
  "kernel.all.cpu.user",
  "kernel.all.cpu.sys",
  "kernel.all.cpu.idle",
  "kernel.all.cpu.nice",
  "kernel.all.cpu.iowait",
  "kernel.all.cpu.irq.soft",
  "kernel.all.cpu.irq.hard",
  "kernel.all.cpu.steal",
];

const LINE_RE =
  /^([A-Za-z][A-Za-z0-9_.]*)\s+(?:\["([^"]*)"\]\s+)?(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s+(\S+)$/;

export function parseHostMetricsSummary(stdout: string): ParsedSummary {
  const scalars = new Map<string, MetricValue>();
  const instances = new Map<string, Map<string, MetricValue>>();
  const unparsedLines: string[] = [];

  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = LINE_RE.exec(line);
    if (!m) {
      if (unparsedLines.length < 5) unparsedLines.push(line);
      continue;
    }
    const [, name, inst, value, unit] = m;
    const entry: MetricValue = { value: Number(value), unit };
    if (inst !== undefined) {
      const perInst = instances.get(name) ?? new Map<string, MetricValue>();
      perInst.set(inst, entry);
      instances.set(name, perInst);
    } else {
      scalars.set(name, entry);
    }
  }

  return { scalars, instances, unparsedLines };
}

export interface HostResourcePercentages {
  memPct: number | null;
  swapPct: number | null;
  cpuPct: number | null;
}

const UNIT_TO_BYTES: Record<string, number> = {
  byte: 1,
  Kbyte: 1024,
  Mbyte: 1024 ** 2,
  Gbyte: 1024 ** 3,
};

function toBytes(v: MetricValue | undefined): number | null {
  if (!v) return null;
  const scale = UNIT_TO_BYTES[v.unit];
  return scale === undefined ? null : v.value * scale;
}

function clampPct(v: number): number {
  return Math.min(100, Math.max(0, v));
}

/** CPU states summed for the utilization denominator. `idle` must be present
 *  (it is the numerator's complement); the others contribute when they exist. */
const CPU_STATES: readonly string[] = [
  "kernel.all.cpu.user",
  "kernel.all.cpu.sys",
  "kernel.all.cpu.idle",
  "kernel.all.cpu.nice",
  "kernel.all.cpu.iowait",
  "kernel.all.cpu.irq.soft",
  "kernel.all.cpu.irq.hard",
  "kernel.all.cpu.steal",
];

export function hostResourcePercentages(summary: ParsedSummary): HostResourcePercentages {
  const { scalars, instances } = summary;

  const available = scalars.get("mem.util.available");
  const physmem = scalars.get("mem.physmem");
  const memPct =
    available && physmem && physmem.value > 0
      ? clampPct((available.value / physmem.value) * 100)
      : null;

  const swapUsed = toBytes(scalars.get("swap.used"));
  let swapTotal = 0;
  let haveSwapTotal = false;
  for (const length of instances.get("swapdev.length")?.values() ?? []) {
    const b = toBytes(length);
    if (b === null) {
      // One unreadable device length poisons the denominator — emit null
      // rather than a percentage measured against partial hardware.
      haveSwapTotal = false;
      break;
    }
    swapTotal += b;
    haveSwapTotal = true;
  }
  const swapPct =
    swapUsed !== null && haveSwapTotal && swapTotal > 0
      ? clampPct((swapUsed / swapTotal) * 100)
      : null;

  const idle = scalars.get("kernel.all.cpu.idle")?.value ?? null;
  let cpuTotal = 0;
  for (const state of CPU_STATES) {
    cpuTotal += scalars.get(state)?.value ?? 0;
  }
  const cpuPct = idle !== null && cpuTotal > 0 ? clampPct((1 - idle / cpuTotal) * 100) : null;

  return { memPct, swapPct, cpuPct };
}
