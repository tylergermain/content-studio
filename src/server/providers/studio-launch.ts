/** Normalize conflicting CLI options before adding the studio's permission defaults. */
export function studioPermissionArgs(provider: 'claude' | 'codex' | 'pi', extra: string[]): string[] {
  const values = provider === 'claude' ? ['--permission-mode'] : provider === 'codex' ? ['--sandbox', '-s', '--ask-for-approval', '-a'] : [];
  const flags = provider === 'claude' ? ['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions'] : provider === 'codex' ? ['--yolo', '--full-auto', '--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust'] : ['--approve', '-a', '--no-approve', '-na'];
  const args: string[] = [];
  for (let i = 0; i < extra.length; i++) {
    const arg = extra[i];
    if (arg === '--') break;
    if (flags.includes(arg)) continue;
    if (values.includes(arg)) { i++; continue; }
    if (values.some(value => arg.startsWith(`${value}=`))) continue;
    args.push(arg);
  }
  return [...args, ...(provider === 'claude' ? ['--dangerously-skip-permissions'] : provider === 'codex' ? ['--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust'] : ['--approve'])];
}
