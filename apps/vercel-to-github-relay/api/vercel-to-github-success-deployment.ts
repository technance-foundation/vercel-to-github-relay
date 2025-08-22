import crypto from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { VercelWebhook, VercelDeploymentPayload, VercelDeploymentSucceededEvent } from "../types";

const GH_WORKFLOW_FILE = "e2e.yaml";

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

    const body = { ref, inputs: { url, project: dep.name } };

    const resp = await fetch(
        `https://api.github.com/repos/${ghOwner}/${ghRepo}/actions/workflows/${GH_WORKFLOW_FILE}/dispatches`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${ghToken}`,
                "Content-Type": "application/json",
                "User-Agent": "vercel-to-github-relay",
                Accept: "application/vnd.github+json",
            },
            body: JSON.stringify(body),
        },
    );

    if (!resp.ok) {
        const err = await resp.text();
        res.status(502).send(`GitHub workflow_dispatch failed: ${resp.status} ${err}`);
        return;
    }

    res.status(200).send("OK");
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
