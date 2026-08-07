const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;

if (!secret) {
  console.error("[backup-scheduler] AUTH_SECRET is required");
  process.exit(1);
}

const run = async () => {
  try {
    const response = await fetch("http://127.0.0.1:3001/api/internal/backups/run-due", {
      method: "POST",
      headers: { "x-internal-secret": secret },
      signal: AbortSignal.timeout(55_000),
    });
    if (!response.ok) console.error(`[backup-scheduler] run failed status=${response.status}`);
  } catch {
    console.error("[backup-scheduler] portal unavailable");
  }
};

setTimeout(() => {
  void run();
  setInterval(() => void run(), 60_000);
}, 10_000);
