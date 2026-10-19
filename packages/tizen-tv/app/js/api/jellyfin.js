// Jellyfin calls, request shapes ported from packages/web/src/lib/queries.ts
// and session.tsx. Parameter names are the ones server routes/jellyfin/*.ts
// honour (case-insensitive). List calls return { Items, TotalRecordCount }
// (Items/Latest's bare array is wrapped to match).
import * as client from './client.js';
import * as session from '../session.js';

export const FIELDS = [
  'Overview', 'Genres', 'ProductionYear', 'OfficialRating', 'CommunityRating', 'RunTimeTicks',
  'ChildCount', 'ImageTags', 'BackdropImageTags', 'ParentBackdropImageTags', 'ParentLogoImageTag',
  'UserData', 'PremiereDate', 'RemoteTrailers', 'ProviderIds', 'OriginalTitle', 'ProductionLocations',
].join(',');

// Detail pages also want the streams of the chosen source (subtitles/audio).
export const FIELDS_DETAIL = FIELDS + ',MediaStreams';

/** Only movies/series libraries are browsable; music, photos etc. are dropped. */
const SHOWN_LIBRARIES = { movies: 1, tvshows: 1, boxsets: 1, mixed: 1 };

function uid() { return session.userId(); }

function wrap(arr) {
  const items = Array.isArray(arr) ? arr : [];
  return { Items: items, TotalRecordCount: items.length, StartIndex: 0 };
}

/** @returns {Promise<{Secret:string, Code:string, Authenticated:boolean}>} */
export function quickConnectInitiate() {
  return client.post('/QuickConnect/Initiate');
}

/** @returns {Promise<{Secret:string, Code:string, Authenticated:boolean}>} */
export function quickConnectState(secret) {
  return client.get('/QuickConnect/Connect', { secret: secret });
}

/** @returns {Promise<{AccessToken:string, User:{Id:string, Name:string}}>} */
export function authenticateQuickConnect(secret) {
  return client.post('/Users/AuthenticateWithQuickConnect', { Secret: secret });
}

/** The signed-in user. */
export function me() {
  return client.get('/Users/Me');
}

/** Catalog views (CollectionType movies | tvshows | boxsets | absent). */
export async function views() {
  const r = await client.get('/UserViews', { userId: uid() });
  const items = (r && r.Items ? r.Items : []).filter(function (v) {
    return !v.CollectionType || SHOWN_LIBRARIES[v.CollectionType];
  });
  return { Items: items, TotalRecordCount: items.length };
}

/** Continue watching. The server answers empty when parentId is set. */
export function resume(o) {
  o = o || {};
  return client.get('/UserItems/Resume', {
    userId: uid(), Limit: o.limit || 24, MediaTypes: 'Video', ParentId: o.parentId, Fields: FIELDS,
  });
}

/** Next episode per followed series (or just for seriesId). */
export function nextUp(o) {
  o = o || {};
  return client.get('/Shows/NextUp', {
    userId: uid(), Limit: o.limit || 24, SeriesId: o.seriesId, EnableResumable: false, Fields: FIELDS,
  });
}

/** Upcoming episodes of followed series. */
export function upcoming(o) {
  o = o || {};
  return client.get('/Shows/Upcoming', { userId: uid(), Limit: o.limit || 24, Fields: FIELDS });
}

/** Newest items of a view (or everything). */
export async function latest(o) {
  o = o || {};
  const r = await client.get('/Items/Latest', {
    userId: uid(), ParentId: o.parentId, Limit: o.limit || 16, IncludeItemTypes: o.includeItemTypes, Fields: FIELDS,
  });
  return Array.isArray(r) ? wrap(r) : r;
}

/**
 * Catalog / library listing.
 * @param {{parentId?:string,startIndex?:number,limit?:number,sortBy?:string,sortOrder?:string,
 *   genres?:string|string[],genreIds?:string|string[],minPremiereDate?:string,searchTerm?:string,
 *   includeItemTypes?:string,filters?:string,recursive?:boolean}} o
 */
