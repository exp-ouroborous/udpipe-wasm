#!/usr/bin/env bash
# Downloads the english-ewt UD 2.5 model used by the e2e test. ~16 MB.
set -euo pipefail
DEST="$(cd "$(dirname "$0")" && pwd)/fixtures/english-ewt.udpipe"
URL="https://raw.githubusercontent.com/jwijffels/udpipe.models.ud.2.5/master/inst/udpipe-ud-2.5-191206/english-ewt-ud-2.5-191206.udpipe"
if [ -s "$DEST" ]; then echo "model present: $DEST"; exit 0; fi
curl -sL -o "$DEST" "$URL"
echo "downloaded $(ls -lh "$DEST" | awk '{print $5}') -> $DEST"
