import { createHmac, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { VercelWebhook, VercelDeploymentPayload, VercelDeploymentSucceededEvent } from "../types";

const GH_WORKFLOW_FILE = "e2e.yaml";

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
    }

    const secret = process.env.VERCEL_WEBHOOK_SECRET || "";
    const sigHeader = req.headers["x-vercel-signature"];
    const sig = Array.isArray(sigHeader) ? sigHeader[0] : (sigHeader ?? null);

    const raw = await readRawBody(req);

    if (!secret || !verifyVercelSig(raw, sig, secret)) {
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
    if (!rawUrl) {
        res.status(400).send("No preview URL");
        return;
    }
    const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;

    const ref = dep.meta?.githubCommitRef ?? dep.meta?.gitlabCommitRef ?? dep.meta?.branch ?? dep.ref ?? "";

    if (!ref) {
        res.status(400).send("No branch ref");
        return;
    }

    const project = dep.name;

    const ghOwner = process.env.GH_OWNER;
    const ghRepo = process.env.GH_REPO;
    const ghToken = process.env.GH_TOKEN_RELAY;

    if (!ghOwner || !ghRepo || !ghToken) {
        res.status(500).send("Missing GitHub config (GH_OWNER/GH_REPO/GH_TOKEN_RELAY)");
        return;
    }

    const body = {
        ref,
        inputs: { url, project },
    };

    const resp = await fetch(
        `https://api.github.com/repos/${ghOwner}/${ghRepo}/actions/workflows/${encodeURIComponent(GH_WORKFLOW_FILE)}/dispatches`,
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
    return new Promise<string>((resolve, reject) => {
        let data = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => {
            data += chunk;
        });
        req.on("end", () => resolve(data));
        req.on("error", reject);
    });
}

function verifyVercelSig(body: string, signature: string | null, secret: string): boolean {
    if (!signature) return false;
    const hmac = createHmac("sha1", secret);
    const digest = Buffer.from(`sha1=${hmac.update(body).digest("hex")}`, "utf8");
    const check = Buffer.from(signature, "utf8");
    try {
        return timingSafeEqual(digest, check);
    } catch {
        return false;
    }
}

function isDeploymentSucceededEvent(evt: VercelWebhook<VercelDeploymentPayload>): evt is VercelDeploymentSucceededEvent {
    if (evt.type !== "deployment.succeeded" && evt.type !== "deployment.ready") return false;
    const d = evt.payload?.deployment;
    return Boolean(d && typeof d.url === "string" && typeof d.name === "string");
}
