// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD_PREVIOUS_MS, HoldWhileLoading } from "./HoldWhileLoading";

afterEach(cleanup);
beforeEach(() => {
  vi.useFakeTimers();
  return () => vi.useRealTimers();
});

function view(contentKey: string, ready: boolean, text: string) {
  return (
    <HoldWhileLoading contentKey={contentKey} ready={ready}>
      <p>{text}</p>
    </HoldWhileLoading>
  );
}

describe("HoldWhileLoading", () => {
  it("keeps the previous file on screen while the next one loads", () => {
    const { rerender, container } = render(view("file:a.ts", true, "a.ts"));
    rerender(view("file:b.ts", false, "Opening b.ts…"));
    expect(screen.getByText("a.ts")).toBeTruthy();
    expect(screen.queryByText("Opening b.ts…")).toBeNull();
    expect(container.firstElementChild?.hasAttribute("inert")).toBe(true);

    rerender(view("file:b.ts", true, "b.ts"));
    expect(screen.getByText("b.ts")).toBeTruthy();
    expect(container.firstElementChild?.hasAttribute("inert")).toBe(false);
  });

  it("shows the loading state once the load is slow", () => {
    const { rerender } = render(view("file:a.ts", true, "a.ts"));
    rerender(view("file:b.ts", false, "Opening b.ts…"));
    act(() => {
      vi.advanceTimersByTime(HOLD_PREVIOUS_MS);
    });
    expect(screen.getByText("Opening b.ts…")).toBeTruthy();
  });

  it("shows the loading state when there is nothing to hold", () => {
    render(view("file:a.ts", false, "Opening a.ts…"));
    expect(screen.getByText("Opening a.ts…")).toBeTruthy();
  });

  it("keeps the same child mounted from the held view to the ready one", () => {
    let mounts = 0;
    function Editor({ path }: { path: string }) {
      useState(() => (mounts += 1));
      return <p>{path}</p>;
    }
    const { rerender } = render(
      <HoldWhileLoading contentKey="file:a.ts" ready>
        <Editor path="a.ts" />
      </HoldWhileLoading>,
    );
    rerender(
      <HoldWhileLoading contentKey="file:b.ts" ready={false}>
        <Editor path="b.ts" />
      </HoldWhileLoading>,
    );
    rerender(
      <HoldWhileLoading contentKey="file:b.ts" ready>
        <Editor path="b.ts" />
      </HoldWhileLoading>,
    );
    expect(screen.getByText("b.ts")).toBeTruthy();
    expect(mounts).toBe(1);
  });
});
