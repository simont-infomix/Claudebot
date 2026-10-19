import './AttachmentChip.css';

const TRUNCATE_LENGTH = 5;

function truncateName(name: string): string {
  return name.length > TRUNCATE_LENGTH ? `${name.slice(0, TRUNCATE_LENGTH)}...` : name;
}

interface Props {
  name: string;
  onRemove: () => void;
}

export function AttachmentChip({ name, onRemove }: Props) {
  return (
    <div className="attachment-chip" title={name}>
      <span className="attachment-chip__name">{truncateName(name)}</span>
      <button
        type="button"
        className="attachment-chip__remove"
        onClick={onRemove}
        aria-label={`${name} eltávolítása`}
      >
        ✕
      </button>
    </div>
  );
}
