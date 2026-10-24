import test from 'node:test';
import assert from 'node:assert/strict';
import { seasonAt, selectAnime, animePreview, animeLabel, type Anime } from './seasonal-anime.js';
const now = new Date('2026-10-25T12:00:00Z');
function anime(extra: Partial<Anime> = {}): Anime {
  return { id: 1, idMal: 2, title: { romaji: 'Synthetic debut' }, season: 'FALL', seasonYear: 2026,
    status: 'RELEASING', format: 'TV', episodes: 12, averageScore: 75, popularity: 1000, trending: 10,
    genres: ['Fantasy'], tags: [], coverImage: { large: 'https://example.test/poster.jpg' },
    startDate: { year: 2026, month: 10, day: 1 }, relations: { edges: [] }, ...extra };
}
const sequel = anime({ id: 3, title: { romaji: 'Mushoku Tensei 3' }, relations: { edges: [{ relationType: 'PREQUEL', node: { type: 'ANIME', title: { romaji: 'Mushoku Tensei' } } }] } });
test('season rollover, sequels and unknown schedules never masquerade as debuts', () => {
  assert.deepEqual(seasonAt(new Date('2027-01-01T00:00:00Z')), { season: 'WINTER', year: 2027 });
  const input = [anime(), sequel, anime({ seasonYear: 2020 }), anime({ status: 'NOT_YET_RELEASED' }), anime({ format: 'MOVIE' })];
  assert.deepEqual(selectAnime(input, 'debuts', 'trending', 0, now).map(x => x.id), [1]);
  assert.deepEqual(selectAnime(input, 'returning', 'trending', 0, now).map(x => x.id), [3]);
});
test('rating and audience sorting differ; unrated new shows survive thresholds', () => {
  const low = anime({ id: 4, averageScore: 60, popularity: 5000 });
  const unrated = anime({ id: 5, averageScore: undefined, trending: 100 });
  assert.deepEqual(selectAnime([low, anime(), unrated], 'debuts', 'rating', 70, now).map(x => x.id), [1, 5]);
  assert.equal(selectAnime([low, anime()], 'debuts', 'popular', 0, now)[0].id, 4);
  assert.equal(selectAnime([anime(), unrated], 'debuts', 'trending', 0, now)[0].id, 5);
  assert.match(animeLabel(unrated), /not yet rated/);
});
test('quiet fantasy and identity mapping retain season-specific metadata', () => {
  assert.equal(selectAnime([anime(), anime({ id: 7, tags: [{ name: 'Iyashikei', rank: 90 }] })], 'quiet', 'trending', 0, now)[0].id, 7);
  assert.equal(animePreview(sequel).id, 'mal:2');
  assert.equal(animePreview(anime({ idMal: undefined })).id, 'anilist:1');
  assert.equal('imdbRating' in animePreview(anime()), false);
});
