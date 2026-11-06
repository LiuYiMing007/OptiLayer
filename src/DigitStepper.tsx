import { decimalColumns, incrementPlace } from "./digitEditing";
/** TFC-style decimal columns; all columns act on the single shared project value. */
export default function DigitStepper({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const columns = decimalColumns(Math.max(0, value));
  return (
    <div className="decimal-editor" role="group" aria-label="新值逐位调整">
      {columns.map(({ character, place }) =>
        place === null ? (
          <span key="dot" className="decimal-dot">
            .
          </span>
        ) : (
          <div className="decimal-column" key={place}>
            <button
              className="digit-step"
              data-place={place}
              data-direction="up"
              aria-label={`增大 ${10 ** place} 位`}
              disabled={disabled}
              onClick={() => onChange(incrementPlace(value, place, 1))}
            >
              ▴
            </button>
            <input
              aria-label={`新值 ${10 ** place} 位`}
              inputMode="numeric"
              value={character}
              disabled={disabled}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => {
                if (/^\d$/.test(e.target.value))
                  onChange(
                    Math.max(
                      0,
                      Number(
                        (
                          value +
                          (Number(e.target.value) - Number(character)) *
                            10 ** place
                        ).toPrecision(15),
                      ),
                    ),
                  );
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                  e.preventDefault();
                  onChange(
                    incrementPlace(value, place, e.key === "ArrowUp" ? 1 : -1),
                  );
                }
                if (["ArrowLeft", "ArrowRight", "Enter"].includes(e.key)) {
                  e.preventDefault();
                  const fields = e.currentTarget
                    .closest(".decimal-editor")
                    ?.querySelectorAll<HTMLInputElement>("input");
                  const next =
                    [...(fields || [])].indexOf(e.currentTarget) +
                    (e.key === "ArrowLeft" ? -1 : 1);
                  fields?.[next]?.focus();
                }
              }}
            />
            <button
              className="digit-step"
              data-place={place}
              data-direction="down"
              aria-label={`减小 ${10 ** place} 位`}
              disabled={disabled || incrementPlace(value, place, -1) < 0}
              onClick={() => onChange(incrementPlace(value, place, -1))}
            >
              ▾
            </button>
          </div>
        ),
      )}
    </div>
  );
}
