"use client";

import { useState, type RefObject } from "react";
import { Download, FileArchive, FileSpreadsheet, FileText, FileVideo, File as FileIcon, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAction } from "@/lib/use-action";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { attachFileAction, removeAttachmentAction } from "../../actions";
import { FILE_ACCEPT, FILE_MAX_BYTES, fileExtension, formatBytes } from "../../attachment-logic";
import type { WorkAttachmentDto, WorkUserRef } from "../../dto";

/** Paperclip-style file badge for anything that isn't a previewable image. */
function FileGlyph({ name, className }: { name: string; className?: string }) {
  const ext = fileExtension(name);
  const Icon =
    ext === "zip" ? FileArchive : ["csv", "xls", "xlsx"].includes(ext) ? FileSpreadsheet : ["mp4", "mov"].includes(ext) ? FileVideo : ["pdf", "txt", "log", "md", "doc", "docx", "json", "xml"].includes(ext) ? FileText : FileIcon;
  return <Icon className={className} />;
}

/**
 * Jira's Attachments panel: thumbnails for images (click to preview), cards
 * for other files (click to download), drag and drop onto the panel, and
 * delete for whoever attached it or an ops admin. The hidden file input is
 * the title row's Attach button's target too.
 */
export function ItemAttachments({
  itemId,
  attachments,
  inputRef,
  viewer,
  canManage,
}: {
  itemId: string;
  attachments: WorkAttachmentDto[];
  inputRef: RefObject<HTMLInputElement | null>;
  viewer: WorkUserRef | null;
  canManage: boolean;
}) {
  const confirm = useConfirm();
  const { run, isPending } = useAction();
  const [uploading, setUploading] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<WorkAttachmentDto | null>(null);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(list.map((f) => f.name));
    let added = 0;
    for (const file of list) {
      if (file.size > FILE_MAX_BYTES) {
        toast.error(`${file.name}: files can be up to ${FILE_MAX_BYTES / 1024 / 1024} MB`);
        continue;
      }
      const form = new FormData();
      form.set("itemId", itemId);
      form.set("file", file);
      // useAction toasts a refusal (type, size) itself; the server action refreshes the item.
      const res = await run(() => attachFileAction(form), { key: "upload", refresh: false, error: `${file.name}: the upload failed — try again` });
      if (res?.ok) added++;
      setUploading((u) => u.filter((n) => n !== file.name));
    }
    setUploading([]);
    if (added) toast.success(added === 1 ? "File attached" : `${added} files attached`);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function remove(a: WorkAttachmentDto) {
    const ok = await confirm({ title: `Delete ${a.fileName}?`, description: "The file is removed from this item for good.", destructive: true, confirmLabel: "Delete" });
    if (!ok) return;
    await run(() => removeAttachmentAction(a.id), { key: `rm:${a.id}`, refresh: false, success: "File deleted" });
  }

  const canDelete = (a: WorkAttachmentDto) => canManage || (!!viewer && a.uploader?.id === viewer.id);
  const busy = uploading.length > 0;

  return (
    <>
      <input ref={inputRef} type="file" multiple accept={FILE_ACCEPT} className="hidden" onChange={(e) => e.target.files && void upload(e.target.files)} aria-label="Attach files" />
      {(attachments.length > 0 || busy) && (
        <section
          className={cn("flex flex-col gap-2 rounded-[3px]", dragging && "outline-2 outline-dashed outline-info outline-offset-4")}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            setDragging(false);
            void upload(e.dataTransfer.files);
          }}
        >
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">Attachments</h2>
            <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{attachments.length}</span>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto size-8 cursor-pointer rounded-[3px]"
              aria-label="Attach files"
              title="Attach files (or drop them here)"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <Paperclip className="size-4" />
            </Button>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {attachments.map((a) => (
              <li key={a.id} className="group/att relative flex flex-col overflow-hidden rounded-[3px] border bg-card">
                <button
                  type="button"
                  className="flex h-28 w-full cursor-pointer items-center justify-center overflow-hidden bg-muted/50"
                  onClick={() => (a.isImage ? setPreview(a) : window.open(`${a.url}?download`, "_self"))}
                  title={a.isImage ? "Preview" : "Download"}
                  aria-label={`${a.isImage ? "Preview" : "Download"} ${a.fileName}`}
                >
                  {a.isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element -- user upload served by the attachment route
                    <img src={a.url} alt={a.fileName} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <FileGlyph name={a.fileName} className="size-10 text-muted-foreground" />
                  )}
                </button>
                <div className="flex min-w-0 flex-col gap-0.5 px-2 py-1.5">
                  <span className="truncate text-xs font-medium text-foreground" title={a.fileName}>
                    {a.fileName}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground" title={formatDateTime(a.createdAt)}>
                    {formatBytes(a.byteSize)} · {formatRelative(a.createdAt)}
                    {a.uploader ? ` · ${a.uploader.name}` : ""}
                  </span>
                </div>
                <div className="absolute top-1 right-1 flex gap-1 opacity-0 transition-opacity group-hover/att:opacity-100 focus-within:opacity-100">
                  <a href={`${a.url}?download`} className="rounded-[3px] bg-background/90 p-1 text-foreground shadow-sm hover:bg-accent" aria-label={`Download ${a.fileName}`} title="Download">
                    <Download className="size-3.5" />
                  </a>
                  {canDelete(a) && (
                    <button
                      type="button"
                      className="cursor-pointer rounded-[3px] bg-background/90 p-1 text-destructive shadow-sm hover:bg-accent"
                      aria-label={`Delete ${a.fileName}`}
                      title="Delete"
                      disabled={isPending(`rm:${a.id}`)}
                      onClick={() => void remove(a)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
            {uploading.map((name) => (
              <li key={`up-${name}`} className="flex h-[9.5rem] flex-col items-center justify-center gap-2 rounded-[3px] border border-dashed text-xs text-muted-foreground">
                <Paperclip className="size-5 animate-pulse" />
                <span className="max-w-full truncate px-2">{name}</span>
                Uploading…
              </li>
            ))}
          </ul>
        </section>
      )}
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="w-auto max-w-[min(92vw,1200px)] gap-3 p-3 sm:max-w-[min(92vw,1200px)]">
          <DialogTitle className="sr-only">{preview?.fileName ?? "Image"}</DialogTitle>
          <DialogDescription className="sr-only">Attachment preview</DialogDescription>
          {preview && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- user upload served by the attachment route */}
              <img src={preview.url} alt={preview.fileName} className="max-h-[80vh] max-w-full rounded-md object-contain" />
              <div className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{preview.fileName}</span>
                <Button asChild size="sm" variant="outline" className="cursor-pointer">
                  <a href={`${preview.url}?download`}>
                    <Download className="size-4" /> Download
                  </a>
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
