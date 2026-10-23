// A locale is a suggestion, never a claim of physical location. No IP lookup.
import * as store from '../util/store.js';
export const COUNTRIES = [
  ['NO', 'Norway'], ['SE', 'Sweden'], ['DK', 'Denmark'], ['FI', 'Finland'], ['IS', 'Iceland'],
  ['GB', 'United Kingdom'], ['US', 'United States'], ['CA', 'Canada'], ['AU', 'Australia'],
  ['NZ', 'New Zealand'], ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'],
  ['NL', 'Netherlands'], ['BE', 'Belgium'], ['AT', 'Austria'], ['CH', 'Switzerland'], ['IE', 'Ireland'],
  ['PT', 'Portugal'], ['PL', 'Poland'], ['CZ', 'Czechia'], ['SK', 'Slovakia'], ['HU', 'Hungary'],
  ['RO', 'Romania'], ['BG', 'Bulgaria'], ['GR', 'Greece'], ['HR', 'Croatia'], ['SI', 'Slovenia'],
  ['EE', 'Estonia'], ['LV', 'Latvia'], ['LT', 'Lithuania'], ['UA', 'Ukraine'], ['TR', 'Turkey'],
  ['BR', 'Brazil'], ['MX', 'Mexico'], ['AR', 'Argentina'], ['CL', 'Chile'], ['CO', 'Colombia'],
  ['JP', 'Japan'], ['KR', 'South Korea'], ['IN', 'India'], ['ID', 'Indonesia'], ['MY', 'Malaysia'],
  ['PH', 'Philippines'], ['SG', 'Singapore'], ['TH', 'Thailand'], ['TW', 'Taiwan'], ['HK', 'Hong Kong'],
  ['ZA', 'South Africa'], ['EG', 'Egypt'], ['AE', 'United Arab Emirates'], ['SA', 'Saudi Arabia'],
];
export function countryName(code) {
  const match = COUNTRIES.filter(function (c) { return c[0] === code; })[0];
  return match ? match[1] : code;
}
export function localeCountry(locales) {
  for (let i = 0; i < locales.length; i++) {
    const match = /^[a-z]{2,3}(?:-[a-z]{4})?-([a-z]{2})(?:-|$)/i.exec(locales[i]);
    if (match) return match[1].toUpperCase();
  }
  return '';
}
export function detectedCountry() {
  if (typeof navigator === 'undefined') return '';
  return localeCountry(navigator.languages || [navigator.language || '']);
}
export function preference() { return store.get('discovery.country', 'auto'); }
export function country() {
  const value = preference();
  return value === 'auto' ? detectedCountry() : (/^[A-Z]{2}$/.test(value) ? value : '');
}
export function choices() {
  const codes = COUNTRIES.map(function (c) { return c[0]; });
  const current = country();
  if (current && codes.indexOf(current) < 0) codes.push(current);
  return ['auto', 'off'].concat(codes);
}
export function label() {
  const value = preference();
  if (value === 'off') return 'Off';
  if (value === 'auto') return country() ? 'Device region: ' + countryName(country()) : 'Choose country';
  return countryName(country());
}
