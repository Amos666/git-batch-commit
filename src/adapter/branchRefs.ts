import type { BranchRef } from '../protocol/messages';
import type { Ref } from './gitApiTypes';

// 内置 git API 的 RefType 是数字枚举（Head=0, RemoteHead=1, Tag=2），字符串形式仅兼容旧 mock
export function mapLocalBranches(refs: Ref[], currentName: string | undefined): BranchRef[] {
  return refs
    .filter((r) => (r.type === 0 || r.type === 'head') && r.name)
    .map((r) => ({ name: r.name as string, commit: r.commit, current: r.name === currentName }));
}