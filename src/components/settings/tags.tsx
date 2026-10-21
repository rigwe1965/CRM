"use client";

import { useState } from "react";
import { Pencil, Tag as TagIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog, EmptyState, ErrorState, FormField } from "@/components/common/page";
import { FormShell, useFormState } from "@/components/forms/form-kit";
import { errorMessage, useDeleteTag, useRenameTag, useTags } from "@/lib/client/hooks";
import type { Tag } from "@/lib/client/types";

function RenameForm({ tag, onClose }: { tag: Tag; onClose: () => void }) {
  const rename = useRenameTag();
  const form = useFormState();
  const [name, setName] = useState(tag.name);
  return (
    <FormShell
      title="Rename tag"
      description="The new name shows on every contact that has this tag."
      submitLabel="Save"
      pending={rename.isPending}
      formError={form.formError}
      onCancel={onClose}
      onSubmit={async () => {
        const ok = await form.run(() => rename.mutateAsync({ id: tag.id, name }));
        if (ok) {
          toast.success("Tag renamed");
          onClose();
        }
      }}
    >
      <FormField label="Name" error={form.err("name")}>
        <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />
      </FormField>
    </FormShell>
  );
}

/** Admin-only list of tags with rename and delete. Anyone can add tags from a contact; only admins tidy them up. */
export function TagsCard() {
  const { data, isLoading, error, refetch } = useTags();
  const del = useDeleteTag();
  const [renaming, setRenaming] = useState<Tag | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tags</CardTitle>
        <CardDescription>
          Labels on contacts (add them in a contact&apos;s form). Fix a typo with Rename; Delete removes the tag from every contact that has it.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {isLoading ? (
          <Skeleton className="mx-5 h-24" />
        ) : error || !data ? (
          <ErrorState message={error?.message} onRetry={() => refetch()} />
        ) : data.length === 0 ? (
          <EmptyState icon={TagIcon} title="No tags yet" description="Open a contact, add a tag such as wholesale or VIP, and it appears here." className="py-10" />
        ) : (
          <ul className="divide-y">
            {data.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <span className="font-medium">{t.name}</span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Rename ${t.name}`} onClick={() => setRenaming(t)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Delete ${t.name}`} onClick={() => setDeleting(t)}>
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>{renaming && <RenameForm tag={renaming} onClose={() => setRenaming(null)} />}</DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete tag?"
        description={`"${deleting?.name ?? ""}" will be removed from every contact that has it. The contacts themselves are not affected.`}
        pending={del.isPending}
        onConfirm={() =>
          deleting &&
          del.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Tag deleted");
              setDeleting(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </Card>
  );
}
