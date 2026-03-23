/**
 * General Vercel webhook envelope.
 */
export interface VercelWebhook<P = unknown> {
    /**
     * Event type, for example:
     * "deployment.succeeded", "deployment.ready", "deployment.error".
     */
    type: string;

    /**
     * Unique webhook delivery ID.
     */
    id: string;

    /**
     * Webhook delivery timestamp in Unix milliseconds.
     */
    createdAt: number;

    /**
     * Region where the event occurred, if provided.
     */
    region?: string | null;

    /**
     * Event-specific payload.
     */
    payload: P;
}

/**
 * Deployment payload for deployment-related Vercel webhook events.
 *
 * Based on Vercel webhook payloads such as `deployment.succeeded`.
 */
export interface VercelDeploymentPayload {
    /**
     * Team information for the event, if applicable.
     */
    team?: {
        /**
         * Vercel team ID, or null when not applicable.
         */
        id: string | null;
    };

    /**
     * User information for the event, if applicable.
     */
    user?: {
        /**
         * Vercel user ID.
         */
        id: string;
    };

    /**
     * Deployment metadata.
     */
    deployment: {
        /**
         * Vercel deployment ID.
         */
        id: string;

        /**
         * Arbitrary deployment metadata provided by Vercel.
         * Often includes git-related fields such as branch or commit SHA.
         */
        meta?: Record<string, string>;

        /**
         * Preview or production deployment URL.
         * This may be a hostname or a full URL depending on the payload source.
         */
        url: string;

        /**
         * Vercel project name associated with the deployment.
         * This is human-readable, but can change if the project is renamed.
         */
        name: string;

        /**
         * Optional deployment state, often "READY" or "ERROR".
         */
        state?: "READY" | "ERROR" | string;

        /**
         * Optional deployment status string.
         */
        status?: string;

        /**
         * Git ref or branch associated with the deployment, if available.
         */
        ref?: string;
    };

    /**
     * Helpful dashboard links provided by Vercel.
     */
    links?: {
        /**
         * Vercel dashboard URL for inspecting the deployment.
         */
        deployment?: string;

        /**
         * Vercel dashboard URL for inspecting the project.
         */
        project?: string;
    };

    /**
     * Deployment target environment.
     */
    target: "production" | "staging" | null;

    /**
     * Vercel project metadata.
     */
    project: {
        /**
         * Stable Vercel project ID.
         * Prefer this over deployment name when mapping projects in config.
         */
        id: string;
    };

    /**
     * Vercel plan type for the deployment, if present.
     */
    plan?: string;

    /**
     * Supported deployment regions, if present.
     */
    regions?: string[];
}

/**
 * Specialized webhook event for successful deployment completion.
 */
export type VercelDeploymentSucceededEvent = VercelWebhook<VercelDeploymentPayload> & {
    type: "deployment.succeeded";
};

/**
 * Configuration for a single E2E project.
 */
export interface E2EProjectConfig {
    /**
     * Logical project/app name passed into the E2E workflow.
     * This is usually the app identifier used in CI reporting.
     */
    project: string;

    /**
     * Repository-relative working directory where E2E tests should run.
     * Example: "apps/midnight"
     */
    workingDirectory: string;

    /**
     * Command used to execute E2E tests for this project.
     * Example: "pnpm run test:e2e"
     */
    testCommand: string;

    /**
     * Optional human-friendly label used in the GitHub check run name.
     * If omitted, the workflow may fall back to the configured project name.
     */
    checkName?: string;
}

/**
 * Root structure of the E2E project configuration file.
 *
 * Keys under `projects` should preferably be Vercel project IDs for stability.
 * Name-based keys can still be supported as a fallback when needed.
 */
export interface E2EProjectsFile {
    /**
     * Map of project resolvers to E2E project configuration.
     *
     * Recommended key:
     * - Vercel project ID, for example: "prj_123456789"
     *
     * Optional fallback key:
     * - Vercel deployment/project name, for example: "midnight"
     */
    projects: Record<string, E2EProjectConfig>;
}
