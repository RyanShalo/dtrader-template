/* eslint-disable import/no-named-as-default-member */
/* eslint-disable import/no-named-as-default */
import React from 'react';
import { createRoot } from 'react-dom/client';

import App from 'App/app.jsx';
import initStore from 'App/initStore';
// eslint-disable-next-line
import registerServiceWorker from 'Utils/PWA';

import AppNotificationMessages from './App/Containers/app-notification-messages.jsx';

if (
    !!window?.localStorage.getItem?.('debug_service_worker') || // To enable local service worker related development
    !window.location.hostname.startsWith('localhost')
) {
    registerServiceWorker();
}

// ---------------------------------------------------------------------------
// Trusted-host token bootstrap
//
// When this app is embedded in a trusted host (e.g. quantumsynpro), the host
// can hand over an OAuth2 access_token via URL params or postMessage so the
// user doesn't have to OAuth-login a second time inside the iframe.
//
// Accepted URL params (in order of precedence):
//   ?access_token=...&expires_in=3600&refresh_token=...&loginid=CR1234&currency=USD
// Legacy aliases also accepted: token1 (→ access_token), acct1 (→ loginid),
// cur1 (→ currency).
//
// Accepted postMessage payload:
//   { type: 'AUTH_TOKEN', access_token, expires_in?, refresh_token?,
//     loginid?, currency? }
//
// Both write to sessionStorage under the same key the fork's getStoredToken()
// reads from (`auth_info`), so the existing client.init() flow then runs
// fetchAccounts() → fetchOTP() → OTP-WebSocket as normal.
// ---------------------------------------------------------------------------
type HostAuthPayload = {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
    loginid?: string;
    currency?: string;
};

const writeHostAuth = ({ access_token, expires_in = 3600, refresh_token, loginid, currency }: HostAuthPayload) => {
    sessionStorage.setItem(
        'auth_info',
        JSON.stringify({
            access_token,
            refresh_token,
            expires_at: Date.now() + expires_in * 1000,
        })
    );
    // Sentinel: tells apiFetch (and anyone else) NOT to call the fork's
    // refresh endpoint, because the refresh_token belongs to the host's
    // OAuth app (different client_id). The parent is responsible for
    // pushing a fresh access_token before the current one expires.
    sessionStorage.setItem('host_auth', 'true');
    // CSS hook: lets stylesheets hide host-redundant UI (account switcher,
    // deposit button, etc.) when the app is embedded inside a trusted host.
    // Use documentElement because body may not exist yet during boot.
    document.documentElement.classList.add('host-embedded');
    if (loginid) {
        sessionStorage.setItem('active_loginid', loginid);
        localStorage.setItem('active_loginid', loginid);
    }
    if (currency) {
        sessionStorage.setItem('query_param_currency', currency);
    }
};

const bootstrapTokenFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    const access_token = params.get('access_token') || params.get('token1');
    if (!access_token) return;

    writeHostAuth({
        access_token,
        expires_in: Number(params.get('expires_in') || 3600),
        refresh_token: params.get('refresh_token') || undefined,
        loginid: params.get('loginid') || params.get('acct1') || undefined,
        currency: params.get('currency') || params.get('cur1') || undefined,
    });

    // Strip auth params from the URL so the token isn't visible in the bar.
    // Preserves non-auth params (chart_type, symbol, trade_type, etc.).
    const preserved = new URLSearchParams();
    params.forEach((value, key) => {
        const isAuthKey = [
            'access_token',
            'token1',
            'expires_in',
            'refresh_token',
            'loginid',
            'acct1',
            'currency',
            'cur1',
        ].includes(key);
        if (!isAuthKey) preserved.append(key, value);
    });
    const query = preserved.toString();
    const cleanUrl = window.location.pathname + (query ? `?${query}` : '') + window.location.hash;
    window.history.replaceState({}, document.title, cleanUrl);
};

