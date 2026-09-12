try {
  const r = await fetch('http://127.0.0.1:8080/healthz', { signal: AbortSignal.timeout(4000) });
  process.exitCode = r.ok ? 0 : 1;
} catch { process.exitCode = 1; }
