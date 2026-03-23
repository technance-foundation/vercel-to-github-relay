# **Vercel → GitHub Relay**

This service connects Vercel preview deployments with GitHub’s E2E test pipeline.

GitHub Actions can run tests -- but they don’t know _when_ a preview deployment is actually ready.
This Relay fills that gap.

Whenever Vercel finishes building a preview deployment, the Relay:

1. Verifies the webhook signature
2. Figures out the commit / branch involved
3. Resolves E2E project configuration
4. Creates an E2E Check Run on GitHub
5. Triggers the E2E workflow with the correct inputs
6. Lets the E2E Test Runner handle everything else

It’s a small piece of glue, but it's what makes E2E checks feel like a natural part of your pull-request flow.

---

## **GitHub App Required**

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

If you rename this file, update the Relay constant:

```ts
const GH_WORKFLOW_FILE = "e2e.yaml";
```

A mismatched name will cause E2E checks to remain stuck in "Queued" forever.

---

## **E2E Project Configuration**

The Relay supports per-project configuration via:

```txt
.github/e2e-projects.json
```

### ✅ Recommended: Use Vercel Project ID

Each Vercel webhook includes a stable project ID:

```ts
payload.project.id;
```

You should use this as the primary key in your config, since:

- Project names can change
- IDs are stable and reliable
- Avoids accidental mismatches

---

### Example

```json
{
    "projects": {
        "prj_jWLGA9cpGatUCCf4kVLC5V44kuDt": {
            "project": "midnight",
            "workingDirectory": "apps/midnight",
            "testCommand": "pnpm run test:e2e",
            "checkName": "Midnight"
        }
    }
}
```

---

### Fields

| Field              | Description                     |
| ------------------ | ------------------------------- |
| `project`          | Value passed to the workflow    |
| `workingDirectory` | Where tests should run          |
| `testCommand`      | Command used to run E2E tests   |
| `checkName`        | Optional label for GitHub check |

---

### How it works

- The Relay first tries to match using:
    - `payload.project.id` (recommended)

- If not found, it falls back to:
    - `deployment.name`

Resolution logic:

```ts
projects[projectId] ?? projects[deploymentName];
```

---

### Fallback behavior

If no config exists, the Relay defaults to:

```ts
{
  project: deploymentName,
  workingDirectory: `apps/${deploymentName}`,
  testCommand: "pnpm run test:e2e",
  checkName: deploymentName,
}
```

This ensures zero breaking changes and keeps setup friction low.

---

## **How the Relay works (high level)**

Every time a preview deployment succeeds on Vercel:

1. **Vercel sends a `deployment.succeeded` webhook**
   The Relay verifies authenticity and parses deployment details.

2. **It resolves the correct Git SHA**
   Either from deployment metadata or by asking GitHub.

3. **It resolves project configuration**
   From `.github/e2e-projects.json` (project ID first, name fallback).

4. **It creates a GitHub Check Run**
   So the PR instantly shows:
   _"E2E Tests -- <project>"_

5. **It dispatches the E2E workflow**
   Passing along:
    - `url`
    - `project`
    - `check_run_id`
    - `working_directory`
    - `test_command`

6. **The workflow takes over**
   The `e2e-test-runner` action handles setup, testing, and updating the check status.

---

## **Development**

Run locally with:

```sh
pnpm install
pnpm dev
```

### Notes

#### 1. Vercel won’t forward real webhooks to localhost

You can simulate them manually:

```sh
curl -X POST http://localhost:3000/api/vercel-to-github-success-deployment \
  -H "x-vercel-signature: <hmac>" \
  -d @test-payload.json
```

#### 2. Your GitHub App must be installed on the correct repo

Without it, the Relay can’t create check runs.

#### 3. The private key must keep its newlines

The Relay automatically restores `\n` if your environment strips them.

---

## **Deploying**

This project is already wired for Vercel:

```sh
vercel deploy --prod
```

Once deployed, configure your Vercel project to send `deployment.succeeded` webhooks to:

```
/api/vercel-to-github-success-deployment
```

---

## **Local Testing (Simulating Vercel Webhooks)**

Vercel does not forward real webhooks to localhost, so the project includes a helper script to simulate a full `deployment.succeeded` event.

### Useful for testing:

- Webhook signature verification
- Git SHA resolution
- Project config resolution (project ID first, deployment name fallback)
- GitHub App check run creation
- Workflow dispatching logic

---

### Usage

```sh
./test-webhook.sh <deployment-name> <preview-url> [branch] [project-id]
```

- `<deployment-name>` -- Vercel deployment name (`deployment.name`)
- `<preview-url>` -- preview deployment URL
- `[branch]` -- optional (defaults to `main`)
- `[project-id]` -- optional Vercel project ID (`payload.project.id`)

---

### Examples

#### Basic

```sh
./test-webhook.sh portal https://portal-git-main-abc123.vercel.app
```

#### Custom branch

```sh
./test-webhook.sh portal https://portal-git-feat-login.vercel.app feat/login
```

#### Local Relay

```sh
export WEBHOOK_ENDPOINT="http://localhost:3000/api/vercel-to-github-success-deployment"
export VERCEL_WEBHOOK_SECRET="dev-secret"

./test-webhook.sh portal http://localhost:3000
```

#### With project ID (recommended)

```sh
./test-webhook.sh midnight https://midnight-git-main-abc123.vercel.app main prj_jWLGA9cpGatUCCf4kVLC5V44kuDt
```

---

The script sends a **fully valid** Vercel webhook envelope, computes the correct **HMAC SHA1 signature**, and posts it to your Relay -- just like Vercel does in production.
