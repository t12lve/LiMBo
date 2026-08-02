import type { VideoFormat } from "@limbo/shared";

export type FormatListProps = {
  formats: VideoFormat[];
  selectedFormatId: string | null;
  onSelect: (formatId: string) => void;
};

export default function FormatList({
  formats,
  selectedFormatId,
  onSelect,
}: FormatListProps) {
  if (formats.length === 0) {
    return <p className="text-sm text-gray-500">Aucun format disponible.</p>;
  }

  return (
    <fieldset className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-gray-200 p-2">
      <legend className="px-1 text-xs font-medium text-gray-600">Qualité</legend>
      {formats.map((format) => (
        <label
          key={format.formatId}
          className={`flex cursor-pointer items-center justify-between rounded px-2 py-1 text-sm ${
            selectedFormatId === format.formatId ? "bg-blue-50" : "hover:bg-gray-50"
          }`}
        >
          <span className="flex items-center gap-2">
            <input
              type="radio"
              name="format"
              checked={selectedFormatId === format.formatId}
              onChange={() => onSelect(format.formatId)}
            />
            {format.label}
          </span>
          <span className="text-xs text-gray-400">
            {format.ext}
            {!format.hasAudio ? " · sans audio" : ""}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
