# Phase 2.8-E systemd Production Service

Phase 2.8-E: COMPLETE VERIFIED

System:
Ubuntu 24.04.4 LTS
x86_64
Node v22.23.2

Git:
branch=master
HEAD=a7230d6
working tree=clean except phase-2.8-D-report.md

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
service=hs-audio-verify.service
enabled=YES
active=YES
Restart=always
automatic restart test=PASS

Automatic restart:
OLDPID=43857
NEWPID=44016
NEWPID != OLDPID

HTTP:
health=PASS

Bind:
127.0.0.1:8767

Extractor:
NOT CALLED

Windows Hearthstone dependency:
NONE

Nginx:
NOT CONFIGURED

HTTPS:
NOT CONFIGURED

Public HTTP:
NOT TESTED

UFW:
NOT MODIFIED

Git:
NO COMMIT
NO PUSH
