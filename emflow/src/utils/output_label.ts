/**
 * Label of a protocol output: its info (or another text), after its prefix
 * when it has one, e.g. "Class01 - Volume (112 x 112 x 112)". The prefix
 * (optional, from the host) tells apart outputs of the same kind of a
 * protocol, e.g. the volume of each class of a 3D classification.
 */
export function withOutputPrefix(text: unknown, prefix: unknown): string {
  const label = String(text ?? "");
  const p = typeof prefix === "string" ? prefix.trim() : "";
  return p ? (label ? `${p} - ${label}` : p) : label;
}
