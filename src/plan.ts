import { resolveVenues, s2VenueNames, type VenueSelector } from "./venues.js";

export interface SearchPlanInput {
  venue?: string[];
  selector: VenueSelector;
  rorIds: string[];
  enabled: { semanticScholar: boolean; openalex: boolean; arxiv: boolean };
}

export interface SearchPlan {
  semanticScholar?: { venues?: string[] };
  openalex?: { sourceIds?: string[]; rorIds?: string[] };
  arxiv: boolean;
  skipped: { source: string; reason: string }[];
  /** Caveats where a channel still runs but cannot cover every requested venue. */
  notes: string[];
  venuesApplied: string[];
}

/**
 * Decide which channels can honour the requested filters. A channel that cannot
 * apply a filter is skipped rather than returning unfiltered results.
 *  - arXiv has neither venue nor affiliation data.
 *  - Semantic Scholar filters by venue name but has no ROR ids.
 *  - OpenAlex filters by venue (source id) and ROR id.
 */
export function planSearch(input: SearchPlanInput): SearchPlan {
  const { selector, rorIds, enabled } = input;
  const resolved = resolveVenues(input.venue, selector);
  const venueFilter =
    !!input.venue?.length || selector.tier !== undefined || !!selector.area || !!selector.type;
  const institutionFilter = rorIds.length > 0;
  if (venueFilter && !resolved.venues.length && !resolved.unknownNames.length) {
    throw new Error("No venues in the registry match the given venue_tier / venue_area / venue_type.");
  }

  const plan: SearchPlan = {
    arxiv: false,
    skipped: [],
    notes: [],
    venuesApplied: [...resolved.venues.map((v) => v.name), ...resolved.unknownNames],
  };
  const skip = (source: string, reason: string) => plan.skipped.push({ source, reason });

  if (enabled.arxiv) {
    if (venueFilter || institutionFilter) skip("arxiv", "no venue or institution data");
    else plan.arxiv = true;
  }

  if (enabled.semanticScholar) {
    if (institutionFilter) skip("semantic_scholar", "no ROR institution filter");
    else if (!venueFilter) plan.semanticScholar = {};
    else {
      const { names, truncated } = s2VenueNames(resolved);
      plan.semanticScholar = { venues: names };
      if (truncated) plan.notes.push("Semantic Scholar venue filter was shortened to fit the request size; some aliases were dropped");
    }
  }

  if (enabled.openalex) {
    const sourceIds = resolved.venues.flatMap((v) => v.openalexSources);
    const uncovered = [
      ...resolved.venues.filter((v) => !v.openalexSources.length).map((v) => v.name),
      ...resolved.unknownNames,
    ];
    if (venueFilter && !sourceIds.length) {
      skip("openalex", `no OpenAlex source id for: ${uncovered.join(", ")}`);
    } else {
      plan.openalex = {
        sourceIds: venueFilter ? sourceIds : undefined,
        rorIds: institutionFilter ? rorIds : undefined,
      };
      if (venueFilter && uncovered.length) {
        plan.notes.push(`OpenAlex results exclude venues without a source id: ${uncovered.join(", ")}`);
      }
    }
  }
  return plan;
}
