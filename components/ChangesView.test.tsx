// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChangesView } from "./ChangesView";
import type { ChangedFile, GitChangesState } from "./use-git-file";

afterEach(cleanup);

const file = (path: string, isViewed: boolean): ChangedFile => ({
  path,
  changeKind: "modified",
  additions: 3,
  deletions: 1,
  isUntracked: false,
  isUncommitted: true,
  isViewed,
});

const changes: GitChangesState = {
  isAvailable: true,
  files: [file("docs/viewer-design.md", true), file("src/viewer/light.ts", false)],
  insertions: 6,
  deletions: 2,
  isLoading: false,
};

const noop = () => undefined;

function rowLabel(path: string): HTMLElement {
  const open = screen.getByRole("button", { name: `Open ${path}` });
  return open.parentElement!.querySelector("span")!;
}

describe("ChangesView", () => {
  it("fades a viewed file to half strength, like Conductor", () => {
    render(
      <ChangesView changes={changes} layout="list" hideViewed={false} activePath={null} onOpenFile={noop} onDiscard={noop} />,
    );
    expect(rowLabel("docs/viewer-design.md").style.opacity).toBe("0.5");
    expect(rowLabel("src/viewer/light.ts").style.opacity).toBe("");
    expect(screen.getByText(/1 viewed/)).toBeTruthy();
  });

  it("leaves viewed files out when the Viewed filter is on", () => {
    render(
      <ChangesView changes={changes} layout="tree" hideViewed activePath={null} onOpenFile={noop} onDiscard={noop} />,
    );
    expect(screen.queryByRole("button", { name: "Open docs/viewer-design.md" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open src/viewer/light.ts" })).toBeTruthy();
    expect(screen.getByText(/1 viewed \(hidden\)/)).toBeTruthy();
  });
});
