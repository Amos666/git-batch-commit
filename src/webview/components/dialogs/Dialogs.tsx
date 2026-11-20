import { useState, type ReactNode } from 'react';
import type { ChangelistFileRef, PushPreviewCommit, PushPreviewEntry } from '../../../protocol/models';
import { STRINGS } from '../../strings/en';
import { usePanelStore } from '../../state/StoreContext';
import { pushTargetFor } from '../../state/slices/branch';
import type { Dialog } from '../../state/types';
import { Icon } from '../../theme/icons/Icon';
import { Checkbox, SplitButton } from '../primitives';

const D = STRINGS.dialogs;
const A = STRINGS.actions;

function Shell({
  title,
  testId,
  children,
  footer,
  wide,
}: {
  title: string;
  testId: string;
  children: ReactNode;
  footer: ReactNode;
  wide?: boolean;
}) {
  const closeDialog = usePanelStore((s) => s.closeDialog);
  const dialogBusy = usePanelStore((s) => s.dialogBusy);
  const dialogError = usePanelStore((s) => s.dialogError);
  return (
    <div
      className="gbc-dialog-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !dialogBusy) {
          closeDialog();
        }
      }}
    >
      <div className={wide ? 'gbc-dialog gbc-dialog-wide' : 'gbc-dialog'} role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
        <div className="gbc-dialog-head">
          <span className="gbc-dialog-title">{title}</span>
          <button type="button" className="gbc-banner-close" aria-label={A.close} data-testid="dialog-close" onClick={closeDialog}>
            <Icon name="close" size={12} />
          </button>
        </div>
        <div className="gbc-dialog-body">{children}</div>
        {dialogError && (
          <div className="gbc-dialog-error" role="alert" data-testid="dialog-error">
            {dialogError}
          </div>
        )}
        <div className="gbc-dialog-foot">{footer}</div>
      </div>
    </div>
  );
}

function Btn({
  label,
  onClick,
  primary,
  danger,
  disabled,
  testId,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  const busy = usePanelStore((s) => s.dialogBusy);
  return (
    <button
      type="button"
      className={`gbc-btn${primary ? ' gbc-btn-primary' : ''}${danger ? ' gbc-btn-danger' : ''}`}
      disabled={disabled || busy}
      data-testid={testId}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function FileList({ refs }: { refs: ChangelistFileRef[] }) {
  const repos = usePanelStore((s) => s.repos);
  const multi = new Set(refs.map((r) => r.repoId)).size > 1;
  return (
    <ul className="gbc-filelist" data-testid="dialog-filelist">
      {refs.map((r) => (
        <li key={`${r.repoId}:${r.path}`} title={r.path}>
          {multi ? `${repos[r.repoId]?.repo.name ?? r.repoId}: ` : ''}
          {r.path}
        </li>
      ))}
    </ul>
  );
}

function ListSelect({ value, onChange, testId }: { value: string; onChange: (id: string) => void; testId: string }) {
  const lists = usePanelStore((s) => s.changelists?.lists ?? []);
  return (
    <select className="gbc-input gbc-select" data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)}>
      {lists.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </select>
  );
}

function RollbackDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'rollback' }> }) {
  const rollbackFiles = usePanelStore((s) => s.rollbackFiles);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  return (
    <Shell
      title={D.rollbackTitle}
      testId="dialog-rollback"
      footer={
        <>
          <Btn label={A.cancel} onClick={closeDialog} />
          <Btn label={A.rollback} primary danger testId="dialog-ok" onClick={() => void rollbackFiles(dialog.refs)} />
        </>
      }
    >
      <p>{D.rollbackBody}</p>
      <FileList refs={dialog.refs} />
    </Shell>
  );
}

function DeleteFilesDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'deleteFiles' }> }) {
  const deleteFiles = usePanelStore((s) => s.deleteFiles);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  return (
    <Shell
      title={D.deleteTitle}
      testId="dialog-delete"
      footer={
        <>
          <Btn label={A.cancel} onClick={closeDialog} />
          <Btn label={A.delete} primary danger testId="dialog-ok" onClick={() => void deleteFiles(dialog.refs)} />
        </>
      }
    >
      <p>{D.deleteBody}</p>
      <FileList refs={dialog.refs} />
    </Shell>
  );
}

function ShelveDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'shelve' }> }) {
  const patchDialog = usePanelStore((s) => s.patchDialog);
  const confirmShelve = usePanelStore((s) => s.confirmShelve);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  return (
    <Shell
      title={D.shelveTitle}
      testId="dialog-shelve"
      footer={
        <>
          <Btn label={A.cancel} onClick={closeDialog} />
          <Btn label={A.shelveChanges} primary testId="dialog-ok" onClick={() => void confirmShelve()} />
        </>
      }
    >
      <label className="gbc-field">
        <span className="gbc-option-label">{D.shelfName}</span>
        <input
          type="text"
          className="gbc-input"
          data-testid="shelve-name"
          value={dialog.name}
          onChange={(e) => patchDialog({ name: e.target.value })}
        />
      </label>
      <div className="gbc-option-label">{D.shelveFiles}</div>
      <ul className="gbc-filelist gbc-checklist" data-testid="shelve-files">
        {dialog.refs.map((r) => (
          <li key={r.path}>
            <label className="gbc-checklist-item">
              <Checkbox
                checked={dialog.selected[r.path] ?? true}
                onChange={(target) => patchDialog({ selected: { ...dialog.selected, [r.path]: target } })}
                label={r.path}
              />
              <span title={r.path}>{r.path}</span>
            </label>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

function UnshelveDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'unshelve' }> }) {
  const patchDialog = usePanelStore((s) => s.patchDialog);
  const confirmUnshelve = usePanelStore((s) => s.confirmUnshelve);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  const mode = usePanelStore((s) => s.mode);
  return (
    <Shell
      title={D.unshelveTitle}
      testId="dialog-unshelve"
      footer={
        <>
          <Btn label={A.cancel} onClick={closeDialog} />
          <Btn label={A.unshelveChanges} primary testId="dialog-ok" onClick={() => void confirmUnshelve()} />
        </>
      }
    >
      {mode === 'changelist' && (
        <label className="gbc-field">
          <span className="gbc-option-label">{D.unshelveTo}</span>
          <ListSelect value={dialog.targetListId} onChange={(id) => patchDialog({ targetListId: id })} testId="unshelve-target" />
        </label>
      )}
      <div className="gbc-option-label">{D.unshelveFiles}</div>
      <ul className="gbc-filelist gbc-checklist" data-testid="unshelve-files">
        {dialog.files.map((path) => (
          <li key={path}>
            <label className="gbc-checklist-item">
              <Checkbox
                checked={dialog.selected[path] ?? true}
                onChange={(target) => patchDialog({ selected: { ...dialog.selected, [path]: target } })}
                label={path}
              />
              <span title={path}>{path}</span>
            </label>
          </li>
        ))}
      </ul>
      <label className="gbc-option-row gbc-option-check">
        <Checkbox
          checked={dialog.removeAfter}
          onChange={(target) => patchDialog({ removeAfter: target })}
          label={D.removeAfter}
          testId="unshelve-removeafter"
        />
        <span className="gbc-option-label">{D.removeAfter}</span>
      </label>
    </Shell>
  );
}

function StashCreateDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'stashCreate' }> }) {
  const patchDialog = usePanelStore((s) => s.patchDialog);
  const confirmStashCreate = usePanelStore((s) => s.confirmStashCreate);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  return (
    <Shell
      title={D.stashTitle}
      testId="dialog-stash"
      footer={
        <>
          <Btn label={A.cancel} onClick={closeDialog} />
          <Btn label={A.createStash} primary testId="dialog-ok" onClick={() => void confirmStashCreate()} />
        </>
      }
    >
      <label className="gbc-field">
        <span className="gbc-option-label">{D.stashMessage}</span>
        <input
          type="text"
          className="gbc-input"
          data-testid="stash-message"
          value={dialog.message}
          onChange={(e) => patchDialog({ message: e.target.value })}
        />
      </label>
      <label className="gbc-option-row gbc-option-check">
        <Checkbox
          checked={dialog.includeUntracked}
          onChange={(target) => patchDialog({ includeUntracked: target })}
          label={D.stashIncludeUntracked}
          testId="stash-untracked"
        />
        <span className="gbc-option-label">{D.stashIncludeUntracked}</span>
      </label>
      <label className="gbc-option-row gbc-option-check">
        <Checkbox
          checked={dialog.stagedOnly}
          onChange={(target) => patchDialog({ stagedOnly: target })}
          label={D.stashStagedOnly}
          testId="stash-stagedonly"
        />
        <span className="gbc-option-label">{D.stashStagedOnly}</span>
      </label>
    </Shell>
  );
}

function MoveChangelistDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'moveChangelist' }> }) {
  const patchDialog = usePanelStore((s) => s.patchDialog);
  const moveFiles = usePanelStore((s) => s.moveFiles);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  return (
    <Shell
      title={D.moveTitle}
      testId="dialog-move"
      footer={
        <>
          <Btn label={A.cancel} onClick={closeDialog} />
          <Btn label={A.move} primary testId="dialog-ok" onClick={() => void moveFiles(dialog.refs, dialog.targetId)} />
        </>
      }
    >
      <label className="gbc-field">
        <span className="gbc-option-label">{D.moveTarget}</span>
        <ListSelect value={dialog.targetId} onChange={(id) => patchDialog({ targetId: id })} testId="move-target" />
      </label>
      <FileList refs={dialog.refs} />
    </Shell>
  );
}

function NewChangelistDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'newChangelist' }> }) {
  const patchDialog = usePanelStore((s) => s.patchDialog);
  const createChangelist = usePanelStore((s) => s.createChangelist);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  return (
    <Shell
      title={D.newChangelistTitle}
      testId="dialog-newchangelist"
      footer={
        <>
          <Btn label={A.cancel} onClick={closeDialog} />
          <Btn
            label={A.create}
            primary
            testId="dialog-ok"
            disabled={!dialog.name.trim()}
            onClick={() => void createChangelist(dialog.name.trim(), dialog.comment)}
          />
        </>
      }
    >
      <label className="gbc-field">
        <span className="gbc-option-label">{D.listName}</span>
        <input
          type="text"
          className="gbc-input"
          data-testid="changelist-name"
          value={dialog.name}
          autoFocus
          onChange={(e) => patchDialog({ name: e.target.value })}
        />
      </label>
      <label className="gbc-field">
        <span className="gbc-option-label">{D.listComment}</span>
        <input
          type="text"
          className="gbc-input"
          data-testid="changelist-comment"
          value={dialog.comment}
          onChange={(e) => patchDialog({ comment: e.target.value })}
        />
      </label>
    </Shell>
  );
}

function RenameChangelistDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'renameChangelist' }> }) {
  const patchDialog = usePanelStore((s) => s.patchDialog);
  const renameChangelist = usePanelStore((s) => s.renameChangelist);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  return (
    <Shell
      title={D.renameChangelistTitle}
      testId="dialog-renamechangelist"
      footer={
        <>
          <Btn label={A.cancel} onClick={closeDialog} />
          <Btn
            label={A.rename}
            primary
            testId="dialog-ok"
            disabled={!dialog.name.trim()}
            onClick={() => void renameChangelist(dialog.id, dialog.name.trim())}
          />
        </>
      }
    >
      <label className="gbc-field">
        <span className="gbc-option-label">{D.listName}</span>
        <input
          type="text"
          className="gbc-input"
          data-testid="changelist-name"
          value={dialog.name}
          autoFocus
          onChange={(e) => patchDialog({ name: e.target.value })}
        />
      </label>
    </Shell>
  );
}

function EditCommentDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'editComment' }> }) {
  const patchDialog = usePanelStore((s) => s.patchDialog);
  const setChangelistComment = usePanelStore((s) => s.setChangelistComment);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  return (
    <Shell
      title={D.editCommentTitle}
      testId="dialog-editcomment"
      footer={
        <>
          <Btn label={A.cancel} onClick={closeDialog} />
          <Btn label={A.save} primary testId="dialog-ok" onClick={() => void setChangelistComment(dialog.id, dialog.comment)} />
        </>
      }
    >
      <textarea
        className="gbc-input gbc-comment-input"
        data-testid="changelist-comment"
        value={dialog.comment}
        autoFocus
        onChange={(e) => patchDialog({ comment: e.target.value })}
      />
    </Shell>
  );
}

function DeleteChangelistDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'deleteChangelist' }> }) {
  const lists = usePanelStore((s) => s.changelists?.lists ?? []);
  const removeChangelist = usePanelStore((s) => s.removeChangelist);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  const list = lists.find((l) => l.id === dialog.id);
  return (
    <Shell
      title={D.deleteChangelistTitle}
      testId="dialog-deletechangelist"
      footer={
        <>
          <Btn label={A.cancel} onClick={closeDialog} />
          <Btn label={A.delete} primary danger testId="dialog-ok" onClick={() => void removeChangelist(dialog.id)} />
        </>
      }
    >
      <p>{D.deleteChangelistBody(list?.name ?? dialog.id, list?.files.length ?? 0)}</p>
    </Shell>
  );
}

function ModeSwitchDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'modeSwitch' }> }) {
  const confirmModeSwitch = usePanelStore((s) => s.confirmModeSwitch);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  const enabling = dialog.mode === 'staging';
  return (
    <Shell
      title={enabling ? D.modeEnableTitle : D.modeDisableTitle}
      testId="dialog-modeswitch"
      footer={
        <>
          <Btn label={A.cancel} onClick={closeDialog} />
          <Btn
            label={enabling ? A.enable : A.disable}
            primary
            testId="dialog-ok"
            onClick={() => void confirmModeSwitch()}
          />
        </>
      }
    >
      <p>{enabling ? D.modeEnableBody(dialog.preview) : D.modeDisableBody(dialog.preview)}</p>
    </Shell>
  );
}

function ChangelistConflictDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'changelistConflict' }> }) {
  const moveFiles = usePanelStore((s) => s.moveFiles);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  return (
    <Shell
      title={D.conflictTitle}
      testId="dialog-changelistconflict"
      footer={
        <>
          <Btn label={A.cancel} onClick={closeDialog} />
          <Btn label={A.move} primary testId="dialog-ok" onClick={() => void moveFiles(dialog.refs, dialog.targetId, true)} />
        </>
      }
    >
      <p>{D.conflictBody(dialog.conflict.path, dialog.conflict.ownerListName)}</p>
    </Shell>
  );
}

function PushDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'push' }> }) {
  const repos = usePanelStore((s) => s.repos);
  const operations = usePanelStore((s) => s.operations);
  const dialogBusy = usePanelStore((s) => s.dialogBusy);
  const confirmPush = usePanelStore((s) => s.confirmPush);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  const togglePushRepo = usePanelStore((s) => s.togglePushRepo);
  const togglePushExpand = usePanelStore((s) => s.togglePushExpand);
  const setPushRemote = usePanelStore((s) => s.setPushRemote);
  const setPushBranch = usePanelStore((s) => s.setPushBranch);
  const setPushTags = usePanelStore((s) => s.setPushTags);
  const requestForcePush = usePanelStore((s) => s.requestForcePush);
  const cancelForcePush = usePanelStore((s) => s.cancelForcePush);
  const confirmForcePush = usePanelStore((s) => s.confirmForcePush);
  const retryPushRepo = usePanelStore((s) => s.retryPushRepo);
  const selectPushFiles = usePanelStore((s) => s.selectPushFiles);
  const cancelRemaining = usePanelStore((s) => s.cancelRemaining);
  const [targetEdit, setTargetEdit] = useState<string | null>(null);
  const selected = dialog.repoIds.filter((id) => dialog.checked[id]);
  const results = Object.values(dialog.results);
  const pushed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  if (dialog.forceConfirm) {
    const names = selected.map((id) => repos[id]?.repo.name ?? id).join(', ');
    return (
      <Shell
        title={D.forcePushTitle}
        testId="dialog-push"
        footer={
          <>
            <Btn label={A.cancel} onClick={cancelForcePush} />
            <Btn label={D.forcePush} primary danger testId="dialog-ok" onClick={() => void confirmForcePush()} />
          </>
        }
      >
        <p data-testid="forcepush-confirm">{D.forcePushBody(names)}</p>
      </Shell>
    );
  }

  return (
    <Shell
      title={D.pushTitle}
      testId="dialog-push"
      wide
      footer={
        <>
          <label className="gbc-pushtags">
            <span>{D.pushTagsLabel}</span>
            <select
              className="gbc-input gbc-select"
              data-testid="push-tags"
              value={dialog.tags ? 'all' : 'none'}
              disabled={dialogBusy}
              onChange={(e) => setPushTags(e.target.value === 'all')}
            >
              <option value="none">{D.pushTagsNone}</option>
              <option value="all">{D.pushTagsAll}</option>
            </select>
          </label>
          <span className="gbc-toolbar-spacer" />
          {dialogBusy ? (
            <button type="button" className="gbc-btn" data-testid="push-cancel-remaining" onClick={cancelRemaining}>
              {A.cancelRemaining}
            </button>
          ) : (
            <Btn label={A.cancel} onClick={closeDialog} />
          )}
          <SplitButton
            label={A.push}
            testId="dialog-ok"
            busy={dialogBusy}
            disabled={selected.length === 0}
            onClick={() => void confirmPush()}
            menu={[{ label: D.forcePush, disabled: selected.length === 0, onClick: requestForcePush }]}
          />
        </>
      }
    >
      <div className="gbc-pushpanes">
      <ul className="gbc-pushlist" data-testid="push-repos">
        {dialog.repoIds.map((id) => {
          const status = repos[id];
          if (!status) {
            return null;
          }
          const entry = dialog.preview[id];
          const { branch } = status;
          const ahead = entry?.ahead ?? branch.ahead;
          const result = dialog.results[id];
          const pushing = operations[id]?.phase === 'pushing';
          const expanded = !!dialog.expanded[id];
          const remotes = entry?.remotes ?? [];
          const target = pushTargetFor(dialog, id, status, entry);
          const editingTarget = targetEdit === id;
          return (
            <li key={id} data-repo={id} data-testid="push-repo">
              <div className="gbc-pushrow">
                <button
                  type="button"
                  className="gbc-chevron"
                  data-testid="push-expand"
                  aria-label={status.repo.name}
                  onClick={() => togglePushExpand(id)}
                >
                  <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={12} />
                </button>
                <Checkbox
                  checked={!!dialog.checked[id]}
                  onChange={() => togglePushRepo(id)}
                  label={status.repo.name}
                  testId="push-check"
                  disabled={dialogBusy}
                />
                <button
                  type="button"
                  className={dialog.selected?.repoId === id && !dialog.selected.hash ? 'gbc-repo-name gbc-pushsel-on' : 'gbc-repo-name'}
                  data-testid="push-repo-select"
                  onClick={() => selectPushFiles(id)}
                >
                  {status.repo.name}
                </button>
                <span className="gbc-pushref">
                  {branch.name}
                  {' → '}
                  <button
                    type="button"
                    className={editingTarget ? 'gbc-pushtarget gbc-pushtarget-on' : 'gbc-pushtarget'}
                    data-testid="push-target"
                    title={D.pushTargetEdit}
                    disabled={dialogBusy}
                    onClick={() => setTargetEdit(id)}
                  >
                    {target.remote ? `${target.remote}/${target.branch}` : D.pushChooseRemote}
                  </button>
                </span>
                {ahead !== undefined && ahead > 0 && <span className="gbc-ahead">↑{ahead}</span>}
                <span className="gbc-pushstate" data-testid="push-state">
                  {pushing ? (
                    <span className="gbc-spinner" aria-hidden />
                  ) : result?.ok ? (
                    <Icon name="check" size={12} />
                  ) : result ? (
                    <Icon name="close" size={12} />
                  ) : null}
                </span>
              </div>
              {editingTarget && (
                <div className="gbc-pushtarget-edit" data-testid="push-target-edit">
                  <label className="gbc-pushtarget-field">
                    <span>{D.pushTargetRemote}</span>
                    <select
                      className="gbc-input gbc-select gbc-pushremote"
                      data-testid="push-remote"
                      value={target.remote}
                      disabled={dialogBusy || remotes.length === 0}
                      onChange={(e) => setPushRemote(id, e.target.value)}
                    >
                      {!target.remote && (
                        <option value="" disabled>
                          {D.pushChooseRemote}
                        </option>
                      )}
                      {target.remote && !remotes.includes(target.remote) && (
                        <option value={target.remote}>{target.remote}</option>
                      )}
                      {remotes.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="gbc-pushtarget-field">
                    <span>{D.pushTargetBranch}</span>
                    <input
                      className="gbc-input gbc-pushbranch"
                      data-testid="push-branch"
                      value={target.branch}
                      disabled={dialogBusy}
                      onChange={(e) => setPushBranch(id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === 'Escape') {
                          setTargetEdit(null);
                        }
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="gbc-btn gbc-btn-sm"
                    data-testid="push-target-done"
                    onClick={() => setTargetEdit(null)}
                  >
                    {D.pushTargetDone}
                  </button>
                </div>
              )}
              {!branch.upstream && <div className="gbc-push-note">{D.pushNoUpstream}</div>}
              {expanded && (
                <ul className="gbc-pushcommits" data-testid="push-commits">
                  {dialog.previewLoading && !entry ? (
                    <li className="gbc-pushcommit-muted">{D.pushLoading}</li>
                  ) : entry?.previewUnavailable ? (
                    <li className="gbc-pushcommit-muted">{D.pushPreviewUnavailable}</li>
                  ) : entry && entry.commits.length > 0 ? (
                    <>
                      {entry.commits.slice(0, 10).map((c) => (
                        <li
                          key={c.hash}
                          className={
                            dialog.selected?.repoId === id && dialog.selected.hash === c.hash
                              ? 'gbc-pushcommit gbc-pushsel-on'
                              : 'gbc-pushcommit'
                          }
                          data-testid="push-commit"
                          tabIndex={0}
                          onClick={() => selectPushFiles(id, c.hash)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              selectPushFiles(id, c.hash);
                            }
                          }}
                        >
                          <span className="gbc-pushcommit-hash">{c.hash.slice(0, 7)}</span>
                          <span className="gbc-pushcommit-msg">{c.message.split('\n')[0]}</span>
                          {c.authorName && (
                            <span className="gbc-pushcommit-author">
                              {c.authorName}
                              {isOtherAuthor(entry, c) ? '*' : ''}
                            </span>
                          )}
                        </li>
                      ))}
                      {entry.commits.length > 10 && (
                        <li className="gbc-pushcommit-muted">{D.pushMore(entry.commits.length - 10)}</li>
                      )}
                    </>
                  ) : (
                    <li className="gbc-pushcommit-muted">{D.pushNoCommits}</li>
                  )}
                </ul>
              )}
              {result && !result.ok && (
                <div className="gbc-pusherror" data-testid="push-error">
                  <span>{result.skipped === 'cancelled' ? STRINGS.errors.CANCELLED : (result.error?.message ?? STRINGS.errors.GENERIC)}</span>
                  {!dialogBusy && (
                    <button type="button" className="gbc-btn gbc-btn-sm" data-testid="push-retry" onClick={() => void retryPushRepo(id)}>
                      {A.retry}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <PushFilesPane dialog={dialog} />
      </div>
      {results.length > 0 && (
        <div className="gbc-pushsummary" data-testid="push-summary">
          {D.pushSummary(pushed, failed)}
        </div>
      )}
    </Shell>
  );
}

function PushFilesPane({ dialog }: { dialog: Extract<Dialog, { kind: 'push' }> }) {
  const repos = usePanelStore((s) => s.repos);
  const openPushFileDiff = usePanelStore((s) => s.openPushFileDiff);
  const sel = dialog.selected;
  const files = dialog.files;
  const repoName = sel ? (repos[sel.repoId]?.repo.name ?? sel.repoId) : '';
  const header = sel
    ? sel.hash
      ? `${repoName} · ${sel.hash.slice(0, 7)}`
      : `${repoName} · ${repos[sel.repoId]?.branch.name ?? ''}`
    : D.pushFilesHint;
  return (
    <div className="gbc-pushfiles" data-testid="push-files">
      <div className="gbc-pushfiles-head" data-testid="push-files-head">
        <span className="gbc-pushfiles-title">{header}</span>
        {files && !dialog.filesLoading && (
          <span className="gbc-pushfiles-count">{D.pushFilesCount(files.files.length)}</span>
        )}
      </div>
      {dialog.filesLoading ? (
        <div className="gbc-pushcommit-muted" data-testid="push-files-loading">{D.pushFilesLoading}</div>
      ) : dialog.filesError ? (
        <div className="gbc-pushcommit-muted" data-testid="push-files-error">{dialog.filesError}</div>
      ) : !sel ? null : files && files.files.length > 0 ? (
        <ul className="gbc-pushfilelist">
          {files.files.map((f) => {
            const display = f.renamePath ?? f.path;
            const renamed = f.origPath !== undefined && f.origPath !== display;
            return (
              <li
                key={f.path}
                className="gbc-pushfile"
                data-testid="push-file"
                tabIndex={0}
                title={display}
                onDoubleClick={() => void openPushFileDiff(f)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void openPushFileDiff(f);
                  }
                }}
              >
                <span className={`gbc-pushfile-status gbc-pushfile-${statusLetter(f.status)}`}>{statusLetter(f.status)}</span>
                <span className="gbc-pushfile-path">{display}</span>
                {renamed && <span className="gbc-pushfile-orig">← {f.origPath}</span>}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="gbc-pushcommit-muted" data-testid="push-files-empty">{D.pushFilesEmpty}</div>
      )}
    </div>
  );
}

function statusLetter(status: number | undefined): string {
  switch (status) {
    case 1:
      return 'A';
    case 2:
    case 6:
      return 'D';
    case 3:
      return 'R';
    case 4:
      return 'C';
    case 11:
      return 'T';
    default:
      return 'M';
  }
}

function isOtherAuthor(entry: PushPreviewEntry | undefined, commit: PushPreviewCommit): boolean {
  const self = entry?.selfAuthor;
  if (!self) {
    return false;
  }
  if (self.email && commit.authorEmail) {
    return self.email.toLowerCase() !== commit.authorEmail.toLowerCase();
  }
  if (self.name && commit.authorName) {
    return self.name !== commit.authorName;
  }
  return false;
}

function AmendPushedDialog() {
  const confirmAmendPushed = usePanelStore((s) => s.confirmAmendPushed);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  return (
    <Shell
      title={D.amendPushedTitle}
      testId="dialog-amendpushed"
      footer={
        <>
          <Btn label={A.cancel} onClick={closeDialog} />
          <Btn label={A.amendAnyway} primary danger testId="dialog-ok" onClick={() => void confirmAmendPushed()} />
        </>
      }
    >
      <p>{D.amendPushedBody}</p>
    </Shell>
  );
}

const CHECK_STATUS_LABEL = {
  ok: STRINGS.checks.statusOk,
  issues: STRINGS.checks.statusIssues,
  unavailable: STRINGS.checks.statusUnavailable,
  skipped: STRINGS.checks.statusSkipped,
} as const;

function ChecksReportDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'checksReport' }> }) {
  const commit = usePanelStore((s) => s.commit);
  const requestPush = usePanelStore((s) => s.requestPush);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  return (
    <Shell
      title={D.checksReportTitle}
      testId="dialog-checksreport"
      footer={
        dialog.postCommit ? (
          <>
            <Btn label={STRINGS.checks.review} testId="dialog-review" onClick={closeDialog} />
            {dialog.pushAfter && (
              <Btn
                label={A.push}
                primary
                testId="dialog-ok"
                onClick={() => {
                  closeDialog();
                  requestPush(dialog.repoIds ?? []);
                }}
              />
            )}
          </>
        ) : (
          <>
            <Btn label={STRINGS.checks.review} onClick={closeDialog} />
            <Btn
              label={STRINGS.checks.commitAnyway}
              primary
              testId="dialog-ok"
              onClick={() => {
                closeDialog();
                void commit({ skipChecks: true, pushAfter: dialog.pushAfter });
              }}
            />
          </>
        )
      }
    >
      <ul className="gbc-checkreport" data-testid="checks-report">
        {dialog.report.results.map((r) => (
          <li key={r.id} data-check={r.id} data-status={r.status}>
            <span className="gbc-option-label">{STRINGS.checks[r.id]}</span>
            <span className={`gbc-checkstatus gbc-checkstatus-${r.status}`}>{CHECK_STATUS_LABEL[r.status]}</span>
            {r.details && <span className="gbc-checkdetails">{r.details}</span>}
          </li>
        ))}
      </ul>
    </Shell>
  );
}

function AbortMergeDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'abortMerge' }> }) {
  const repos = usePanelStore((s) => s.repos);
  const confirmAbortMerge = usePanelStore((s) => s.confirmAbortMerge);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  return (
    <Shell
      title={D.abortTitle}
      testId="dialog-abort"
      footer={
        <>
          <Btn label={A.cancel} onClick={closeDialog} />
          <Btn label={A.abort} primary danger testId="dialog-ok" onClick={() => void confirmAbortMerge()} />
        </>
      }
    >
      <p>{D.abortBody(repos[dialog.repoId]?.repo.name ?? dialog.repoId)}</p>
    </Shell>
  );
}

function UndoCommitDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'undoCommit' }> }) {
  const repos = usePanelStore((s) => s.repos);
  const confirmUndoCommit = usePanelStore((s) => s.confirmUndoCommit);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  const status = repos[dialog.repoId];
  return (
    <Shell
      title={D.undoTitle}
      testId="dialog-undo"
      footer={
        <>
          <Btn label={A.cancel} onClick={closeDialog} />
          <Btn label={A.undoCommit} primary danger testId="dialog-ok" onClick={() => void confirmUndoCommit()} />
        </>
      }
    >
      <p>{D.undoBody(status?.repo.name ?? dialog.repoId, status?.branch.oid?.slice(0, 7) ?? '')}</p>
    </Shell>
  );
}

function SkipHooksDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'skipHooks' }> }) {
  const commit = usePanelStore((s) => s.commit);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  return (
    <Shell
      title={D.skipHooksTitle}
      testId="dialog-skiphooks"
      footer={
        <>
          <Btn label={A.cancel} onClick={closeDialog} />
          <Btn
            label={STRINGS.recovery.skipHooksRetry}
            primary
            testId="dialog-ok"
            onClick={() => {
              closeDialog();
              void commit({ skipChecks: true, noVerify: true, pushAfter: dialog.pushAfter });
            }}
          />
        </>
      }
    >
      <p>{D.skipHooksBody}</p>
    </Shell>
  );
}

