function canonicalHost(input: string | null): string | undefined {
  if (!input || input.length > 255 || /[\s,/@\\]/.test(input)) {
    return undefined;
  }
  try {
    const url = new URL(`http://${input}`);
    return url.host.toLowerCase() === input.toLowerCase() ? url.host.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

export function hasSameOriginHost(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || (fetchSite !== null && fetchSite !== "same-origin")) {
    return false;
  }
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (
    (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") ||
    originUrl.username ||
    originUrl.password ||
    originUrl.pathname !== "/" ||
    originUrl.search ||
    originUrl.hash
  ) {
    return false;
  }
  const expectedHost = canonicalHost(
    request.headers.get("x-forwarded-host") ??
      request.headers.get("host") ??
      new URL(request.url).host,
  );
  return expectedHost !== undefined && originUrl.host.toLowerCase() === expectedHost;
}
