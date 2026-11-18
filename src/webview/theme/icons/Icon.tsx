import { ICON_PATHS } from './paths';
import type { IconName } from './paths';

export type { IconName };

export function Icon({
  name,
  size = 16,
  className,
  title,
}: {
  name: IconName;
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={className ? `gbc-icon ${className}` : 'gbc-icon'}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      data-icon={name}
    >
      {title && <title>{title}</title>}
      {ICON_PATHS[name].map((p, i) =>
        p.fill ? (
          <path key={i} d={p.d} fill="currentColor" stroke="none" />
        ) : (
          <path
            key={i}
            d={p.d}
            stroke="currentColor"
            strokeWidth={1.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
    </svg>
  );
}