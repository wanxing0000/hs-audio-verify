# Phase 2.9 微信小程序生产 API 接入 + 真机验证

Phase 2.9: BLOCKED

失败步骤：STEP 10 微信开发者工具配置检查（及之后的开发者工具 / 真机验证）

原因：本环境无法打开微信开发者工具或真机微信客户端，不能把「不校验合法域名」当作生产完成。

## Production API

https://api.hsvoiceguide.online

## Server

- Node: 127.0.0.1:8767
- systemd: active
- Nginx: not modified this phase
- HTTPS: health / catalog / latest verified from this workstation
- 127.0.0.1:8767: localhost-only (ss)

## API

- Health: PASS (HTTP 200, audioSource=production)
- Catalog: PASS (HTTP 200)
- Latest: PASS (ESCAPEFROM_VIOLET_HOLD / 164)
- Voice / Music / Entrance: not re-played in WeChat this phase
- Server-side HIT/MISS already verified in Phase 2.8-F

## Error handling

- AUDIO_NOT_AVAILABLE: existing player shows 暂时无法播放 on download 404 (not rewritten)
- NO_VOICE: same download 404 path
- network error: catalog/latest/card copy updated to 网络异常，请稍后重试

## Mini Program

- Production Base URL: https://api.hsvoiceguide.online (config.js DEFAULT + apiBase.lan.js)
- override remains null
- request / downloadFile legal domain: MUST be configured in WeChat MP admin (not done here)
- Developer Tools: NOT VERIFIED
- Real device: NOT VERIFIED
- project.config.json still has urlCheck=false (dev setting; not treated as production complete)

## Security

- no server secret
- no Supabase service role key
- no IP hardcoding in production config
- no localhost production URL
- no 8767 public exposure
- diagnostic snapshot.json still has localhost (dev fixture, not production config)

## Tests

npm test PASS (includes test/miniappProductionApi.test.js)

## Git

NO COMMIT
NO PUSH

## Result

BLOCKED
