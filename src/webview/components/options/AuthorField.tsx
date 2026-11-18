import { useEffect, useState } from 'react';
import { STRINGS } from '../../strings/en';
import { usePanelStore } from '../../state/StoreContext';
import { IconButton } from '../primitives';

const AUTHOR_RE = /^\s*(.+?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/;

export function AuthorField() {
  const author = usePanelStore((s) => s.optionsState.author);
  const setOptions = usePanelStore((s) => s.setOptions);
  const [text, setText] = useState(author ? `${author.name} <${author.email}>` : '');

  useEffect(() => {
    setText(author ? `${author.name} <${author.email}>` : '');
  }, [author]);

  const apply = (): void => {
    const trimmed = text.trim();
    if (!trimmed) {
      if (author) {
        void setOptions({ author: undefined });
      }
      return;
    }
    const match = AUTHOR_RE.exec(trimmed);
    if (match && match[1] && match[2]) {
      void setOptions({ author: { name: match[1], email: match[2] } });
    }
  };

  return (
    <div className="gbc-option-row gbc-author" data-testid="option-author">
      <span className="gbc-option-label">{STRINGS.options.author}</span>
      <input
        type="text"
        className="gbc-input gbc-author-input"
        data-testid="author-input"
        placeholder={STRINGS.options.authorPlaceholder}
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply();
          }
        }}
      />
      <IconButton
        icon="close"
        label={STRINGS.options.authorClear}
        testId="author-clear"
        disabled={!author && !text}
        onClick={() => {
          setText('');
          void setOptions({ author: undefined });
        }}
      />
    </div>
  );
}