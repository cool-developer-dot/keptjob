"use client";

/**
 * Multi-select for objection categories (SPEC §3). Popover + Command list with
 * check marks; selected values show as chips in the trigger. Works inside
 * react-hook-form: wrap it in <FormControl> (the trigger receives id/aria props).
 */
import { ChevronsUpDownIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { OBJECTION_CATEGORIES, OBJECTION_LABELS, type ObjectionCategory } from "@/lib/constants";

type Props = Omit<React.ComponentProps<typeof Button>, "value" | "onChange"> & {
  value: readonly ObjectionCategory[];
  onChange: (value: ObjectionCategory[]) => void;
  placeholder?: string;
};

export function ObjectionMultiSelect({
  value,
  onChange,
  placeholder = "Select objections",
  disabled,
  ...triggerProps
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = new Set(value);

  const toggle = (category: ObjectionCategory) => {
    // Keep the canonical (SPEC) order regardless of click order.
    const next = OBJECTION_CATEGORIES.filter((c) => (c === category ? !selected.has(c) : selected.has(c)));
    onChange(next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={disabled}
          className="h-auto min-h-9 w-full justify-between px-3 py-1.5 font-normal"
          {...triggerProps}
        >
          {value.length === 0 ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {value.map((category) => (
                <Badge key={category} variant="secondary">
                  {OBJECTION_LABELS[category]}
                </Badge>
              ))}
            </span>
          )}
          <ChevronsUpDownIcon aria-hidden className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-56 p-0" align="start">
        <Command>
          <CommandList aria-label="Objections" aria-multiselectable="true">
            <CommandGroup>
              {OBJECTION_CATEGORIES.map((category) => {
                const checked = selected.has(category);
                return (
                  <CommandItem
                    key={category}
                    value={category}
                    keywords={[OBJECTION_LABELS[category]]}
                    data-checked={checked}
                    onSelect={() => toggle(category)}
                  >
                    {OBJECTION_LABELS[category]}
                    {checked && <span className="sr-only">(selected)</span>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
