# Phase 2.8-F Nginx HTTPS Public Deployment

Phase 2.8-F: COMPLETE VERIFIED

System:
Ubuntu 24.04.4 LTS
x86_64
Node v22.23.2

Domain:
api.hsvoiceguide.online

Let's Encrypt:
2251679842@qq.com

Git:
branch=master
HEAD=a7230d6

Production audio:
649 files
483129187 bytes
voice=350
music=200
entrance=98
manifest=VALID

Production environment:
ENV_VALID

Production package:
PACKAGE_READY

Production tests:
PRODUCTION_TESTS_PASS

systemd:
enabled=YES
active=YES
Restart=always

Node:
127.0.0.1:8767

Nginx:
ACTIVE

Reverse proxy:
PASS

HTTP:
PASS

HTTPS:
PASS

HTTP to HTTPS:
PASS
301 -> https://api.hsvoiceguide.online/api/mini/health

Certificate:
PASS
Issuer=Let's Encrypt YE1
notBefore=2026-08-30
notAfter=2026-11-28

Certificate renewal dry-run:
PASS

Health:
PASS

Catalog:
PASS
total=7263

Latest:
PASS
ESCAPEFROM_VIOLET_HOLD / 164

Voice:
PASS
GET 200 audio/wav

Music:
PASS
GET 200 audio/wav

Entrance:
PASS
GET 200 audio/wav

Production miss:
PASS
CAP_107 -> AUDIO_NOT_AVAILABLE

Unknown card:
PASS
ZZZ_NO_SUCH_CARD_999 -> NO_VOICE

8767:
LOCALHOST ONLY
public TCP 8767 from this workstation: connection timed out

UFW:
inactive
22/80/443 not opened by this phase
8767=NOT ALLOWED

Tencent Cloud Security Group:
not modified by this phase
required inbound: TCP 22, TCP 80, TCP 443
8767=NOT ALLOWED

Extractor:
NOT CALLED

Windows Hearthstone dependency:
NONE

production-audio:
UNCHANGED

.env:
NOT TRACKED

Nginx error:
NO PERSISTENT 5xx

Git:
NO COMMIT
NO PUSH
