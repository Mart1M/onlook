import type { CodesandboxProviderOptions } from './providers/codesandbox';
import { CodeProvider } from './providers';
import { CodesandboxProvider } from './providers/codesandbox';
import { RemoteProvider, type RemoteProviderOptions } from './providers/remote';

export * from './providers';
export { CodesandboxProvider } from './providers/codesandbox';
export { RemoteProvider } from './providers/remote';
export type {
    RemoteCodeProviderRpc,
    RemoteProviderOptions,
    RemoteSessionEvent,
} from './providers/remote';
export * from './types';

// `NodeFsProvider` is server-only (Node built-ins) and this entry point is bundled into the
// browser, so it is not exported here. Import it from '@onlook/code-provider/src/providers/nodefs'.
// Browser clients use `RemoteProvider` (CodeProvider.NodeFs) which RPCs to a server-held NodeFs.

export interface CreateClientOptions {
    providerOptions: ProviderInstanceOptions;
}

/**
 * Providers are designed to be singletons; be mindful of this when creating multiple clients
 * or when instantiating in the backend (stateless vs stateful).
 */
export async function createCodeProviderClient(
    codeProvider: CodeProvider,
    { providerOptions }: CreateClientOptions,
) {
    const provider = newProviderInstance(codeProvider, providerOptions);
    await provider.initialize({});
    return provider;
}

export async function getStaticCodeProvider(
    codeProvider: CodeProvider,
): Promise<typeof CodesandboxProvider | typeof RemoteProvider> {
    if (codeProvider === CodeProvider.CodeSandbox) {
        return CodesandboxProvider;
    }
    if (codeProvider === CodeProvider.NodeFs) {
        return RemoteProvider;
    }
    throw new Error(`Unimplemented code provider: ${codeProvider}`);
}

export interface ProviderInstanceOptions {
    codesandbox?: CodesandboxProviderOptions;
    /**
     * Browser proxy to a server-side NodeFsProvider.
     * Prefer this over importing `@onlook/code-provider/src/providers/nodefs` in client code.
     */
    nodefs?: RemoteProviderOptions;
}

function newProviderInstance(codeProvider: CodeProvider, providerOptions: ProviderInstanceOptions) {
    if (codeProvider === CodeProvider.CodeSandbox) {
        if (!providerOptions.codesandbox) {
            throw new Error('Codesandbox provider options are required.');
        }
        return new CodesandboxProvider(providerOptions.codesandbox);
    }

    if (codeProvider === CodeProvider.NodeFs) {
        if (!providerOptions.nodefs) {
            throw new Error('NodeFs (remote) provider options are required.');
        }
        return new RemoteProvider(providerOptions.nodefs);
    }

    throw new Error(`Unimplemented code provider: ${codeProvider}`);
}