// ---------------------------------------------------------------------------
// Host-controlled theme
//
// The host that embeds this app decides the theme and tells the iframe, so the
// trader matches the surrounding site. The iframe never guesses.
//
//   URL param:   ?theme=dark | ?theme=light
//   postMessage: { type: 'SET_THEME', theme: 'dark' | 'light' }
//
// On boot we apply the class immediately (no flash) and remember the choice;
// once the store is up we call ui.setDarkMode() so it persists and the normal
// theme autorun keeps the body class in sync. The postMessage path lets the
// host switch the theme at runtime without a reload.
// ---------------------------------------------------------------------------
let host_theme: 'dark' | 'light' | null = null;

const applyThemeClass = (theme: 'dark' | 'light') => {
    [document.documentElement, document.body].forEach(el => {
        if (!el) return;
        el.classList.remove('theme--dark', 'theme--light');
        el.classList.add(theme === 'dark' ? 'theme--dark' : 'theme--light');
    });
};

const normalizeTheme = (value: unknown): 'dark' | 'light' | null =>
    value === 'dark' || value === 'light' ? value : null;

const bootstrapThemeFromUrl = () => {
    const theme = normalizeTheme(new URLSearchParams(window.location.search).get('theme'));
    if (!theme) return;
    host_theme = theme;
    applyThemeClass(theme);
};

const setupPostMessageTheme = () => {
    window.addEventListener('message', event => {
        if (!event?.data || typeof event.data !== 'object') return;
        if (event.data.type !== 'SET_THEME') return;
        const theme = normalizeTheme(event.data.theme);
        if (!theme) return;
        host_theme = theme;
        applyThemeClass(theme);
        // If the store is already up, flip it there too so the choice persists.
        ui_store_ref?.setDarkMode(theme === 'dark');
    });
};

// Set once the store is created so the runtime SET_THEME handler can reach it.
let ui_store_ref: { setDarkMode: (on: boolean) => void } | null = null;

const setupPostMessageAuth = () => {
    window.addEventListener('message', event => {
        // event.origin is the parent's origin. In production you should
        // tighten this to the known host (e.g. quantumsynpro's URL). Left
        // permissive here to support local-dev and preview deploys.
        if (!event?.data || typeof event.data !== 'object') return;
        if (event.data.type !== 'AUTH_TOKEN') return;
        const { access_token, expires_in, refresh_token, loginid, currency } = event.data;
        if (!access_token) return;

        // Compare with what's already stored — only reload if it changed.
        let existing: HostAuthPayload | null = null;
        try {
            existing = JSON.parse(sessionStorage.getItem('auth_info') ?? 'null');
        } catch {
            existing = null;
        }
        const sameToken = existing && (existing as any).access_token === access_token;
        const sameLogin = sessionStorage.getItem('active_loginid') === loginid;
        if (sameToken && sameLogin) return;

        writeHostAuth({ access_token, expires_in, refresh_token, loginid, currency });
        // Reload so the fork picks up the new auth via its normal init path.
        window.location.reload();
    });
};

// Run the URL bootstrap synchronously so initStore() below sees the token.
bootstrapTokenFromUrl();
setupPostMessageAuth();
// Theme bootstrap — apply the host's theme class before React mounts.
bootstrapThemeFromUrl();
setupPostMessageTheme();

// Mark ANY iframed context as embedded, even if no token was handed over
// (e.g. user did the fork's own OAuth login inside the frame). The host
// renders its own account UI above the iframe, so the duplicate header
// content should be hidden in every embedded session.
if (typeof window !== 'undefined' && window.self !== window.top) {
    document.documentElement.classList.add('host-embedded');
}

const initApp = async () => {
    // For simplified authentication, we don't need to pass accounts to initStore
    // The authentication will be handled by temp-auth.js and client-store.js
    // initStore is now async to perform whoami check before WebSocket connection
    const root_store = await initStore(AppNotificationMessages);

    // Expose the UI store to the runtime SET_THEME handler, and apply the
    // host's theme (from the URL) now that the store exists so it persists
    // and the theme autorun keeps the body class in sync.
    ui_store_ref = root_store.ui;
    if (host_theme) {
        root_store.ui.setDarkMode(host_theme === 'dark');
    }

    const wrapper = document.getElementById('derivatives_trader');
    if (wrapper) {
        const root = createRoot(wrapper);
        root.render(<App root_store={root_store} />);
    }
};

initApp();
