import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  value: number;
  presets: number[];
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  className?: string;
}

/** A number input with a dropdown of common presets — pick one, or just type a custom value. */
export default function EditableSelect({ value, presets, min, max, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  return (
    <div
      className={`editable-select ${className ?? ''}`}
      ref={containerRef}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onFocus={() => setOpen(true)}
      />
      <button
        type="button"
        className="editable-select-toggle"
        tabIndex={-1}
        onClick={() => setOpen((prev) => !prev)}
      >
        <ChevronDown />
      </button>
      {open && (
        <div className="editable-select-menu">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`editable-select-option ${preset === value ? 'active' : ''}`}
              onClick={() => {
                onChange(preset);
                setOpen(false);
              }}
            >
              {preset}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
