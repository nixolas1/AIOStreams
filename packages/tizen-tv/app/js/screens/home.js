// Home: the shared browse page with mixed-kind rows (see screens/hub.js, api/hubs.js homeRecipes).
import { createBrowsePage } from './hub.js';
import * as hubs from '../api/hubs.js';

export function HomeScreen(args) {
  return createBrowsePage({
    tab: 'home', name: 'home', kind: null, focusNav: !!(args && args.focusNav),
    build: function () { return hubs.homeRecipes(); },
  });
}
