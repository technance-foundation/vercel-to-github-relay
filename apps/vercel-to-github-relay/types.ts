/**
 * General Vercel webhook envelope.
 */
export interface VercelWebhook<P = unknown> {
    /**
     * Event type, e.g. "deployment.succeeded", "deployment.error", etc.
     */
    type: string;

    /**
     * Unique webhook delivery ID.
     */
    id: string;

    /**
     * Webhook delivery timestamp (UNIX ms).
     */
    createdAt: number;

    /**
     * Region string where the event occurred (possibly null).
     */
    region?: string | null;

    /**
     * Event-specific payload (typed separately, e.g. VercelDeploymentPayload).
     */
    payload: P;
}

/**
 * Deployment payload for deployment-related webhook events.
 */
export interface VercelDeploymentPayload {
    /**
     * Team information (if applicable).
     */
    team?: { id: string | null };

    /**
     * User information who triggered the event.
     */
    user?: { id: string };

    /**
     * Deployment object with metadata and status.
     */
    deployment: {
        /**
         * Deployment ID.
         */
        id: string;

        /**
         * Arbitrary key/value metadata provided at deploy time.
         */
        meta?: Record<string, string>;

        /**
         * Preview or production URL of the deployment (hostname or full URL).
         */
        url: string;

        /**
         * Project name used in the deployment URL.
         */
        name: string;

        /**
         * Optional state, often "READY" or "ERROR".
         */
        state?: "READY" | "ERROR" | string;

        /**
         * Optional status field (string).
         */
        status?: string;

        /**
         * Git ref/branch associated with the deployment.
         */
        ref?: string;
    };

    /**
     * Useful dashboard links for the deployment and project.
     */
    links?: {
        /**
         * Dashboard URL to inspect the deployment.
         */
        deployment?: string;

        /**
         * Dashboard URL to the project.
         */
        project?: string;
    };

    /**
     * Deployment target environment.
     * One of "production", "staging", or null.
     */
    target: "production" | "staging" | null;

    /**
     * Project metadata.
     */
    project: { id: string };

    /**
     * Plan type of the deployment.
     */
    plan?: string;

    /**
     * List of supported regions for the deployment.
     */
    regions?: string[];
}

/**
 * Specialized webhook event type for succeeded/ready deployments.
 */
export type VercelDeploymentSucceededEvent = VercelWebhook<VercelDeploymentPayload> & {
    type: "deployment.succeeded";
};
