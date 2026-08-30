# 微信小程序局域网预览（开发阶段）

这是开发阶段方案：电脑运行 Mini API，手机通过同一局域网访问。  
**不是正式上线方案。** 不要用它替代合法域名、HTTPS、备案或生产部署。

当前微信开发者工具已关闭「校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」（`urlCheck: false`）。这只适用于开发调试。

## 1. 同一局域网

电脑和手机必须连接**同一个 Wi-Fi / 局域网**。

手机热点、访客网络、开启「AP 隔离 / 客户端隔离」的网络通常会导致手机看不到电脑。

## 2. 电脑启动 Mini API

在项目根目录：

```
npm run mini
```

默认监听 `0.0.0.0:8767`（可用环境变量 `MINI_HOST`、`MINI_PORT` 覆盖）。

## 3. 看终端里的 LAN 地址

启动成功后终端会打印类似：

```
Local:
  http://127.0.0.1:8767

LAN:
  http://192.168.x.x:8767
```

把 LAN 那一行复制下来。不要把某个 `192.168.x.x` 写进业务代码。

也可查看启动时生成的：

`data/mini-preview/last-lan-url.txt`

## 4. 手机浏览器先测 health

在手机浏览器打开：

```
http://<电脑局域网IP>:8767/api/mini/health
```

若看到类似：

```json
{ "ok": true, "service": "mini-api", "port": 8767 }
```

说明手机已经能访问电脑上的 Mini API。

## 5. 微信开发者工具

继续使用：

```
http://127.0.0.1:8767
```

小程序默认 API Base 就是这个地址。开发者工具的 `platform` 为 `devtools`，不会改用 LAN IP。

改 JS 后请重新编译。

## 6. 手机微信预览

真机预览时，小程序必须访问：

```
http://<电脑局域网IP>:8767
```

`npm run mini` 会把检测到的 LAN 地址写入：

`miniprogram/utils/apiBase.lan.js`

真机（iOS / Android）会走这个地址。开发者工具仍走 `127.0.0.1`。

可选手动覆盖（开发者工具和真机都会用）：编辑

`miniprogram/utils/apiBase.override.js`

把 `apiBase` 设成完整 URL。不要把某个电脑的 IP 当成项目永久默认值。

也可用环境变量让启动时写入指定 Base（不改业务代码）：

```
MINI_API_BASE=http://192.168.x.x:8767
```

写入后需重新编译小程序。

Catalog / Search / Card Detail / Voice / Music / Entrance 都走 `miniprogram/utils/config.js` 与 `miniprogram/utils/audio.js`，不要在页面里写死 API 地址。

## 7. 手机浏览器打不开 health 时

先不要改小程序代码。按下面排查：

1. 电脑和手机是否同一 Wi-Fi。
2. Windows 网络类型（专用网络通常比公用网络更容易被访问）。
3. Windows 防火墙是否拦截入站 TCP 8767。
4. Mini API 是否监听 `0.0.0.0`（终端应显示 `Server listening on 0.0.0.0:8767`）。
5. 路由器是否开启 AP 隔离 / 客户端隔离。

本机 PowerShell 可检查端口（把 IP 换成终端里的 LAN IP）：

```
Test-NetConnection -ComputerName 192.168.x.x -Port 8767
```

本机浏览器也可试：

```
http://127.0.0.1:8767/api/mini/health
http://<LAN-IP>:8767/api/mini/health
```

本机访问 LAN IP 成功，不能证明手机一定能连。

**不要自动改防火墙。** 若确认是防火墙拦截，需要**管理员权限**手动添加入站规则放行 TCP 8767。未确认前不要改系统设置。
