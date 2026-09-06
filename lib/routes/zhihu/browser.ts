import { getPlaywrightPage } from '@/utils/playwright';

const allowedResources = new Set(['document', 'script', 'xhr', 'fetch']);

export const getBrowserCredentials = async (url: string, configuredCookies: string) => {
    const { page, context, destroy } = await getPlaywrightPage(url, { noGoto: true, closeTimeout: 0 });
    try {
        const cookies = configuredCookies
            .split(';')
            .map((pair) => pair.trim())
            .filter((pair) => pair.indexOf('=') > 0)
            .map((pair) => {
                const separator = pair.indexOf('=');
                return { name: pair.slice(0, separator), value: pair.slice(separator + 1), domain: '.zhihu.com', path: '/' };
            });
        if (cookies.length) {
            await context.addCookies(cookies);
        }
        await page.route('**/*', (route) => (allowedResources.has(route.request().resourceType()) ? route.continue() : route.abort()));
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.cookie.split(';').some((pair) => pair.trimStart().startsWith('__zse_ck=')), undefined, { timeout: 10000 });

        const browserCookies = await context.cookies('https://www.zhihu.com/');
        const dc0 = browserCookies.find((cookie) => cookie.name === 'd_c0')?.value;
        const zseCk = browserCookies.find((cookie) => cookie.name === '__zse_ck')?.value;
        if (!dc0 || !zseCk) {
            throw new Error('The browser did not receive the required cookies');
        }
        const ua = await page.evaluate(() => window.navigator.userAgent);
        return { dc0, zseCk, ua };
    } catch {
        throw new Error('zhihu: browser access did not provide valid credentials. Configure ZHIHU_COOKIES with an accessible session containing d_c0 and __zse_ck.');
    } finally {
        await destroy();
    }
};
