import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
/** An input draft only; the project remains owned by the main coordinator. */
export default function TextInput({
  value,
  onChange,
  ...attributes
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false),
    edited = useRef(false);
  useEffect(() => {
    if (!focused.current || !edited.current) setDraft(value);
  }, [value]);
  return (
    <input
      {...attributes}
      value={draft}
      onFocus={() => {
        focused.current = true;
        edited.current = false;
      }}
      onChange={(e) => {
        edited.current = true;
        setDraft(e.target.value);
        onChange(e.target.value);
      }}
      onBlur={() => {
        focused.current = false;
        edited.current = false;
        setDraft(value);
      }}
    />
  );
}
