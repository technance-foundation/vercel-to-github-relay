# **Vercel → GitHub Relay**

This service connects Vercel preview deployments with GitHub E2E test pipeline.

GitHub Actions can run tests — but they don’t know _when_ a preview is actually ready.

This Relay fills that gap.

Whenever Vercel finishes building a preview deployment, the Relay:

1. Verifies the webhook signature
2. Figures out the commit / branch involved
3. Creates an E2E Check Run on GitHub
4. Triggers the E2E workflow with the correct inputs
5. Lets the E2E Test Runner handle everything else

It’s a small piece of glue, but it’s what makes PR E2E checks feel “native” in GitHub.

---

### GitHub App Required

The Relay uses a GitHub App to create check runs and trigger workflows.
If you don't have one yet, follow the setup guide here:

👉 **[GitHub App Setup Guide](./GITHUB_APP_SETUP.md)**

## **Environment variables**

To run correctly, the Relay needs:

### **From GitHub App**

| Variable             | Description                                 |
| -------------------- | ------------------------------------------- |
| `GH_APP_ID`          | The GitHub App ID                           |
| `GH_APP_PRIVATE_KEY` | Multiline private key (Relay normalizes it) |
| `GH_OWNER`           | GitHub org/user owning the repo             |
| `GH_REPO`            | Repo where E2E workflow lives               |

### **From Vercel**

| Variable                | Description                          |
| ----------------------- | ------------------------------------ |
| `VERCEL_WEBHOOK_SECRET` | Secret to validate incoming webhooks |

---

## **How the Relay works (high level)**

Here’s what happens behind the scenes every time Vercel finishes a preview build:

1. **Vercel sends a `deployment.succeeded` webhook.**
   We verify the signature and parse out deployment metadata.

2. **We resolve the correct `head_sha` for the PR.**
   Either from metadata (`githubCommitSha`) or by looking up the branch.

3. **We create a GitHub Check Run.**
   It shows up instantly in the PR as:
   `E2E Tests — <project>`

4. **We dispatch the E2E workflow.**
   The workflow receives:

    - `url` (preview URL)
    - `project` (app name)
    - `check_run_id` (so the test runner can update it)

5. **The GitHub Action takes over.**
   The `e2e-test-runner` action handles setup, testing, and updating the check.

The Relay steps aside — the workflow does the rest.

---

## **Development**

Local dev uses `vercel dev`:

```sh
pnpm install
pnpm dev
```

A few tips:

### 1. Vercel won’t hit your local server automatically

You can simulate webhook traffic with:

```sh
curl -X POST http://localhost:3000/api/vercel-to-github-success-deployment \
  -H "x-vercel-signature: <hmac>" \
  -d @test-payload.json
```

### 2. Make sure your GitHub App is installed on the repo

Otherwise the Relay won’t be able to create Check Runs.

### 3. Check the private key formatting

The code includes a helper to restore `\n` if Vercel strips them.

---

## **Deploying**

This project is already set up for Vercel:

```
vercel deploy --prod
```

You’ll then add the deployment URL as the webhook endpoint inside Vercel’s project settings.
