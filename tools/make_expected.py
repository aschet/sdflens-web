# SPDX-FileCopyrightText: 2026 Thomas Ascher <thomas.ascher@gmx.at>
#
# SPDX-License-Identifier: GPL-3.0-or-later

"""Write test/expected.json: what sdfio and x3pio read from the sample files of test/samples.

Run it with a Python that has sdfio and x3pio installed: ``python tools/make_expected.py``.
"""

import json
from pathlib import Path

import numpy as np
import sdfio
import x3pio

SAMPLES = Path(__file__).parent.parent / "test" / "samples"


def summary(z: np.ndarray, x: np.ndarray | None = None) -> dict:
    finite = np.isfinite(z)
    return {
        "min": float(np.min(z[finite])),
        "max": float(np.max(z[finite])),
        "mean": float(np.mean(z[finite])),
        "invalid": int(z.size - finite.sum()),
    }


expected = {}
for path in sorted(SAMPLES.glob("*.sdf")):
    sdf = sdfio.read(path)
    rows, columns = sdf.data.shape
    expected[path.name] = {
        "kind": "grid",
        "layers": 1,
        "columns": columns,
        "rows": rows,
        "stepX": sdf.header.x_scale,
        "stepY": sdf.header.y_scale,
        **summary(sdf.data),
    }
for path in sorted(SAMPLES.glob("*.x3p")):
    file = x3pio.read(path)
    layer = file.layers[0]
    z = np.asarray(layer.z, dtype=float)
    if isinstance(file, x3pio.PointCloud):
        entry = {"kind": "cloud", "layers": 1, "columns": z.size, "rows": 1}
    else:
        rows, columns = (1, z.size) if z.ndim == 1 else z.shape
        entry = {"kind": "grid", "layers": len(file.layers), "columns": columns, "rows": rows}
        if file.header.x.is_incremental and file.header.y.is_incremental:
            entry["stepX"] = abs(file.header.x.increment)
            entry["stepY"] = abs(file.header.y.increment)
    expected[path.name] = {**entry, **summary(z.ravel())}
(SAMPLES.parent / "expected.json").write_text(json.dumps(expected, indent=2) + "\n")
print(f"{len(expected)} files")
