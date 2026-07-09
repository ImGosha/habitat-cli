import type { ModuleRecord } from "./modules.js";

type ConstructionJobLike = {
  outputModuleId?: unknown;
};

function toIdToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_");
}

function getExistingLocalModuleIds(modules: ModuleRecord[] = []): string[] {
  const ids: string[] = [];

  for (const module of modules) {
    ids.push(module.id);

    const constructionJob = module.runtimeAttributes.constructionJob as ConstructionJobLike | undefined;
    if (constructionJob && typeof constructionJob.outputModuleId === "string") {
      ids.push(constructionJob.outputModuleId);
    }
  }

  return ids;
}

export function createNextLocalModuleId(modules: ModuleRecord[] = [], blueprintId: string): string {
  const blueprintToken = toIdToken(blueprintId);
  const prefix = `local_${blueprintToken}_`;
  const existingIds = getExistingLocalModuleIds(modules);
  let highestSequence = 0;

  for (const id of existingIds) {
    if (!id.startsWith(prefix)) {
      continue;
    }

    const suffix = id.slice(prefix.length);
    const sequence = Number(suffix);

    if (Number.isInteger(sequence) && sequence > highestSequence) {
      highestSequence = sequence;
    }
  }

  return `${prefix}${highestSequence + 1}`;
}
