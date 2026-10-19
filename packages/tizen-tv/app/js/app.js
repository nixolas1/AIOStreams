// Boot: keys, router, nav wiring, session restore, splash.
import { DEV } from './config.js';
import * as router from './router.js';
import * as nav from './nav.js';
import * as session from './session.js';
import { registerKeys, isTizen } from './platform/tizen.js';
import { ConnectScreen } from './screens/connect.js';
import { HomeScreen } from './screens/home.js';
import { HubScreen } from './screens/hub.js';
import { LibraryScreen } from './screens/library.js';
import { DetailScreen } from './screens/detail.js';
import { SourcesScreen } from './screens/sources.js';
import { PlayerScreen } from './screens/player.js';
import { SearchScreen } from './screens/search.js';
import { SettingsScreen } from './screens/settings.js';
import { initHud } from './ui/hud.js';

// Desktop only: scale the fixed 1920x1080 canvas into the browser window.
function fitWindow() {
  if (isTizen()) return;
  const apply = function () {
    const z = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    document.body.style.zoom = z > 0 && z !== 1 ? String(z) : '';
  };
  apply();
  window.addEventListener('resize', apply);
}

function wireNav() {
  nav.register('openItem', function (item) { return router.push(DetailScreen({ item: item })); });
  nav.register('playItem', function (item, opts) { return router.push(PlayerScreen({ item: item, opts: opts || {} })); });
  nav.register('openLibrary', function (view, opts) { return router.push(LibraryScreen({ view: view, opts: opts || {} })); });
  // Home/Movies/Series/Anime are tabs: switching replaces the tab screen instead of stacking.
  nav.register('openHub', function (kind) {
    const screen = kind === 'home' ? HomeScreen({}) : HubScreen({ kind: kind });
    const top = router.top();
    return top && top.tab ? router.replace(screen) : router.push(screen);
  });
  nav.register('openSearch', function () { return router.push(SearchScreen({})); });
  nav.register('openSettings', function () { return router.push(SettingsScreen({})); });
  nav.register('openSources', function (item) { return router.push(SourcesScreen({ item: item })); });
  nav.register('openConnect', function () { return router.reset(ConnectScreen({})); });
}

function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.classList.add('gone');
  setTimeout(function () { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 450);
}

function applyDevParams() {
  if (!DEV) return;
  try {
    const q = new URLSearchParams(location.search);
    const server = q.get('server');
    if (server) session.setBase(server);
  } catch (e) { /* ignore */ }
}

export function start() {
  fitWindow();
  registerKeys();
  applyDevParams();
  try { initHud(); } catch (e) { /* ignore */ }
  router.init(document.getElementById('app'), null);
  wireNav();
  if (session.isSignedIn()) router.reset(HomeScreen({}));
  else router.reset(ConnectScreen({}));
  // Let the first paint land before fading the splash.
  requestAnimationFrame(function () { requestAnimationFrame(hideSplash); });
}
