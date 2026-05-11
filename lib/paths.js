import path from 'node:path';

const home = () => process.env.HOME || process.env.USERPROFILE || '';

export const cartDir = () => path.join(home(), '.claude', 'cart');
export const profilePath = () => path.join(cartDir(), 'profile.md');
export const retailersPath = () => path.join(cartDir(), 'retailers.md');
export const requestsDir = () => path.join(cartDir(), 'requests');
