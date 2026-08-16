export function renderPrompt(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_m, key: string) => {
    const value = vars[key];
    return value ?? '';
  });
}
