export interface FrontContext {
  page: string;
  source: string;
  url: string;
}

export const emptyContext = (): FrontContext => ({
  page: "",
  source: "",
  url: "",
});

const LS_NAME = /"LSDisplayName"="(?<name>[^"]*)"/u;
const LS_BUNDLE = /"CFBundleIdentifier"="(?<bundle>[^"]*)"/u;
const LS_PID = /"pid"=(?<pid>\d+)/u;

export const parseLsapp = (
  raw: string
): { bundle: string; name: string; pid: number } => ({
  bundle: LS_BUNDLE.exec(raw)?.groups?.bundle ?? "",
  name: LS_NAME.exec(raw)?.groups?.name ?? "",
  pid: Number(LS_PID.exec(raw)?.groups?.pid ?? 0),
});

export const cleanUrl = (raw: string): string => {
  const value = raw.trim();
  if (!value) {
    return "";
  }
  try {
    const url = new URL(value);
    if (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "file:"
    ) {
      return url.href;
    }
    return "";
  } catch {
    return "";
  }
};

export const cleanPage = (page: string, app: string): string => {
  let next = page.replaceAll(/\s+/gu, " ").trim();
  next = next.replace(/\s-\sHigh memory usage.*$/u, "").trim();
  if (app) {
    for (const mark of [` - ${app}`, ` — ${app}`, ` – ${app}`]) {
      if (next.endsWith(mark)) {
        next = next.slice(0, -mark.length).trim();
      }
    }
  }
  return next;
};

export const shortPage = (page: string): string => {
  const first =
    page.split(/\s[·|—–]\s/u)[0]?.trim() ||
    page.split(/\s-\s/u)[0]?.trim() ||
    page;
  if (first.length <= 42) {
    return first;
  }
  return `${first.slice(0, 41).trimEnd()}…`;
};

export const hostOf = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") {
      return decodeURIComponent(parsed.pathname.split("/").pop() ?? "");
    }
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.hostname.replace(/^www\./u, "");
    }
    return "";
  } catch {
    return "";
  }
};

export const sourceApp = (source: string): string =>
  source === "capture" ? "" : source;

export const sourcePlace = (ctx: FrontContext): string => {
  const page = shortPage(ctx.page);
  const app = sourceApp(ctx.source);
  const host = hostOf(ctx.url);
  const title = page && page !== app ? page : "";
  if (title && host) {
    return `${title} · ${host}`;
  }
  return title || host;
};

export const sourceLabel = (ctx: FrontContext): string => {
  const app = sourceApp(ctx.source);
  const host = hostOf(ctx.url);
  const page = shortPage(ctx.page);
  if (app && host) {
    return `${app} · ${host}`;
  }
  if (app && page && page !== app) {
    return `${app} · ${page}`;
  }
  return host || page || app;
};

export const sourceWhere = (ctx: FrontContext): string => {
  const host = hostOf(ctx.url);
  if (host) {
    return host;
  }
  const page = shortPage(ctx.page);
  const app = sourceApp(ctx.source);
  if (page && page !== app) {
    return page;
  }
  return app;
};

export const sourceHint = (ctx: FrontContext): string => {
  if (ctx.page && ctx.url) {
    return `${ctx.page}\n${ctx.url}`;
  }
  return ctx.page || ctx.url;
};

export const sourceSearchText = (ctx: FrontContext): string =>
  [ctx.source, ctx.page, ctx.url, hostOf(ctx.url)].join(" ").toLowerCase();

export const sourcePrompt = (ctx: FrontContext): string => {
  const app = sourceApp(ctx.source);
  if (ctx.url) {
    const line = app ? `${app} · ${ctx.url}` : ctx.url;
    return ctx.page ? `${line}\n${ctx.page}` : line;
  }
  if (app && ctx.page) {
    return `${app} · ${ctx.page}`;
  }
  return app || ctx.page;
};

export const isWebUrl = (url: string): boolean =>
  url.startsWith("http://") || url.startsWith("https://");

export const urlLabel = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") {
      return decodeURIComponent(parsed.pathname);
    }
    return `${parsed.hostname.replace(/^www\./u, "")}${parsed.pathname.replace(/\/$/u, "")}`;
  } catch {
    return url;
  }
};
