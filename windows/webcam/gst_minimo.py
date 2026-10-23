"""Copia só a parte do GStreamer que o receptor nativo usa (usado pelo workflow webcam-windows).

Uso: python gst_minimo.py <raiz do GStreamer instalado> <destino>

Leva os plugins da lista e, de bin/, só as DLLs de que eles (e o app) dependem, seguindo as
importações de cada DLL. A estrutura fica igual à do GStreamer (bin/ e lib/gstreamer-1.0/).
"""
import os
import shutil
import sys

import pefile

PLUGINS = [
    "gstcoreelements", "gstapp", "gstwebrtc", "gstnice", "gstdtls", "gstsrtp", "gstsctp",
    "gstrtpmanager", "gstrtp", "gstvideoparsersbad", "gstd3d11", "gstmediafoundation",
    "gstvideoconvertscale",
]
# bibliotecas que o app chama direto (Nativo.cs)
DIRETAS = ["gstreamer-1.0-0.dll", "gstapp-1.0-0.dll", "gstsdp-1.0-0.dll", "gstwebrtc-1.0-0.dll",
           "gobject-2.0-0.dll", "glib-2.0-0.dll"]


def achar_raiz(r):
    for base, _, arquivos in os.walk(r):
        if "gstreamer-1.0-0.dll" in arquivos and os.path.basename(base).lower() == "bin":
            return os.path.dirname(base)
    sys.exit("gstreamer-1.0-0.dll não encontrada em " + r)


def importacoes(caminho):
    pe = pefile.PE(caminho, fast_load=True)
    pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_IMPORT"],
                                           pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT"]])
    nomes = []
    for attr in ("DIRECTORY_ENTRY_IMPORT", "DIRECTORY_ENTRY_DELAY_IMPORT"):
        for e in getattr(pe, attr, []):
            nomes.append(e.dll.decode("ascii", "ignore"))
    pe.close()
    return nomes


def main():
    raiz = achar_raiz(sys.argv[1])
    destino = sys.argv[2]
    bin_ = os.path.join(raiz, "bin")
    plug = os.path.join(raiz, "lib", "gstreamer-1.0")
    na_bin = {n.lower(): n for n in os.listdir(bin_)}
    os.makedirs(os.path.join(destino, "bin"), exist_ok=True)
    os.makedirs(os.path.join(destino, "lib", "gstreamer-1.0"), exist_ok=True)

    pendentes, vistos = [], set()
    for p in PLUGINS:
        f = os.path.join(plug, p + ".dll")
        if not os.path.exists(f):
            print("AVISO: plugin ausente:", p)
            continue
        shutil.copy2(f, os.path.join(destino, "lib", "gstreamer-1.0"))
        pendentes.append(f)
    for d in DIRETAS:
        origem = os.path.join(bin_, na_bin[d.lower()])
        vistos.add(d.lower())
        shutil.copy2(origem, os.path.join(destino, "bin"))
        pendentes.append(origem)
    while pendentes:
        f = pendentes.pop()
        for imp in importacoes(f):
            k = imp.lower()
            if k in na_bin and k not in vistos:
                vistos.add(k)
                origem = os.path.join(bin_, na_bin[k])
                shutil.copy2(origem, os.path.join(destino, "bin"))
                pendentes.append(origem)
    total = 0
    for base, _, arquivos in os.walk(destino):
        for a in arquivos:
            total += os.path.getsize(os.path.join(base, a))
    print("GStreamer mínimo: %d DLLs em bin, %d plugins, %.1f MB" % (len(vistos), len(PLUGINS), total / 1e6))


if __name__ == "__main__":
    main()
