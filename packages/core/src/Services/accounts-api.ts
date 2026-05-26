import { getApiV4BaseUrl, getAppId } from '@deriv/shared';

import { getStoredToken, refreshAccessToken } from './oauth';

export type TAccount = {
    account_id: string;
    balance: number;
    currency: string;
    group: string;
    status: string;
    account_type: 'demo' | 'real';
    created_at: string;
    email: string;
    last_access_at: string;
    name: string;
    server_id: string;
    rights: Record<string, unknown>;
};

const getHeaders = (includeContentType = true): HeadersInit => {
    const token = getStoredToken();
    if (!token) throw new Error('No access token — user must log in');
    return {
        'Deriv-App-ID': String(getAppId()),
        Authorization: `Bearer ${token}`,
        ...(includeContentType && { 'Content-Type': 'application/json' }),
    };
};

/**
 * Fetch wrapper: retries once with a refreshed token on 401.
 *
 * When the token was handed over by a trusted host (host_auth sentinel set
 * by the bootstrap in index.tsx), refreshing here would call the fork's
 * /oauth2/token endpoint with the fork's client_id — but the refresh_token
 * belongs to the host's client_id, so the refresh would 401 too. Instead we
 * notify the parent via postMessage and let it push a fresh access_token.
 */
const apiFetch = async (url: string, options: RequestInit = {}, includeContentType = true): Promise<Response> => {
    const res = await fetch(url, { ...options, headers: getHeaders(includeContentType) });
    if (res.status === 401) {
        const isHostAuth = sessionStorage.getItem('host_auth') === 'true';
        if (isHostAuth) {
            // Ping the parent so it can refresh its OAuth session and re-post.
            try {
                window.parent?.postMessage(
                    { type: 'TOKEN_EXPIRED', source: 'dtrader-iframe' },
                    '*' // parent origin unknown at this layer; the parent itself filters
                );
            } catch {
                // ignore — parent may not be reachable
            }
            // Return the 401 untouched. The parent's next postMessage will
            // trigger a re-bootstrap via window.location.reload() in
            // setupPostMessageAuth (see index.tsx).
            return res;
        }
        await refreshAccessToken();
        return fetch(url, { ...options, headers: getHeaders(includeContentType) });
    }
    return res;
};

/** GET /trading/v1/options/accounts */
export const fetchAccounts = async (): Promise<TAccount[]> => {
    const res = await apiFetch(`${getApiV4BaseUrl()}/trading/v1/options/accounts`);
    if (!res.ok) throw new Error(`fetchAccounts failed: ${res.status}`);
    return (await res.json()).data;
};

/** POST /trading/v1/options/accounts */
export const createAccount = async (params: {
    currency: 'USD';
    group: 'row';
    account_type: 'demo' | 'real';
}): Promise<TAccount> => {
    const res = await apiFetch(`${getApiV4BaseUrl()}/trading/v1/options/accounts`, {
        method: 'POST',
        body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`createAccount failed: ${res.status}`);
    return (await res.json()).data;
};

/**
 * POST /trading/v1/options/accounts/{id}/otp
 * Returns the ready-to-use authenticated WebSocket URL.
 * Fetch this immediately before opening the socket — do not cache.
 */
export const fetchOTP = async (account_id: string): Promise<string> => {
    const res = await apiFetch(
        `${getApiV4BaseUrl()}/trading/v1/options/accounts/${account_id}/otp`,
        { method: 'POST' },
        false // no Content-Type — endpoint accepts no body
    );
    if (!res.ok) throw new Error(`fetchOTP failed: ${res.status}`);
    // Response shape: { data: { url: "wss://..." } }
    const json = await res.json();
    const url = json?.data?.url;
    if (!url) throw new Error(`fetchOTP: no url in response: ${JSON.stringify(json)}`);
    return url;
};

/** POST /trading/v1/options/accounts/{id}/reset-demo-balance */
export const resetDemoBalance = async (account_id: string): Promise<TAccount> => {
    const res = await apiFetch(
        `${getApiV4BaseUrl()}/trading/v1/options/accounts/${account_id}/reset-demo-balance`,
        { method: 'POST' },
        false // no Content-Type — endpoint accepts no body
    );
    if (!res.ok) throw new Error(`resetDemoBalance failed: ${res.status}`);
    return (await res.json()).data;
};
