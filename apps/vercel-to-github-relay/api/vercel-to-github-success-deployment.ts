import crypto from "node:crypto";
import { App as GitHubApp } from "@octokit/app";
import type { VercelRequest, VercelResponse } from "@vercel/node";

import type { VercelDeploymentPayload, VercelDeploymentSucceededEvent, VercelWebhook } from "../types.js";

const GH_WORKFLOW_FILE = "e2e.yaml";
const CHECK_NAME_PREFIX = "E2E Tests —";

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== "POST") return void res.status(405).send("Method Not Allowed");

    const secret = process.env.VERCEL_WEBHOOK_SECRET;
    if (!secret) return void res.status(500).send("Missing VERCEL_WEBHOOK_SECRET");

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

    const dep = envelope.payload.deployment;
    const rawUrl = dep.url;
    const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    const ref = dep.meta?.githubCommitRef ?? dep.meta?.gitlabCommitRef ?? dep.meta?.branch ?? dep.ref ?? "";

    if (!rawUrl || !ref) return void res.status(400).send("Missing URL or branch ref");

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
        const inst = await appOctokit.request("GET /repos/{owner}/{repo}/installation", { owner, repo });
        const installationId = Number(inst.data.id);

        const octokit = await app.getInstallationOctokit(installationId);

        const metaSha = dep.meta?.githubCommitSha || dep.meta?.commitSha || dep.meta?.sha;
        const headSha =
            (typeof metaSha === "string" && metaSha.length ? metaSha : undefined) ??
            (await resolveHeadSha(octokit, owner, repo, ref));

        const checkName = `${CHECK_NAME_PREFIX} ${dep.name}`;

        const { data: created } = await octokit.request("POST /repos/{owner}/{repo}/check-runs", {
            owner,
            repo,
            name: checkName,
            head_sha: headSha,
            status: "queued",
            started_at: new Date().toISOString(),
            output: {
                title: "E2E Tests",
                summary: `Queued workflow for **${dep.name}**\n\n**Preview URL:** ${url}`,
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
                project: dep.name,
                check_run_id: String(checkRunId),
            },
        });

        res.status(200).send("OK");
    } catch (e: any) {
        res.status(502).send(e?.message || String(e));
    }
}

function readRawBody(req: VercelRequest): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => resolve(data));
        req.on("error", reject);
    });
}

function isDeploymentSucceededEvent(evt: VercelWebhook<VercelDeploymentPayload>): evt is VercelDeploymentSucceededEvent {
    return evt.type === "deployment.succeeded";
}

async function resolveHeadSha(octokit: any, owner: string, repo: string, ref: string): Promise<string> {
    try {
        const commit = await octokit.request("GET /repos/{owner}/{repo}/commits/{ref}", { owner, repo, ref });
        if (commit.data?.sha) return commit.data.sha;
    } catch {
        // fall through
    }

    try {
        const getRef = await octokit.request("GET /repos/{owner}/{repo}/git/ref/{ref}", { owner, repo, ref: `heads/${ref}` });
        const sha = (getRef.data.object as any)?.sha as string | undefined;
        if (sha) return sha;
    } catch {
        // fall through
    }

    throw new Error(`Could not resolve SHA for ref '${ref}'`);
}

function normalizePrivateKey(pk?: string): string {
    if (!pk) return "";
    return pk.includes("\\n") ? pk.replace(/\\n/g, "\n") : pk;
}
