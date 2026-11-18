import type { ProtocolError, RecoveryAction } from '../../protocol/errors';
import { STRINGS } from '../strings/en';

/** User-facing summary for a protocol error; technical detail stays secondary. */
export function errorText(error: ProtocolError): string {
  return STRINGS.errors[error.code] ?? STRINGS.errors.GENERIC;
}

/** Recovery buttons to render, in protocol order, without duplicates. */
export function recoveryActions(error: ProtocolError): RecoveryAction[] {
  return [...new Set(error.actions)];
}

export function recoveryLabel(action: RecoveryAction): string {
  return STRINGS.recovery[action];
}