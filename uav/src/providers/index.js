// Adapter registry. To support a new ATS, add a module exporting `fetchJobs(source) -> job[]`
// (the normalized shape) and register it here — nothing else in the tracker/UI changes.
import * as greenhouse from './greenhouse.js';
import * as ashby from './ashby.js';
import * as google from './google.js';
import * as lever from './lever.js';
import * as workday from './workday.js';

export const PROVIDERS = {
  greenhouse,
  ashby,
  google,
  lever,
  workday,
};

export function getProvider(name) {
  const p = PROVIDERS[name];
  if (!p) throw new Error(`unknown provider: ${name}`);
  return p;
}