function PickChangelistDialog() {
  const lists = usePanelStore((s) => s.changelists?.lists ?? []);
  const activeId = usePanelStore((s) => s.changelists?.activeId);
  const setActiveChangelist = usePanelStore((s) => s.setActiveChangelist);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  return (
    <Shell
      title={STRINGS.misc.pickChangelist}
      testId="dialog-pickchangelist"
      footer={<Btn label={A.close} onClick={closeDialog} />}
    >
      <ul className="gbc-picklist" data-testid="pick-changelists">
        {lists.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              className={`gbc-menu-item${l.id === activeId ? ' gbc-pick-active' : ''}`}
              data-testid={`pick-${l.id}`}
              onClick={() => void setActiveChangelist(l.id)}
            >
              {l.id === activeId && <Icon name="check" size={12} />}
              {l.name}
            </button>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

function DropStashDialog() {
  const confirmDropStash = usePanelStore((s) => s.confirmDropStash);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  return (
    <Shell
      title={D.dropStashTitle}
      testId="dialog-dropstash"
      footer={
        <>
          <Btn label={A.cancel} onClick={closeDialog} />
          <Btn label={A.delete} primary danger testId="dialog-ok" onClick={() => void confirmDropStash()} />
        </>
      }
    >
      <p>{D.dropStashBody}</p>
    </Shell>
  );
}

function PopStashDialog() {
  const confirmPopStash = usePanelStore((s) => s.confirmPopStash);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  return (
    <Shell
      title={D.popStashTitle}
      testId="dialog-popstash"
      footer={
        <>
          <Btn label={A.cancel} onClick={closeDialog} />
          <Btn label={STRINGS.menus.stashEntry.pop} primary testId="dialog-ok" onClick={() => void confirmPopStash()} />
        </>
      }
    >
      <p>{D.popStashBody}</p>
    </Shell>
  );
}

function DeleteShelfDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'deleteShelf' }> }) {
  const entries = usePanelStore((s) => s.shelfTab?.entries ?? []);
  const confirmDeleteShelf = usePanelStore((s) => s.confirmDeleteShelf);
  const closeDialog = usePanelStore((s) => s.closeDialog);
  const entry = entries.find((e) => e.id === dialog.id);
  return (
    <Shell
      title={D.deleteShelfTitle}
      testId="dialog-deleteshelf"
      footer={
        <>
          <Btn label={A.cancel} onClick={closeDialog} />
          <Btn label={A.delete} primary danger testId="dialog-ok" onClick={() => void confirmDeleteShelf()} />
        </>
      }
    >
      <p>{D.deleteShelfBody(entry?.name ?? dialog.id)}</p>
    </Shell>
  );
}

