"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import {
  Bold,
  ChevronDown,
  Code,
  Code2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  MoreHorizontal,
  Quote,
  RemoveFormatting,
  Strikethrough,
  Underline,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { uploadWorkImageAction } from "../../actions";
import { ATTACHMENT_TYPES } from "../../attachment-logic";
import { isRichTextEmpty } from "../../rich-text";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

type Props = {
  /** Starting content (HTML from the server, already sanitised). */
  initialHtml: string;
  ariaLabel: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Tailwind min-height for the writing area. */
  minHeight?: string;
  /** Controlled mode (the Create dialog): every change, no Save/Cancel row. */
  onChange?: (html: string) => void;
  /** Save mode (descriptions, comments): Save/Cancel row, Ctrl+Enter / Esc. */
  onSave?: (html: string) => void | Promise<unknown>;
  onCancel?: () => void;
  saving?: boolean;
  saveLabel?: string;
  /** "thumb": images show as small previews while writing (comments, like Jira); "large": capped full previews (descriptions). */
  media?: "thumb" | "large";
};

/**
 * The work-area editor (ProseMirror via Tiptap — the same model as
 * Atlassian's): text styles, marks, lists, task lists, quotes, code, links
 * (Ctrl+K) and images (button, paste or drop → uploaded as attachments).
 * Markdown shortcuts work as you type: **bold**, # heading, - list, [ ] task, ``` code.
 * Output is HTML; the server sanitises it before storing and again before showing it.
 */
