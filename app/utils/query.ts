export function pickFirstQuery(query: string | string[] | undefined): string {
  if (Array.isArray(query)) {
    return query[0] || "";
  }
  return query || "";
}
