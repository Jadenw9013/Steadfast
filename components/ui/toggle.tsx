"use client";

export function Toggle({
    checked,
    onChange,
    label,
    disabled = false,
}: {
    checked: boolean;
    onChange: (value: boolean) => void;
    label: string;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className="sf-toggle"
        >
            <span className="sf-toggle-thumb" />
        </button>
    );
}
