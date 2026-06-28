import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; pi-sidequest/0.1; +https://pi.dev) AppleWebKit/537.36 Chrome/120 Safari/537.36";

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function decodeHtml(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function htmlToText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/h[1-6]>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function absolutizeDuckDuckGoUrl(rawHref: string): string {
  const decoded = decodeHtml(rawHref);
  try {
    const url = decoded.startsWith("//")
      ? new URL(`https:${decoded}`)
      : decoded.startsWith("/")
        ? new URL(decoded, "https://duckduckgo.com")
        : new URL(decoded);
    const uddg = url.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : url.toString();
  } catch {
    return decoded;
  }
}

async function braveSearch(query: string, maxResults: number, signal?: AbortSignal): Promise<Array<{ title: string; url: string; snippet?: string }>> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(maxResults));

  const response = await fetch(url, {
    signal,
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": key,
      "User-Agent": DEFAULT_USER_AGENT,
    },
  });
  if (!response.ok) throw new Error(`Brave Search failed: HTTP ${response.status}`);
  const json = (await response.json()) as any;
  const results = Array.isArray(json?.web?.results) ? json.web.results : [];
  return results.slice(0, maxResults).map((result: any) => ({
    title: String(result.title ?? "Untitled"),
    url: String(result.url ?? ""),
    snippet: result.description ? String(result.description) : undefined,
  }));
}

async function duckDuckGoSearch(query: string, maxResults: number, signal?: AbortSignal): Promise<Array<{ title: string; url: string; snippet?: string }>> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);

  const response = await fetch(url, {
    signal,
    headers: {
      "User-Agent": DEFAULT_USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`DuckDuckGo search failed: HTTP ${response.status}`);

  const html = await response.text();
  const results: Array<{ title: string; url: string; snippet?: string }> = [];
  const regex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) && results.length < maxResults) {
    const resultUrl = absolutizeDuckDuckGoUrl(match[1] ?? "");
    const title = htmlToText(match[2] ?? "").replace(/\s+/g, " ").trim();
    if (!resultUrl || !title) continue;
    results.push({ title, url: resultUrl });
  }
  return results;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "sidequest_web_search",
    label: "Sidequest Web Search",
    description: "Search the web for public information. Prefer Brave Search when BRAVE_SEARCH_API_KEY is set, otherwise use DuckDuckGo HTML results.",
    promptSnippet: "Search the web for current external information",
    promptGuidelines: [
      "Use sidequest_web_search when the sidequest question needs current public information beyond the active pi conversation.",
      "When using sidequest_web_search, cite result URLs in the answer and separate external facts from conversation-grounded facts.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      maxResults: Type.Optional(Type.Number({ description: "Maximum number of results, 1-10", default: 5 })),
    }),
    async execute(_toolCallId, params, signal) {
      const maxResults = clamp((params as any).maxResults, 1, 10, 5);
      const query = String((params as any).query ?? "").trim();
      if (!query) {
        return { content: [{ type: "text", text: "Missing query." }], isError: true };
      }

      const results = process.env.BRAVE_SEARCH_API_KEY
        ? await braveSearch(query, maxResults, signal)
        : await duckDuckGoSearch(query, maxResults, signal);

      const text = results.length
        ? results
            .map((result, index) => `${index + 1}. ${result.title}\n   ${result.url}${result.snippet ? `\n   ${result.snippet}` : ""}`)
            .join("\n\n")
        : "No search results found.";

      return {
        content: [{ type: "text", text }],
        details: { query, maxResults, results },
      };
    },
  });

  pi.registerTool({
    name: "sidequest_web_fetch",
    label: "Sidequest Web Fetch",
    description: "Fetch a public http(s) URL and return readable text. Use after sidequest_web_search or when the user provides a URL.",
    promptSnippet: "Fetch a URL and extract readable text",
    promptGuidelines: [
      "Use sidequest_web_fetch to inspect source pages before relying on web search snippets.",
      "When using sidequest_web_fetch, cite the fetched URL in the answer and separate external facts from conversation-grounded facts.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "Public http(s) URL to fetch" }),
      maxChars: Type.Optional(Type.Number({ description: "Maximum characters to return, 1000-50000", default: 20000 })),
    }),
    async execute(_toolCallId, params, signal) {
      const rawUrl = String((params as any).url ?? "").trim();
      const maxChars = clamp((params as any).maxChars, 1000, 50_000, 20_000);
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        return { content: [{ type: "text", text: `Invalid URL: ${rawUrl}` }], isError: true };
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { content: [{ type: "text", text: "Only http(s) URLs are allowed." }], isError: true };
      }

      const response = await fetch(url, {
        signal,
        headers: {
          "User-Agent": DEFAULT_USER_AGENT,
          "Accept": "text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      const contentType = response.headers.get("content-type") ?? "unknown";
      const raw = await response.text();
      const readable = /html/i.test(contentType) ? htmlToText(raw) : raw.trim();
      const truncated = readable.length > maxChars;
      const text = truncated ? `${readable.slice(0, maxChars)}\n\n[truncated at ${maxChars} chars]` : readable;

      return {
        content: [
          {
            type: "text",
            text: `URL: ${url.toString()}\nStatus: ${response.status}\nContent-Type: ${contentType}\n\n${text}`,
          },
        ],
        isError: !response.ok,
        details: { url: url.toString(), status: response.status, contentType, truncated, maxChars },
      };
    },
  });
}
