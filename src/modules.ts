export type ModuleRecord = {
  id: string;
  blueprintId: string;
  displayName: string;
  connectedTo: string[];
  runtimeAttributes: Record<string, unknown>;
  capabilities: string[];
};

export const moduleRuntimeStatuses = ["offline", "idle", "online", "active", "damaged"] as const;

export type ModuleRuntimeStatus = (typeof moduleRuntimeStatuses)[number];

function toIdToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_");
}

function normalizeModuleLookupId(value: string): string {
  return toIdToken(value).toLowerCase();
}

export function getShortModuleId(module: ModuleRecord): string {
  const blueprintToken = toIdToken(module.blueprintId);
  const tokenStart = module.id.indexOf(blueprintToken);

  if (tokenStart === -1) {
    return module.id;
  }

  return module.id.slice(tokenStart);
}

export function formatModuleListItem(module: ModuleRecord): string {
  return `${getShortModuleId(module)}: ${module.displayName} (${module.blueprintId}) status=${
    module.runtimeAttributes.status ?? "Unknown"
  }`;
}

export function findModuleById(modules: ModuleRecord[] | undefined, moduleId: string): ModuleRecord | undefined {
  const normalizedModuleId = normalizeModuleLookupId(moduleId);
  return modules?.find(
    (module) =>
      normalizeModuleLookupId(module.id) === normalizedModuleId ||
      normalizeModuleLookupId(getShortModuleId(module)) === normalizedModuleId,
  );
}

export function isModuleRuntimeStatus(status: string): status is ModuleRuntimeStatus {
  return moduleRuntimeStatuses.includes(status as ModuleRuntimeStatus);
}

export function setModuleRuntimeStatus(module: ModuleRecord, status: ModuleRuntimeStatus): void {
  module.runtimeAttributes.status = status;
}
