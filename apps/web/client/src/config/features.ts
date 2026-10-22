import { env } from '@/env';

/**
 * Fork feature flags for SaaS surfaces that are out of scope (PRD §3.2).
 * Default off so local builds need neither Stripe nor Freestyle/growth.
 * Flip via NEXT_PUBLIC_FEATURE_* when re-enabling upstream SaaS.
 */
export function isBillingEnabled(): boolean {
    return env.NEXT_PUBLIC_FEATURE_BILLING === true;
}

export function isPublishEnabled(): boolean {
    return env.NEXT_PUBLIC_FEATURE_PUBLISH === true;
}
