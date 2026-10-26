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
node --test tests/forms.test.mjs
```

Node DOM 测试需要设置 CUP_BROWSER=Chrome 路径；可选 CUP_PUPPETEER_MODULE 指向已有包入口，否则使用 npm 安装的依赖。该测试启动未登录的隔离浏览器，拦截所有网络，模拟平台回执，不向 B 站发稿。未设置 CUP_BROWSER 时会明确跳过 DOM 测试，不能将此视作端到端通过。

当前状态：本机真实账号登录、投稿/编辑表单和合集已做只读核查；离线浏览器验证了双封面、多选声明、动态标签、活动、重名合集和最终提交回执。真实新视频的完整投稿尚未实测，没有重复上传已有视频进行验证。

参考 [biliup/biliup](https://github.com/biliup/biliup) 与 [grapeot/bilibili-upload-skill](https://github.com/grapeot/bilibili-upload-skill)，归属及边界见 NOTICE。实现独立，不调用或绕过后者的人工提交守卫。
