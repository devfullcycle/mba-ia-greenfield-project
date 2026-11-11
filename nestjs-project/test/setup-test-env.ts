// Runs before `dotenv/config` in Jest `setupFiles`. dotenv never overrides
// variables already present in process.env, so these values win over `.env`
// and keep test runs away from development storage and queue data.
process.env.S3_BUCKET = 'streamtube-test';
process.env.QUEUE_PREFIX = 'streamtube-test';
// Tests run inside the Docker network, so presigned URLs must target the service name.
process.env.S3_PUBLIC_ENDPOINT = 'http://minio:9000';
process.env.VIDEO_RECONCILER_ENABLED = 'false';
