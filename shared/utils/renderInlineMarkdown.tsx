import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import * as React from "react";
import underlinesRule from "../editor/rules/underlines";
import { sanitizeUrl } from "./urls";

// a minimal instance covering only the inline marks a Text property value can
// hold (bold, italic, underline, strikethrough, code, links) — no block-level
// rules are needed since parseInline never runs them. Mirrors the same
// underline rewrite the real editor's markdown-it instance uses (see
// shared/editor/lib/markdown/rules.ts), so `__text__` reads as underline
// rather than bold, matching note bodies exactly.
const md = MarkdownIt("default", {
  html: false,
  linkify: false,
  breaks: false,
}).use(underlinesRule);

type InlineTag = "strong" | "em" | "u" | "del" | "a";

type Frame = {
  tag: InlineTag;
  href?: string;
  children: React.ReactNode[];
};

const OPEN_TAGS: Partial<Record<string, InlineTag>> = {
  strong_open: "strong",
  em_open: "em",
  underline_open: "u",
  s_open: "del",
  link_open: "a",
};

/**
 * Renders a Text property's markdown value as React elements, applying the
 * same inline formatting (bold, italic, underline, strikethrough, code,
 * links) a document body would, without any block-level markdown. Used for
 * read-only display outside the app's editor, such as the embedded database
 * block, which lives in shared code and cannot reach the app's ProseMirror
 * instance.
 *
 * @param text the property's markdown value.
 * @returns the formatted content, or the original text if parsing fails.
 */
export function renderInlineMarkdown(text: string): React.ReactNode {
  if (!text) {
    return text;
  }

  let tokens: Token[];
  try {
    tokens = md.parseInline(text, {})[0]?.children ?? [];
  } catch (_err) {
    return text;
  }

  const root: React.ReactNode[] = [];
  const stack: Frame[] = [];
  let key = 0;

  const currentChildren = () =>
    stack.length ? stack[stack.length - 1].children : root;

  for (const token of tokens) {
    const openTag = OPEN_TAGS[token.type];
    if (openTag) {
      stack.push({
        tag: openTag,
        href: openTag === "a" ? sanitizeUrl(token.attrGet("href")) : undefined,
        children: [],
      });
      continue;
    }

    if (token.type.endsWith("_close") && stack.length > 0) {
      const frame = stack.pop();
      if (!frame) {
        continue;
      }
      const element =
        frame.tag === "a" ? (
          <a
            key={key++}
            href={frame.href}
            target="_blank"
            rel="noreferrer nofollow"
          >
            {frame.children}
          </a>
        ) : (
          React.createElement(frame.tag, { key: key++ }, frame.children)
        );
      currentChildren().push(element);
      continue;
    }

    switch (token.type) {
      case "text":
        currentChildren().push(token.content);
        break;
      case "softbreak":
      case "hardbreak":
        currentChildren().push(<br key={key++} />);
        break;
      case "code_inline":
        currentChildren().push(<code key={key++}>{token.content}</code>);
        break;
      default:
        break;
    }
  }

  return root;
}
