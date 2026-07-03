import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { Activity, TrendingUp } from "lucide-react";

import { StatsBar } from "../ui/stats-bar";

describe("StatsBar", () => {
  it("renders a semantic <dl> with <dt> labels and <dd> values", () => {
    const html = renderToStaticMarkup(
      <StatsBar
        stats={[
          { label: "Sessions", value: 4, format: "number" },
          { label: "Messages", value: 16, format: "number" },
        ]}
      />,
    );

    expect(html).toContain("<dl");
    expect(html).toContain('data-slot="stats-bar"');
    expect(html).toContain("<dt");
    expect(html).toContain("<dd");
    expect(html).toContain("Sessions");
    expect(html).toContain("Messages");
    expect(html).toContain("4");
    expect(html).toContain("16");
  });

  it("applies responsive layout classes (flex-col + sm:flex-row)", () => {
    const html = renderToStaticMarkup(
      <StatsBar
        stats={[{ label: "Sessions", value: 4, format: "number" }]}
      />,
    );

    expect(html).toContain("flex-col");
    expect(html).toContain("sm:flex-row");
    expect(html).toContain("sm:flex-wrap");
    expect(html).toContain("sm:items-center");
  });

  it("renders the compact variant with gap-2 and no background", () => {
    const html = renderToStaticMarkup(
      <StatsBar
        variant="compact"
        stats={[{ label: "A", value: 1, format: "number" }]}
      />,
    );

    expect(html).toContain("gap-2");
    expect(html).not.toContain("rounded-lg");
    expect(html).not.toContain("border-card-border");
    expect(html).toContain('data-variant="compact"');
  });

  it("renders the default variant with gap-4 and no background", () => {
    const html = renderToStaticMarkup(
      <StatsBar
        variant="default"
        stats={[{ label: "A", value: 1, format: "number" }]}
      />,
    );

    expect(html).toContain("gap-4");
    expect(html).not.toContain("rounded-lg");
    expect(html).toContain('data-variant="default"');
  });

  it("renders the card variant with border, background, and padding", () => {
    const html = renderToStaticMarkup(
      <StatsBar
        variant="card"
        stats={[{ label: "A", value: 1, format: "number" }]}
      />,
    );

    expect(html).toContain("rounded-lg");
    expect(html).toContain("border-card-border");
    expect(html).toContain("bg-card-bg");
    expect(html).toContain("px-3");
    expect(html).toContain("py-2");
    expect(html).toContain('data-variant="card"');
  });

  it("formats numeric values with the number helper (1,234 -> 1,234)", () => {
    const html = renderToStaticMarkup(
      <StatsBar
        stats={[
          { label: "Small", value: 42, format: "number" },
          { label: "Mid", value: 1234, format: "number" },
          { label: "Big", value: 2_500_000, format: "number" },
        ]}
      />,
    );

    expect(html).toContain("42");
    expect(html).toContain("1,234");
    expect(html).toContain("2,500,000");
  });

  it("formats numeric values with the cost helper ($45.67)", () => {
    const html = renderToStaticMarkup(
      <StatsBar
        stats={[{ label: "Cost", value: 45.67, format: "cost" }]}
      />,
    );

    expect(html).toContain("$45.67");
  });

  it("formats numeric values with the percentage helper (0.856 -> 85.6%)", () => {
    const html = renderToStaticMarkup(
      <StatsBar
        stats={[{ label: "Share", value: 0.856, format: "percentage" }]}
      />,
    );

    expect(html).toContain("85.6%");
  });

  it("renders numeric values as-is when no format is specified", () => {
    const html = renderToStaticMarkup(
      <StatsBar stats={[{ label: "Raw", value: 42 }]} />,
    );

    expect(html).toContain(">42<");
  });

  it("applies the accent color class to the value when highlight is true", () => {
    const html = renderToStaticMarkup(
      <StatsBar
        stats={[
          { label: "Cost", value: 12.5, format: "cost", highlight: true },
        ]}
      />,
    );

    expect(html).toContain("text-accent-primary");
  });

  it("does not apply the accent color class when highlight is false", () => {
    const html = renderToStaticMarkup(
      <StatsBar
        stats={[
          { label: "Cost", value: 0, format: "cost", highlight: false },
        ]}
      />,
    );

    expect(html).not.toContain("text-accent-primary");
  });

  it("renders an icon when provided and sizes it at 16px", () => {
    const html = renderToStaticMarkup(
      <StatsBar
        stats={[
          { label: "Active", value: 9, format: "number", icon: Activity },
        ]}
      />,
    );

    expect(html).toContain("size-4");
    expect(html).toContain("aria-hidden=\"true\"");
  });

  it("does not render any icon element when icon is omitted", () => {
    const html = renderToStaticMarkup(
      <StatsBar
        stats={[{ label: "Plain", value: 1, format: "number" }]}
      />,
    );

    expect(html).not.toContain("<svg");
  });

  it("renders nothing when the stats array is empty", () => {
    const html = renderToStaticMarkup(<StatsBar stats={[]} />);

    expect(html).toBe("");
  });

  it("displays an em dash for null values", () => {
    const html = renderToStaticMarkup(
      <StatsBar stats={[{ label: "Missing", value: null }]} />,
    );

    expect(html).toContain("—");
  });

  it("displays an em dash for undefined values", () => {
    const html = renderToStaticMarkup(
      <StatsBar stats={[{ label: "Missing", value: undefined }]} />,
    );

    expect(html).toContain("—");
  });

  it("renders a single stat without layout issues", () => {
    const html = renderToStaticMarkup(
      <StatsBar stats={[{ label: "Solo", value: 7, format: "number" }]} />,
    );

    expect(html).toContain("<dl");
    expect(html).toContain("Solo");
    expect(html).toContain("7");
  });

  it("preserves pre-formatted string values without reformatting", () => {
    const html = renderToStaticMarkup(
      <StatsBar
        stats={[
          { label: "Avg", value: "$0.50/msg" },
          { label: "Custom", value: "n/a" },
        ]}
      />,
    );

    expect(html).toContain("$0.50/msg");
    expect(html).toContain("n/a");
  });

  it("merges a custom className with the base classes", () => {
    const html = renderToStaticMarkup(
      <StatsBar
        className="my-custom-class"
        stats={[{ label: "X", value: 1, format: "number" }]}
      />,
    );

    expect(html).toContain("my-custom-class");
    expect(html).toContain("flex-col");
  });

  it("renders an icon with custom element type (not just lucide)", () => {
    function CustomIcon(props: React.SVGProps<SVGSVGElement>) {
      return <svg {...props} data-testid="custom-icon" />;
    }

    const html = renderToStaticMarkup(
      <StatsBar
        stats={[
          { label: "Custom", value: 1, format: "number", icon: CustomIcon },
        ]}
      />,
    );

    expect(html).toContain("data-testid=\"custom-icon\"");
  });

  it("renders multiple stats in source order", () => {
    const html = renderToStaticMarkup(
      <StatsBar
        stats={[
          { label: "First", value: 1, format: "number" },
          { label: "Second", value: 2, format: "number" },
          { label: "Third", value: 3, format: "number" },
        ]}
      />,
    );

    const firstIdx = html.indexOf("First");
    const secondIdx = html.indexOf("Second");
    const thirdIdx = html.indexOf("Third");
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(firstIdx);
    expect(thirdIdx).toBeGreaterThan(secondIdx);
  });

  it("renders the icon before the label inside each stat-item", () => {
    const html = renderToStaticMarkup(
      <StatsBar
        stats={[
          { label: "Trend", value: 5, format: "number", icon: TrendingUp },
        ]}
      />,
    );

    const iconIdx = html.indexOf("<svg");
    const labelIdx = html.indexOf("Trend");
    expect(iconIdx).toBeGreaterThan(-1);
    expect(labelIdx).toBeGreaterThan(iconIdx);
  });
});
