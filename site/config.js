// 默认留空即可——网站由同一个 Worker 托管，会自动连上接口（同源）。
//
// 只有当你把网站单独放在别处（GitHub Pages / Cloudflare Pages）、和 Worker
// 不在同一个域名时，才需要在这里填 Worker 地址（不带结尾斜杠），例如：
//   window.WORKER_BASE = "https://finance.你的子域.workers.dev";
window.WORKER_BASE = "";
