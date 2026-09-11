import type { VideoFormat } from "@limbo/shared";

export type FormatListProps = {
  formats: VideoFormat[];
  selectedFormatId: string | null;
  onSelect: (formatId: string) => void;
};

type Group = {
  title: string;
  formats: VideoFormat[];
};

function groupFormats(formats: VideoFormat[]): Group[] {
  const withSound = formats.filter((f) => f.hasVideo && f.hasAudio).slice(0, 4);
  const audioOnly = formats.filter((f) => f.hasAudio && !f.hasVideo).slice(0, 1);
  const videoOnly = formats.filter((f) => f.hasVideo && !f.hasAudio).slice(0, 3);

  return [
    { title: "Avec son", formats: withSound },
    { title: "Juste le son", formats: audioOnly },
    { title: "Sans le son", formats: videoOnly },
  ].filter((g) => g.formats.length > 0);
}

function FormatOption({
  format,
  selectedFormatId,
  onSelect,
  hint,
}: {
  format: VideoFormat;
  selectedFormatId: string | null;
  onSelect: (formatId: string) => void;
  hint: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center justify-between rounded px-2 py-1 text-sm ${
        selectedFormatId === format.formatId ? "bg-blue-50" : "hover:bg-gray-50"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <input
          type="radio"
          name="format"
          checked={selectedFormatId === format.formatId}
          onChange={() => onSelect(format.formatId)}
        />
        <span className="truncate">{format.label}</span>
      </span>
      <span className="shrink-0 text-xs text-gray-400">{hint}</span>
    </label>
  );
}

export default function FormatList({
  formats,
  selectedFormatId,
  onSelect,
}: FormatListProps) {
  const groups = groupFormats(formats);

  if (groups.length === 0) {
    return <p className="text-sm text-gray-500">Aucun format disponible.</p>;
  }

  return (
    <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
      {groups.map((group) => (
        <fieldset
          key={group.title}
          className="flex flex-col gap-1 rounded-md border border-gray-200 p-2"
        >
          <legend className="px-1 text-xs font-semibold text-gray-700">{group.title}</legend>
          {group.formats.map((format) => (
            <FormatOption
              key={format.formatId}
              format={format}
              selectedFormatId={selectedFormatId}
              onSelect={onSelect}
              hint={
                group.title === "Avec son"
                  ? format.ext
                  : group.title === "Juste le son"
                    ? format.ext
                    : `${format.ext} · sans audio`
              }
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}
