# 月度累积计时器 · dsh-month-timer

对话框上方常驻的一枚月度进度条：按月分别记账，把「这一段在忙什么」连同时长一起记成彩色阶段。

![月度累积计时器](docs/preview.png)

## 安装

三种方式任选一种，装完在 `插件` 面板里确认它是启用状态即可（插件 ID：`dsh-month-timer`）。

1. **插件市场**（推荐）：打开 `插件市场`，搜「月度进度条」或 `dsh-month-timer`，点安装。
2. **Release 里的 tgz**（不依赖 git，最稳）：`插件` → `添加插件` → 粘
   `https://github.com/862287884-alt/dsh-month-timer/releases/latest/download/dsh-month-timer.tgz`
3. **仓库地址**：同一处填 `https://github.com/862287884-alt/dsh-month-timer`（或 `github:862287884-alt/dsh-month-timer`）。这条走 pnpm 的 git 解析，**本机得装了 git** 才成功。

要求：DSH 桌面端 / Web 端均可（客户端插件只用到 `shell.overlay`、`conversation.composer.dock` 两个槽位和 `locale` 服务），React 18 由宿主提供。数据只写本机 `localStorage`，不联网。

外观用的是一张横幅素材（鲸鱼女仆），进度槽正好落在素材中间那条带子上，所以整体是「一张横幅 + 叠在上面的进度与文字」，宽度可拖动调整，高度按 3200:941 等比跟随。卡片停在输入框正上方，跟着对话栏的位置走。

## 它做什么

- **只记手填的时长**：不自动走时、不需要暂停。在卡片下方填「分:秒」+ 一句备注，点 ＋ 或回车，就把这一段落成一条阶段。时长按真实比例铺成彩条，颜色按调色板顺序自动区分。
- **达成节点**：当月工作日（周一至周五）数量 × **2 或 × 3** **分钟** = 节点（21 个工作日 × 3 = 63分），倍率用月份右边的下拉框切换，改完立刻重算（节点、量程、状态、百分比一起变）。进度条的量程取节点 × 2，节点固定在正中间；没到节点显示 ⭕️ 未完成，到了显示 ✅️ 已完成。「达成」按节点算，所以越过节点后会显示 100% 以上（122% 就是超出 22%）。
- **单位只有分:秒**：时钟、阶段时长、距节点一律按「分:秒」写，满 60 分钟不折成小时——61 分 59 秒就写 `61:59`，76 分 40 秒写 `76:40`。
- **外观**：右上角的滑杆按钮里可以选**背景**（纸面 / 毛玻璃 / 透明）和**位置**（页面上方 / 页面下方）。素材本身带透明通道，所以「毛玻璃」是在半透明白底上做背景模糊，「透明」则完全露出后面的页面内容、只留角色与相框。
- **按月分开**：每月一本账，切换月份只看那一个月；月份列表只列到当月。「阶段」显示这个月记了几段。
- **看与删**：鼠标移到彩条上会浮出这条阶段的信息（备注、时长、添加日期）；在彩条上右键弹出「删除该阶段」，点一下就从进度里减掉；聚焦到彩条上按 Delete 也行。
- **其他**：右上角可以收起成一条细条；右下角的斜纹手柄拖动改整体宽度（最小 700、最大 1600），双击手柄回到「跟随对话栏宽度」。

## 数据放在哪

浏览器 localStorage，键名 `dsh-month-timer.store.v1`：

```jsonc
{
  "version": 1,
  "width": 0,            // 0 = 跟随对话栏宽度
  "collapsed": false,
  "month": "2026-11",    // 当前在看的月份
  "nodeMode": 3,         // 界定节点倍率：2 或 3（节点 = 工作日 × N 分钟）
  "bg": "glass",         // 背景：paper 纸面 / glass 毛玻璃 / clear 透明
  "position": "bottom",  // 位置：top 页面上方 / bottom 页面下方（对话框上）
  "months": {
    "2026-11": {
      "stages": [{ "id": "…", "ms": 7800000, "note": "…", "at": "2026-11-09T10:24:00.000Z", "color": "#5B6FE0" }],
      "pendingMs": 0     // 旧版自动计时留下的字段，现已废弃
    }
  }
}
```

只写本机这一份，不联网、不上报；换浏览器或清掉 site data 就没了。

## 要说明的口径

1. **工作日只按周一到周五算**，没有接中国的法定节假日与调休表。遇到长假当月，节点会比真实工作日偏多；如果你需要按真实工作日算，可以先把 `src/store.ts` 里的 `workdaysInMonth` 换成带节假日表的实现，再 `bun scripts/build.mjs` 重打包。
2. **旧数据会自动迁移**：早期版本自动累积、还没提交的那段 `pendingMs`（≥1000ms）会在读取时变成一条「未备注」阶段，不会丢；此后不再产生新的 `pendingMs`。

## 开发

```sh
# 素材：把根目录的横幅 PNG 压成内嵌的 WebP data URL（src/asset.ts）
python scripts/make-asset.py

# 打包：src/app.tsx → client.js（内嵌 __ModuleLoader__ 外壳）
bun scripts/build.mjs
```

> 注意：这两个源文件是 UTF-8，**不要用 PowerShell 的 `Get-Content -Raw` + `Set-Content` 改**——PS 5.1 会按 ANSI/GBK 解码，把中文整体写成乱码。用编辑器或 python 显式 `encoding="utf-8"`。

改完 `client.js` 不用重启应用：客户端插件走 HMR，保存后运行中的页面会热加载新 bundle（宿主半侧 `index.js` 的改动才需要 toggle 一次插件）。

`test/preview.html` 是不启动 DSH 的独立预览页：本地有 React 的 UMD 版本时，它会伪造 `window.__ModuleLoader__` 与一个假 ctx，把卡片渲染出来，方便调样式和交互。

参数：`?scenario=done|half|empty` 选数据集，`?mode=2|3` 指定倍率，`?width=900` 指定宽度，`?month=2026-10` 看指定月份，`?keep` 保留上一次的数据，`?slowslots=1800` 模拟 `slots` 服务延迟就绪（验证轮询注册）。

## 排查：插件「已启用」但页面不出现

浏览器半侧要等 `slots` 服务就绪后才能注册。客户端插件在 `apply` 时 `ctx.slots` 可能还不存在，早期版本在这里直接 `return`，于是永久静默不注册。现在：

- `mount()` 会轮询等 `slots`（约 45 秒，200ms 起步逐步放宽到 1 秒）；拿到后先装样式，再注册 `shell.overlay` 与 `conversation.composer.dock`。
- `package.json` 的 `dsh.client.inject` 声明了 `dsh-client-locale`、`dsh-client-ui-slots`、`dsh-client-ui-conversation`，并去掉了 `immediately`，与其它能注册到浮层的插件保持一致。
- 读服务也做了防御：Cordis 里读一个没在 `inject` 里声明的服务属性会直接抛异常（`cannot get property "locale" without inject`），所以 `locale` 走 `ctx.get("locale")` 并兜底到本地词典。

仍不出现时，看启动日志（宿主半侧会把客户端上报的标记追加到文件）：

```
%TEMP%\dsh-month-timer-boot.log
```

依次应能看到：

```
--- host half loaded 2026-…
2026-… {"stage":"apply"}
2026-… {"stage":"registered","attempts":0}
```

- 只有 `host half loaded` → 客户端那份 bundle 没被加载（或是 `dsh.client` 声明被跳过）。
- `apply` 之后没有 `registered`，最后出现 `slots-timeout` → 45 秒内 `slots` 一直没就绪。
- 出现 `register-error` → 注册那一步抛了异常，`message` 里是原因。
