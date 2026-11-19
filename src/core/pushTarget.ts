/** Pure push-target resolution shared by the host handlers and unit tests. */

export type RemotePick = { status: 'ok'; remote: string } | { status: 'none' } | { status: 'ambiguous' };

export function pickRemote(upstream: string | undefined, remotes: string[], explicit?: string): RemotePick {
  if (explicit) {
    return { status: 'ok', remote: explicit };
  }
  if (upstream) {
    return { status: 'ok', remote: upstream };
  }
  const only = remotes.length === 1 ? remotes[0] : undefined;
  if (only) {
    return { status: 'ok', remote: only };
  }
  return remotes.length === 0 ? { status: 'none' } : { status: 'ambiguous' };
}