export function Dialogs() {
  const dialog = usePanelStore((s) => s.dialog);
  if (!dialog) {
    return null;
  }
  switch (dialog.kind) {
    case 'rollback':
      return <RollbackDialog dialog={dialog} />;
    case 'deleteFiles':
      return <DeleteFilesDialog dialog={dialog} />;
    case 'shelve':
      return <ShelveDialog dialog={dialog} />;
    case 'unshelve':
      return <UnshelveDialog dialog={dialog} />;
    case 'stashCreate':
      return <StashCreateDialog dialog={dialog} />;
    case 'moveChangelist':
      return <MoveChangelistDialog dialog={dialog} />;
    case 'newChangelist':
      return <NewChangelistDialog dialog={dialog} />;
    case 'renameChangelist':
      return <RenameChangelistDialog dialog={dialog} />;
    case 'editComment':
      return <EditCommentDialog dialog={dialog} />;
    case 'deleteChangelist':
      return <DeleteChangelistDialog dialog={dialog} />;
    case 'modeSwitch':
      return <ModeSwitchDialog dialog={dialog} />;
    case 'changelistConflict':
      return <ChangelistConflictDialog dialog={dialog} />;
    case 'push':
      return <PushDialog dialog={dialog} />;
    case 'amendPushed':
      return <AmendPushedDialog />;
    case 'checksReport':
      return <ChecksReportDialog dialog={dialog} />;
    case 'abortMerge':
      return <AbortMergeDialog dialog={dialog} />;
    case 'undoCommit':
      return <UndoCommitDialog dialog={dialog} />;
    case 'skipHooks':
      return <SkipHooksDialog dialog={dialog} />;
    case 'pickChangelist':
      return <PickChangelistDialog />;
    case 'dropStash':
      return <DropStashDialog />;
    case 'popStash':
      return <PopStashDialog />;
    case 'deleteShelf':
      return <DeleteShelfDialog dialog={dialog} />;
  }
}