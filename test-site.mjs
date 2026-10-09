// Trail demo/test site — the XXPROBE library used by the verification
// experiments. Zero dependencies: `node test-site.mjs` (PORT env, default 8769).
// `--variant=v2` moves the compose page to /memo/write and 404s /compose,
// simulating a site redesign for the stale-memory test.
import http from "node:http";

const PORT = Number(process.env.PORT || 8769);
const v2 = process.argv.includes("--variant=v2");

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const page = (h1, inner) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>XXPROBE</title></head>` +
  `<body><main><h1>${h1}</h1>${inner}</main></body></html>`;

const composePath = v2 ? "/memo/write" : "/compose";

const composeHtml = page(
  "쪽지 작성",
  `<form method="GET" action="/done">
     <label>쪽지 내용 <input type="text" name="note"></label>
     <button type="submit">테스트 쪽지 저장</button>
   </form>`
);

const routes = {
  "/": page("XXPROBE 실험 도서관", `<a href="/services">이용 서비스</a>`),
  "/services": page("이용 서비스", `<a href="/desk">쪽지 데스크</a>`),
  "/desk": page("쪽지 데스크", `<a href="${composePath}">쪽지 작성</a>`),
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const send = (code, body) => {
    res.writeHead(code, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  };
  if (u.pathname === "/done") {
    const note = u.searchParams.get("note") || "";
    return send(200, page("테스트 쪽지 저장 완료", `<p>${esc(note)}</p>`));
  }
  if (v2 && u.pathname === "/compose") return send(404, page("404", "<p>not found</p>"));
  if (u.pathname === composePath) return send(200, composeHtml);
  if (routes[u.pathname]) return send(200, routes[u.pathname]);
  return send(404, page("404", "<p>not found</p>"));
});

server.listen(PORT, "127.0.0.1", () =>
  console.log(`XXPROBE test site on http://127.0.0.1:${PORT} (variant ${v2 ? "v2" : "v1"})`)
);