export function RichEditor({
  initialHtml,
  ariaLabel,
  placeholder = "Type something…",
  autoFocus,
  minHeight = "min-h-28",
  onChange,
  onSave,
  onCancel,
  saving,
  saveLabel = "Save",
  media = "large",
}: Props) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [uploading, setUploading] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  // Editor options are read once; keep the latest callbacks in refs.
  const handlers = useRef({ onSave, onCancel, onChange });
  useEffect(() => {
    handlers.current = { onSave, onCancel, onChange };
  });
  const editorRef = useRef<Editor | null>(null);

  async function uploadAndInsert(files: File[], at?: number) {
    const images = files.filter((f) => (ATTACHMENT_TYPES as readonly string[]).includes(f.type));
    if (images.length === 0) {
      if (files.length) toast.error("Only PNG, JPEG, GIF or WebP images can be added");
      return;
    }
    for (const file of images) {
      setUploading((n) => n + 1);
      const fd = new FormData();
      fd.set("file", file);
      try {
        const res = await uploadWorkImageAction(fd);
        const ed = editorRef.current;
        if (!res.ok) toast.error(res.error);
        else if (ed) {
          const node = { type: "image", attrs: { src: res.url, alt: file.name || "image" } };
          if (at != null) ed.chain().focus().insertContentAt(at, node).run();
          else ed.chain().focus().insertContent(node).run();
        }
      } catch {
        toast.error("Couldn't upload the image");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }
  const uploadRef = useRef(uploadAndInsert);
  useEffect(() => {
    uploadRef.current = uploadAndInsert;
  });

  const editor = useEditor({
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: "https" },
      }),
      Image.configure({ inline: false, allowBase64: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
    ],
    content: initialHtml,
    editorProps: {
      attributes: {
        class: cn("work-rich-text px-3 py-2 outline-none", media === "thumb" ? "work-media-thumb" : "work-media-large", minHeight),
        "aria-label": ariaLabel,
        "aria-multiline": "true",
        role: "textbox",
      },
      handleKeyDown: (_view, e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.key === "Enter" && handlers.current.onSave) {
          e.preventDefault();
          void handlers.current.onSave(editorRef.current?.getHTML() ?? "");
          return true;
        }
        if (mod && e.key.toLowerCase() === "k") {
          e.preventDefault();
          setLinkOpen(true);
          return true;
        }
        if (e.key === "Escape" && handlers.current.onCancel) {
          handlers.current.onCancel();
          return true;
        }
        return false;
      },
      handlePaste: (_view, e) => {
        const files = Array.from(e.clipboardData?.files ?? []);
        if (!files.some((f) => f.type.startsWith("image/"))) return false;
        e.preventDefault();
        void uploadRef.current(files);
        return true;
      },
      handleDrop: (view, e, _slice, moved) => {
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (moved || !files.some((f) => f.type.startsWith("image/"))) return false;
        e.preventDefault();
        const pos = view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos;
        void uploadRef.current(files, pos);
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => handlers.current.onChange?.(ed.getHTML()),
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) =>
      ed
        ? {
            bold: ed.isActive("bold"),
            italic: ed.isActive("italic"),
            underline: ed.isActive("underline"),
            strike: ed.isActive("strike"),
            code: ed.isActive("code"),
            link: ed.isActive("link"),
            bullet: ed.isActive("bulletList"),
            ordered: ed.isActive("orderedList"),
            task: ed.isActive("taskList"),
            quote: ed.isActive("blockquote"),
            codeBlock: ed.isActive("codeBlock"),
            heading: ([1, 2, 3] as const).find((level) => ed.isActive("heading", { level })) ?? null,
            empty: isRichTextEmpty(ed.getHTML()),
          }
        : null,
  });

  const run = (fn: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => editor && fn(editor.chain().focus()).run();
  const styleLabel = state?.heading ? `Heading ${state.heading}` : state?.codeBlock ? "Code" : "Normal text";

  return (
    <div className="rounded-[3px] border-2 bg-background transition-colors focus-within:border-info">
      <div className="flex flex-wrap items-center gap-0.5 border-b px-1 py-1" role="toolbar" aria-label="Formatting">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-8 w-32 justify-between rounded-[3px] px-2 font-medium" disabled={!editor}>
              {styleLabel}
              <ChevronDown className="size-4 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onSelect={() => run((c) => c.setParagraph())}>
              Normal text <DropdownMenuShortcut>{MOD}+Alt+0</DropdownMenuShortcut>
            </DropdownMenuItem>
            {([1, 2, 3] as const).map((level) => (
              <DropdownMenuItem key={level} onSelect={() => run((c) => c.setHeading({ level }))}>
                <span className={cn("font-semibold", level === 1 ? "text-xl" : level === 2 ? "text-lg" : "text-base")}>Heading {level}</span>
                <DropdownMenuShortcut>{MOD}+Alt+{level}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Sep />
        <Tool icon={Bold} label={`Bold (${MOD}+B)`} active={state?.bold} onClick={() => run((c) => c.toggleBold())} disabled={!editor} />
        <Tool icon={Italic} label={`Italic (${MOD}+I)`} active={state?.italic} onClick={() => run((c) => c.toggleItalic())} disabled={!editor} />
        <Tool icon={Underline} label={`Underline (${MOD}+U)`} active={state?.underline} onClick={() => run((c) => c.toggleUnderline())} disabled={!editor} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="size-8 rounded-[3px]" aria-label="More formatting" title="More formatting" disabled={!editor}>
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onSelect={() => run((c) => c.toggleStrike())}>
              <Strikethrough className="size-4" /> Strikethrough <DropdownMenuShortcut>{MOD}+Shift+S</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((c) => c.toggleCode())}>
              <Code className="size-4" /> Code <DropdownMenuShortcut>{MOD}+E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => run((c) => c.unsetAllMarks().clearNodes())}>
              <RemoveFormatting className="size-4" /> Clear formatting
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Sep />
        <Tool icon={List} label={`Bullet list (${MOD}+Shift+8)`} active={state?.bullet} onClick={() => run((c) => c.toggleBulletList())} disabled={!editor} />
        <Tool icon={ListOrdered} label={`Numbered list (${MOD}+Shift+7)`} active={state?.ordered} onClick={() => run((c) => c.toggleOrderedList())} disabled={!editor} />
        <Tool icon={ListChecks} label={`Action items (${MOD}+Shift+9)`} active={state?.task} onClick={() => run((c) => c.toggleTaskList())} disabled={!editor} />
        <Sep />
        <Tool icon={Link2} label={`Link (${MOD}+K)`} active={state?.link || linkOpen} onClick={() => setLinkOpen((v) => !v)} disabled={!editor} />
        <Tool icon={ImagePlus} label="Image (or paste / drop one)" onClick={() => fileRef.current?.click()} disabled={!editor || uploading > 0} />
        <Tool icon={Quote} label={`Quote (${MOD}+Shift+B)`} active={state?.quote} onClick={() => run((c) => c.toggleBlockquote())} disabled={!editor} />
        <Tool icon={Code2} label={`Code block (${MOD}+Alt+C)`} active={state?.codeBlock} onClick={() => run((c) => c.toggleCodeBlock())} disabled={!editor} />
        <Tool icon={Minus} label="Divider (---)" onClick={() => run((c) => c.setHorizontalRule())} disabled={!editor} />
        {uploading > 0 && <span className="ml-1 text-xs text-muted-foreground">Uploading image…</span>}
        <input
          ref={fileRef}
          type="file"
          accept={ATTACHMENT_TYPES.join(",")}
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void uploadAndInsert(files);
          }}
        />
      </div>

      {linkOpen && editor && <LinkBar editor={editor} onClose={() => setLinkOpen(false)} />}

      {/* The writing area: a click anywhere in the padding focuses the end. */}
      <div className="cursor-text" onClick={(e) => e.target === e.currentTarget && editor?.commands.focus("end")}>
        <EditorContent editor={editor} />
        {!editor && <div className={cn("work-rich-text px-3 py-2", minHeight)} dangerouslySetInnerHTML={{ __html: initialHtml }} />}
      </div>

      {onSave && (
        <div className="flex items-center gap-2 border-t px-2 py-2">
          <Button
            type="button"
            size="sm"
            className="rounded-[3px] bg-info text-white hover:bg-info/90 dark:text-background"
            disabled={!editor || saving || uploading > 0}
            onClick={() => void onSave(editor?.getHTML() ?? "")}
          >
            {saving ? "Saving…" : saveLabel}
          </Button>
          {onCancel && (
            <Button type="button" size="sm" variant="ghost" className="rounded-[3px]" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <span className="ml-auto hidden text-[11px] text-muted-foreground sm:block">
            {MOD}+Enter to save · Esc to cancel
          </span>
        </div>
      )}
    </div>
  );
}

function Sep() {
  return <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />;
}

function Tool({ icon: Icon, label, active, onClick, disabled }: { icon: LucideIcon; label: string; active?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("size-8 rounded-[3px]", active && "bg-info/15 text-info hover:bg-info/20 hover:text-info")}
      aria-label={label}
      aria-pressed={active ?? undefined}
      title={label}
      onMouseDown={(e) => e.preventDefault()} // keep the editor's selection
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="size-4" />
    </Button>
  );
}

