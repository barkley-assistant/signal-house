/**
 * Mount-once ECharts lifecycle: init a dark-theme instance on a container
 * ref, resize it with a ResizeObserver, dispose it on unmount.
 *
 * ResizeObserver beats window-resize: it tracks the container even when the
 * grid reflows (mobile column collapse, diagnostics opening, etc).
 *
 * The container must EXIST when the effect runs. Callers that render their
 * chart div conditionally (per-model detail renders it only after data
 * arrives) keep their bespoke init effect — this hook is for charts whose
 * container is present from first render.
 */

import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import * as echarts from "echarts";

export function useEChart(ref: RefObject<HTMLDivElement | null>): MutableRefObject<echarts.ECharts | null> {
  const chartRef = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    chartRef.current = echarts.init(ref.current, "dark");
    const ro = new ResizeObserver(() => chartRef.current?.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chartRef.current?.dispose(); // must dispose to avoid instance leaks
      chartRef.current = null;
    };
  }, [ref]);
  return chartRef;
}