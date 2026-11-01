import { useEffect, useRef, useState } from "react";
interface Props {
  value: number;
  onChange: (value: number) => void;
  label: string;
  precision?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}
export default function NumericInput({
  value,
  onChange,
  label,
  precision = 6,
  min,
  max,
  step = "any",
  disabled,
}: Omit<Props, "step"> & { step?: number | "any" }) {
  const format = (v: number) =>
    Number.isFinite(v) ? String(Number(v.toFixed(precision))) : "";
  const [draft, setDraft] = useState(format(value));
  const focused = useRef(false);
  const edited = useRef(false);
  useEffect(() => {
    if (!focused.current || !edited.current) setDraft(format(value));
  }, [value, precision]);
  return (
    <input
      aria-label={label}
      type="number"
      value={draft}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onFocus={() => {
        focused.current = true;
        edited.current = false;
      }}
      onChange={(e) => {
        edited.current = true;
        setDraft(e.target.value);
        onChange(e.target.value === "" ? NaN : Number(e.target.value));
      }}
      onBlur={() => {
        focused.current = false;
        edited.current = false;
        setDraft(format(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
