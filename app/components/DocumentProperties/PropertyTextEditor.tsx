import type { Command } from "prosemirror-state";
import { observer } from "mobx-react";
import * as React from "react";
import styled from "styled-components";
import Extension from "@shared/editor/lib/Extension";
import DeleteNearAtom from "@shared/editor/extensions/DeleteNearAtom";
import History from "@shared/editor/extensions/History";
import InputRuleUndo from "@shared/editor/extensions/InputRuleUndo";
import MaxLength from "@shared/editor/extensions/MaxLength";
import Bold from "@shared/editor/marks/Bold";
import Code from "@shared/editor/marks/Code";
import Italic from "@shared/editor/marks/Italic";
import Link from "@shared/editor/marks/Link";
import Strikethrough from "@shared/editor/marks/Strikethrough";
import Underline from "@shared/editor/marks/Underline";
import Doc from "@shared/editor/nodes/Doc";
import HardBreak from "@shared/editor/nodes/HardBreak";
import Paragraph from "@shared/editor/nodes/Paragraph";
import Text from "@shared/editor/nodes/Text";
import { s } from "@shared/styles";
import EditorComponent from "~/components/Editor";
import ClipboardTextSerializer from "~/editor/extensions/ClipboardTextSerializer";
import Keys from "~/editor/extensions/Keys";
import PasteHandler from "~/editor/extensions/PasteHandler";
import PreventTab from "~/editor/extensions/PreventTab";
import SmartText from "~/editor/extensions/SmartText";

/**
 * Blurs the editor on Enter instead of splitting into a new paragraph, for
 * property values that hold a single line of text (table/board/gallery
 * cells). Row detail panels allow multiple paragraphs and don't load this.
 */
class BlurOnEnter extends Extension {
  get name() {
    return "blur_on_enter";
  }

  keys(): Record<string, Command> {
    return {
      Enter: (_state, _dispatch, view) => {
        view?.dom.blur();
        return true;
      },
    };
  }
}

const inlineFormattingExtensions = [
  Doc,
  InputRuleUndo,
  Paragraph,
  Text,
  HardBreak,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Link,
  History,
  DeleteNearAtom,
  MaxLength,
  SmartText,
  PasteHandler,
  ClipboardTextSerializer,
  PreventTab,
  Keys,
];

const singleLineExtensions = [...inlineFormattingExtensions, BlurOnEnter];

type Props = {
  /** The current markdown value of the property. */
  value: string;
  /** Placeholder shown when the value is editable and empty. */
  placeholder?: string;
  /** Whether the value cannot be edited. */
  readOnly?: boolean;
  /**
   * Whether the value may span multiple lines/paragraphs, like a note body.
   * A single-line value commits on Enter rather than starting a new line.
   */
  wrap?: boolean;
  /** Callback with the new value; null unsets the property. */
  onChange: (value: string | null) => void;
};

/**
 * Edits a Text property value with the same inline formatting (bold, italic,
 * links, code, strikethrough) as a document body, backed by the same
 * markdown source, so typed markdown such as `**bold**` renders as it would
 * in a note rather than showing as literal syntax. Commits on blur, like the
 * other property editors.
 */
function PropertyTextEditor({
  value,
  placeholder,
  readOnly,
  wrap,
  onChange,
}: Props) {
  const [initialValue] = React.useState(value);
  const committedRef = React.useRef(value);
  const pendingRef = React.useRef(value);

  const handleChange = React.useCallback(
    (getValue: (asString?: boolean, trim?: boolean) => string) => {
      pendingRef.current = getValue(true, true);
    },
    []
  );

  const handleBlur = React.useCallback(() => {
    const next = pendingRef.current;
    if (next === committedRef.current) {
      return;
    }
    committedRef.current = next;
    onChange(next === "" ? null : next);
  }, [onChange]);

  return (
    <Container $wrap={!!wrap}>
      <EditorComponent
        defaultValue={initialValue}
        placeholder={placeholder}
        extensions={wrap ? inlineFormattingExtensions : singleLineExtensions}
        onChange={handleChange}
        onBlur={handleBlur}
        readOnly={readOnly}
        editorStyle={{ padding: "4px 6px" }}
      />
    </Container>
  );
}

const Container = styled.div<{ $wrap: boolean }>`
  width: 100%;
  min-width: 0;
  border-radius: 4px;
  --font-size-body: 14px;

  .ProseMirror {
    line-height: 1.4;
  }

  &:hover,
  &:focus-within {
    background: ${s("backgroundSecondary")};
  }

  ${(props) =>
    !props.$wrap &&
    `
    .ProseMirror {
      white-space: nowrap !important;
    }

    .ProseMirror p {
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `}
`;

export default observer(PropertyTextEditor);
