import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
blocked.addSubnet("0.0.0.0", 8, "ipv4");
blocked.addSubnet("10.0.0.0", 8, "ipv4");
blocked.addSubnet("100.64.0.0", 10, "ipv4");
blocked.addSubnet("127.0.0.0", 8, "ipv4");
blocked.addSubnet("169.254.0.0", 16, "ipv4");
blocked.addSubnet("172.16.0.0", 12, "ipv4");
blocked.addSubnet("192.168.0.0", 16, "ipv4");
blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
blocked.addSubnet("fc00::", 7, "ipv6");
blocked.addSubnet("fe80::", 10, "ipv6");

export interface FetchPublicOptions {
  fetchImpl?: typeof fetch;
  maxBytes: number;
  maxRedirects: number;
  timeoutMs: number;
}

export interface FetchedBytes {
  bytes: Buffer;
  contentType: string;
}

const hostOf = (hostname: string): string =>
  hostname.replaceAll(/^\[|\]$/gu, "").toLowerCase();

export const isAllowedImageUrl = (raw: string): boolean => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  const host = hostOf(url.hostname);
  if (
    host.length === 0 ||
    host.includes("%") ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return false;
  }
  const kind = isIP(host);
  if (kind === 0) {
    return true;
  }
  return !blocked.check(host, kind === 4 ? "ipv4" : "ipv6");
};

const readLimited = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  cap: number
): Promise<Buffer | null> => {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const next = async (): Promise<Buffer | null> => {
    const { done, value } = await reader.read();
    if (done) {
      return Buffer.concat(chunks);
    }
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
    return await next();
  };
  try {
    return await next();
  } finally {
    reader.releaseLock();
  }
};

const fetchHop = async (
  current: string,
  hop: number,
  fetchImpl: typeof fetch,
  maxBytes: number,
  maxRedirects: number,
  timeoutMs: number
): Promise<FetchedBytes | null> => {
  if (hop > maxRedirects || !isAllowedImageUrl(current)) {
    return null;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, timeoutMs);
  try {
    const res = await fetchImpl(current, {
      redirect: "manual",
      signal: ctrl.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel();
      if (loc === null || loc.length === 0) {
        return null;
      }
      return await fetchHop(
        new URL(loc, current).href,
        hop + 1,
        fetchImpl,
        maxBytes,
        maxRedirects,
        timeoutMs
      );
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      return null;
    }
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body.cancel();
      return null;
    }
    const bytes = await readLimited(res.body.getReader(), maxBytes);
    if (bytes === null || bytes.byteLength === 0) {
      return null;
    }
    return {
      bytes,
      contentType: res.headers.get("content-type") ?? "",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

export const fetchPublicBytes = async (
  raw: string,
  opts: FetchPublicOptions
): Promise<FetchedBytes | null> =>
  await fetchHop(
    raw,
    0,
    opts.fetchImpl ?? fetch,
    opts.maxBytes,
    opts.maxRedirects,
    opts.timeoutMs
  );
