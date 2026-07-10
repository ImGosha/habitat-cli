import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function findProjectRootPath(startPath = process.cwd()): string {
  let currentPath = startPath;

  while (true) {
    if (existsSync(join(currentPath, "package.json")) && existsSync(join(currentPath, "src"))) {
      return currentPath;
    }

    const parentPath = dirname(currentPath);

    if (parentPath === currentPath) {
      return startPath;
    }

    currentPath = parentPath;
  }
}

export function getHabitatSqlitePath(startPath = process.cwd()): string {
  return join(findProjectRootPath(startPath), "habitat.sqlite");
}
