# GitHub App Setup Guide

The Relay needs to act on GitHub’s behalf — creating check runs, triggering workflows, and resolving commit SHAs.  
To do that securely, it uses a GitHub App.  
If you haven’t set one up yet, this guide walks you through it.

---

## 1. Create a new GitHub App

Go to: [https://github.com/settings/apps](https://github.com/settings/apps)

Click **“New GitHub App”**.

Fill in the basics:

-   **Name:**
    Something like _Preview → E2E Bridge_

-   **Homepage URL:**
    Optional — use your org website.

-   **Webhook URL:**
    Not needed. The Relay listens only to **Vercel**, not GitHub.
    Leave GitHub webhooks disabled.

-   **Webhook secret:**
    Also not needed.

Save the app.

---

## 2. Configure permissions

The Relay only needs a very small set of permissions.

### Repository permissions (required)

| Permission   | Access       | Why                                          |
| ------------ | ------------ | -------------------------------------------- |
| **Checks**   | Read & write | To create/update E2E test check runs         |
| **Actions**  | Read & write | To trigger workflows via `workflow_dispatch` |
| **Contents** | Read         | To resolve commit SHAs                       |

Everything else can stay on **No access**.

### Organization permissions

None required.

Save your changes.

---

## 3. Generate a private key

After creating the app:

1. Scroll to **Private keys**
2. Click **“Generate a private key”**
3. Download the `.pem` file

You’ll paste this into your Vercel environment variable:

```

GH_APP_PRIVATE_KEY

```

The Relay automatically re-formats the key if Vercel strips newlines.

---

## 4. Install the App on the correct repository

On the left sidebar, click **Install App**.

Choose **Only select repositories**, then select:

-   The repository where your **E2E workflow** lives
    (typically your frontend monorepo)

The Relay uses this installation to:

-   create check runs
-   dispatch workflows
-   look up commits

---

## 5. Add credentials to Vercel

Inside your Vercel Project Settings → **Environment Variables**:

| Key                  | Value                                    |
| -------------------- | ---------------------------------------- |
| `GH_APP_ID`          | From the GitHub App settings             |
| `GH_APP_PRIVATE_KEY` | Contents of the PEM file                 |
| `GH_OWNER`           | GitHub org (e.g. `technance-foundation`) |
| `GH_REPO`            | Repository containing the E2E workflow   |

Make sure they are added in **Production** at minimum.

Also keep:

```

VERCEL_WEBHOOK_SECRET

```

which you already set for verifying Vercel events.

---

## 6. Test the setup

Open any pull request in the repo where the App was installed.

You should see:

-   instantly: **“E2E Tests — <project>”** check
-   later: check updates when the workflow starts and completes

If it remains stuck in “Queued”, check:

-   App not installed on the repo
-   Wrong permissions
-   Private key incorrectly copied
-   Missing Vercel env vars
-   Workflow file name mismatch (should match the Relay’s `GH_WORKFLOW_FILE`)

---

## 7. What the App actually does

Once configured, the GitHub App lets the Relay:

-   Create a Check Run for each deployment
-   Trigger the E2E workflow with the correct inputs
-   Resolve PR commit SHAs
-   Update check run state from "queued" → "in_progress" → "completed"

It's the identity the Relay uses when talking to GitHub.
