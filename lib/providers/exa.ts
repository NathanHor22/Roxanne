import { env } from "../env";
import {
  relayResearchSourceSchema,
  type RelayResearchSource,
} from "../relay";

type ExaSearchResult = {
  title?: unknown;
  url?: unknown;
  publishedDate?: unknown;
  summary?: unknown;
  highlights?: unknown;
  text?: unknown;
};

function safeSnippet(result: ExaSearchResult) {
  if (typeof result.summary === "string" && result.summary.trim())
    return result.summary.trim();
  if (Array.isArray(result.highlights)) {
    const highlight = result.highlights.find(
      (value): value is string => typeof value === "string" && Boolean(value.trim()),
    );
    if (highlight) return highlight.trim();
  }
  return typeof result.text === "string" ? result.text.trim().slice(0, 1_200) : "";
}

function safePublicUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function researchCompanyWithExa(
  company: string,
  options: {
    apiKey?: string | null;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<RelayResearchSource[]> {
  const apiKey = options.apiKey === undefined ? env().EXA_API_KEY : options.apiKey;
  if (!apiKey || !company.trim()) return [];

  const response = await (options.fetchImpl || fetch)("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    signal: AbortSignal.timeout(options.timeoutMs || 12_000),
    body: JSON.stringify({
      query: `${company.trim()} official company products services markets partnerships`,
      type: "auto",
      numResults: 3,
      moderation: true,
      contents: {
        summary: {
          query:
            "Summarise only public facts useful for assessing a business introduction. Do not infer personal or private information.",
        },
        livecrawl: "preferred",
        maxAgeHours: 24,
      },
    }),
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as { results?: ExaSearchResult[] };

  return (payload.results || []).flatMap((result) => {
    const url = safePublicUrl(result.url);
    const snippet = safeSnippet(result);
    if (!url || !snippet) return [];
    const parsed = relayResearchSourceSchema.safeParse({
      company: company.trim(),
      title:
        typeof result.title === "string" && result.title.trim()
          ? result.title.trim()
          : new URL(url).hostname,
      url,
      snippet: snippet.slice(0, 1_200),
      publishedDate:
        typeof result.publishedDate === "string" ? result.publishedDate : null,
    });
    return parsed.success ? [parsed.data] : [];
  });
}

export async function researchCompaniesWithExa(
  companies: readonly string[],
  options: Parameters<typeof researchCompanyWithExa>[1] = {},
) {
  const unique = [...new Set(companies.map((company) => company.trim()).filter(Boolean))].slice(
    0,
    4,
  );
  const results = await Promise.all(
    unique.map((company) => researchCompanyWithExa(company, options).catch(() => [])),
  );
  return results.flat().slice(0, 12);
}
