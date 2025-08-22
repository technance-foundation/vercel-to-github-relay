import crypto from "crypto";

export default async function handler(req: Request): Promise<Response> {
    if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    const text = await req.text();

    const secret = process.env.VERCEL_WEBHOOK_SECRET || "";
    const sig = req.headers.get("x-vercel-signature");
    if (!secret || !verifyVercelSig(text, sig, secret)) {
        return new Response("Invalid signature", { status: 401 });
    }

    const payload = JSON.parse(text);
    const type: string = payload.type || payload.event || payload.action || "";

    const deployment = payload.deployment || payload.payload?.deployment || payload;

    const state: string | undefined = deployment.state || deployment.status;

    const isReadyEvent = type === "deployment.succeeded" || type === "deployment.ready" || state === "READY" || state === "ready";

    if (!isReadyEvent) {
        return new Response("Ignored", { status: 202 });
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
        return new Response("No preview URL", { status: 400 });
    }

    const project: string = deployment.project?.name || deployment.name || payload.project?.name || "";

    const ghOwner = process.env.GH_OWNER;
    const ghRepo = process.env.GH_REPO;
    const ghToken = process.env.GH_TOKEN_RELAY;
    if (!ghOwner || !ghRepo || !ghToken) {
        return new Response("Missing GitHub config", { status: 500 });
    }

    const body = {
        event_type: "vercel_deployment_ready",
        client_payload: {
            url: rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`,
            project,
        },
    };

    const ghResp = await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}/dispatches`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${ghToken}`,
            "Content-Type": "application/json",
            "User-Agent": "vercel-to-github-relay",
            Accept: "application/vnd.github+json",
        },
        body: JSON.stringify(body),
    });

    if (!ghResp.ok) {
        const err = await ghResp.text();
        return new Response(`GitHub dispatch failed: ${ghResp.status} ${err}`, { status: 502 });
    }

    return new Response("OK", { status: 200 });
}

function verifyVercelSig(body: string, signature: string | null, secret: string) {
    if (!signature) return false;
    const hmac = crypto.createHmac("sha1", secret);
    const digest = Buffer.from("sha1=" + hmac.update(body).digest("hex"), "utf8");
    const check = Buffer.from(signature, "utf8");
    try {
        return crypto.timingSafeEqual(digest, check);
    } catch {
        return false;
    }
}
