import { isBillingEnabled, isPublishEnabled } from '@/config/features';
import { TRPCError } from '@trpc/server';

export function assertBillingEnabled(): void {
    if (!isBillingEnabled()) {
        throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Billing is disabled in this fork build',
        });
    }
}

export function assertPublishEnabled(): void {
    if (!isPublishEnabled()) {
        throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Publish / hosting is disabled in this fork build',
        });
    }
}
