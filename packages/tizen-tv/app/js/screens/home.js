// Home: the shared browse page with mixed-kind rows (see screens/hub.js, api/hubs.js homeRecipes).
import { createBrowsePage } from './hub.js';
import * as hubs from '../api/hubs.js';

export function HomeScreen() {
  return createBrowsePage({
    tab: 'home', name: 'home', kind: null,
    build: function () { return hubs.homeRecipes(); },
  });
}
