"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useList } from "@/lib/client/hooks";
import { fullName } from "@/lib/client/format";
import type { Contact, Deal, Organization } from "@/lib/client/types";

const NONE = "__none__";

type PickerProps = {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  placeholder: string;
  disabled?: boolean;
  invalid?: boolean;
};

function Picker({
  value,
  onChange,
  placeholder,
  disabled,
  invalid,
  options,
  loading,
}: PickerProps & { options: { id: string; label: string }[]; loading: boolean }) {
  // Keep the current value selectable even if it isn't in the first page of options.
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled || loading}>
      <SelectTrigger aria-invalid={invalid || undefined}>
        <SelectValue placeholder={loading ? "Loading…" : placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>None</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// The pickers load the first 100 records alphabetically. Fine for a light CRM; swap for a
// search-as-you-type combobox if you expect thousands of companies or contacts.
export function OrganizationPicker(props: PickerProps & { fallback?: { id: string; name: string } | null }) {
  const { data, isLoading } = useList<Organization>("organizations", { pageSize: 100, sort: "name", order: "asc" });
  const options = (data?.data ?? []).map((o) => ({ id: o.id, label: o.name }));
  if (props.fallback && !options.some((o) => o.id === props.fallback!.id)) {
    options.push({ id: props.fallback.id, label: props.fallback.name });
  }
  return <Picker {...props} options={options} loading={isLoading} />;
}

export function ContactPicker(props: PickerProps & { fallback?: { id: string; firstName: string; lastName: string } | null }) {
  const { data, isLoading } = useList<Contact>("contacts", { pageSize: 100, sort: "name", order: "asc" });
  const options = (data?.data ?? []).map((c) => ({ id: c.id, label: fullName(c) }));
  if (props.fallback && !options.some((o) => o.id === props.fallback!.id)) {
    options.push({ id: props.fallback.id, label: fullName(props.fallback) });
  }
  return <Picker {...props} options={options} loading={isLoading} />;
}

export function DealPicker(props: PickerProps & { fallback?: { id: string; title: string } | null }) {
  const { data, isLoading } = useList<Deal>("deals", { pageSize: 100, sort: "title", order: "asc" });
  const options = (data?.data ?? []).map((d) => ({ id: d.id, label: d.title }));
  if (props.fallback && !options.some((o) => o.id === props.fallback!.id)) {
    options.push({ id: props.fallback.id, label: props.fallback.title });
  }
  return <Picker {...props} options={options} loading={isLoading} />;
}
