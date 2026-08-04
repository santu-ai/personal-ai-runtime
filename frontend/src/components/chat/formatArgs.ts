/** Format a JSON-stringified tool-call arguments payload for display. */
export function formatArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}
