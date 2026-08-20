## Purpose

Defines the observable rendering behavior of the "Daily cost & tokens" usage chart, specifically that each legend entry's swatch color matches the color of its corresponding series line.

## ADDED Requirements

### Requirement: Legend swatch colors match series line colors

The "Daily cost & tokens" chart SHALL render every legend entry with a swatch color identical to the color of its corresponding series line, so a user can reliably tell which legend entry belongs to which line. The three series lines SHALL keep their current colors: "Cost ($)" sky blue (#38bdf8), "Tokens" yellow (#facc15), and "Cache read" green (#4ade80).

#### Scenario: Cost series legend swatch matches its line

- **WHEN** the "Daily cost & tokens" chart renders with the "Cost ($)" series
- **THEN** the "Cost ($)" legend entry swatch SHALL be sky blue (#38bdf8), the same color as the "Cost ($)" series line

#### Scenario: Tokens series legend swatch matches its line

- **WHEN** the "Daily cost & tokens" chart renders with the "Tokens" series
- **THEN** the "Tokens" legend entry swatch SHALL be yellow (#facc15), the same color as the "Tokens" series line

#### Scenario: Cache read series legend swatch matches its line

- **WHEN** the "Daily cost & tokens" chart renders with the "Cache read" series
- **THEN** the "Cache read" legend entry swatch SHALL be green (#4ade80), the same color as the "Cache read" series line