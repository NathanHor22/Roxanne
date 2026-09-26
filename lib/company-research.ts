import "server-only";

import { relayResearchSourceSchema, type RelayResearchSource } from "./relay";
import { researchCompanyWithExa } from "./providers/exa";
import { cacheCompanyResearch, getCachedCompanyResearch } from "./redis";

/** Sends only explicit public company names to Exa and caches public results. */
export async function researchCompaniesForMeeting(
  companies: readonly (string | null | undefined)[],
): Promise<RelayResearchSource[]> {
  const unique = [...new Set(
    companies.map((company) => company?.normalize("NFKC").trim()).filter((company): company is string => Boolean(company)),
  )].slice(0, 4);
  const groups = await Promise.all(unique.map(async (company) => {
    const cached = await getCachedCompanyResearch<unknown>(company);
    if (Array.isArray(cached)) {
      const parsed = cached.flatMap((value) => {
        const result = relayResearchSourceSchema.safeParse(value);
        return result.success ? [result.data] : [];
      });
      if (parsed.length) return parsed;
    }
    const live = await researchCompanyWithExa(company).catch(() => []);
    if (live.length) await cacheCompanyResearch(company, live);
    return live;
  }));
  const seenUrls = new Set<string>();
  return groups.flat().filter((source) => {
    if (seenUrls.has(source.url)) return false;
    seenUrls.add(source.url);
    return true;
  }).slice(0, 12);
}
