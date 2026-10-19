import { expect, test } from "bun:test";

import { fetchPublicBytes, isAllowedImageUrl } from "./image-fetch";

test("public image urls are allowed", () => {
  expect(isAllowedImageUrl("https://example.com/a.png")).toBe(true);
  expect(isAllowedImageUrl("http://8.8.8.8/a.png")).toBe(true);
});

test("private, local, and non-http urls are blocked", () => {
  const blocked = [
    "http://127.0.0.1/a.png",
    "http://10.1.2.3/a.png",
    "http://192.168.1.1/a.png",
    "http://172.16.0.1/a.png",
    "http://169.254.169.254/latest",
    "http://100.64.1.1/a.png",
    "http://0.0.0.0/",
    "http://[::1]/a.png",
    "http://[::ffff:127.0.0.1]/a.png",
    "http://2130706433/a.png",
    "http://localhost/a.png",
    "http://printer.local/a.png",
    "file:///etc/passwd",
    "not a url",
  ];
  for (const url of blocked) {
    expect(isAllowedImageUrl(url)).toBe(false);
  }
});

test("does not request a private url", async () => {
  let called = false;
  const result = await fetchPublicBytes("http://127.0.0.1/a.png", {
    fetchImpl: async () => {
      called = true;
      return new Response();
    },
    maxBytes: 100,
    maxRedirects: 2,
    timeoutMs: 50,
  });
  expect(result).toBeNull();
  expect(called).toBe(false);
});

test("does not follow a redirect onto a private host", async () => {
  const seen: string[] = [];
  const result = await fetchPublicBytes("https://example.com/a.png", {
    fetchImpl: async (url) => {
      seen.push(String(url));
      return new Response(null, {
        headers: { location: "http://127.0.0.1/secret.png" },
        status: 302,
      });
    },
    maxBytes: 100,
    maxRedirects: 2,
    timeoutMs: 50,
  });
  expect(result).toBeNull();
  expect(seen).toEqual(["https://example.com/a.png"]);
});

test("stops when the body exceeds the cap", async () => {
  const result = await fetchPublicBytes("https://example.com/a.png", {
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(80));
            controller.enqueue(new Uint8Array(80));
            controller.close();
          },
        }),
        { headers: { "content-type": "image/png" }, status: 200 }
      ),
    maxBytes: 100,
    maxRedirects: 0,
    timeoutMs: 200,
  });
  expect(result).toBeNull();
});

test("aborts a body read that outlives the timeout", async () => {
  let aborted = false;
  const result = await fetchPublicBytes("https://example.com/a.png", {
    fetchImpl: (_url, init) => {
      const stream = new ReadableStream({
        pull(controller) {
          return new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              controller.enqueue(Uint8Array.of(1, 2, 3));
              controller.close();
              resolve();
            }, 300);
            init?.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              aborted = true;
              controller.error(new DOMException("aborted", "AbortError"));
              resolve();
            });
          });
        },
      });
      return Promise.resolve(
        new Response(stream, {
          headers: { "content-type": "image/png" },
          status: 200,
        })
      );
    },
    maxBytes: 1000,
    maxRedirects: 0,
    timeoutMs: 30,
  });
  expect(result).toBeNull();
  expect(aborted).toBe(true);
});

test("returns a small body", async () => {
  const result = await fetchPublicBytes("https://cdn.example/a.png", {
    fetchImpl: async () =>
      new Response(Uint8Array.of(1, 2, 3, 4), {
        headers: { "content-type": "image/png" },
        status: 200,
      }),
    maxBytes: 10,
    maxRedirects: 1,
    timeoutMs: 50,
  });
  expect([...(result?.bytes ?? [])]).toEqual([1, 2, 3, 4]);
  expect(result?.contentType).toBe("image/png");
});
