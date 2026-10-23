import {
    httpBatchStreamLink,
    httpSubscriptionLink,
    loggerLink,
    splitLink,
} from '@trpc/client';
import SuperJSON from 'superjson';

export function getBaseUrl() {
    if (typeof window !== 'undefined') return window.location.origin;
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
    return `http://localhost:${process.env.PORT ?? 3000}`;
}

const trpcUrl = () => getBaseUrl() + '/api/trpc';

const commonHeaders = () => {
    const headers = new Headers();
    headers.set('x-trpc-source', 'vanilla-client');
    return headers;
};

export const links = [
    loggerLink({
        enabled: (op) =>
            process.env.NODE_ENV === 'development' ||
            (op.direction === 'down' && op.result instanceof Error),
    }),
    // SSE subscriptions for Provider watch/process streams; HTTP batch for the rest.
    splitLink({
        condition: (op) => op.type === 'subscription',
        true: httpSubscriptionLink({
            transformer: SuperJSON,
            url: trpcUrl,
            eventSourceOptions: () =>
                ({
                    withCredentials: true,
                }) as EventSourceInit,
        }),
        false: httpBatchStreamLink({
            transformer: SuperJSON,
            url: getBaseUrl() + '/api/trpc',
            headers: commonHeaders,
        }),
    }),
];
