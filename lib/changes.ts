/** Conductor's tree view of changes: one group per directory, files inside. */
export interface ChangeGroup<T extends { path: string }> {
  /** Directory path without trailing slash; "" for the workspace root. */
  directory: string;
  files: T[];
}

export function splitPath(path: string): { directory: string; name: string } {
  const slash = path.lastIndexOf("/");
  return slash === -1
    ? { directory: "", name: path }
    : { directory: path.slice(0, slash), name: path.slice(slash + 1) };
}

export function groupByDirectory<T extends { path: string }>(files: readonly T[]): ChangeGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const file of files) {
    const { directory } = splitPath(file.path);
    const group = groups.get(directory);
    if (group === undefined) groups.set(directory, [file]);
    else group.push(file);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => (left === "" ? -1 : right === "" ? 1 : left.localeCompare(right)))
    .map(([directory, grouped]) => ({
      directory,
      files: [...grouped].sort((left, right) => left.path.localeCompare(right.path)),
    }));
}
