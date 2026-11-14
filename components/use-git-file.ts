import { useCallback, useEffect } from "react";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import {
  experimental_useRpcKeyedQuery as useRpcKeyedQuery,
  experimental_useRpcMutation as useRpcMutation,
  experimental_useRpcQuery as useRpcQuery,
} from "@get-bb/plugin-sdk/app";
import { z } from "zod";

/**
 * The slice of BB's git plugin (`bb--git`) the editor reads: which diff target
 * the workspace compares against, one file's patch, and its Viewed mark. The
 * schemas are deliberately loose so a newer git plugin can add fields.
 */
const GIT_PLUGIN_ID = "bb--git";

const targetSchema = z.union([
  z.object({ type: z.literal("uncommitted") }),
  z.object({ type: z.literal("all"), mergeBaseBranch: z.string() }),
]);
type DiffTarget = z.infer<typeof targetSchema>;

const environmentInput = { environmentId: z.string().min(1) };

const gitContract = defineRpcContract({
  status: {
    input: z.object({ keys: z.array(z.string().min(1)) }),
    output: z.record(
      z.string(),
      z.looseObject({
        outcome: z.string(),
        workspace: z
          .looseObject({
            mergeBase: z
              .looseObject({ mergeBaseBranch: z.string(), behindCount: z.number().optional() })
              .nullable()
              .optional(),
          })
          .optional(),
      }),
    ),
  },
  files: {
    input: z.object({ ...environmentInput, target: targetSchema, ignoreWhitespace: z.boolean() }),
    output: z.looseObject({
      outcome: z.string(),
      mergeBaseRef: z.string().nullable().optional(),
      files: z
        .array(
          z.looseObject({
            path: z.string(),
            changeKind: z.string(),
            additions: z.number(),
            deletions: z.number(),
            binary: z.boolean(),
            origin: z.string(),
            revision: z.string(),
          }),
        )
        .optional(),
    }),
  },
  patches: {
    input: z.object({ keys: z.array(z.string().min(1)) }),
    output: z.record(
      z.string(),
      z.looseObject({
        outcome: z.string(),
        patch: z.looseObject({ patch: z.string(), truncated: z.boolean() }).optional(),
      }),
    ),
  },
  fileSide: {
    input: z.object({
      ...environmentInput,
      query: z.union([
        z.object({ target: z.literal("uncommitted"), path: z.string(), side: z.literal("old") }),
        z.object({
          target: z.literal("all"),
          mergeBaseRef: z.string(),
          path: z.string(),
          side: z.literal("old"),
        }),
      ]),
    }),
    output: z.looseObject({
      outcome: z.string(),
      code: z.string().optional(),
      file: z.looseObject({ content: z.string(), contentEncoding: z.string() }).optional(),
    }),
  },
  viewed: {
    input: z.object({ ...environmentInput, target: targetSchema, paths: z.array(z.string()) }),
    output: z.looseObject({
      files: z.array(z.looseObject({ path: z.string(), revision: z.string() })),
    }),
  },
  markViewed: {
    input: z.object({
      ...environmentInput,
      target: targetSchema,
      path: z.string(),
      revision: z.string(),
    }),
    output: z.looseObject({ ok: z.boolean() }),
  },
  clearViewed: {
    input: z.object({ ...environmentInput, target: targetSchema, path: z.string() }),
    output: z.looseObject({ ok: z.boolean() }),
  },
});

/** Fired after a Viewed mark changes, so other views of it refresh. */
export const VIEWED_CHANGED_EVENT = "workspace-files:viewed-changed";

/** Same key format as the git plugin's `gitPatchKey`. */
function patchKey(
  environmentId: string,
  target: DiffTarget,
  ignoreWhitespace: boolean,
  path: string,
  revision: string,
): string {
  return JSON.stringify([environmentId, target, ignoreWhitespace, path, revision]);
}

export interface GitFileState {
  /** The file has changes against the workspace's diff target. */
  isChanged: boolean;
  patch: string | null;
  isPatchTruncated: boolean;
  isBinary: boolean;
  changeKind: string | null;
  /** The file before the changes (empty for a new file); null while loading. */
  originalContent: string | null;
  /** Untracked files are new on disk and not yet known to git. */
  isUntracked: boolean;
  isViewed: boolean;
  isLoading: boolean;
  /**
   * Everything a diff of this file needs has arrived (or failed): whether it
   * is changed, its patch, and the old side for the full-file view. A diff
   * drawn before then is drawn again when the rest arrives, which shows as
   * the view jumping on every file switch.
   */
  isSettled: boolean;
  setViewed(viewed: boolean): Promise<void>;
}

const NO_CHANGES: GitFileState = {
  isChanged: false,
  patch: null,
  isPatchTruncated: false,
  isBinary: false,
  changeKind: null,
  originalContent: null,
  isUntracked: false,
  isViewed: false,
  isLoading: false,
  isSettled: true,
  setViewed: async () => undefined,
};

