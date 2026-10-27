# codex-upload-video

`codex-upload` 是 Bilibili 投稿与稿件修改的 Codex skill。有效本地登录与授权齐备时，自动设置字段、读回、最终提交并保存平台回执；不是停在提交按钮前的填表工具。

支持双比例封面、标题/简介、动态标签、AI 与原创声明、News 等合集及相关热门免费活动。上传与修改分开，重复视频/期次/reset 事件受到幂等保护，未知提交先回查，不盲目二投。Chrome 优先，Edge 后续兼容。

## 安装

将仓库的 `codex-upload/` 完整目录安装到 Codex skills 目录。DSH 等环境可显式读取 `codex-upload/SKILL.md` 并调用同一 Python CLI。根目录 `npm install --ignore-scripts` 安装固定版本 puppeteer-core；Python 仅使用标准库。认证与本地路径配置见 [runtime](codex-upload/references/runtime.md)。

在配置的私人 home 中完成一次 `login`，之后复用登录态。不要将浏览器 profile、cookies、token、成片或新闻数据库提交到此仓库。当前用户默认值在 assets/default-profile.json，个人授权、账号和路径留本地。

## 使用

```text
python codex-upload/scripts/codex_upload.py --home LOCAL_PRIVATE_HOME doctor
python codex-upload/scripts/codex_upload.py --home LOCAL_PRIVATE_HOME from-release RELEASE_DIRECTORY
python codex-upload/scripts/codex_upload.py --home LOCAL_PRIVATE_HOME plan MANIFEST
python codex-upload/scripts/codex_upload.py --home LOCAL_PRIVATE_HOME publish MANIFEST --execute --unattended
```

已有默认配置且所需信息完整时直接执行；交互模式只集中确认真实缺项。用户授权的无人值守流程不再等待人工点提交。登录/验证码、字段不可编辑、平台风控或网络故障会结构化停止，不能保证外部条件永远不需要人处理。

编辑和状态契约见 [contract](codex-upload/references/contract.md)。成品包必须先 ready_for_upload；平台 submitted 不等于审核通过，只在公开回查成功后标 published。

## 验证

```text
python -B -m unittest discover -s tests -p "test_*.py" -v
node --test tests/forms.test.mjs tests/cover_editor.test.mjs
```

Node DOM 测试需要设置 CUP_BROWSER=Chrome 路径；可选 CUP_PUPPETEER_MODULE 指向已有包入口，否则使用 npm 安装的依赖。该测试启动未登录的隔离浏览器，拦截所有网络，模拟平台回执，不向 B 站发稿。未设置 CUP_BROWSER 时会明确跳过 DOM 测试，不能将此视作端到端通过。

生产部署强制使用完整验证入口：`python -B validate.py --node NODE_EXE --browser CHROME_EXE --puppeteer PUPPETEER_MODULE`。Python及实际Chrome回归必须全部成功、零跳过；`.validation/latest.json`绑定完整技能源码、测试、原生夹具与日志。项目`sync_upload_skill.py --apply --installed`在复制前检查该记录，代码或测试变化后必须重验。指纹覆盖scripts下全部Python/ES模块，不能只核对旧的三个文件。

`cover_editor.mjs`使用原生双比例结构，按实际crop-box验证本地图像及保存后的读回。`tests/fixtures/native-cover.js`是脱敏重建的交互契约：惰性标签、真实中心点击、共享输入、隐藏干扰、同步提示和异步保存；没有平台代码或账号数据。未知结构、保存损坏、比例未激活等必须在提交前停止。已发布稿不用于开发试传。

当前状态：Chrome对真实新视频已完成自动提交与公开发布核验；隔离浏览器测试覆盖双封面、声明、标签、活动、重名合集及提交回执。Edge未验证，不使用已发布稿件做二次公开测试。

参考 [biliup/biliup](https://github.com/biliup/biliup) 与 [grapeot/bilibili-upload-skill](https://github.com/grapeot/bilibili-upload-skill)，归属及边界见 NOTICE。实现独立，不调用或绕过后者的人工提交守卫。


## 2026-10-27 实操更新

Chrome已经对真实新稿完成自动上传、双封面、科技数码、News、标签、AI/原创多选声明、相关免费活动、最终提交与公开发布核验。Edge未验证。新稿空封面入口与异步渲染已兼容；封面用实际画布像素读回，隐藏设置读真实checked值。表单内有限重试不重新选视频，unknown仍回查而非盲目重投。详细约束见skill及references/contract.md。更新没有修改任何旧公开稿件，也不包含账号或浏览器数据。
