import crypto from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
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

    const ghOwner = process.env.GH_OWNER!;
    const ghRepo = process.env.GH_REPO!;
    const ghToken = process.env.GH_TOKEN_RELAY!;
    if (!ghOwner || !ghRepo || !ghToken) {
        res.status(500).send("Missing GH_OWNER/GH_REPO/GH_TOKEN_RELAY");
        return;
    }

    const metaSha = dep.meta?.githubCommitSha || dep.meta?.commitSha || dep.meta?.sha;
    let headSha = typeof metaSha === "string" && metaSha.length > 0 ? metaSha : undefined;

    if (!headSha) {
        try {
            headSha = await resolveHeadSha(ghOwner, ghRepo, ref, ghToken);
        } catch (e: any) {
            res.status(502).send(`Failed to resolve head SHA for ref '${ref}': ${e?.message || e}`);
            return;
        }
    }

    const checkName = `${CHECK_NAME_PREFIX}${dep.name}`;
    let checkRunId: number;
    try {
        checkRunId = await createCheckRun(ghOwner, ghRepo, headSha!, checkName, ghToken);
    } catch (e: any) {
        res.status(502).send(`Failed to create check run: ${e?.message || e}`);
        return;
    }

    const body = { ref, inputs: { url, project: dep.name, check_run_id: String(checkRunId) } };

    const resp = await fetch(
        `https://api.github.com/repos/${ghOwner}/${ghRepo}/actions/workflows/${GH_WORKFLOW_FILE}/dispatches`,
        {
            method: "POST",
            headers: ghHeaders(ghToken),
            body: JSON.stringify(body),
        },
    );

    if (!resp.ok) {
        const err = await resp.text();
        await safeFailCheck(ghOwner, ghRepo, checkRunId, `workflow_dispatch failed: ${resp.status} ${err}`, ghToken);
        res.status(502).send(`GitHub workflow_dispatch failed: ${resp.status} ${err}`);
        return;
    }

    res.status(200).send("OK");
}

function ghHeaders(token: string) {
    return {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "vercel-to-github-relay",
        Accept: "application/vnd.github+json",
    };
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

async function resolveHeadSha(owner: string, repo: string, ref: string, token: string): Promise<string> {
    {
        const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`, {
            headers: ghHeaders(token),
        });
        if (r.ok) {
            const j = await r.json();
            if (j?.sha) return j.sha as string;
        }
    }
    {
        const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(ref)}`, {
            headers: ghHeaders(token),
        });
        if (r.ok) {
            const j = await r.json();
            const sha = j?.object?.sha as string | undefined;
            if (sha) return sha;
        }
    }
    throw new Error(`Could not resolve SHA for ref '${ref}'`);
}

async function createCheckRun(owner: string, repo: string, headSha: string, name: string, token: string): Promise<number> {
    const body = { name, head_sha: headSha, status: "queued", started_at: new Date().toISOString() };
    const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}/check-runs`, {
        method: "POST",
        headers: ghHeaders(token),
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`createCheckRun failed: ${resp.status} ${err}`);
    }
    const json = (await resp.json()) as { id: number };
    return json.id;
}

async function safeFailCheck(owner: string, repo: string, checkRunId: number, summary: string, token: string): Promise<void> {
    try {
        await fetch(`https://api.github.com/repos/${owner}/${repo}/check-runs/${checkRunId}`, {
            method: "PATCH",
            headers: ghHeaders(token),
            body: JSON.stringify({
                status: "completed",
                completed_at: new Date().toISOString(),
                conclusion: "failure",
                output: { title: "E2E Tests (relay error)", summary },
            }),
        });
    } catch {
        // best-effort
    }
}
