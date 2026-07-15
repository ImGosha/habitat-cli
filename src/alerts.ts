import type { AlertRecord, LocalState } from "./local-state.js";
import { formatTable } from "./cli-format.js";

type AlertSubject = AlertRecord["subject"];

function subjectsMatch(left: AlertSubject, right: AlertSubject): boolean {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.type === right.type && left.id === right.id;
}

export function listAlerts(state: LocalState): AlertRecord[] {
  return state.alerts ?? [];
}

export function openOrUpdateAlert(
  state: LocalState,
  input: Omit<AlertRecord, "id" | "openedAt" | "lastObservedAt" | "occurrenceCount">,
  now: string,
): AlertRecord {
  const alerts = state.alerts ?? [];
  const existing = alerts.find(
    (alert) => alert.code === input.code && alert.status !== "resolved" && subjectsMatch(alert.subject, input.subject),
  );

  if (existing) {
    existing.lastObservedAt = now;
    existing.occurrenceCount += 1;
    existing.description = input.description;
    existing.severity = input.severity;
    existing.source = input.source;
    existing.details = input.details;
    return existing;
  }

  const created: AlertRecord = {
    ...input,
    id: `alert_${alerts.length + 1}`,
    openedAt: now,
    lastObservedAt: now,
    occurrenceCount: 1,
  };
  alerts.push(created);
  state.alerts = alerts;
  return created;
}

export function acknowledgeAlert(state: LocalState, alertId: string, now: string): AlertRecord {
  const alert = (state.alerts ?? []).find((entry) => entry.id === alertId);

  if (!alert) {
    throw new Error(`Alert "${alertId}" was not found.`);
  }

  alert.status = "acknowledged";
  alert.acknowledgedAt = now;
  alert.lastObservedAt = now;
  return alert;
}

export function resolveAlertByCode(state: LocalState, code: string, now: string, subject?: AlertSubject): void {
  for (const alert of state.alerts ?? []) {
    if (alert.code === code && alert.status !== "resolved" && subjectsMatch(alert.subject, subject)) {
      alert.status = "resolved";
      alert.resolvedAt = now;
      alert.lastObservedAt = now;
    }
  }
}

export function formatAlertList(alerts: AlertRecord[]): string {
  if (alerts.length === 0) {
    return "No alerts found.";
  }

  return formatTable(
    ["Alert ID", "Code", "Severity", "Status", "Occurrences", "Subject"],
    alerts.map((alert) => [
      alert.id,
      alert.code,
      alert.severity,
      alert.status,
      String(alert.occurrenceCount),
      alert.subject ? `${alert.subject.type}:${alert.subject.id}` : "Habitat",
    ]),
  );
}
