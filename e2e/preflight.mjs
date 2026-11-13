const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const targetUrl = `${baseURL}/api/auth/get-session`;

try {
  const res = await fetch(targetUrl);
  if (res.status !== 200) {
    console.error(
      `\n[E2E 预检失败] 请求 ${targetUrl} 返回状态码 ${res.status}（预期为 200）。\n请确认前后端服务是否已启动就绪，可先执行：docker compose up -d --build\n`,
    );
    process.exit(1);
  }
  const body = await res.json();
  if (body !== null) {
    console.error(
      `\n[E2E 预检失败] 请求 ${targetUrl} 返回内容不为 null（当前已有残留会话）。\n请确认服务状态，或重新部署：docker compose up -d --build\n`,
    );
    process.exit(1);
  }
  console.log(`[E2E 预检通过] ${targetUrl} 响应正常（HTTP 200, body: null）。`);
} catch (err) {
  console.error(
    `\n[E2E 预检失败] 无法连接到服务 ${targetUrl}：${err instanceof Error ? err.message : String(err)}\n请确认前后端服务是否已启动就绪，可先执行：docker compose up -d --build\n`,
  );
  process.exit(1);
}