export function items(o) {
  o = o || {};
  return client.get('/Items', {
    userId: uid(),
    ParentId: o.parentId,
    StartIndex: o.startIndex || 0,
    Limit: o.limit || 60,
    SortBy: o.sortBy,
    SortOrder: o.sortOrder,
    Genres: o.genres,
    GenreIds: o.genreIds,
    MinPremiereDate: o.minPremiereDate,
    SearchTerm: o.searchTerm,
    IncludeItemTypes: o.includeItemTypes,
    Filters: o.filters,
    Recursive: o.recursive === undefined ? true : o.recursive,
    EnableTotalRecordCount: true,
    Fields: FIELDS,
  });
}

/** Genres a view offers (ParentId). */
export function genres(parentId) {
  return client.get('/Genres', { userId: uid(), ParentId: parentId });
}

/** One item with detail fields (no stream resolution). */
export function item(id) {
  return client.get('/Items/' + id, { userId: uid(), Fields: FIELDS_DETAIL });
}

export function seasons(seriesId) {
  return client.get('/Shows/' + seriesId + '/Seasons', { userId: uid(), Fields: FIELDS });
}

export function episodes(seriesId, seasonId) {
  return client.get('/Shows/' + seriesId + '/Episodes', { userId: uid(), SeasonId: seasonId, Fields: FIELDS });
}

export function similar(id, limit) {
  return client.get('/Items/' + id + '/Similar', { userId: uid(), Limit: limit || 20, Fields: FIELDS });
}

/** Search suggestions: { SearchHints: [...], TotalRecordCount }. */
export function searchHints(term) {
  return client.get('/Search/Hints', {
    userId: uid(), SearchTerm: term, Limit: 20, IncludeItemTypes: 'Movie,Series',
  });
}

// Minimal profile: direct play any video, external VTT subtitles.
const DEVICE_PROFILE = {
  DirectPlayProfiles: [{ Type: 'Video' }],
  SubtitleProfiles: [{ Format: 'vtt', Method: 'External' }],
};

/** Versions have their own id under aiostreams.id (the first carries the item's). */
function withOwnId(source) {
  const id = source && source.aiostreams && source.aiostreams.id;
  if (!id) return source;
  const copy = {};
  for (const k in source) copy[k] = source[k];
  copy.Id = id;
  return copy;
}

/**
 * MediaSources for an item. Opening the list asks the server to search anew
 * (Fresh) unless opts.kept (reuse what the server kept); opts.refresh forces a
 * new search; opts.sourceId names one version.
 */
export async function playbackInfo(id, o) {
  o = o || {};
  const body = { UserId: uid(), DeviceProfile: DEVICE_PROFILE };
  if (o.sourceId) body.MediaSourceId = o.sourceId;
  else if (!o.kept) body.Fresh = true;
  if (o.refresh) body.Refresh = true;
  if (o.startTimeTicks) body.StartTimeTicks = o.startTimeTicks;
  const info = await client.post('/Items/' + id + '/PlaybackInfo', body, { userId: uid() });
  if (info && info.MediaSources) info.MediaSources = info.MediaSources.map(withOwnId);
  return info;
}

/** payload: { ItemId, MediaSourceId, PlaySessionId, PositionTicks, IsPaused, ... } */
export function reportStart(payload) {
  return client.post('/Sessions/Playing', payload);
}
export function reportProgress(payload) {
  return client.post('/Sessions/Playing/Progress', payload);
}
export function reportStopped(payload) {
  return client.post('/Sessions/Playing/Stopped', payload, undefined, { keepalive: true });
}

export function markPlayed(id, played) {
  const path = '/UserPlayedItems/' + id;
  return played ? client.post(path, undefined, { userId: uid() }) : client.del(path, { userId: uid() });
}

export function setFavorite(id, fav) {
  const path = '/UserFavoriteItems/' + id;
  return fav ? client.post(path, undefined, { userId: uid() }) : client.del(path, { userId: uid() });
}

/** The watchlist. */
export function favorites(o) {
  o = o || {};
  return client.get('/Items', {
    userId: uid(), Filters: 'IsFavorite', Recursive: true, IncludeItemTypes: 'Movie,Series',
    Limit: o.limit || 100, Fields: FIELDS,
  });
}
