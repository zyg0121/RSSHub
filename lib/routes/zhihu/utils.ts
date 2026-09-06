import { load } from 'cheerio';

import { config } from '@/config';
import cache from '@/utils/cache';
import md5 from '@/utils/md5';

import { encrypt as g_encrypt } from './execlib/x-zse-96-v3';

export const header = {
    'x-api-version': '3.0.91',
};

const fixImageUrl = (url: string) => url.split('?', 1)[0].replace('_b.jpg', '.jpg').replace('_r.jpg', '.jpg').replace('_720w.jpg', '.jpg');

export const processImage = (content: string) => {
    const $ = load(content, null, false);

    $('noscript, a[data-draft-type="mcn-link-card"]').remove();

    $('a').each((_, elem) => {
        const href = $(elem).attr('href');
        if (href?.startsWith('http://link.zhihu.com/?target=') || href?.startsWith('https://link.zhihu.com/?target=')) {
            const url = new URL(href);
            const target = url.searchParams.get('target') || '';
            try {
                $(elem).attr('href', decodeURIComponent(target));
            } catch {
                // sometimes the target is not a valid url
            }
        }
    });

    $('img.content_image, img.origin_image, img.content-image, img.data-actualsrc, figure>img').each((i, e) => {
        if (e.attribs['data-actualsrc']) {
            $(e).attr({
                src: fixImageUrl(e.attribs['data-actualsrc']),
                width: null,
                height: null,
            });
            $(e).removeAttr('data-actualsrc');
        } else if (e.attribs['data-original']) {
            $(e).attr({
                src: fixImageUrl(e.attribs['data-original']),
                width: null,
                height: null,
            });
            $(e).removeAttr('data-original');
        } else {
            $(e).attr({
                src: fixImageUrl(e.attribs.src),
                width: null,
                height: null,
            });
        }
    });

    return $.html();
};

const getCookieValueFrom = (cookieStr: string | undefined, key: string) =>
    cookieStr
        ?.split(';')
        .map((e) => e.trim())
        .find((e) => e.startsWith(key + '='))
        ?.slice(key.length + 1) || '';

export const getCookieValueByKey = (key: string) => getCookieValueFrom(config.zhihu.cookies, key);

const pendingZseCredentials = new Map<string, Promise<{ dc0: string; zseCk: string; ua: string }>>();

const getGeneratedZseCredentials = (url: string, configuredDc0: string) => {
    const cacheKey = `zhihu:browser-credentials:v1:${configuredDc0 ? md5(configuredDc0) : 'guest'}`;
    const pending = pendingZseCredentials.get(cacheKey);
    if (pending) {
        return pending;
    }

    const created = (async () => {
        try {
            return await cache.tryGet(
                cacheKey,
                async () => {
                    const { getBrowserCredentials } = await import('./browser');
                    return getBrowserCredentials(url, configuredDc0 ? config.zhihu.cookies || '' : '');
                },
                config.cache.contentExpire,
                false
            );
        } finally {
            pendingZseCredentials.delete(cacheKey);
        }
    })();
    pendingZseCredentials.set(cacheKey, created);
    return created;
};

const mergeGeneratedCookies = (configured: string, dc0: string, zseCk: string) => {
    const remaining = configured
        .split(';')
        .map((pair) => pair.trim())
        .filter((pair) => {
            const name = pair.split('=', 1)[0];
            return name && name !== 'd_c0' && name !== '__zse_ck';
        });
    return [`__zse_ck=${zseCk}`, `d_c0=${dc0}`, ...remaining].join('; ');
};

export const getSignedHeader = async (url: string, apiPath: string) => {
    const configured = config?.zhihu?.cookies || '';

    const configuredDc0 = getCookieValueFrom(configured, 'd_c0');
    const configuredZseCk = getCookieValueFrom(configured, '__zse_ck');

    // A configured pair may have been generated with a different user-agent, so
    // preserve the previous behavior and trust it as-is. Generated credentials
    // always return their matching user-agent.
    let cookieStr: string;
    let ua: string | undefined;
    if (configuredDc0 && configuredZseCk) {
        cookieStr = configured;
    } else {
        const credentials = await getGeneratedZseCredentials(url, configuredDc0);
        // Login cookies only belong to the configured d_c0 session. Do not mix
        // an isolated z_c0 with a newly-created guest session.
        cookieStr = configuredDc0 ? mergeGeneratedCookies(configured, credentials.dc0, credentials.zseCk) : `__zse_ck=${credentials.zseCk}; d_c0=${credentials.dc0}`;
        ua = credentials.ua;
    }

    // Sign with the same `d_c0` that is sent, otherwise the backend rejects the
    // request. Refer to https://github.com/srx-2000/spider_collection/issues/18
    const dc0 = getCookieValueFrom(cookieStr, 'd_c0');
    const xzse93 = '101_3_3.0';
    const f = `${xzse93}+${apiPath}+${dc0}`;
    const xzse96 = '2.0_' + g_encrypt(md5(f));

    return {
        cookie: cookieStr,
        ...(ua && { 'user-agent': ua }),
        'x-zse-96': xzse96,
        'x-app-za': 'OS=Web',
        'x-zse-93': xzse93,
    };
};
