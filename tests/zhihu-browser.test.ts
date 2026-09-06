import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    cookies: '',
    getPlaywrightPage: vi.fn(),
    tryGet: vi.fn(),
    destroy: vi.fn(),
    addCookies: vi.fn(),
    browserCookies: vi.fn(),
    goto: vi.fn(),
    route: vi.fn(),
    waitForFunction: vi.fn(),
    evaluate: vi.fn(),
}));

vi.mock('../lib/config', () => ({
    config: {
        zhihu: {
            get cookies() {
                return mocks.cookies;
            },
        },
        cache: { contentExpire: 600 },
    },
}));
vi.mock('../lib/utils/cache', () => ({ default: { tryGet: mocks.tryGet } }));
vi.mock('../lib/utils/playwright', () => ({ getPlaywrightPage: mocks.getPlaywrightPage }));

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.cookies = '';
    mocks.tryGet.mockImplementation((_key, create) => create());
    mocks.waitForFunction.mockResolvedValue(undefined);
    mocks.browserCookies.mockResolvedValue([
        { name: 'd_c0', value: 'browser-dc0' },
        { name: '__zse_ck', value: 'browser-zse' },
    ]);
    mocks.evaluate.mockResolvedValue('Browser user agent');
    mocks.getPlaywrightPage.mockResolvedValue({
        page: { goto: mocks.goto, route: mocks.route, waitForFunction: mocks.waitForFunction, evaluate: mocks.evaluate },
        context: { addCookies: mocks.addCookies, cookies: mocks.browserCookies },
        destroy: mocks.destroy,
    });
});

describe('Zhihu browser credentials', () => {
    it('uses configured credentials without starting a browser', async () => {
        mocks.cookies = 'd_c0=configured; __zse_ck=existing; z_c0=login';
        const { getSignedHeader } = await import('../lib/routes/zhihu/utils');
        const headers = await getSignedHeader('https://www.zhihu.com/people/example', '/api/v4/members/example');
        expect(headers.cookie).toBe(mocks.cookies);
        expect(headers['x-zse-96']).toMatch(/^2\.0_/);
        expect(mocks.getPlaywrightPage).not.toHaveBeenCalled();
        expect(mocks.tryGet).not.toHaveBeenCalled();
    });

    it('keeps browser cookies and their native user agent together', async () => {
        mocks.cookies = 'z_c0=isolated-login';
        const { getSignedHeader } = await import('../lib/routes/zhihu/utils');
        const headers = await getSignedHeader('https://www.zhihu.com/people/example', '/api/v4/members/example');
        expect(headers.cookie).toBe('__zse_ck=browser-zse; d_c0=browser-dc0');
        expect(headers['user-agent']).toBe('Browser user agent');
        expect(mocks.addCookies).not.toHaveBeenCalled();
        expect(mocks.goto).toHaveBeenCalledWith('https://www.zhihu.com/people/example', { waitUntil: 'domcontentloaded' });
        expect(mocks.browserCookies).toHaveBeenCalledWith('https://www.zhihu.com/');
        expect(mocks.destroy).toHaveBeenCalledOnce();
    });

    it('transfers the configured session without truncating cookie values', async () => {
        const { getBrowserCredentials } = await import('../lib/routes/zhihu/browser');
        await getBrowserCredentials('https://www.zhihu.com/people/example', 'd_c0=seed==;z_c0=login=value');
        expect(mocks.addCookies).toHaveBeenCalledWith([
            { name: 'd_c0', value: 'seed==', domain: '.zhihu.com', path: '/' },
            { name: 'z_c0', value: 'login=value', domain: '.zhihu.com', path: '/' },
        ]);
        const handler = mocks.route.mock.calls[0][1];
        const continueRequest = vi.fn();
        const abortRequest = vi.fn();
        await handler({ request: () => ({ resourceType: () => 'image' }), continue: continueRequest, abort: abortRequest });
        expect(abortRequest).toHaveBeenCalledOnce();
        expect(continueRequest).not.toHaveBeenCalled();
    });

    it('closes the browser and gives an actionable error when cookies are unavailable', async () => {
        mocks.waitForFunction.mockRejectedValue(new Error('Page timeout'));
        const { getBrowserCredentials } = await import('../lib/routes/zhihu/browser');
        await expect(getBrowserCredentials('https://www.zhihu.com/people/example', '')).rejects.toThrow('Configure ZHIHU_COOKIES');
        expect(mocks.destroy).toHaveBeenCalledOnce();
    });
});
