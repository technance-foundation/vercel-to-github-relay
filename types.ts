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

/**
 * Configuration for a single E2E project resolved from a Vercel deployment name.
 */
export interface E2EProjectConfig {
    /**
     * Logical project/app name passed into the E2E workflow.
     * This is typically used for reporting and workflow inputs.
     */
    project: string;

    /**
     * Repository-relative working directory where the E2E tests should run.
     * Example: "apps/portal"
     */
    workingDirectory: string;

    /**
     * Command used to execute the E2E tests for this project.
     * Example: "pnpm run test:e2e"
     */
    testCommand: string;

    /**
     * Optional human-friendly label used in the GitHub check run name.
     * If omitted, the deployment name or project name can be used instead.
     */
    checkName?: string;
}

/**
 * Root structure of the repository E2E project configuration file.
 *
 * The object keys under `projects` are expected to match Vercel deployment names.
 */
export interface E2EProjectsFile {
    /**
     * Map of Vercel deployment names to E2E project configuration.
     */
    projects: Record<string, E2EProjectConfig>;
}
