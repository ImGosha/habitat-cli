export type ModuleRecord = {
  id: string;
  blueprintId: string;
  displayName: string;
  connectedTo: string[];
  runtimeAttributes: Record<string, unknown>;
  capabilities: string[];
};

function toIdToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_");
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
  return modules?.find((module) => module.id === moduleId || getShortModuleId(module) === moduleId);
}
