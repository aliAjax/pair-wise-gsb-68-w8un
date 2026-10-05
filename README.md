# 新闻事实核查证据链与发布审阅工作台

基于React、Chakra UI、Zustand、React Router、TanStack Query、Axios、Vite和TypeScript的独立前端工程。数据使用浏览器本地持久化。

## 功能

- 核查主张列表、搜索、状态筛选和新建。
- 可验证事实树、支持证据、相反证据、置信度和未解决疑点。
- **可核验收件链（收件台 `/intake`）**：
  - 舆情回调按「公开地址 + 内容哈希」入来源版本库：相同哈希只留一条（`deduped` 回执，回调次数累加）；
  - 同址不同哈希作为改版并列保留多版，不互相覆盖；事实用 `versionRefs` 钉住确定哈希，未钉住且存在多版的事实标「引用不确定版本」并阻断发布；
  - 两名核查员同时提交同一版本时，后到者只生成 `verification-only` 比对值，不新增卡片；
  - 旧来源缺哈希先进「待核」，补齐哈希（显式补哈希送达）才升级为有效版本，待核件不能关联、不能发布；
  - 撤回件到达：依赖该版的**未发布**结论自动失效（结论置证据不足、置信度归零、加系统批注与疑点），必须人工重算；**已发布**快照只标记撤回哈希，深拷贝内容永久可追；
  - 写入失败保留完整收件批次为「部分失败」，从批次恢复时重放已完成项重建状态、只补未完成项并保留原始回执。
- 原始证据、二次来源、待证信息分类与内容哈希留档。
- 证据关系图、来源时间线、多人批注和解决状态。
- 发布前收件链校验（待核/撤回/不确定版本拦截）、版本记录、完整档案与审计导出。

端口为`18468`。

```bash
npm install
npm run build
npm run dev
```

收件链纯函数在 `src/services/intakeChain.ts`，端到端规则断言见 `chain-test.mts`：

```bash
npx esbuild chain-test.mts --bundle --platform=node --format=esm --outfile=/tmp/chain-test.mjs && node /tmp/chain-test.mjs
```
