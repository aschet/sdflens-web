# SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
#
# SPDX-License-Identifier: GPL-3.0-or-later

"""Write test/expected-glb.json: what the GLB export of sdflens makes of the sample files of test/samples.

Run it with a Python that has sdflens installed: ``python tools/make_expected_glb.py``. The test compares the
export of the page with these numbers, so that the two writers stay in step.
"""

import json
import struct
from pathlib import Path

import numpy as np
from sdflens.colormap import build_lut
from sdflens.gltf import ViewShape, glb_bytes
from sdflens.surfacefile import build_mesh, build_model, read_surface_file

SAMPLES = Path(__file__).parent.parent / "test" / "samples"
Z_FACTOR = 7.5
DTYPES = {5126: np.float32, 5121: np.uint8, 5125: np.uint32}
WIDTHS = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}


def accessor(document: dict, binary: bytes, index: int) -> np.ndarray:
    entry = document["accessors"][index]
    view = document["bufferViews"][entry["bufferView"]]
    width = WIDTHS[entry["type"]]
    array = np.frombuffer(
        binary, dtype=DTYPES[entry["componentType"]], count=entry["count"] * width, offset=view["byteOffset"]
    )
    return array.reshape(-1, width) if width > 1 else array


expected = {}
for path in sorted([*SAMPLES.glob("*.sdf"), *SAMPLES.glob("*.x3p")]):
    model = build_model(read_surface_file(str(path)))
    if model.is_profile:
        continue
    data = glb_bytes(ViewShape(model, build_mesh(model), build_lut("Viridis")), Z_FACTOR)
    text_length = struct.unpack_from("<I", data, 12)[0]
    document = json.loads(data[20 : 20 + text_length])
    binary = data[28 + text_length :]
    primitive = document["meshes"][0]["primitives"][0]
    attributes = primitive["attributes"]
    positions = accessor(document, binary, attributes["POSITION"])
    entry = {
        "vertices": len(positions),
        "mode": primitive["mode"],
        "positions": positions.sum(axis=0, dtype=np.float64).tolist(),
        "colors": accessor(document, binary, attributes["COLOR_0"]).sum(axis=0, dtype=np.int64).tolist(),
        "extentMeters": document["asset"]["extras"]["extent_meters"],
    }
    if "indices" in primitive:
        indices = accessor(document, binary, primitive["indices"])
        entry["indices"] = len(indices)
        entry["indexSum"] = int(indices.sum(dtype=np.int64))
        entry["normals"] = accessor(document, binary, attributes["NORMAL"]).sum(axis=0, dtype=np.float64).tolist()
    expected[path.name] = entry
(SAMPLES.parent / "expected-glb.json").write_text(json.dumps(expected, indent=2) + "\n")
print(f"{len(expected)} files at {Z_FACTOR}x")
