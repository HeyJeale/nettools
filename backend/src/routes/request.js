'use strict';

module.exports = async function requestRoutes(fastify) {
  fastify.post('/send', async (req, reply) => {
    const {
      method = 'GET',
      url,
      headers = {},
      body,
      followRedirects = true,
      timeout = 30000,
    } = req.body;

    if (!url) return reply.code(400).send({ error: 'url is required' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const startTime = Date.now();

    try {
      const redirectChain = [];
      let currentUrl = url;
      let response;
      const maxRedirects = followRedirects ? 10 : 0;
      let redirectCount = 0;

      // Build fetch options
      const fetchHeaders = {};
      for (const [k, v] of Object.entries(headers)) {
        if (k && v !== undefined && v !== '') fetchHeaders[k] = v;
      }

      let fetchBody;
      if (body && !['GET', 'HEAD'].includes(method.toUpperCase())) {
        fetchBody = typeof body === 'string' ? body : JSON.stringify(body);
      }

      while (true) {
        response = await fetch(currentUrl, {
          method: method.toUpperCase(),
          headers: fetchHeaders,
          body: fetchBody,
          redirect: 'manual',
          signal: controller.signal,
        });

        const isRedirect = response.status >= 300 && response.status < 400;
        const location = response.headers.get('location');

        if (isRedirect && location && followRedirects && redirectCount < maxRedirects) {
          redirectChain.push({
            url: currentUrl,
            status: response.status,
            location,
          });
          // Resolve relative redirects
          try {
            currentUrl = new URL(location, currentUrl).href;
          } catch {
            currentUrl = location;
          }
          redirectCount++;
          // 303 / 301 / 302 with non-GET: switch to GET
          if ([301, 302, 303].includes(response.status) && method.toUpperCase() !== 'GET') {
            fetchBody = undefined;
          }
          continue;
        }
        break;
      }

      const elapsed = Date.now() - startTime;

      // Read response body
      const rawBody = await response.arrayBuffer();
      const bodyBuffer = Buffer.from(rawBody);
      const bodyText = bodyBuffer.toString('utf8');
      const size = bodyBuffer.byteLength;

      // Collect response headers
      const respHeaders = {};
      response.headers.forEach((v, k) => { respHeaders[k] = v; });

      // Collect cookies from set-cookie header
      const cookies = response.headers.getSetCookie
        ? response.headers.getSetCookie()
        : (respHeaders['set-cookie'] ? [respHeaders['set-cookie']] : []);

      return {
        status: response.status,
        statusText: response.statusText,
        headers: respHeaders,
        cookies,
        body: bodyText,
        size,
        elapsed,
        redirects: redirectChain,
        finalUrl: currentUrl,
      };
    } catch (err) {
      const elapsed = Date.now() - startTime;
      if (err.name === 'AbortError') {
        return reply.code(504).send({ error: `Request timed out after ${timeout}ms`, elapsed });
      }
      return reply.code(502).send({ error: err.message, elapsed });
    } finally {
      clearTimeout(timer);
    }
  });
};
