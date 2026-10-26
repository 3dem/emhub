export function extractValidationErrors(detail: string): string[] {
  const singleQuoted = Array.from(detail.matchAll(/'([^']+)'/g), (m) => m[1].trim());
  if (singleQuoted.length) return singleQuoted;

  const doubleQuoted = Array.from(detail.matchAll(/"([^"]+)"/g), (m) => m[1].trim());
  if (doubleQuoted.length) return doubleQuoted;

  const bracket = detail.match(/\[(.*)\]/);
  if (bracket && bracket[1]) {
    return bracket[1]
      .split(/',\s*'|",\s*"/)
      .map((s: string) => s.replace(/^['"]|['"]$/g, "").trim())
      .filter((s: string) => s.length > 0);
  }

  return [detail.replace(/^422:\s*/, "").trim()];
}

export function extractValidationMessages(detail: any): string[] {
  if (!detail) return [];

  if (typeof detail === "string") {
    return extractValidationErrors(detail);
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") return item;

        const loc = Array.isArray(item?.loc) ? item.loc.join(".") : "";
        const msg = item?.msg ?? item?.message ?? JSON.stringify(item);
        const locPrefix = loc ? `${loc}: ` : "";
        return `${locPrefix}${String(msg)}`;
      })
      .filter((s) => typeof s === "string" && s.trim().length > 0);
  }

  if (typeof detail === "object") {
    const msg = (detail as any).msg ?? (detail as any).message ?? (detail as any).error;
    if (typeof msg === "string" && msg.trim()) return [msg];
    try {
      return [JSON.stringify(detail)];
    } catch {
      return [String(detail)];
    }
  }

  return [String(detail)];
}

export function normalizeStringList(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v)).filter((s) => s.trim().length > 0);
  if (typeof value === "string") return [value].filter((s) => s.trim().length > 0);
  return [String(value)].filter((s) => s.trim().length > 0);
}

export function getBackendPayloadFromError(err: any): any {
  return err?.response?.data ?? err?.data ?? null;
}

export function getHttpStatusFromError(err: any): number | null {
  const statusCode = err?.status ?? err?.response?.status ?? null;
  return typeof statusCode === "number" ? statusCode : null;
}

export function getErrorsFromBackendPayload(payload: any): string[] {
  if (!payload) return [];

  const directErrors = normalizeStringList(payload?.errors);
  if (directErrors.length > 0) return directErrors;

  const detail = payload?.detail ?? payload?.error ?? payload?.message ?? null;
  if (!detail) return [];

  return extractValidationMessages(detail);
}

export function formatErrorsForDialog(errors: string[]): string {
  if (errors.length === 0) return "Unknown error";
  if (errors.length === 1) return errors[0];
  return errors.map((e, i) => `${i + 1}. ${e}`).join("\n");
}