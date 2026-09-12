# AWS / Production Configuration Notes

This is guidance for moving from local mock mode to real AWS services — it has **not** been exercised against a live AWS account in this session (no credentials were available). Treat every step below as reviewed-but-unverified until you've run it once yourself. For MongoDB Atlas + Render + Vercel deployment specifics, see [DEPLOYMENT.md](DEPLOYMENT.md) — this doc covers only the AWS side (S3 storage + Rekognition face search).

## 0. Create an AWS account (if you don't have one yet)

1. Go to [aws.amazon.com](https://aws.amazon.com) → **Create an AWS Account**. You'll need an email, a credit/debit card (AWS requires one even for free-tier usage — Rekognition and S3 at pilot-event scale cost a few dollars a month, not a meaningful sum), and phone verification.
2. Once in the console, **do not use the root account's credentials in the app.** Go to **IAM → Users → Create user**:
   - Name: e.g. `neoteric-memories-api`.
   - Do **not** grant console access (this user is only for programmatic API calls from Render).
3. **Attach a policy** — create a new policy (IAM → Policies → Create policy → JSON tab) with:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:ListBucket"],
         "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME"
       },
       {
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
         "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"
       },
       {
         "Effect": "Allow",
         "Action": [
           "rekognition:CreateCollection",
           "rekognition:DeleteCollection",
           "rekognition:IndexFaces",
           "rekognition:DeleteFaces",
           "rekognition:SearchFacesByImage",
           "rekognition:DetectFaces",
           "rekognition:DescribeCollection"
         ],
         "Resource": "*"
       }
     ]
   }
   ```
   (Rekognition doesn't support resource-level restriction by collection name, hence `"Resource": "*"` there — it's still scoped to only these specific actions.) Attach this policy to the `neoteric-memories-api` user.
4. **IAM → Users → neoteric-memories-api → Security credentials → Create access key** → choose "Application running outside AWS" (this is exactly the Render use case) → save the **Access key ID** and **Secret access key** immediately (the secret is shown once).
5. These two values become `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (used for both S3 and Rekognition — no need for separate credentials).

> Render doesn't support AWS IAM roles (that's an AWS-hosting-specific mechanism — EC2/ECS/Lambda), so long-lived access keys via this IAM user are the correct approach here, not a shortcut. Keep them out of git; set them only as Render environment variables.

## 1. S3 bucket

1. **S3 → Create bucket**. Name it something like `neoteric-memories-photos`. Region: pick the same region you'll use for Render/Rekognition.
2. Leave **Block all public access** ON (default) — the app only ever generates short-lived signed URLs, never public ones.
3. **Properties → Default encryption** → enable (SSE-S3 is fine, no extra setup needed).
4. Set `STORAGE_PROVIDER=s3`, `S3_BUCKET=neoteric-memories-photos`, `S3_REGION=<your region>` and the access key pair from step 0.
5. Optional: a lifecycle rule for auto-expiring old objects as a second line of defense beyond the app's own retention sweep.

## 2. Amazon Rekognition

1. Set `FACE_PROVIDER=rekognition`, `AWS_REGION`, and the same access key pair from step 0.
2. Nothing to pre-provision — Rekognition collections are created per event automatically (`neoteric-event-{eventId}`).
3. **Calibrate the threshold before any real pilot** — see [FACE_PROVIDER.md](FACE_PROVIDER.md#calibrating-the-high-confidence-threshold). Do not go live with the L1 default (`92`) unverified against real Neoteric event photography. A fast way to get a first read: create a throwaway test event, index ~20 photos of colleagues, have 3-4 people search with real selfies, and look at the similarity scores Rekognition actually returns before trusting the default.
4. Rekognition has regional availability and per-account quotas — check current AWS service quotas for your target region before a large multi-event rollout.

## 3. Secrets

- Generate real `JWT_SECRET` and `COOKIE_SECRET` (Render's Blueprint auto-generates these — see `render.yaml`). Never put them, or the AWS access key pair, in source control.

## 4. Liveness detection

`LIVENESS_PROVIDER=aws` is **not implemented** in L1 — Rekognition Face Liveness requires a purpose-built client-SDK-driven session flow (not a single server call like the rest of the Rekognition integration), out of scope for this build. The `LivenessProvider` interface (`apps/api/src/providers/liveness`) exists so this can be added later without touching the selfie-submission route.

## 5. What was NOT verified in this session

- No live AWS account was available — `RekognitionFaceSearchProvider` and `S3StorageProvider` are implemented to the correct SDK v3 API shape and pass typecheck, but have not been run against real AWS.
- No MongoDB Atlas cluster was available — see [DEPLOYMENT.md](DEPLOYMENT.md) for what that means.
