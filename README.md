# **Vercel → GitHub Relay**

This service connects Vercel preview deployments with GitHub’s E2E test pipeline.

GitHub Actions can run tests — but they don’t know _when_ a preview deployment is actually ready.
This Relay fills that gap.

Whenever Vercel finishes building a preview deployment, the Relay:

1. Verifies the webhook signature
2. Figures out the commit / branch involved
3. Creates an E2E Check Run on GitHub
4. Triggers the E2E workflow with the correct inputs
5. Lets the E2E Test Runner handle everything else

It’s a small piece of glue, but it's what makes E2E checks feel like a natural part of your pull-request flow.

---

### GitHub App Required

The Relay uses a GitHub App to create check runs and trigger workflows.
If you don’t have one yet, follow the setup guide here:

👉 **[GitHub App Setup Guide](./GITHUB_APP_SETUP.md)**

---

## **Environment variables**

To run correctly, the Relay needs:

### **From GitHub App**

| Variable             | Description                                 |
| -------------------- | ------------------------------------------- |
| `GH_APP_ID`          | The GitHub App ID                           |
| `GH_APP_PRIVATE_KEY` | Multiline private key (Relay normalizes it) |
| `GH_OWNER`           | GitHub org/user owning the repo             |
| `GH_REPO`            | Repo where the E2E workflow lives           |

### **From Vercel**

| Variable                | Description                      |
| ----------------------- | -------------------------------- |
| `VERCEL_WEBHOOK_SECRET` | Secret used to validate webhooks |

---

## **🚨 Workflow Filename Matters**

> [!IMPORTANT]
> The Relay triggers a workflow by filename:
> **`e2e.yaml`**
>
> If you rename this file, update the Relay constant:
>
> ```ts
> const GH_WORKFLOW_FILE = "e2e.yaml";
> ```
>
> A mismatched name will cause E2E checks to remain stuck in “Queued” forever.

---

## **How the Relay works (high level)**

Every time a preview deployment succeeds on Vercel:

1. **Vercel sends a `deployment.succeeded` webhook**
   The Relay verifies authenticity and parses deployment details.

2. **It resolves the correct Git SHA**
   Either from deployment metadata or by asking GitHub.

3. **It creates a GitHub Check Run**
   So the PR instantly shows:
   _“E2E Tests — <project>”_

4. **It dispatches the E2E workflow**
   Passing along:

    - `url`
    - `project`
    - `check_run_id`

5. **The workflow takes over**
   The `e2e-test-runner` action handles setup, testing, and updating the check status.

After that, the Relay’s job is done.

---

## **Development**

Run locally with:

```sh
pnpm install
pnpm dev
```

A couple notes:

### 1. Vercel won’t forward real webhooks to localhost

You can simulate them manually:

```sh
curl -X POST http://localhost:3000/api/vercel-to-github-success-deployment \
  -H "x-vercel-signature: <hmac>" \
  -d @test-payload.json
```

### 2. Your GitHub App must be installed on the correct repo

Without it, the Relay can’t create check runs.

### 3. The private key must keep its newlines

The Relay automatically restores `\n` if your environment strips them.

---

## **Deploying**

This project is already wired for Vercel:

```
vercel deploy --prod
```

Once deployed, configure your Vercel project to send `deployment.succeeded` webhooks to:

```
/api/vercel-to-github-success-deployment
```
