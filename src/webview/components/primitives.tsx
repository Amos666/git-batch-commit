import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../theme/icons/Icon';
import type { IconName } from '../theme/icons/paths';

export function Checkbox({
  checked,
  indeterminate,
  disabled,
  onChange,
  label,
  testId,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: (target: boolean) => void;
  label: string;
  testId?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate ?? false;
    }
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="gbc-checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="gbc-tooltip" data-tooltip={text}>
      {children}
    </span>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  active,
  testId,
  danger,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  testId?: string;
  danger?: boolean;
}) {
  return (
    <Tooltip text={label}>
      <button
        type="button"
        className={`gbc-iconbtn${active ? ' gbc-iconbtn-active' : ''}${danger ? ' gbc-iconbtn-danger' : ''}`}
        aria-label={label}
        disabled={disabled}
        data-testid={testId}
        onClick={onClick}
      >
        <Icon name={icon} />
      </button>
    </Tooltip>
  );
}

export function SplitButton({
  label,
  onClick,
  disabled,
  disabledReason,
  menu,
  testId,
  busy,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string | null;
  menu: { label: string; onClick: () => void; disabled?: boolean }[];
  testId?: string;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (openRef.current && ref.current && !ref.current.contains(e.target as Node)) {
        openRef.current = false;
        ref.current.classList.remove('gbc-split-open');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
  return (
    <div className="gbc-split" ref={ref} data-testid={testId}>
      <button
        type="button"
        className="gbc-btn gbc-split-main"
        disabled={disabled || busy}
        title={disabled && disabledReason ? disabledReason : undefined}
        data-testid={testId ? `${testId}-main` : undefined}
        onClick={onClick}
      >
        {busy ? <span className="gbc-spinner" aria-hidden /> : null}
        {label}
      </button>
      <button
        type="button"
        className="gbc-btn gbc-split-arrow"
        disabled={busy}
        aria-label="More commit actions"
        data-testid={testId ? `${testId}-arrow` : undefined}
        onClick={() => {
          openRef.current = !openRef.current;
          ref.current?.classList.toggle('gbc-split-open', openRef.current);
        }}
      >
        <Icon name="chevronDown" size={12} />
      </button>
      <div className="gbc-split-menu" role="menu">
        {menu.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className="gbc-menu-item"
            disabled={item.disabled}
            onClick={() => {
              openRef.current = false;
              ref.current?.classList.remove('gbc-split-open');
              item.onClick();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}