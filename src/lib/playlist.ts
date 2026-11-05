/** Shared playlist navigation. Never returns the current item as its own neighbour. */
export function neighbors<T>(list: T[], isCurrent: (x: T) => boolean): { prev?: T | undefined; next?: T | undefined; index: number } {
  const index = list.findIndex(isCurrent);
  if (index < 0) return { index };
  return { index, prev: index > 0 ? list[index - 1] : undefined, next: index < list.length - 1 ? list[index + 1] : undefined };
}

type Ep = { n: number };
/** Next/previous real episode, crossing into adjacent seasons only when their episode lists are known. */
export function episodeNeighbors(
  season: number, episode: number, eps: Ep[], prevSeason?: { n: number; eps?: Ep[] | undefined }, nextSeason?: { n: number; eps?: Ep[] | undefined },
): { prev?: { s: number; e: number } | undefined; next?: { s: number; e: number } | undefined } {
  const { index, prev, next } = neighbors(eps, (x) => x.n === episode);
  if (index < 0) return {};
  const pLast = prevSeason?.eps?.[prevSeason.eps.length - 1];
  const nFirst = nextSeason?.eps?.[0];
  return {
    prev: prev ? { s: season, e: prev.n } : pLast && prevSeason ? { s: prevSeason.n, e: pLast.n } : undefined,
    next: next ? { s: season, e: next.n } : nFirst && nextSeason ? { s: nextSeason.n, e: nFirst.n } : undefined,
  };
}