export function useGitFile({
  environmentId,
  path,
  ignoreWhitespace,
}: {
  environmentId: string | null;
  path: string | null;
  ignoreWhitespace: boolean;
}): GitFileState {
  const enabled = environmentId !== null && path !== null;

  const status = useRpcKeyedQuery({
    pluginId: GIT_PLUGIN_ID,
    contract: gitContract,
    method: "status",
    keys: environmentId === null ? [] : [environmentId],
    enabled,
  });
  const row = environmentId === null ? undefined : status.data?.[environmentId];
  const isGit = row?.outcome === "available";
  // The Diff tab's rule: compare with the merge-base branch when one
  // resolves, otherwise show what is not committed yet.
  const mergeBaseBranch = row?.workspace?.mergeBase?.mergeBaseBranch;
  const target: DiffTarget =
    mergeBaseBranch === undefined || mergeBaseBranch === ""
      ? { type: "uncommitted" }
      : { type: "all", mergeBaseBranch };

  const files = useRpcQuery({
    pluginId: GIT_PLUGIN_ID,
    contract: gitContract,
    method: "files",
    input: { environmentId: environmentId ?? "-", target, ignoreWhitespace },
    enabled: enabled && isGit,
  });
  const entry =
    files.data?.outcome === "available"
      ? files.data.files?.find((file) => file.path === path)
      : undefined;

  const key =
    entry === undefined || environmentId === null
      ? null
      : patchKey(environmentId, target, ignoreWhitespace, entry.path, entry.revision);
  const patches = useRpcKeyedQuery({
    pluginId: GIT_PLUGIN_ID,
    contract: gitContract,
    method: "patches",
    keys: key === null ? [] : [key],
    enabled: key !== null && entry?.binary !== true,
  });
  const patchRow = key === null ? undefined : patches.data?.[key];

  const mergeBaseRef = files.data?.mergeBaseRef ?? null;
  const sideQuery =
    entry === undefined || path === null
      ? null
      : target.type === "uncommitted"
        ? ({ target: "uncommitted", path: entry.path, side: "old" } as const)
        : mergeBaseRef === null
          ? null
          : ({ target: "all", mergeBaseRef, path: entry.path, side: "old" } as const);
  const isNewFile = entry?.origin === "untracked" || entry?.changeKind === "added";
  const oldSide = useRpcQuery({
    pluginId: GIT_PLUGIN_ID,
    contract: gitContract,
    method: "fileSide",
    input: {
      environmentId: environmentId ?? "-",
      query: sideQuery ?? { target: "uncommitted", path: path ?? "-", side: "old" },
    },
    enabled: sideQuery !== null && !isNewFile && entry?.binary !== true,
  });
  const originalContent = isNewFile
    ? ""
    : oldSide.data === undefined
      ? null
      : oldSide.data.outcome === "available" && oldSide.data.file !== undefined
        ? oldSide.data.file.contentEncoding === "base64"
          ? null
          : oldSide.data.file.content
        : oldSide.data.code === "ENOENT"
          ? ""
          : null;

  const viewed = useRpcQuery({
    pluginId: GIT_PLUGIN_ID,
    contract: gitContract,
    method: "viewed",
    input: { environmentId: environmentId ?? "-", target, paths: path === null ? [] : [path] },
    enabled: enabled && isGit && entry !== undefined,
  });
  const isViewed =
    entry !== undefined &&
    (viewed.data?.files ?? []).some(
      (file) => file.path === entry.path && file.revision === entry.revision,
    );

  const mark = useRpcMutation({ pluginId: GIT_PLUGIN_ID, contract: gitContract, method: "markViewed" });
  const clear = useRpcMutation({ pluginId: GIT_PLUGIN_ID, contract: gitContract, method: "clearViewed" });
  const setViewed = useCallback(
    async (next: boolean) => {
      if (environmentId === null || entry === undefined) return;
      if (next) {
        await mark.mutate({ environmentId, target, path: entry.path, revision: entry.revision });
      } else {
        await clear.mutate({ environmentId, target, path: entry.path });
      }
      await viewed.refetch();
      window.dispatchEvent(new CustomEvent(VIEWED_CHANGED_EVENT, { detail: { environmentId } }));
    },
    // `target` is rebuilt every render; its fields are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [environmentId, entry?.path, entry?.revision, target.type, mergeBaseBranch, mark, clear, viewed],
  );

  if (!enabled || !isGit || entry === undefined) {
    const isLoading = status.isLoading || files.isLoading;
    return { ...NO_CHANGES, isLoading, isSettled: !isLoading };
  }
  // `isLoading` is false for a moment before a new key's read starts, so
  // settled means "the row is here", not "nothing is loading".
  const isPatchSettled = entry.binary || patchRow !== undefined || patches.error !== null;
  const isOldSideSettled =
    sideQuery === null ||
    isNewFile ||
    entry.binary ||
    oldSide.data !== undefined ||
    oldSide.error !== null;
  return {
    isChanged: true,
    patch: patchRow?.outcome === "available" ? (patchRow.patch?.patch ?? null) : null,
    isPatchTruncated: patchRow?.patch?.truncated === true,
    isBinary: entry.binary,
    changeKind: entry.changeKind,
    originalContent,
    isUntracked: entry.origin === "untracked",
    isViewed,
    isLoading: patches.isLoading,
    isSettled: isPatchSettled && isOldSideSettled,
    setViewed,
  };
}

