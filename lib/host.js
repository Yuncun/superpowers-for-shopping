function makeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function normalizeHost(input) {
  if (input == null || typeof input !== 'string' || input.trim() === '') {
    throw makeError('invalid_host', `Invalid host: ${JSON.stringify(input)}`);
  }

  let host = input.replace(/^https?:\/\//i, '');
  host = host.split('/')[0];
  host = host.toLowerCase().trim();

  if (host === '') {
    throw makeError('invalid_host', `Invalid host: ${JSON.stringify(input)}`);
  }
  if (/\s/.test(host)) {
    throw makeError('invalid_host', `Host contains whitespace: ${JSON.stringify(input)}`);
  }
  if (!host.includes('.')) {
    throw makeError('invalid_host', `Host has no dot: ${JSON.stringify(input)}`);
  }
  if (host.startsWith('.')) {
    throw makeError('invalid_host', `Host starts with dot: ${JSON.stringify(input)}`);
  }

  return host;
}
