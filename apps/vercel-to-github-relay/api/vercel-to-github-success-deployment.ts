import { createHmac, timingSafeEqual } from "node:crypto";

const GH_WORKFLOW_FILE = "e2e-on-vercel-webhook.yaml";

export default async function handler(req: any, res: any) {
    if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
    }

    const secret = process.env.VERCEL_WEBHOOK_SECRET || "";
    const sig = req.headers["x-vercel-signature"] as string | undefined;
    const text = await readRawBody(req);

    if (!secret || !verifyVercelSig(text, sig ?? null, secret)) {
        res.status(401).send("Invalid signature");
        return;
    }

    const payload = JSON.parse(text);
    const type: string = payload.type || payload.event || payload.action || "";
    const deployment = payload.deployment || payload.payload?.deployment || payload;
    const state: string | undefined = deployment.state || deployment.status;

    const isReadyEvent = type === "deployment.succeeded" || type === "deployment.ready" || state === "READY" || state === "ready";

    if (!isReadyEvent) {
        res.status(202).send("Ignored");
        return;
    }

    const rawUrl: string =
        deployment.url ||
        deployment.previewUrl ||
        deployment.environment_url ||
        deployment.target_url ||
        deployment.alias ||
        (deployment.aliases && deployment.aliases[0]) ||
        "";

    if (!rawUrl) {
        res.status(400).send("No preview URL");
        return;
    }

    const meta = deployment.meta || payload.meta || payload.payload?.meta || {};
    // Common places Vercel provides the source branch
    const ref: string = meta.githubCommitRef || meta.gitlabCommitRef || meta.branch || deployment.ref || payload.ref || "";

    if (!ref) {
        res.status(400).send("No branch ref in payload (meta.githubCommitRef/branch missing)");
        return;
    }

    const project: string = deployment.project?.name || deployment.name || payload.project?.name || "";

    const ghOwner = process.env.GH_OWNER;
    const ghRepo = process.env.GH_REPO;
    const ghToken = process.env.GH_TOKEN_RELAY;

    if (!ghOwner || !ghRepo || !ghToken) {
        res.status(500).send("Missing GitHub config (GH_OWNER/GH_REPO/GH_TOKEN_RELAY)");
        return;
    }

    const dispatchBody = {
        ref, // PR branch
        inputs: {
            url: rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`,
            project,
        },
    };

    const ghResp = await fetch(
        `https://api.github.com/repos/${ghOwner}/${ghRepo}/actions/workflows/${encodeURIComponent(GH_WORKFLOW_FILE)}/dispatches`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${ghToken}`,
                "Content-Type": "application/json",
                "User-Agent": "vercel-to-github-relay",
                Accept: "application/vnd.github+json",
            },
            body: JSON.stringify(dispatchBody),
        },
    );

    if (!ghResp.ok) {
        const err = await ghResp.text();
        res.status(502).send(`GitHub workflow_dispatch failed: ${ghResp.status} ${err}`);
        return;
    }

    res.status(200).send("OK");
}

async function readRawBody(req: any): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
        let data = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => (data += chunk));
        req.on("end", () => resolve(data));
        req.on("error", reject);
    });
}

function verifyVercelSig(body: string, signature: string | null, secret: string) {
    if (!signature) return false;
    const hmac = createHmac("sha1", secret);
    const digest = Buffer.from("sha1=" + hmac.update(body).digest("hex"), "utf8");
    const check = Buffer.from(signature, "utf8");
    try {
        return timingSafeEqual(digest, check);
    } catch {
        return false;
    }
}
