"use client";

import { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
import { useDashboardStore } from "@/store/dashboard";

function formatTimeAgo(dateStr: string | null, now: number): string {
  if (!dateStr) return "never";
  const diff = now - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function StatusStrip() {
  const {
    lastRefreshAt,
    isRefreshing,
    refreshStatus,
    manualRefreshStatus,
    error,
  } = useDashboardStore();

  const [now, setNow] = useState(() => Date.now());
  const [pulsing, setPulsing] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const prevRefreshStatusRef = useRef(refreshStatus);

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
      setCountdown((prev) => (prev <= 1 ? 30 : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const prev = prevRefreshStatusRef.current;
    prevRefreshStatusRef.current = refreshStatus;
    if (prev === "running" && refreshStatus === "success") {
      setPulsing(true);
      const timer = setTimeout(() => setPulsing(false), 6000);
      return () => clearTimeout(timer);
    }
  }, [refreshStatus]);

  useEffect(() => {
    if (manualRefreshStatus === "success") {
      const timer = setTimeout(() => {
        useDashboardStore.setState({ manualRefreshStatus: "idle" });
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [manualRefreshStatus]);

  const isRefreshingNow = isRefreshing || refreshStatus === "running";
  const isError = refreshStatus === "failed" && !isRefreshingNow;

  const timeAgo = formatTimeAgo(lastRefreshAt, now);

  let dotStyle: React.CSSProperties;
  let statusText: string;

  if (isRefreshingNow) {
    dotStyle = {
      backgroundColor: "var(--color-status-info)",
      animation: "pulse-dot 2s ease-in-out infinite",
    };
    statusText = "Refreshing...";
  } else if (isError) {
    dotStyle = { backgroundColor: "var(--color-status-error)" };
    statusText = error ? `Refresh failed: ${error}` : "Refresh failed";
  } else {
    dotStyle = pulsing
      ? {
          backgroundColor: "var(--color-status-success)",
          animation: "pulse-dot 2s ease-in-out 3",
        }
      : { backgroundColor: "var(--color-status-success)" };
    statusText = `Next: ${countdown}s`;
  }

  return (
    <motion.div
      className="flex items-center justify-center gap-2 rounded-lg px-4 py-1.5 text-xs"
      style={{
        backgroundColor: "var(--color-card-bg)",
        border: "1px solid var(--color-divider)",
      }}
      animate={
        manualRefreshStatus === "success"
          ? {
              backgroundColor: [
                "var(--color-card-bg)",
                "rgba(74, 222, 128, 0.15)",
                "var(--color-card-bg)",
              ],
            }
          : {}
      }
      transition={
        manualRefreshStatus === "success"
          ? { duration: 1.5, ease: "easeInOut" }
          : { duration: 0 }
      }
    >
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={dotStyle}
      />
      <span style={{ color: "var(--color-text-muted)" }}>
        Updated: {timeAgo}
        {isRefreshingNow && ` \u00B7 ${statusText}`}
        {isError && ` \u00B7 ${statusText}`}
        {!isRefreshingNow && !isError && ` \u00B7 ${statusText}`}
      </span>
    </motion.div>
  );
}
