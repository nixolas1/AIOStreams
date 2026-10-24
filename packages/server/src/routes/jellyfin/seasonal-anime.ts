// Public season metadata only. No AniList account or viewing history is sent.
export interface Anime {
  id: number; idMal?: number; title: { english?: string; romaji: string };
  synonyms?: string[]; season: string; seasonYear: number; status: string;
  format: string; episodes?: number; averageScore?: number; popularity: number;
  trending: number; genres: string[]; tags: { name: string; rank: number }[];
  coverImage: { large: string }; bannerImage?: string; description?: string;
  startDate: { year: number; month: number; day: number };
  relations: { edges: { relationType: string; node: { type: string; title: { english?: string; romaji: string } } }[] };
}
export function seasonAt(now = new Date()) {
  return { season: ['WINTER', 'SPRING', 'SUMMER', 'FALL'][Math.floor(now.getUTCMonth() / 3)], year: now.getUTCFullYear() };
}
const fields = `id idMal title { english romaji } synonyms season seasonYear status format episodes averageScore popularity trending genres tags { name rank } coverImage { large } bannerImage description startDate { year month day } relations { edges { relationType node { type title { english romaji } } } }`;
export const SEASON_QUERY = `query ($season: MediaSeason!, $year: Int!, $page: Int!) { Page(page: $page, perPage: 50) { pageInfo { hasNextPage } media(type: ANIME, season: $season, seasonYear: $year, format_in: [TV, ONA], isAdult: false, sort: TRENDING_DESC) { ${fields} } } }`;
let cache: { key: string; until: number; promise: Promise<Anime[]> } | undefined;
export function seasonalAnime(now = new Date()): Promise<Anime[]> {
  const s = seasonAt(now), key = s.season + s.year;
  if (cache && cache.key === key && cache.until > Date.now()) return cache.promise;
  const promise = (async () => {
    const all: Anime[] = [];
    for (let page = 1; page <= 10; page++) {
      const response = await fetch('https://graphql.anilist.co', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: SEASON_QUERY, variables: { ...s, page } }),
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error('Seasonal anime provider unavailable');
      const result = await response.json() as { errors?: unknown[]; data?: { Page: { pageInfo: { hasNextPage: boolean }; media: Anime[] } } };
      if (result.errors || !result.data) throw new Error('Seasonal anime metadata unavailable');
      all.push(...result.data.Page.media);
      if (!result.data.Page.pageInfo.hasNextPage) return all;
    }
    throw new Error('Seasonal anime result exceeds page limit');
  })();
  cache = { key, until: Date.now() + 15 * 60 * 1000, promise };
  promise.catch(() => { if (cache?.promise === promise) cache = undefined; });
  return promise;
}
export function returning(a: Anime) {
  return a.relations.edges.some(e => e.relationType === 'PREQUEL' && e.node.type === 'ANIME');
}
const favorites = /mushoku tensei|jobless reincarnation|jaadugar|witch hat atelier|tongari boushi|wistoria|tsue to tsurugi|solo leveling|ore dake level|mushi.?shi/i;
export function selectAnime(all: Anime[], row: string, sort: string, minimum: number, now = new Date()) {
  const s = seasonAt(now);
  return all.filter(a => {
    if (a.season !== s.season || a.seasonYear !== s.year || !['TV', 'ONA'].includes(a.format)) return false;
    if (!['RELEASING', 'FINISHED'].includes(a.status)) return false;
    // Unknown scores remain visible; a new premiere should not disappear before votes arrive.
    if (a.averageScore && a.averageScore < minimum) return false;
    const sequel = returning(a);
    const tags = a.tags.filter(t => t.rank >= 50).map(t => t.name).join(' ');
    if (row === 'returning') {
      const titles = [a.title, ...a.relations.edges.filter(e => e.relationType === 'PREQUEL' && e.node.type === 'ANIME').map(e => e.node.title)];
      return sequel && titles.some(t => favorites.test((t.english || '') + ' ' + t.romaji));
    }
    if (row === 'sequels') return sequel;
    if (sequel) return false;
    if (row === 'fantasy') return a.genres.includes('Fantasy') || /Isekai|Magic|Video Games|Cultivation/.test(tags);
    if (row === 'quiet') return a.genres.includes('Fantasy') && (a.genres.includes('Slice of Life') || /Iyashikei|Travel|Episodic/.test(tags));
    return true;
  }).sort((a, b) => {
    const metric = (x: Anime) => sort === 'rating' ? x.averageScore || 0 : sort === 'popular' ? x.popularity : sort === 'newest' ? (x.startDate.year || 0) * 10000 + (x.startDate.month || 0) * 100 + (x.startDate.day || 0) : x.trending;
    return metric(b) - metric(a) || b.popularity - a.popularity || a.id - b.id;
  });
}
export function animePreview(a: Anime) {
  return { id: a.idMal ? `mal:${a.idMal}` : `anilist:${a.id}`, type: 'anime', name: a.title.english || a.title.romaji,
    poster: a.coverImage.large, background: a.bannerImage, genres: a.genres,
    releaseInfo: a.startDate.year, description: (a.description || '').replace(/<[^>]*>/g, '') };
}
export function animeLabel(a: Anime) {
  const score = a.averageScore ? `AniList ${a.averageScore}/100` : 'AniList: not yet rated';
  const audience = a.popularity >= 1000 ? (a.popularity / 1000).toFixed(1) + 'k' : String(a.popularity);
  return `${score} · ${audience} users listed · ${returning(a) ? 'Returning' : 'Debut'}${a.episodes ? ' · ' + a.episodes + ' episodes' : ''}`;
}
