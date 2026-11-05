import { useEffect, useRef, useState } from "react";
// Local text draft only. Project state changes once when a valid edit is committed.
export default function CommitNumber({
  value,
  label,
  min,
  max,
  onChange,
  disabled,
}: {
  disabled?: boolean;
  value: number;
  label: string;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value)),
    [invalid, setInvalid] = useState(false);
  const focused = useRef(false),
    original = useRef(String(value)),
    cancelled = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);
  function commit() {
    focused.current = false;
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const n = Number(draft);
    if (
      !draft.trim() ||
      !Number.isFinite(n) ||
      (min !== undefined && n < min) ||
      (max !== undefined && n > max)
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (draft !== original.current) onChange(n);
  }
  return (
    <input
      disabled={disabled}
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid}
      title={invalid ? "请输入有效范围内的数值" : undefined}
      value={draft}
      onFocus={() => {
        focused.current = true;
        original.current = String(value);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        setInvalid(false);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          cancelled.current = true;
          setDraft(String(value));
          setInvalid(false);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
