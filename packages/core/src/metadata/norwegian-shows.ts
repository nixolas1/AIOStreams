// Original broadcasters/networks, not current streaming availability.
export const NORWEGIAN_NETWORKS: Record<string, string> = {
  all: '',
  nrk: '379|843|1942|7722',
  tv2: '467|4461|4875',
  hbo: '1062|3186|6783',
  tvnorge: '157|4381|4784',
  viaplay: '374|2406',
  netflix: '213',
};
export const NORWEGIAN_GENRES: Record<string, string> = {
  all: '',
  drama: '18|80|9648',
  comedy: '35',
  entertainment: '10764|10767',
  documentary: '99',
};
export interface NorwegianShowOptions {
  period: 'month' | 'year' | 'all';
  category: string;
  source: string;
  includeNews: boolean;
}
export function norwegianShowOptions(
  input: Record<string, unknown> = {}
): NorwegianShowOptions | null {
  const {
    period = 'year',
    category = 'all',
    source = 'all',
    includeNews = false,
  } = input;
  if (period !== 'month' && period !== 'year' && period !== 'all') return null;
  if (
    typeof category !== 'string' ||
    !Object.hasOwn(NORWEGIAN_GENRES, category)
  )
    return null;
  if (typeof source !== 'string' || !Object.hasOwn(NORWEGIAN_NETWORKS, source))
    return null;
  if (typeof includeNews !== 'boolean') return null;
  return { period, category, source, includeNews };
}
export function norwegianShowQuery(
  options: NorwegianShowOptions,
  now = new Date()
): Record<string, string> {
  const end = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
  const params: Record<string, string> = {
    sort_by: 'popularity.desc',
    include_adult: 'false',
    language: 'nb-NO',
    include_null_first_air_dates: 'false',
    page: '1',
  };
  if (options.period !== 'all') {
    params['air_date.gte'] =
      end.slice(0, options.period === 'month' ? 7 : 4) +
      (options.period === 'month' ? '-01' : '-01-01');
    params['air_date.lte'] = end;
  }
  if (!options.includeNews) params.without_genres = '10763';
  if (NORWEGIAN_GENRES[options.category])
    params.with_genres = NORWEGIAN_GENRES[options.category];
  if (NORWEGIAN_NETWORKS[options.source])
    params.with_networks = NORWEGIAN_NETWORKS[options.source];
  return params;
}
