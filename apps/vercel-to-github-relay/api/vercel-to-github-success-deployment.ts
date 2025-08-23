import crypto from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { App as GitHubApp } from "@octokit/app";
import { Octokit } from "octokit";
import type { VercelWebhook, VercelDeploymentPayload, VercelDeploymentSucceededEvent } from "../types";

const GH_WORKFLOW_FILE = "e2e.yaml";
const CHECK_NAME_PREFIX = "E2E Tests —";

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
    }

    const secret = process.env.VERCEL_WEBHOOK_SECRET;
    if (!secret) {
        res.status(500).send("Missing VERCEL_WEBHOOK_SECRET");
        return;
    }

    const raw = await readRawBody(req);
    const signature = crypto.createHmac("sha1", secret).update(raw).digest("hex");
    if (signature !== req.headers["x-vercel-signature"]) {
        res.status(401).send("Invalid signature");
        return;
    }

    let envelope: VercelWebhook<VercelDeploymentPayload>;
    try {
        envelope = JSON.parse(raw) as VercelWebhook<VercelDeploymentPayload>;
    } catch {
        res.status(400).send("Invalid JSON");
        return;
    }

    if (!isDeploymentSucceededEvent(envelope)) {
        res.status(202).send("Ignored");
        return;
    }

    const dep = envelope.payload.deployment;
    const rawUrl = dep.url;
    const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    const ref = dep.meta?.githubCommitRef ?? dep.meta?.gitlabCommitRef ?? dep.meta?.branch ?? dep.ref ?? "";

    if (!rawUrl || !ref) {
        res.status(400).send("Missing URL or branch ref");
        return;
    }

    const appId = process.env.GH_APP_ID!;
    const privateKey = process.env.GH_APP_PRIVATE_KEY!;
    const owner = process.env.GH_OWNER!;
    const repo = process.env.GH_REPO!;

    if (!appId || !privateKey || !owner || !repo) {
        res.status(500).send("Missing GH_APP_ID / GH_APP_PRIVATE_KEY / GH_OWNER / GH_REPO");
        return;
    }

    const app = new GitHubApp({
        appId: Number(appId),
        privateKey,
    });

    try {
        const appOctokit: Octokit = await app.octokit;
        const inst = await appOctokit.request("GET /repos/{owner}/{repo}/installation", { owner, repo });
        const installationId = Number(inst.data.id);

        const octokit: Octokit = await app.getInstallationOctokit(installationId);

        const metaSha = dep.meta?.githubCommitSha || dep.meta?.commitSha || dep.meta?.sha;
        let headSha: string | undefined = typeof metaSha === "string" && metaSha.length ? metaSha : undefined;

        if (!headSha) {
            headSha = await resolveHeadSha(octokit, owner, repo, ref);
        }

        const checkName = `${CHECK_NAME_PREFIX} ${dep.name}`;
        const { data: created } = await octokit.rest.checks.create({
            owner,
            repo,
            name: checkName,
            head_sha: headSha!,
            status: "queued",
            started_at: new Date().toISOString(),
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

async function resolveHeadSha(octokit: Octokit, owner: string, repo: string, ref: string): Promise<string> {
    /*
     * Try commits/{ref} first (works for branch or SHA)
     */
    try {
        const commit = await octokit.rest.repos.getCommit({ owner, repo, ref });
        if (commit.data.sha) return commit.data.sha;
    } catch {
        // fall through
    }

    /*
     * Fallback to git/getRef (heads/{ref})
     */
    try {
        const getRef = await octokit.rest.git.getRef({
            owner,
            repo,
            ref: `heads/${ref}`,
        });
        const sha = (getRef.data.object as any)?.sha as string | undefined;
        if (sha) return sha;
    } catch {
        // fall through
    }

    throw new Error(`Could not resolve SHA for ref '${ref}'`);
}
