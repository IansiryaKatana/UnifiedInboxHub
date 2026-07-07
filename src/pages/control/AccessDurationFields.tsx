import {
  addDurationToBase,
  addDaysFromNow,
  formatAccessExpiry,
  type AccessDurationMode,
  type RelativeTimeUnit,
  buildAccessDurationPayload,
  computeAccessUntil,
} from "@/lib/admin-users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DAY_PRESETS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

const QUICK_ADD = [
  { label: "+30 min", amount: 30, unit: "minutes" as const },
  { label: "+1 hr", amount: 1, unit: "hours" as const },
  { label: "+6 hr", amount: 6, unit: "hours" as const },
  { label: "+1 day", amount: 1, unit: "days" as const },
];

type Props = {
  mode: AccessDurationMode;
  onModeChange: (m: AccessDurationMode) => void;
  presetDays: number;
  onPresetChange: (days: number) => void;
  addAmount: number;
  onAddAmountChange: (n: number) => void;
  addUnit: RelativeTimeUnit;
  onAddUnitChange: (u: RelativeTimeUnit) => void;
  exactUntil: string;
  onExactUntilChange: (v: string) => void;
  /** For extend: current expiry. For create: omitted (uses now). */
  baseIso?: string | null;
  currentExpiryLabel?: string;
};

export function AccessDurationFields({
  mode,
  onModeChange,
  presetDays,
  onPresetChange,
  addAmount,
  onAddAmountChange,
  addUnit,
  onAddUnitChange,
  exactUntil,
  onExactUntilChange,
  baseIso,
  currentExpiryLabel,
}: Props) {
  const previewIso = computeAccessUntil(mode, {
    baseIso,
    presetDays,
    addAmount,
    addUnit,
    exactUntil,
  });

  const applyQuickAdd = (amount: number, unit: RelativeTimeUnit) => {
    onModeChange("add");
    onAddAmountChange(amount);
    onAddUnitChange(unit);
  };

  return (
    <div className="space-y-3">
      {currentExpiryLabel ? (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Current expiry: <span className="font-medium text-foreground">{currentExpiryLabel}</span>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={mode === "add" ? "default" : "outline"} onClick={() => onModeChange("add")}>
          Add time
        </Button>
        <Button type="button" size="sm" variant={mode === "preset" ? "default" : "outline"} onClick={() => onModeChange("preset")}>
          Day presets
        </Button>
        <Button type="button" size="sm" variant={mode === "exact" ? "default" : "outline"} onClick={() => onModeChange("exact")}>
          Edit expiry
        </Button>
      </div>

      {mode === "add" ? (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="add-amount">Add duration</Label>
              <Input
                id="add-amount"
                type="number"
                min={1}
                step={1}
                required
                placeholder="e.g. 50"
                value={addAmount || ""}
                onChange={(e) => onAddAmountChange(Math.max(1, Number(e.target.value) || 0))}
              />
            </div>
            <div className="sm:w-36 space-y-1.5">
              <Label htmlFor="add-unit">Unit</Label>
              <Select value={addUnit} onValueChange={(v) => onAddUnitChange(v as RelativeTimeUnit)}>
                <SelectTrigger id="add-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">Minutes</SelectItem>
                  <SelectItem value="hours">Hours</SelectItem>
                  <SelectItem value="days">Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {QUICK_ADD.map((q) => (
              <Button
                key={q.label}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => applyQuickAdd(q.amount, q.unit)}
              >
                {q.label}
              </Button>
            ))}
          </div>
          {baseIso ? (
            <p className="text-xs text-muted-foreground">
              Added to the later of now or the current expiry.
            </p>
          ) : null}
        </div>
      ) : null}

      {mode === "preset" ? (
        <div className="flex flex-wrap gap-2">
          {DAY_PRESETS.map((p) => (
            <Button
              key={p.days}
              type="button"
              size="sm"
              variant={presetDays === p.days ? "default" : "outline"}
              onClick={() => onPresetChange(p.days)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      ) : null}

      {mode === "exact" ? (
        <div className="space-y-1.5">
          <Label htmlFor="exact-until">Access until</Label>
          <Input
            id="exact-until"
            type="datetime-local"
            value={exactUntil}
            onChange={(e) => onExactUntilChange(e.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">Set the exact date and time access should end.</p>
        </div>
      ) : null}

      {previewIso ? (
        <p className="text-xs text-muted-foreground">
          New expiry: <span className="font-medium text-foreground">{formatAccessExpiry(previewIso)}</span>
        </p>
      ) : null}
    </div>
  );
}
