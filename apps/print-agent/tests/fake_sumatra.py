"""SumatraPDF falso para las pruebas: anota los argumentos y devuelve el código pedido. NO imprime nada."""
import json
import os
import sys
import time

log = os.environ.get("FAKE_SUMATRA_LOG")
if log:
    with open(log, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(sys.argv[1:]) + "\n")
sleep = float(os.environ.get("FAKE_SUMATRA_SLEEP", "0"))
if sleep:
    time.sleep(sleep)
# FAKE_SUMATRA_EXITS="5,5,0": un código por llamada (el último se repite)
seq = [int(x) for x in os.environ.get("FAKE_SUMATRA_EXITS", "0").split(",")]
counter_file = (log or "") + ".n"
n = 0
if log:
    try:
        with open(counter_file) as fh:
            n = int(fh.read())
    except Exception:
        n = 0
    with open(counter_file, "w") as fh:
        fh.write(str(n + 1))
sys.exit(seq[min(n, len(seq) - 1)])
