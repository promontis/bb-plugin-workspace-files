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
  PythonIcon,
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

// Conductor marks scripts with filled language badges.
const BADGE_BY_EXTENSION: Readonly<Record<string, { label: string; fill: string; ink: string }>> = {
  js: { label: "JS", fill: "#f5c90f", ink: "#1c1917" },
  mjs: { label: "JS", fill: "#f5c90f", ink: "#1c1917" },
  cjs: { label: "JS", fill: "#f5c90f", ink: "#1c1917" },
  jsx: { label: "JS", fill: "#f5c90f", ink: "#1c1917" },
  ts: { label: "TS", fill: "#3178c6", ink: "#ffffff" },
  mts: { label: "TS", fill: "#3178c6", ink: "#ffffff" },
  cts: { label: "TS", fill: "#3178c6", ink: "#ffffff" },
  tsx: { label: "TS", fill: "#3178c6", ink: "#ffffff" },
};

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
  const badge = BADGE_BY_EXTENSION[extension];
  if (badge !== undefined) {
    return <LanguageBadge className={iconClass} {...badge} />;
  }
  if (extension === "py" || extension === "pyi") {
    return (
      <HugeiconsIcon
        icon={PythonIcon}
        aria-hidden
        strokeWidth={2}
        className={iconClass}
        style={{ color: "#437efc" }}
      />
    );
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

/** A filled square with the language's initials in its lower right. */
function LanguageBadge({
  label,
  fill,
  ink,
  className,
}: {
  label: string;
  fill: string;
  ink: string;
  className: string;
}) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className}>
      <rect x="1" y="1" width="14" height="14" rx="1.5" fill={fill} />
      <text
        x="14"
        y="13.6"
        textAnchor="end"
        fontSize="7.5"
        fontWeight="700"
        fontFamily="ui-sans-serif, -apple-system, sans-serif"
        fill={ink}
      >
        {label}
      </text>
    </svg>
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