/** Ctrl+K: add, change or remove the link on the selection (or insert a new linked URL). */
function LinkBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const existing = (editor.getAttributes("link").href as string | undefined) ?? "";
  const [url, setUrl] = useState(existing);
  const [text, setText] = useState("");
  const hasSelection = !editor.state.selection.empty;

  function apply() {
    const raw = url.trim();
    if (!raw) return;
    const href = /^(https?:\/\/|mailto:)/i.test(raw) ? raw : `https://${raw}`;
    if (hasSelection || existing) {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    } else {
      editor.chain().focus().insertContent({ type: "text", text: text.trim() || raw, marks: [{ type: "link", attrs: { href } }] }).insertContent(" ").run();
    }
    onClose();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-2 py-2">
      <Input
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
            editor.commands.focus();
          }
        }}
        placeholder="Paste or type a link"
        className="h-8 min-w-48 flex-1 rounded-[3px]"
        aria-label="Link URL"
      />
      {!hasSelection && !existing && (
        <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), apply())} placeholder="Text to display" className="h-8 w-44 rounded-[3px]" aria-label="Link text" />
      )}
      <Button type="button" size="sm" className="h-8 rounded-[3px]" onClick={apply} disabled={!url.trim()}>
        {existing ? "Update" : "Link"}
      </Button>
      {existing && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 rounded-[3px]"
          onClick={() => {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            onClose();
          }}
        >
          Remove
        </Button>
      )}
    </div>
  );
}
