import { useEffect, useRef, useState } from 'react';
import './Select.css';

interface Option {
  label: string;
  value: string;
}

interface Props {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  ariaLabel?: string;
}

// Egyedi, Aurora-stílusú legördülő — a natív <select>/<option> popupja WebView2-ben nem
// örökli a sötét témát (fehér háttér, alig látható szöveg), ezért saját, teljesen CSS-ezett
// felugró listát rajzolunk a BotContextMenu popup-mintájára.
export function Select({ value, options, onChange, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value) ?? options[0];

  return (
    <div className="select" ref={rootRef}>
      <button
        type="button"
        className={`select__trigger${open ? ' select__trigger--open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="select__value">{selected?.label}</span>
        <span className="select__chevron">▾</span>
      </button>
      {open && (
        <div className="select__popup" role="listbox">
          {options.map((o) => (
            <button
              type="button"
              key={o.value}
              className={`select__option${o.value === value ? ' select__option--selected' : ''}`}
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
