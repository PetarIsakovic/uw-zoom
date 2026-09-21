# UW Zoom

UW Zoom is a minimal Netlify-ready guessing game:

- The player sees a heavily zoomed-in image first.
- Each wrong guess zooms out a little more.
- After the fourth wrong guess, the image fully reveals and the answer is shown.
- Users can upload their own images.
- Uploaded images stay pending until you approve them.

The project is plain HTML, CSS, and JavaScript on the frontend, with Netlify Functions handling AWS S3 uploads and moderation.

## Abuse protection

The deployed app now includes:

- server-side per-IP rate limiting on upload URL creation
- server-side per-IP rate limiting on upload submission
- server-side per-IP rate limiting on leaderboard saves
- S3-enforced upload size limits through presigned POST uploads
- browser/CDN caching on the safe read endpoints to reduce repeat reads

## Pages

- `/` landing page
- `/play/` game page
- `/upload/` upload and owner-review page

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the env template if you want AWS uploads locally:

   ```bash
   cp .env.example .env
   ```

3. Run a quick syntax check:

   ```bash
   npm run check
   ```

4. Start locally with Netlify:

   ```bash
   npx netlify dev
   ```

If AWS is not configured, the game still works with built-in demo images.

## Netlify environment variables

Set these in the Netlify dashboard for the site:

- `UWZ_AWS_REGION`
- `UWZ_AWS_ACCESS_KEY_ID`
- `UWZ_AWS_SECRET_ACCESS_KEY`
- `UWZ_S3_BUCKET`
- `UWZ_ADMIN_KEY`
- `UWZ_MAX_UPLOAD_MB` optional, defaults to `15`

## AWS setup

Create one private S3 bucket for UW Zoom uploads. The app uses these prefixes inside the bucket:

- `pending/images/`
- `pending/meta/`
- `approved/images/`
- `approved/meta/`
- `app/leaderboard/`

### Recommended IAM permissions

The AWS credentials used by Netlify should be able to:

- `s3:PutObject`
- `s3:GetObject`
- `s3:DeleteObject`
- `s3:ListBucket`
- `s3:HeadObject`

Scope those permissions to your UW Zoom bucket.

### Bucket CORS

Because the browser uploads directly to the presigned S3 URL, set bucket CORS similar to this:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["POST", "GET", "HEAD"],
    "AllowedOrigins": [
      "http://localhost:8888",
      "https://your-site.netlify.app",
      "https://uwzoom.com",
      "https://www.uwzoom.com"
    ],
    "ExposeHeaders": ["ETag"]
  }
]
```

Include every origin the site is served from. The browser uploads directly to
S3, so any origin missing here (for example a custom domain you add later) will
fail the CORS preflight with an "S3 CORS issue" error. Replace the Netlify and
custom-domain entries with your real URLs.

### Strongly recommended lifecycle rules

To avoid paying for abandoned spam uploads, add S3 lifecycle rules for these prefixes:

- `pending/images/` -> expire after `1 day`
- `pending/meta/` -> expire after `1 day`

That way, if someone uploads files and never completes moderation, they do not sit in your bucket forever.

## Approval flow

1. A user opens `/upload/` and uploads an image.
2. The file is sent to S3 under `pending/images/` with an S3-enforced size limit.
3. Submission metadata is written to `pending/meta/`.
4. You unlock review on the upload page with `UWZ_ADMIN_KEY`.
5. Approving a submission copies it to `approved/images/`, writes `approved/meta/`, and removes the pending files.
6. Rejecting a submission deletes the pending file and metadata.

## Leaderboard storage

The shared streak leaderboard is stored in the same S3 bucket at:

- `app/leaderboard/top-streaks.json`

The frontend now reads and writes leaderboard data through Netlify Functions, so leaderboard state is shared across players instead of being saved in each browser.

## Deploy

1. Push this project to a Git repo.
2. Import that repo into Netlify.
3. Make sure the publish directory is the project root and functions directory is `netlify/functions`.
4. Add the environment variables above.
5. Deploy.

Netlify will serve the static site and expose the functions under `/api/*`.
