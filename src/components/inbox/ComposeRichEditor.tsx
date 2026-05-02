import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Code,
  Link as LinkIcon,
  RemoveFormatting,
  Heading1,
  Heading2,
  Heading3,
} from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function ComposeRichEditor({ value, onChange, placeholder, disabled, className }: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: "text-primary underline underline-offset-2" },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "Write your message...",
      }),
    ],
    content: value || "",
    editable: !disabled,
    onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
    editorProps: {
      attributes: {
        class:
          "prose prose-sm dark:prose-invert max-w-none min-h-[200px] px-3 py-2 focus:outline-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1",
      },
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  if (!editor) {
    return (
      <div className={cn("rounded-md border border-input bg-muted/30 min-h-[240px]", className)} aria-hidden />
    );
  }

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev?.startsWith("http") ? prev : "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className={cn("rounded-md border border-input bg-background overflow-hidden flex flex-col", className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-input bg-muted/30 px-2 py-1.5">
        <Toggle
          size="sm"
          pressed={editor.isActive("heading", { level: 1 })}
          onPressedChange={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          aria-label="Heading 1"
          disabled={disabled}
        >
          <Heading1 className="size-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("heading", { level: 2 })}
          onPressedChange={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          aria-label="Heading 2"
          disabled={disabled}
        >
          <Heading2 className="size-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("heading", { level: 3 })}
          onPressedChange={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          aria-label="Heading 3"
          disabled={disabled}
        >
          <Heading3 className="size-4" />
        </Toggle>
        <span className="w-px h-6 bg-border mx-0.5 shrink-0" aria-hidden />
        <Toggle
          size="sm"
          pressed={editor.isActive("bold")}
          onPressedChange={() => editor.chain().focus().toggleBold().run()}
          aria-label="Bold"
          disabled={disabled}
        >
          <Bold className="size-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("italic")}
          onPressedChange={() => editor.chain().focus().toggleItalic().run()}
          aria-label="Italic"
          disabled={disabled}
        >
          <Italic className="size-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("underline")}
          onPressedChange={() => editor.chain().focus().toggleUnderline().run()}
          aria-label="Underline"
          disabled={disabled}
        >
          <UnderlineIcon className="size-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("strike")}
          onPressedChange={() => editor.chain().focus().toggleStrike().run()}
          aria-label="Strikethrough"
          disabled={disabled}
        >
          <Strikethrough className="size-4" />
        </Toggle>
        <span className="w-px h-6 bg-border mx-0.5 shrink-0" aria-hidden />
        <Toggle
          size="sm"
          pressed={editor.isActive("bulletList")}
          onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
          aria-label="Bullet list"
          disabled={disabled}
        >
          <List className="size-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("orderedList")}
          onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
          aria-label="Numbered list"
          disabled={disabled}
        >
          <ListOrdered className="size-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("blockquote")}
          onPressedChange={() => editor.chain().focus().toggleBlockquote().run()}
          aria-label="Quote"
          disabled={disabled}
        >
          <Quote className="size-4" />
        </Toggle>
        <Toggle
          size="sm"
          pressed={editor.isActive("codeBlock")}
          onPressedChange={() => editor.chain().focus().toggleCodeBlock().run()}
          aria-label="Code block"
          disabled={disabled}
        >
          <Code className="size-4" />
        </Toggle>
        <span className="w-px h-6 bg-border mx-0.5 shrink-0" aria-hidden />
        <Button
          type="button"
          variant={editor.isActive("link") ? "secondary" : "ghost"}
          size="sm"
          className="size-9 shrink-0 px-0"
          onClick={setLink}
          aria-label="Insert or edit link"
          disabled={disabled}
        >
          <LinkIcon className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="size-9 shrink-0 px-0"
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
          aria-label="Clear formatting"
          disabled={disabled}
        >
          <RemoveFormatting className="size-4" />
        </Button>
      </div>
      <EditorContent editor={editor} className="compose-tiptap max-w-none [&_.ProseMirror]:min-h-[200px] [&_.ProseMirror]:outline-none [&_.ProseMirror]:px-1" />
    </div>
  );
}
