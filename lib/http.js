function cleanUrl(url) {
  const u = new URL(url);
  return `${u.origin}${u.pathname}`;
}

function excerpt(str, max = 200) {
  return str.length <= max ? str : str.slice(0, max) + '…';
}

function makeError(code, message, props = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, props);
  return err;
}

async function handleResponse(res, url) {
  const safe = cleanUrl(url);

  if (!res.ok) {
    const body = await res.text();
    throw makeError(
      'http_error',
      `HTTP ${res.status} at ${safe}: ${excerpt(body)}`,
      { status: res.status, url: safe }
    );
  }

  const ct = res.headers.get('content-type') || '';
  if (!ct.startsWith('application/json')) {
    const body = await res.text();
    throw makeError(
      'not_json',
      `Expected JSON but got ${ct} at ${safe}: ${excerpt(body)}`,
      { url: safe }
    );
  }

  try {
    return await res.json();
  } catch (err) {
    throw makeError('invalid_json', `Invalid JSON at ${safe}: ${err.message}`, { url: safe });
  }
}

export async function httpGetJson(url, { fetchImpl = fetch, headers } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { headers: headers || {} });
  } catch (err) {
    throw makeError('network_error', err.message, { cause: err });
  }
  return handleResponse(res, url);
}

export async function httpPostJson(url, body, { fetchImpl = fetch, headers } = {}) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw makeError('network_error', err.message, { cause: err });
  }
  return handleResponse(res, url);
}
