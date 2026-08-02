import { formatTimecode } from "@limbo/shared";

export type TrimFieldsProps = {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  startText: string;
  endText: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  durationSec: number;
  error: string | null;
};

export default function TrimFields({
  enabled,
  onToggle,
  startText,
  endText,
  onStartChange,
  onEndChange,
  durationSec,
  error,
}: TrimFieldsProps) {
  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-gray-200 p-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
        Découper un extrait (optionnel)
      </label>

      {enabled && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <label className="flex flex-1 flex-col text-xs text-gray-600">
              Début
              <input
                type="text"
                inputMode="numeric"
                placeholder="00:00"
                value={startText}
                onChange={(event) => onStartChange(event.target.value)}
                aria-invalid={error !== null}
                className={inputClass(error !== null)}
              />
            </label>
            <label className="flex flex-1 flex-col text-xs text-gray-600">
              Fin
              <input
                type="text"
                inputMode="numeric"
                placeholder="mm:ss"
                value={endText}
                onChange={(event) => onEndChange(event.target.value)}
                aria-invalid={error !== null}
                className={inputClass(error !== null)}
              />
            </label>
          </div>

          <p className="text-[11px] text-gray-400">
            Format mm:ss (ou hh:mm:ss) — durée totale {formatTimecode(durationSec)}.
          </p>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </fieldset>
  );
}

function inputClass(invalid: boolean): string {
  const base = "rounded border px-2 py-1 text-sm focus:outline-none";
  return invalid
    ? `${base} border-red-500 focus:ring-1 focus:ring-red-500`
    : `${base} border-gray-300 focus:ring-1 focus:ring-blue-500`;
}
