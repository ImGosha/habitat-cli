import { formatKeyValueRows, formatSection, formatTable } from "./cli-format.js";

export type ScanProbability = {
  resourceType: string | null;
  probabilityPct: number;
};

export type ScanQuantityEstimate = {
  resourceType: string | null;
  unit?: string;
  estimatedKg: number;
  minimumKg: number;
  maximumKg: number;
  exact: boolean;
  estimatedValue?: number;
};

export type ScanTile = {
  x: number;
  y: number;
  terrain: string;
  distanceTiles: number;
  probabilities: ScanProbability[];
  topCandidate: ScanProbability;
  quantityEstimate: ScanQuantityEstimate | null;
};

export type ScanPayload = {
  modelVersion: string;
  origin: {
    x: number;
    y: number;
  };
  sensorStrength: number;
  radiusTiles: number;
  tiles: ScanTile[];
};

export type ScanResponse = {
  scan: ScanPayload;
};

export type ScanOptions = {
  strength: number;
  radius: number;
  json?: boolean;
};

function formatNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function formatProbabilityResource(resourceType: string | null): string {
  return resourceType ?? "none";
}

function formatProbabilityPercent(probabilityPct: number): string {
  return `${probabilityPct.toFixed(2)}%`;
}

function formatQuantityEstimate(quantityEstimate: ScanTile["quantityEstimate"]): string {
  if (!quantityEstimate || quantityEstimate.resourceType === null) {
    return "";
  }

  const base = `${formatNumber(quantityEstimate.estimatedKg)} kg`;

  if (quantityEstimate.exact) {
    return `${base} exact`;
  }

  return `${base} (${formatNumber(quantityEstimate.minimumKg)}-${formatNumber(quantityEstimate.maximumKg)} kg)`;
}

function formatQuantityEstimateDetails(quantityEstimate: ScanTile["quantityEstimate"]): string {
  if (!quantityEstimate || quantityEstimate.resourceType === null) {
    return "None";
  }

  const rows: Array<[string, string]> = [
    ["Resource", formatProbabilityResource(quantityEstimate.resourceType)],
    ["Estimated Kg", formatNumber(quantityEstimate.estimatedKg)],
    ["Minimum Kg", formatNumber(quantityEstimate.minimumKg)],
    ["Maximum Kg", formatNumber(quantityEstimate.maximumKg)],
    ["Exact", quantityEstimate.exact ? "yes" : "no"],
  ];

  if (typeof quantityEstimate.unit === "string" && quantityEstimate.unit.length > 0) {
    rows.push(["Unit", quantityEstimate.unit]);
  }

  if (typeof quantityEstimate.estimatedValue === "number") {
    rows.push(["Estimated Value", formatNumber(quantityEstimate.estimatedValue)]);
  }

  return formatKeyValueRows(rows);
}

export function validateScanOptions(options: ScanOptions): string | null {
  if (!Number.isInteger(options.strength) || options.strength < 0 || options.strength > 100) {
    return "strength must be an integer from 0 through 100.";
  }

  if (!Number.isInteger(options.radius) || options.radius < 0 || options.radius > 5) {
    return "radius must be an integer from 0 through 5.";
  }

  return null;
}

export function formatScanReport(response: ScanResponse): string {
  const scan = response.scan;
  const summary = formatSection(
    "Scan Summary",
    formatKeyValueRows([
      ["Position", `(${scan.origin.x}, ${scan.origin.y})`],
      ["Sensor Strength", String(scan.sensorStrength)],
      ["Radius", String(scan.radiusTiles)],
      ["Tiles Returned", String(scan.tiles.length)],
      ["Model Version", scan.modelVersion],
    ]),
  );

  if (scan.radiusTiles === 0 && scan.tiles.length === 1) {
    const [tile] = scan.tiles;
    const probabilityTable = formatTable(
      ["Resource", "Probability"],
      tile.probabilities.map((entry) => [
        formatProbabilityResource(entry.resourceType),
        formatProbabilityPercent(entry.probabilityPct),
      ]),
    );

    const tileSummary = formatSection(
      "Tile Summary",
      formatKeyValueRows([
        ["Coordinates", `(${tile.x}, ${tile.y})`],
        ["Distance", formatNumber(tile.distanceTiles)],
        ["Terrain", tile.terrain],
        ["Top Candidate", formatProbabilityResource(tile.topCandidate.resourceType)],
        ["Confidence", formatProbabilityPercent(tile.topCandidate.probabilityPct)],
      ]),
    );

    return [
      summary,
      tileSummary,
      formatSection("Resource Probabilities", probabilityTable),
      formatSection("Quantity Estimate", formatQuantityEstimateDetails(tile.quantityEstimate)),
    ].join("\n\n");
  }

  const tileRows = scan.tiles.map((tile) => [
    `(${tile.x}, ${tile.y})`,
    formatNumber(tile.distanceTiles),
    tile.terrain,
    formatProbabilityResource(tile.topCandidate.resourceType),
    formatProbabilityPercent(tile.topCandidate.probabilityPct),
    formatQuantityEstimate(tile.quantityEstimate),
  ]);

  return [
    summary,
    formatSection(
      "Tile Results",
      formatTable(
        ["Coordinates", "Distance", "Terrain", "Top Candidate", "Confidence", "Estimated Quantity"],
        tileRows,
      ),
    ),
  ].join("\n\n");
}
