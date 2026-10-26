# 运行环境与本地认证

Python 3.10+（标准库），Node 24，Chrome，puppeteer-core 25.16.0。在仓库根目录 `npm install --ignore-scripts`，复用已安装 Chrome，不下载另一套浏览器。也可在私人 runtime.local.json 指定已有 puppeteer-core 入口。

`--home` 或 CODEX_UPLOAD_HOME 指向账号私人目录，必须在 Git 和公开交接包之外。该目录包含 runtime.local.json、user-profile.json、account.json、browser-profile、jobs 和 state。不要打印或上传 profile 内容，不扫描其他浏览器寻找 Cookie。

runtime.local.json 必填 node_executable、browser_executable；可选 puppeteer_module 为已安装包的实际 JS 入口路径。release_root 指向可授权上传的成品根目录。user-profile.json 覆盖公开默认项，并明确 allow_automated_publish=true 与 release_root；collection 可指定真实 id/name。不要将本机账号 ID、运行时路径和认证 profile 直接写入公共示例。

首次 `login` 打开独立 Chrome，由用户本人登录 B 站；脚本只观察登录完成并读取公开账号标识，随后绑定该 mid。后续 doctor/publish/edit 自动使用此 profile，账号不同立即停止。登录过期或验证码属于阻塞，不能声称保证永远无人介入。

若本机已有安全的运行时配置，直接复用，不反复问默认值。权限不足时只报告具体目录/操作，不修改全局安全设置。Chrome 支持已经做真实账号只读检查；Edge 路径兼容尚未实际验证，应单独验收后再改变默认。