export interface ChangedFile {
  path: string;
  changeKind: string;
  additions: number;
  deletions: number;
  /** New on disk and not yet known to git. */
  isUntracked: boolean;
  /** Part of the not-yet-committed changes (Conductor's "U"). */
  isUncommitted: boolean;
  /** Marked Viewed at its current revision (a new edit clears it). */
  isViewed: boolean;
}

export interface GitChangesState {
  /** The workspace is a git checkout BB can diff. */
  isAvailable: boolean;
  files: ChangedFile[];
  insertions: number;
  deletions: number;
  isLoading: boolean;
  /** The branch the workspace compares with, e.g. "origin/main"; null without one. */
  baseBranch: string | null;
  /** Commits on the base branch this checkout does not have yet. */
  behindCount: number;
}

/**
 * Every changed file of a workspace against the same target the editor diffs
 * with (the merge-base branch, else uncommitted), plus which of them still
 * have uncommitted edits.
 */
export function useGitChanges(environmentId: string | null): GitChangesState {
  const enabled = environmentId !== null;
  const status = useRpcKeyedQuery({
    pluginId: GIT_PLUGIN_ID,
    contract: gitContract,
    method: "status",
    keys: environmentId === null ? [] : [environmentId],
    enabled,
  });
  const row = environmentId === null ? undefined : status.data?.[environmentId];
  const isGit = row?.outcome === "available";
  const mergeBaseBranch = row?.workspace?.mergeBase?.mergeBaseBranch;
  const target: DiffTarget =
    mergeBaseBranch === undefined || mergeBaseBranch === ""
      ? { type: "uncommitted" }
      : { type: "all", mergeBaseBranch };

  const files = useRpcQuery({
    pluginId: GIT_PLUGIN_ID,
    contract: gitContract,
    method: "files",
    input: { environmentId: environmentId ?? "-", target, ignoreWhitespace: false },
    enabled: enabled && isGit,
  });
  const uncommitted = useRpcQuery({
    pluginId: GIT_PLUGIN_ID,
    contract: gitContract,
    method: "files",
    input: { environmentId: environmentId ?? "-", target: { type: "uncommitted" }, ignoreWhitespace: false },
    enabled: enabled && isGit && target.type === "all",
  });

  const listed = files.data?.outcome === "available" ? (files.data.files ?? []) : [];
  const viewed = useRpcQuery({
    pluginId: GIT_PLUGIN_ID,
    contract: gitContract,
    method: "viewed",
    input: { environmentId: environmentId ?? "-", target, paths: listed.slice(0, 500).map((file) => file.path) },
    enabled: enabled && isGit && listed.length > 0,
  });
  const refetchViewed = viewed.refetch;
  useEffect(() => {
    const onChanged = (event: Event) => {
      if ((event as CustomEvent<{ environmentId: string }>).detail.environmentId === environmentId) {
        void refetchViewed();
      }
    };
    window.addEventListener(VIEWED_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(VIEWED_CHANGED_EVENT, onChanged);
  }, [environmentId, refetchViewed]);
  const viewedRevisions = new Map((viewed.data?.files ?? []).map((file) => [file.path, file.revision]));
  const uncommittedPaths = new Set(
    target.type === "uncommitted"
      ? listed.map((file) => file.path)
      : uncommitted.data?.outcome === "available"
        ? (uncommitted.data.files ?? []).map((file) => file.path)
        : [],
  );
  const changed: ChangedFile[] = listed
    .map((file) => ({
      path: file.path,
      changeKind: file.changeKind,
      additions: file.additions,
      deletions: file.deletions,
      isUntracked: file.origin === "untracked",
      isUncommitted: uncommittedPaths.has(file.path),
      isViewed: viewedRevisions.get(file.path) === file.revision,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    isAvailable: isGit,
    files: changed,
    insertions: changed.reduce((total, file) => total + file.additions, 0),
    deletions: changed.reduce((total, file) => total + file.deletions, 0),
    isLoading: status.isLoading || files.isLoading,
    baseBranch: mergeBaseBranch === undefined || mergeBaseBranch === "" ? null : mergeBaseBranch,
    behindCount: row?.workspace?.mergeBase?.behindCount ?? 0,
  };
}
