// lib/profile.js

import fs from 'node:fs/promises';
import yaml from 'js-yaml';
import { profilePath } from './paths.js';

export function getDefaultProfile() {
  return {
    sizes: {},
    budget_default: 'mid',
    budget_caps: {},
    palette: [],
    brands_love: [],
    brands_avoid: [],
    fit_notes: {},
    moodboard_url: '',
    last_setup: null,
    purchase_history: [],
    thumb_signals: [],
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
  const front = yaml.load(m[1]) || {};
  const body = m[2];
  return {
    ...getDefaultProfile(),
    ...front,
    purchase_history: parseTable(body, 'Purchase history'),
    thumb_signals: parseTable(body, 'Thumb signals'),
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
      const cells = line.split('|').slice(1, -1).map(s => s.trim());
      return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
    });
}
