import { describe, expect, test } from "bun:test";
import { formatScanReport, validateScanOptions, type ScanResponse } from "./scan.js";

const singleTileScan: ScanResponse = {
  scan: {
    modelVersion: "scan-v1",
    origin: {
      x: 3,
      y: -2,
    },
    sensorStrength: 60,
    radiusTiles: 0,
    tiles: [
      {
        x: 3,
        y: -2,
        terrain: "flat",
        distanceTiles: 0,
        probabilities: [
          { resourceType: "ferrite", probabilityPct: 63.5 },
          { resourceType: "ice-regolith", probabilityPct: 12.5 },
          { resourceType: "silicate-glass", probabilityPct: 4 },
          { resourceType: null, probabilityPct: 20 },
        ],
        topCandidate: {
          resourceType: "ferrite",
          probabilityPct: 63.5,
        },
        quantityEstimate: {
          resourceType: "ferrite",
          unit: "kg",
          estimatedKg: 184,
          minimumKg: 160,
          maximumKg: 210,
          exact: false,
        },
      },
    ],
  },
};

describe("scan formatting", () => {
  test("formats a single-tile scan with the full probability table and quantity estimate", () => {
    const output = formatScanReport(singleTileScan);

    expect(output).toContain("Scan Summary");
    expect(output).toContain("Position         (3, -2)");
    expect(output).toContain("Sensor Strength  60");
    expect(output).toContain("Resource Probabilities");
    expect(output).toContain("ferrite         63.50%");
    expect(output).toContain("ice-regolith    12.50%");
    expect(output).toContain("silicate-glass  4.00%");
    expect(output).toContain("none            20.00%");
    expect(output).toContain("Estimated Kg  184");
    expect(output).toContain("Minimum Kg    160");
    expect(output).toContain("Maximum Kg    210");
    expect(output).toContain("Exact         no");
  });

  test("formats a multi-tile scan as one summary row per tile", () => {
    const output = formatScanReport({
      scan: {
        ...singleTileScan.scan,
        radiusTiles: 1,
        tiles: [
          singleTileScan.scan.tiles[0],
          {
            x: 4,
            y: -2,
            terrain: "flat",
            distanceTiles: 1,
            probabilities: [
              { resourceType: null, probabilityPct: 55 },
              { resourceType: "ice-regolith", probabilityPct: 45 },
            ],
            topCandidate: {
              resourceType: null,
              probabilityPct: 55,
            },
            quantityEstimate: null,
          },
        ],
      },
    });

    expect(output).toContain("Tile Results");
    expect(output).toContain("(3, -2)      0         flat     ferrite");
    expect(output).toContain("184 kg (160-210 kg)");
    expect(output).toContain("(4, -2)      1         flat     none");
  });
});

describe("scan validation", () => {
  test("accepts valid scan options", () => {
    expect(validateScanOptions({ strength: 60, radius: 1 })).toBeNull();
  });

  test("rejects invalid strength and radius values", () => {
    expect(validateScanOptions({ strength: 101, radius: 1 })).toBe(
      "strength must be an integer from 0 through 100.",
    );
    expect(validateScanOptions({ strength: 60, radius: 6 })).toBe(
      "radius must be an integer from 0 through 5.",
    );
  });
});
