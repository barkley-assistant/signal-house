# daily-usage-chart Specification

## Purpose
Defines the observable rendering behavior of the "Daily cost & tokens" usage chart, specifically that each legend entry's swatch color matches the color of its corresponding series line, and that the plotted line(s) span the full width of the plot area.

## Requirements

### Requirement: Legend swatch colors match series line colors

The "Daily cost & tokens" chart SHALL render every legend entry with a swatch color identical to the color of its corresponding series line, so a user can reliably tell which legend entry belongs to which line. The three series lines SHALL keep their current colors: "Cost ($)" sky blue (#38bdf8), "Tokens" yellow (#facc15), and "Cache read" green (#4ade80).

### Requirement: Daily chart line endpoints reach both chart edges

The "Daily cost & tokens" chart SHALL render each series line so its first point sits flush against the left edge of the plot area and its last point sits flush against the right edge of the plot area, with the line spanning the full width of the plot area and no visible padding gap between the last data point and either border.

#### Scenario: First and last points align to the plot edges

- **WHEN** the "Daily cost & tokens" chart renders the cost, tokens, and cache-read series for a given window
- **THEN** the first data point of each series SHALL be positioned at the left edge of the plot area AND the last data point of each series SHALL be positioned at the right edge of the plot area, with no trailing whitespace between the last point and the right border

#### Scenario: Cost series legend swatch matches its line

- **WHEN** the "Daily cost & tokens" chart renders with the "Cost ($)" series
- **THEN** the "Cost ($)" legend entry swatch SHALL be sky blue (#38bdf8), the same color as the "Cost ($)" series line

#### Scenario: Tokens series legend swatch matches its line

- **WHEN** the "Daily cost & tokens" chart renders with the "Tokens" series
- **THEN** the "Tokens" legend entry swatch SHALL be yellow (#facc15), the same color as the "Tokens" series line

#### Scenario: Cache read series legend swatch matches its line

- **WHEN** the "Daily cost & tokens" chart renders with the "Cache read" series
- **THEN** the "Cache read" legend entry swatch SHALL be green (#4ade80), the same color as the "Cache read" series line
