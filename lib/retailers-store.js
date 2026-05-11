// lib/retailers-store.js

import fs from 'node:fs/promises';
import yaml from 'js-yaml';
import { cartDir, retailersPath } from './paths.js';
import { normalizeHost } from './host.js';

const defaultNow = () => new Date().toISOString().slice(0, 10);

export function getDefaultRetailers() {
  return [
    { host: 'marinelayer.com', tier: 2, handler: 'shopify', last_used: '' },
    { host: 'allbirds.com',    tier: 2, handler: 'shopify', last_used: '' },
    { host: 'everlane.com',    tier: 2, handler: 'shopify', last_used: '' },
    { host: 'mejuri.com',      tier: 2, handler: 'shopify', last_used: '' },
  ];
}

export async function readRetailers() {
  let raw;
  try {
    raw = await fs.readFile(retailersPath(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      const today = defaultNow();
      const defaults = getDefaultRetailers();
      await writeRetailers({ last_updated: today, retailers: defaults });
      return { last_updated: today, retailers: defaults };
    }
    throw err;
  }
  return parseRetailers(raw);
}

function parseRetailers(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('retailers.md missing frontmatter');
  let front;
  try {
    front = yaml.load(m[1], { schema: yaml.JSON_SCHEMA }) || {};
  } catch (err) {
    throw new Error(
      `Failed to parse YAML frontmatter in retailers.md: ${err.message}. ` +
      'Fix the YAML by hand and try again.'
    );
  }
  const body = m[2];
  return {
    last_updated: front.last_updated ?? '',
    retailers: parseTable(body),
  };
}

function parseTable(body) {
  const re = /# Retailers\n+\| ([^\n]+)\n\|[^\n]+\n([\s\S]*?)(?=\n#|$)/;
  const m = body.match(re);
  if (!m) return [];
  const headers = m[1].split('|').map(s => s.trim()).filter(Boolean);
  return m[2].split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('|'))
    .map(line => {
      const parts = line.split('|').map(s => s.trim());
      if (parts.length && parts[0] === '') parts.shift();
      if (parts.length && parts[parts.length - 1] === '') parts.pop();
      const row = Object.fromEntries(headers.map((h, i) => [h, parts[i] ?? '']));
      // Coerce tier to number
      if (row.tier !== undefined) row.tier = Number(row.tier);
      return row;
    });
}

export async function writeRetailers({ last_updated, retailers }, { now } = {}) {
  await fs.mkdir(cartDir(), { recursive: true });
  const front = yaml.dump({ last_updated }, { schema: yaml.JSON_SCHEMA }).trimEnd();
  const out = `---\n${front}\n---\n\n` + formatTable(retailers) + '\n';
  await fs.writeFile(retailersPath(), out);
}

function sanitizeCell(value) {
  return String(value ?? '').replace(/\|/g, '/').replace(/\r\n|[\r\n]/g, ' ');
}

function formatTable(retailers) {
  const headers = ['host', 'tier', 'handler', 'last_used'];
  const headerLine = `| ${headers.join(' | ')} |`;
  const sep = `|${headers.map(() => '---').join('|')}|`;
  const dataLines = retailers.map(
    r => `| ${headers.map(h => sanitizeCell(r[h])).join(' | ')} |`
  );
  return `# Retailers\n${headerLine}\n${sep}\n${dataLines.join('\n')}${dataLines.length ? '\n' : ''}`;
}

export function validateRetailers(retailers) {
  const errors = [];
  for (let i = 0; i < retailers.length; i++) {
    const r = retailers[i];
    if (!r.host || typeof r.host !== 'string' || !r.host.includes('.')) {
      errors.push(`retailers[${i}].host must be a non-empty string with at least one dot`);
    }
    if (r.tier !== 1 && r.tier !== 2) {
      errors.push(`retailers[${i}].tier must be 1 or 2`);
    }
    if (!r.handler || typeof r.handler !== 'string') {
      errors.push(`retailers[${i}].handler must be a non-empty string`);
    }
    if (r.last_used !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(r.last_used)) {
      errors.push(`retailers[${i}].last_used must be '' or YYYY-MM-DD`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export async function addRetailer({ host, tier = 2, handler = 'shopify', fetchImpl, detectImpl, now } = {}) {
  const nowFn = now ?? defaultNow;
  const normalized = normalizeHost(host); // throws invalid_host on bad input

  const { last_updated, retailers } = await readRetailers();

  if (retailers.some(r => r.host === normalized)) {
    return { added: false, reason: 'duplicate' };
  }

  if (tier === 1) {
    return { added: false, reason: 'tier1_not_supported' };
  }

  if (tier === 2) {
    const detected = await detectImpl(normalized, { fetchImpl });
    if (detected !== true) {
      return { added: false, reason: 'not_shopify' };
    }
  }

  const newRetailers = [...retailers, { host: normalized, tier, handler, last_used: '' }];
  await writeRetailers({ last_updated: nowFn(), retailers: newRetailers });
  return { added: true };
}

export async function removeRetailer(host, { now } = {}) {
  const nowFn = now ?? defaultNow;
  const normalized = normalizeHost(host);

  const { retailers } = await readRetailers();

  if (!retailers.some(r => r.host === normalized)) {
    return { removed: false, reason: 'not_found' };
  }

  const newRetailers = retailers.filter(r => r.host !== normalized);
  await writeRetailers({ last_updated: nowFn(), retailers: newRetailers });
  return { removed: true };
}
