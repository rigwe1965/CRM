"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage, useCreateTag, useTags } from "@/lib/client/hooks";
import { cn } from "@/lib/utils";

/** Pick a contact's tags from the shared list, or type a new one. `value` is the selected tag ids. */
export function TagPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const tags = useTags();
  const create = useCreateTag();
  const [name, setName] = useState("");

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  async function add() {
    const n = name.trim();
    if (!n) return;
    try {
      const tag = await create.mutateAsync(n);
      if (!value.includes(tag.id)) onChange([...value, tag.id]);
      setName("");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="space-y-2">
      {tags.data && tags.data.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tags">
          {tags.data.map((t) => {
            const on = value.includes(t.id);
            return (
              <button key={t.id} type="button" aria-pressed={on} onClick={() => toggle(t.id)} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Badge variant={on ? "default" : "outline"} className={cn("cursor-pointer", !on && "text-muted-foreground hover:text-foreground")}>
                  {t.name}
                </Badge>
              </button>
            );
          })}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={name}
          maxLength={40}
          placeholder="Add a tag, e.g. wholesale"
          aria-label="New tag"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault(); // Enter adds the tag, it does not submit the contact form
              void add();
            }
          }}
        />
        <Button type="button" variant="outline" disabled={!name.trim() || create.isPending} onClick={() => void add()}>
          <Plus /> Add
        </Button>
      </div>
    </div>
  );
}
