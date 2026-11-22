/**
 * Klient panelu na stronie (np. mateuszcieplak.com): publikuje aktualny adres
 * tunelu, żeby gracze mogli wejść stałym linkiem {panel}/sieje/mafia/graj.
 *
 *   POST   {panel}/api/sieje/mafia  { url, lanUrl }  → 204 (co 5 min jako heartbeat)
 *   DELETE {panel}/api/sieje/mafia                   → 204 (przy zamykaniu)
 *
 * Nigdy nie rzuca wyjątków na zewnątrz: błędy sieci kończą się ostrzeżeniem w logu.
 */

export const HEARTBEAT_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

/**
 * Zwraca klienta albo null, gdy brakuje SIEJE_PANEL_URL lub MAFIA_PUBLISH_TOKEN.
 * @param {object} opts
 * @param {string|undefined} opts.panelUrl
 * @param {string|undefined} opts.token
 * @param {(tag: string, msg: string) => void} [opts.log]
 * @param {number} [opts.heartbeatMs]
 */
export function createPanelLink({ panelUrl, token, log = () => {}, heartbeatMs = HEARTBEAT_MS } = {}) {
  const base = (panelUrl || '').trim().replace(/\/+$/, '');
  const secret = (token || '').trim();
  if (!base || !secret) return null;

  const endpoint = `${base}/api/sieje/mafia`;
  const headers = { authorization: `Bearer ${secret}` };

  let current = null; // { url, lanUrl } ostatnio opublikowane
  let timer = null;
  let stopped = false;

  async function send(method, body) {
    const init = {
      method,
      headers: body ? { ...headers, 'content-type': 'application/json' } : headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (body) init.body = JSON.stringify(body);
    return fetch(endpoint, init);
  }

  async function post(announceOk) {
    if (stopped || !current) return false;
    try {
      const res = await send('POST', { url: current.url, lanUrl: current.lanUrl });
      if (res.ok) {
        if (announceOk) log('panel', `adres opublikowany na ${base}`);
        return true;
      }
      log('panel', `uwaga: panel odrzucił publikację adresu (HTTP ${res.status})`);
    } catch (err) {
      log('panel', `uwaga: nie udało się opublikować adresu (${err?.name || 'błąd'}: ${err?.message || err})`);
    }
    return false;
  }

  return {
    /** Stały adres dla graczy. */
    playUrl: `${base}/sieje/mafia/graj`,
    panelUrl: base,

    /** Publikuje adres tunelu i włącza heartbeat (ponowne wywołanie podmienia adres). */
    async publish(url, lanUrl = null) {
      current = { url, lanUrl: lanUrl || null };
      if (!timer && !stopped) {
        timer = setInterval(() => void post(false), heartbeatMs);
        timer.unref();
      }
      return post(true);
    },

    /** Czy jest co usuwać z panelu. */
    get published() {
      return current !== null;
    },

    /** DELETE przy zamykaniu; czeka najwyżej maxWaitMs. Bezpieczne przy wielokrotnym wywołaniu. */
    async unpublish(maxWaitMs = 1500) {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (!current) return false;
      current = null;
      const del = send('DELETE')
        .then((res) => {
          if (res.ok) log('panel', 'adres wycofany z panelu');
          else log('panel', `uwaga: panel nie potwierdził wycofania adresu (HTTP ${res.status})`);
          return res.ok;
        })
        .catch((err) => {
          log('panel', `uwaga: nie udało się wycofać adresu (${err?.name || 'błąd'})`);
          return false;
        });
      let t;
      const limit = new Promise((r) => {
        t = setTimeout(() => r(false), maxWaitMs);
      });
      try {
        return await Promise.race([del, limit]);
      } finally {
        clearTimeout(t);
      }
    },
  };
}
