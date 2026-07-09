export type TableRow = string[];

function padCell(value: string, width: number): string {
  return value.padEnd(width, " ");
}

export function formatTable(headers: string[], rows: TableRow[]): string {
  if (headers.length === 0) {
    return "";
  }

  const widths = headers.map((header, columnIndex) =>
    Math.max(header.length, ...rows.map((row) => (row[columnIndex] ?? "").length)),
  );

  const headerLine = headers.map((header, columnIndex) => padCell(header, widths[columnIndex])).join("  ").trimEnd();
  const dividerLine = widths.map((width) => "-".repeat(width)).join("  ");
  const bodyLines = rows.map((row) =>
    headers
      .map((_, columnIndex) => padCell(row[columnIndex] ?? "", widths[columnIndex]))
      .join("  ")
      .trimEnd(),
  );

  return [headerLine, dividerLine, ...bodyLines].join("\n");
}

export function formatKeyValueRows(rows: Array<[string, string]>): string {
  if (rows.length === 0) {
    return "";
  }

  const keyWidth = Math.max(...rows.map(([key]) => key.length));
  return rows.map(([key, value]) => `${padCell(key, keyWidth)}  ${value}`).join("\n");
}

export function formatSection(title: string, body: string): string {
  if (body.trim().length === 0) {
    return title;
  }

  return [title, "-".repeat(title.length), body].join("\n");
}

export function formatExamples(lines: string[]): string {
  return formatSection("Examples", lines.map((line) => `  ${line}`).join("\n"));
}

export function formatList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

export function formatBoolean(value: boolean): string {
  return value ? "yes" : "no";
}

export function formatUnknownValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "None";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

export function formatRecordTable(
  record: Record<string, unknown>,
  keyHeader = "Field",
  valueHeader = "Value",
): string {
  const entries = Object.entries(record).map(([key, value]) => [key, formatUnknownValue(value)]);
  return formatTable([keyHeader, valueHeader], entries);
}
