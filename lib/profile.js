// lib/profile.js
//
// Profile lives at ~/.claude/cart/profile.md as a YAML-frontmatter markdown
// file. The frontmatter holds preferences (sizes, palette, brand prefs,
// budget); the body holds a Purchase history table that /cart appends to on
// every successful add.

import fs from 'node:fs/promises';
import yaml from 'js-yaml';
import { cartDir, profilePath } from './paths.js';

export function getDefaultProfile() {
  return {
    sizes: {},
    budget_default: 'mid',
    budget_caps: {},
    palette: [],
    brands_love: [],
    brands_avoid: [],
    fit_notes: {},
    shopping_for: '',
    moodboard_url: '',
    last_setup: null,
    purchase_history: [],
  };
}

export async function readProfile() {
  let raw;
  try {
    raw = await fs.readFile(profilePath(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return getDefaultProfile();
    throw err;
  }
  return parseProfile(raw);
}

function parseProfile(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('profile.md missing frontmatter');
  let front;
  try {
    front = yaml.load(m[1], { schema: yaml.JSON_SCHEMA }) || {};
  } catch (err) {
    throw new Error(
      `Failed to parse YAML frontmatter in ${profilePath()}: ${err.message}. ` +
      'Fix the YAML by hand and try again.'
    );
  }
  const body = m[2];
  return {
    ...getDefaultProfile(),
    ...front,
    purchase_history: parseTable(body, 'Purchase history'),
  };
}

function parseTable(body, heading) {
  const re = new RegExp(`# ${heading}\\n\\| ([^\\n]+)\\n\\|[^\\n]+\\n([\\s\\S]*?)(?=\\n#|$)`);
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
      return Object.fromEntries(headers.map((h, i) => [h, parts[i] ?? '']));
    });
}

export async function writeProfile(profile) {
  await fs.mkdir(cartDir(), { recursive: true });
  const frontKeys = [
    'sizes', 'budget_default', 'budget_caps', 'palette',
    'brands_love', 'brands_avoid', 'fit_notes', 'shopping_for',
    'moodboard_url', 'last_setup',
  ];
  const front = {};
  for (const k of frontKeys) front[k] = profile[k];
  const out = `---\n${yaml.dump(front).trimEnd()}\n---\n\n` +
    formatTable('Purchase history', ['date', 'item', 'brand', '$', 'url'], profile.purchase_history || []) +
    '\n';
  await fs.writeFile(profilePath(), out);
}

function sanitizeCell(value) {
  return String(value ?? '').replace(/\|/g, '/').replace(/\r\n|[\r\n]/g, ' ');
}

function formatTable(heading, headers, rows) {
  const headerLine = `| ${headers.join(' | ')} |`;
  const sep = `|${headers.map(() => '---').join('|')}|`;
  const dataLines = rows.map(r => `| ${headers.map(h => sanitizeCell(r[h])).join(' | ')} |`);
  return `# ${heading}\n${headerLine}\n${sep}\n${dataLines.join('\n')}${dataLines.length ? '\n' : ''}`;
}

const BUDGET_TIERS = ['low', 'mid', 'high'];
const ARRAY_FIELDS = ['palette', 'brands_love', 'brands_avoid'];

export function validateProfile(p) {
  const errors = [];
  if (!BUDGET_TIERS.includes(p.budget_default)) {
    errors.push(`budget_default must be one of ${BUDGET_TIERS.join(', ')}`);
  }
  for (const field of ARRAY_FIELDS) {
    if (!Array.isArray(p[field])) errors.push(`${field} must be an array`);
  }
  if (typeof p.sizes !== 'object' || p.sizes === null) {
    errors.push('sizes must be an object');
  }
  return { valid: errors.length === 0, errors };
}

export async function appendPurchase(row) {
  const p = await readProfile();
  p.purchase_history.push(row);
  await writeProfile(p);
}

export function mergeFrontmatter(profile, updates) {
  const merged = { ...profile };
  for (const [key, value] of Object.entries(updates)) {
    if (
      value && typeof value === 'object' && !Array.isArray(value) &&
      typeof merged[key] === 'object' && merged[key] !== null
    ) {
      merged[key] = { ...merged[key], ...value };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

export async function updateFrontmatter(updates) {
  const p = await readProfile();
  await writeProfile(mergeFrontmatter(p, updates));
}
