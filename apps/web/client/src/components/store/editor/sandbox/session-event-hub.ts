import type { RemoteSessionEvent, WatchEvent } from '@onlook/code-provider';

type Listener<T> = (value: T) => void;

function add<T>(map: Map<string, Set<Listener<T>>>, key: string, listener: Listener<T>): () => void {
    let listeners = map.get(key);
    if (!listeners) {
        listeners = new Set();
        map.set(key, listeners);
    }
    listeners.add(listener);
    return () => {
        const current = map.get(key);
        current?.delete(listener);
        if (current?.size === 0) {
            map.delete(key);
        }
    };
}

/**
 * Fans the single event stream of a session out to the watchers and processes that registered
 * for it, so any number of them share one connection (see {@link RemoteSessionEvent}).
 */
export class SessionEventHub {
    private readonly watchListeners = new Map<string, Set<Listener<WatchEvent>>>();
    private readonly outputListeners = new Map<string, Set<Listener<string>>>();
    private readonly errorListeners = new Set<Listener<Error>>();

    /** Routes an event to the listeners registered for its watcher or process. */
    dispatch(event: RemoteSessionEvent): void {
        if (event.kind === 'watch') {
            this.notify(this.watchListeners.get(event.watcherId), event.event);
        } else if (event.kind === 'output') {
            this.notify(this.outputListeners.get(event.handleId), event.data);
        }
    }

    onWatch(watcherId: string, listener: Listener<WatchEvent>): () => void {
        return add(this.watchListeners, watcherId, listener);
    }

    onOutput(handleId: string, listener: Listener<string>): () => void {
        return add(this.outputListeners, handleId, listener);
    }

    onError(listener: Listener<Error>): () => void {
        this.errorListeners.add(listener);
        return () => {
            this.errorListeners.delete(listener);
        };
    }

    /** Tells every listener that the stream broke. */
    fail(error: Error): void {
        this.notify(this.errorListeners, error);
    }

    clear(): void {
        this.watchListeners.clear();
        this.outputListeners.clear();
        this.errorListeners.clear();
    }

    private notify<T>(listeners: Set<Listener<T>> | undefined, value: T): void {
        if (!listeners) {
            return;
        }
        // Copy: a listener may unsubscribe itself, and one failing listener must not starve the rest.
        for (const listener of [...listeners]) {
            try {
                listener(value);
            } catch (error) {
                console.error('[SessionEventHub] listener failed:', error);
            }
        }
    }
}
