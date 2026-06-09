// 部署 Worker 后，把它的地址填到这里（不要结尾的斜杠），网站就会自动：
//   1) 从 Worker 拉取全市场目录（搜索覆盖全部股票，不再只有精选）
//   2) 点击"最新财报"直接跳转到 PDF（A股/港股也不用再输代码）
// 例如：
//   window.WORKER_BASE = "https://caibao-resolver.你的子域.workers.dev";
//
// 留空则退回纯静态模式：只显示精选公司，链接指向官方页面。
window.WORKER_BASE = "";
