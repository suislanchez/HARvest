export function findOriginalResponse(
  har: any,
  matchedRequest: { method: string; url: string },
): string | null {
  if (!har?.log?.entries) return null;

  const entry = har.log.entries.find(
    (e: any) =>
      e.request.method === matchedRequest.method &&
      e.request.url === matchedRequest.url,
  );

  return entry?.response?.content?.text || null;
}
