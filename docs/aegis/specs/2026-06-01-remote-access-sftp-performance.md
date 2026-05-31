<spec-entry category="arch" keywords="remote-access,sftp,libssh2,performance,ssh-algorithm-negotiation" date="2026-06-01" source="src-tauri/src/remote.rs">

## 1. 问题定义

远程访问 V1 的核心验收不是“能打开一个连接弹窗”，而是用户点击 SFTP 连接后能在可接受时间内看到目录，失败时能立即知道失败原因。

当前需要约束两类问题：

1. 冷启动连接慢：
   - DNS 可能返回多个地址，单个不可达地址不能拖完整体连接流程。
   - libssh2 阻塞 I/O 不能无限等。
   - 测试连接、保存后打开、目录切换应尽量复用已认证的 SFTP subsystem。

2. 握手失败提示不准：
   - `Unable to exchange encryption keys` 是 SSH key exchange / 算法协商失败，不是用户名、密码或私钥路径错误。
   - 客户端能设置现代算法优先级，但如果服务器只开放双方没有交集的算法，必须提示服务器侧配置建议。

## 2. 决策

采用 `ssh2` / bundled `libssh2` 继续实现 SFTP V1，不引入额外 SSH 客户端进程或新的 Rust SSH 栈。

理由：

- 当前 `ssh2 = 0.9.5` 绑定的 `libssh2-sys = 0.3.1` 默认编译 bundled libssh2，避免系统 libssh2 / OpenSSL 混用风险。
- bundled libssh2 已包含现代算法实现，包括 `curve25519-sha256`、`ecdh-sha2-nistp*`、`diffie-hellman-group14-sha256`、`ssh-ed25519`、`rsa-sha2-*`、`chacha20-poly1305@openssh.com`、`aes*-ctr` 和 `hmac-sha2-*`。
- V1 只做目录浏览，使用一个已认证 session + SFTP subsystem 缓存能覆盖最明显的体感性能问题。

## 3. 实现边界

SFTP 连接必须满足：

- 总操作超时不超过 5 秒。
- 单地址 TCP 尝试不超过 500ms，继续尝试后续解析地址，避免 IPv6 / 不可达地址拖慢。
- libssh2 read / write step timeout 设置为 2 秒。
- 冷启动连接后缓存已初始化的 `Sftp` subsystem，目录切换不重新认证。
- 测试连接只 `stat` 起始目录，不读取整个目录。
- 新建连接弹窗生成稳定 draft id，使“测试连接 → 保存 → 打开”能复用同一个缓存 key。
- 缓存签名必须包含 host、port、username、auth method、base path、private key path 和凭据指纹，编辑后不能复用旧凭据会话。
- SFTP 握手前设置现代算法偏好；不支持的算法由 libssh2 忽略。
- key exchange / method / algorithm 协商失败时，提示“SSH 算法协商失败”和服务器侧建议算法，不误导成账号密码错误。

## 4. 非目标

本轮不做：

- 上传、下载、删除、重命名等远程写操作。
- SSH agent、known_hosts 校验、jump host、proxy command。
- 自定义算法列表 UI。
- 替换 `ssh2` 为进程级 `sftp` 命令或其他 SSH 库。

## 5. 验证要求

自动化验证：

- `npm test -- remote-access-ui remote-connections`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib remote --no-default-features`
- 完整合并前继续执行 `docs/SMOKE_TEST.md` 中自动化测试列表。

手动验收：

- SFTP 私钥登录测试按钮 5 秒内返回成功或明确失败。
- 测试成功后保存并打开连接，不应再次长时间冷启动。
- 点击远程目录能进入子目录。
- 如果出现 `Unable to exchange encryption keys`，UI 显示 SSH 算法协商失败及建议算法。
</spec-entry>
