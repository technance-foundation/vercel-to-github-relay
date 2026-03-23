import crypto from "node:crypto";
import { App as GitHubApp } from "@octokit/app";
import type { VercelRequest, VercelResponse } from "@vercel/node";

import type {
    E2EProjectConfig,
    E2EProjectsFile,
    VercelDeploymentPayload,
    VercelDeploymentSucceededEvent,
    VercelWebhook,
} from "../types.js";

const GH_WORKFLOW_FILE = "e2e.yaml";
const CHECK_NAME_PREFIX = "E2E Tests —";
const E2E_PROJECTS_CONFIG_PATH = ".github/e2e-projects.json";
const DEFAULT_TEST_COMMAND = "pnpm run test:e2e";

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== "POST") {
        return void res.status(405).send("Method Not Allowed");
    }

    const secret = process.env.VERCEL_WEBHOOK_SECRET;
    if (!secret) {
        return void res.status(500).send("Missing VERCEL_WEBHOOK_SECRET");
    }

    const raw = await readRawBody(req);
    const signature = crypto.createHmac("sha1", secret).update(raw).digest("hex");

    if (signature !== req.headers["x-vercel-signature"]) {
        return void res.status(401).send("Invalid signature");
    }

    let envelope: VercelWebhook<VercelDeploymentPayload>;
    try {
        envelope = JSON.parse(raw) as VercelWebhook<VercelDeploymentPayload>;
    } catch {
        return void res.status(400).send("Invalid JSON");
    }

    if (!isDeploymentSucceededEvent(envelope)) {
        return void res.status(202).send("Ignored");
    }

    const payload = envelope.payload;
    const deployment = payload.deployment;
    const rawUrl = deployment.url;
    const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    const ref =
        deployment.meta?.githubCommitRef ?? deployment.meta?.gitlabCommitRef ?? deployment.meta?.branch ?? deployment.ref ?? "";

    if (!rawUrl || !ref) {
        return void res.status(400).send("Missing URL or branch ref");
    }

    const appId = process.env.GH_APP_ID;
    const privateKey = process.env.GH_APP_PRIVATE_KEY;
    const owner = process.env.GH_OWNER;
    const repo = process.env.GH_REPO;

    if (!appId || !privateKey || !owner || !repo) {
        return void res.status(500).send("Missing GH_APP_ID / GH_APP_PRIVATE_KEY / GH_OWNER / GH_REPO");
    }

    const app = new GitHubApp({
        appId: Number(appId),
        privateKey: normalizePrivateKey(privateKey),
    });

    try {
        const appOctokit = app.octokit;
        const installation = await appOctokit.request("GET /repos/{owner}/{repo}/installation", {
            owner,
            repo,
        });
        const installationId = Number(installation.data.id);

        const octokit = await app.getInstallationOctokit(installationId);

        const metaSha = deployment.meta?.githubCommitSha || deployment.meta?.commitSha || deployment.meta?.sha;
        const headSha =
            (typeof metaSha === "string" && metaSha.length > 0 ? metaSha : undefined) ??
            (await resolveHeadSha(octokit, owner, repo, ref));

        const resolvedProject = await resolveProjectConfig(octokit, owner, repo, payload.project.id, deployment.name);

        const checkName = `${CHECK_NAME_PREFIX} ${resolvedProject.checkName ?? resolvedProject.project}`;

        const { data: created } = await octokit.request("POST /repos/{owner}/{repo}/check-runs", {
            owner,
            repo,
            name: checkName,
            head_sha: headSha,
            status: "queued",
            started_at: new Date().toISOString(),
            output: {
                title: "E2E Tests",
                summary: [
                    `Queued workflow for **${resolvedProject.project}**`,
                    "",
                    `**Preview URL:** ${url}`,
                    `**Working Directory:** ${resolvedProject.workingDirectory}`,
                    `**Test Command:** ${resolvedProject.testCommand}`,
                    `**Vercel Project ID:** ${payload.project.id}`,
                    `**Vercel Deployment Name:** ${deployment.name}`,
                ].join("\n"),
            },
        });

        const checkRunId = created.id;

        await octokit.request("POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches", {
            owner,
            repo,
            workflow_id: GH_WORKFLOW_FILE,
            ref,
            inputs: {
                url,
                project: resolvedProject.project,
                check_run_id: String(checkRunId),
                working_directory: resolvedProject.workingDirectory,
                test_command: resolvedProject.testCommand,
            },
        });

        return void res.status(200).send("OK");
    } catch (e) {
        if (e instanceof Error) {
            return void res.status(502).send(e.message || String(e));
        }

        throw e;
    }
}

function readRawBody(req: VercelRequest): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = "";

        req.setEncoding("utf8");
        req.on("data", (chunk) => {
            data += chunk;
        });
        req.on("end", () => resolve(data));
        req.on("error", reject);
    });
}

function isDeploymentSucceededEvent(evt: VercelWebhook<VercelDeploymentPayload>): evt is VercelDeploymentSucceededEvent {
    return evt.type === "deployment.succeeded";
}

// biome-ignore lint/suspicious/noExplicitAny: Hard to type
async function resolveHeadSha(octokit: any, owner: string, repo: string, ref: string): Promise<string> {
    try {
        const commit = await octokit.request("GET /repos/{owner}/{repo}/commits/{ref}", {
            owner,
            repo,
            ref,
        });

        if (commit.data?.sha) {
            return commit.data.sha;
        }
    } catch {
        // fall through
    }

    try {
        const gitRef = await octokit.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
            owner,
            repo,
            ref: `heads/${ref}`,
        });

        const sha = gitRef.data.object?.sha as string | undefined;
        if (sha) {
            return sha;
        }
    } catch {
        // fall through
    }

    throw new Error(`Could not resolve SHA for ref '${ref}'`);
}

async function resolveProjectConfig(
    // biome-ignore lint/suspicious/noExplicitAny: Hard to type
    octokit: any,
    owner: string,
    repo: string,
    projectId: string,
    deploymentName: string,
): Promise<E2EProjectConfig> {
    try {
        const response = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
            owner,
            repo,
            path: E2E_PROJECTS_CONFIG_PATH,
        });

        if (!("content" in response.data) || typeof response.data.content !== "string") {
            throw new Error(`Config file '${E2E_PROJECTS_CONFIG_PATH}' is not a file`);
        }

        const decoded = Buffer.from(response.data.content, "base64").toString("utf8");
        const parsed = JSON.parse(decoded) as E2EProjectsFile;

        const byProjectId = parsed.projects?.[projectId];
        if (byProjectId) {
            return byProjectId;
        }

        const byDeploymentName = parsed.projects?.[deploymentName];
        if (byDeploymentName) {
            return byDeploymentName;
        }
    } catch {
        // fall back to convention
    }

    return {
        project: deploymentName,
        workingDirectory: `apps/${deploymentName}`,
        testCommand: DEFAULT_TEST_COMMAND,
        checkName: deploymentName,
    };
}

function normalizePrivateKey(pk?: string): string {
    if (!pk) {
        return "";
    }

    return pk.includes("\\n") ? pk.replace(/\\n/g, "\n") : pk;
}
