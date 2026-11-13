import type { ReactNode } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  BracesIcon,
  FileCodeIcon,
  FileEmpty02Icon,
  FileTextIcon,
  FolderClosedIcon,
  FolderOpenIcon,
  Image01Icon,
  NoteIcon,
  Pdf01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { extensionOf, glyphTone, type GlyphTone } from "@/lib/file-kind";

// Per-type marks and colours measured from Conductor's file tree.
const FOLDER_COLOR = "#a4a09c";

type Mark = { icon: IconSvgElement; color: string };

const MARK_BY_EXTENSION: Readonly<Record<string, Mark>> = {
  json: { icon: BracesIcon, color: "#c68a0b" },
  jsonc: { icon: BracesIcon, color: "#c68a0b" },
  log: { icon: NoteIcon, color: "#b0b447" },
  txt: { icon: FileTextIcon, color: "#756f6b" },
  pdf: { icon: Pdf01Icon, color: "#d42322" },
};

// Types Conductor's tree did not show keep the explorer's tone, as a file mark.
const TONE_COLOR: Readonly<Record<GlyphTone, string>> = {
  code: "#519aba",
  config: "#c68a0b",
  markup: "#e37933",
  style: "#a074c4",
  doc: "#8b8682",
  media: "#4fc55f",
  plain: "#756f6b",
};

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx", "markdown"]);

/** The coloured file/folder mark on an explorer row. */
export function FileGlyph({
  path,
  kind,
  isExpanded,
  className,
}: {
  path: string;
  kind: "file" | "directory";
  isExpanded?: boolean;
  className?: string;
}): ReactNode {
  const iconClass = cn("size-3.5 shrink-0", className);
  if (kind === "directory") {
    return (
      <HugeiconsIcon
        icon={isExpanded === true ? FolderOpenIcon : FolderClosedIcon}
        aria-hidden
        className={iconClass}
        style={{ color: FOLDER_COLOR }}
      />
    );
  }

  const extension = extensionOf(path);
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return <MarkdownMark className={iconClass} />;
  }
  const tone = glyphTone(path);
  const mark =
    MARK_BY_EXTENSION[extension] ??
    (tone === "media"
      ? { icon: Image01Icon, color: TONE_COLOR.media }
      : tone === "code" || tone === "markup" || tone === "style"
        ? { icon: FileCodeIcon, color: TONE_COLOR[tone] }
        : { icon: FileEmpty02Icon, color: TONE_COLOR[tone] });
  return (
    <HugeiconsIcon
      icon={mark.icon}
      aria-hidden
      className={iconClass}
      style={{ color: mark.color }}
    />
  );
}

/** Conductor marks Markdown with a filled "M↓" badge. */
function MarkdownMark({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className}>
      <rect x="0.5" y="3" width="15" height="10" rx="2" fill="#8b8682" />
      <path
        d="M3 10.5v-5l2 2.4 2-2.4v5M11 5.5v4.5M9.2 8.3 11 10.3l1.8-2"
        fill="none"
        stroke="#1c1917"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
