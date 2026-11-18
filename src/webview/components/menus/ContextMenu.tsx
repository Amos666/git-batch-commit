import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePanelStore, useStoreApi } from '../../state/StoreContext';
import { Icon } from '../../theme/icons/Icon';
import { menuForTarget } from './items';

export function ContextMenu() {
  const target = usePanelStore((s) => s.contextMenu);
  const close = usePanelStore((s) => s.closeContextMenu);
  const api = useStoreApi();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!target) {
      return;
    }
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close();
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        close();
      }
    };
    const onScroll = (): void => close();
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [target, close]);

  useLayoutEffect(() => {
    if (!target || !ref.current) {
      setPos(null);
      return;
    }
    const rect = ref.current.getBoundingClientRect();
    let top = target.y;
    let left = target.x;
    if (top + rect.height > window.innerHeight) {
      top = Math.max(4, target.y - rect.height);
    }
    if (left + rect.width > window.innerWidth) {
      left = Math.max(4, window.innerWidth - rect.width - 4);
    }
    setPos({ top, left });
  }, [target]);

  if (!target) {
    return null;
  }
  const items = menuForTarget(target, api.getState());
  return (
    <div
      className="gbc-menu"
      ref={ref}
      role="menu"
      data-testid="context-menu"
      style={{ position: 'fixed', top: pos?.top ?? target.y, left: pos?.left ?? target.x, visibility: pos ? 'visible' : 'hidden' }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={`sep-${i}`} className="gbc-menu-sep" role="separator" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`gbc-menu-item${item.danger ? ' gbc-menu-item-danger' : ''}`}
            disabled={item.disabled}
            data-testid={`menu-${item.id}`}
            data-menu-label={item.label}
            onClick={() => {
              close();
              item.run?.();
            }}
          >
            <span className="gbc-menu-icon">{item.icon && <Icon name={item.icon} size={14} />}</span>
            <span className="gbc-menu-label">{item.label}</span>
            {item.shortcut && <span className="gbc-menu-shortcut">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}